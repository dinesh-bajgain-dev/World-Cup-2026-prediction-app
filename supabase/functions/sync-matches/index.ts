// Supabase Edge Function — sync-matches
// Fetches live World Cup 2026 results from API-Football and updates the DB.
// The DB trigger `on_match_finished` automatically scores predictions when a
// match transitions to "finished", so this function only needs to update rows.
//
// Schedule: every 2 minutes via pg_cron (see migration 00007).
// Environment variables required (set in Supabase Dashboard > Edge Functions > Secrets):
//   API_FOOTBALL_KEY  — RapidAPI key for v3.football.api-sports.io
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_FOOTBALL_KEY      = Deno.env.get("API_FOOTBALL_KEY");
const BASE_URL              = "https://v3.football.api-sports.io";
const WC_LEAGUE_ID          = 1;      // FIFA World Cup
const SEASON                = 2026;

// ─── Status mapping ───────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  NS:   "Not Started", TBD:  "Time TBD",
  "1H": "1st Half",   "2H": "2nd Half",
  HT:   "Half Time",  ET:   "Extra Time",
  BT:   "Break Time", PEN:  "Penalties",
  SUSP: "Suspended",  INT:  "Interrupted",
  FT:   "Finished",   AET:  "Finished (AET)",
  AP:   "Finished (Penalties)",
  P:    "Postponed",  CANC: "Cancelled",
  ABD:  "Abandoned",  AWD:  "Awarded",
  WO:   "Walkover",   LIVE: "Live",
};

const toDbStatus = (short: string): "upcoming" | "live" | "finished" => {
  if (["FT","AET","AP","AWD","WO"].includes(short))                   return "finished";
  if (["1H","2H","HT","ET","BT","PEN","SUSP","INT","LIVE"].includes(short)) return "live";
  return "upcoming";
};

// ─── Team name normalisation ──────────────────────────────────────────────────
const TEAM_NAME_MAP: Record<string, string> = {
  "Côte d'Ivoire":          "Ivory Coast",
  "Cote d'Ivoire":          "Ivory Coast",
  "Congo DR":               "DR Congo",
  "Bosnia":                 "Bosnia-Herzegovina",
  "Bosnia And Herzegovina": "Bosnia-Herzegovina",
  "United States":          "USA",
  "Korea Republic":         "South Korea",
  "Türkiye":                "Türkiye",
  "Turkey":                 "Türkiye",
  "Cape Verde":             "Cabo Verde",
};
const norm = (name: string) => TEAM_NAME_MAP[name] ?? name;

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Allow manual POST trigger (e.g. from admin UI or curl)
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!API_FOOTBALL_KEY) {
    return new Response(
      JSON.stringify({ success: false, error: "API_FOOTBALL_KEY secret not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // 1. Fetch all WC 2026 fixtures from API-Football
    // Supports both direct api-sports.io key and RapidAPI key (same endpoint)
    const apiRes = await fetch(
      `${BASE_URL}/fixtures?league=${WC_LEAGUE_ID}&season=${SEASON}`,
      {
        headers: {
          "x-apisports-key":  API_FOOTBALL_KEY,
          "x-rapidapi-key":   API_FOOTBALL_KEY,
          "x-rapidapi-host":  "v3.football.api-sports.io",
        },
      },
    );

    if (!apiRes.ok) {
      throw new Error(`API-Football responded ${apiRes.status}: ${await apiRes.text()}`);
    }

    const { response: fixtures = [] } = await apiRes.json();
    console.log(`[sync] Received ${fixtures.length} fixtures from API-Football`);

    // 2. Load existing DB matches (including current status for transition detection)
    const { data: dbMatches, error: dbErr } = await supabase
      .from("matches")
      .select("id, home_team, away_team, status");

    if (dbErr) throw new Error(`DB load failed: ${dbErr.message}`);

    // Build lookup: "HomeTeam_AwayTeam" → { id, currentStatus }
    const lookup: Record<string, { id: string; status: string }> = {};
    for (const m of dbMatches ?? []) {
      lookup[`${norm(m.home_team)}_${norm(m.away_team)}`] = {
        id: m.id,
        status: m.status ?? "upcoming",
      };
    }

    // 3. Process each fixture
    let synced = 0, skipped = 0;
    const errors: string[] = [];
    const newlyFinished: string[] = [];

    for (const fixture of fixtures) {
      const homeTeam = norm(fixture.teams.home.name);
      const awayTeam = norm(fixture.teams.away.name);
      const entry = lookup[`${homeTeam}_${awayTeam}`];

      if (!entry) { skipped++; continue; }

      const short    = fixture.fixture.status.short as string;
      const dbStatus = toDbStatus(short);
      const label    = STATUS_LABEL[short] ?? fixture.fixture.status.long ?? "Unknown";
      const homeGoals = fixture.goals?.home ?? null;
      const awayGoals = fixture.goals?.away ?? null;

      const { error: updateErr } = await supabase
        .from("matches")
        .update({
          status:              dbStatus,
          match_status:        label,
          actual_home_score:   homeGoals,
          actual_away_score:   awayGoals,
        })
        .eq("id", entry.id);

      if (updateErr) {
        errors.push(`${entry.id}: ${updateErr.message}`);
        console.error(`[sync] Update failed for ${entry.id}:`, updateErr.message);
      } else {
        synced++;
        // Detect newly-finished transition (DB trigger will auto-score)
        if (dbStatus === "finished" && entry.status !== "finished") {
          newlyFinished.push(entry.id);
          console.log(`[sync] 🎯 Match ${entry.id} just finished — DB trigger will auto-score`);
        }
      }
    }

    const summary = { success: true, synced, skipped, newlyFinished, errors };
    console.log("[sync] Complete:", summary);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] Fatal error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
