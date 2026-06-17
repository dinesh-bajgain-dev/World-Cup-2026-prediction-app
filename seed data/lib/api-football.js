import { supabase, updatePredictionResults } from "./supabase";

const API_KEY = import.meta.env.VITE_API_FOOTBALL_KEY;
const BASE_URL = "https://v3.football.api-sports.io";

// Map short API status codes to granular human-readable labels
const STATUS_LABEL = {
  NS:   "Not Started",
  TBD:  "Time TBD",
  "1H": "1st Half",
  "2H": "2nd Half",
  HT:   "Half Time",
  ET:   "Extra Time",
  BT:   "Break Time",
  PEN:  "Penalties",
  SUSP: "Suspended",
  INT:  "Interrupted",
  FT:   "Finished",
  AET:  "Finished (AET)",
  AP:   "Finished (Penalties)",
  P:    "Postponed",
  CANC: "Cancelled",
  ABD:  "Abandoned",
  AWD:  "Awarded",
  WO:   "Walkover",
  LIVE: "Live",
};

// Map API short status to our 3-state status column
const toDbStatus = (short) => {
  if (["FT", "AET", "AP", "AWD", "WO"].includes(short)) return "finished";
  if (["1H", "2H", "HT", "ET", "BT", "PEN", "SUSP", "INT", "LIVE"].includes(short)) return "live";
  return "upcoming";
};

// Normalize team names to handle minor API spelling differences
const TEAM_NAME_MAP = {
  "Côte d'Ivoire":  "Ivory Coast",
  "Cote d'Ivoire":  "Ivory Coast",
  "DR Congo":       "DR Congo",
  "Congo DR":       "DR Congo",
  "Bosnia":         "Bosnia-Herzegovina",
  "Bosnia And Herzegovina": "Bosnia-Herzegovina",
  "United States":  "USA",
  "Korea Republic": "South Korea",
  "New Zealand":    "New Zealand",
  "Saudi Arabia":   "Saudi Arabia",
  "Cape Verde":     "Cape Verde",
};

const normalizeTeam = (name) => TEAM_NAME_MAP[name] || name;

export const syncMatchesWithAPI = async () => {
  if (!API_KEY) {
    console.warn("API-Football key not found. Skipping sync.");
    return { success: false, error: "No API key" };
  }

  try {
    console.log("🔄 Starting API-Football sync...");

    // Fetch all World Cup 2026 fixtures from API
    // Supports both direct api-sports.io key (x-apisports-key) and RapidAPI key
    const response = await fetch(`${BASE_URL}/fixtures?league=1&season=2026`, {
      headers: {
        "x-apisports-key": API_KEY,
        "x-rapidapi-key": API_KEY,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const fixtures = data.response || [];

    if (fixtures.length === 0) {
      console.log("⚠️ No fixtures found in API response.");
      return { success: true, synced: 0 };
    }

    console.log(`📦 Received ${fixtures.length} fixtures from API.`);

    // Load existing matches from DB to build lookup by team names
    // NOTE: include `status` so we can detect newly-finished transitions accurately
    const { data: existingMatches, error: dbError } = await supabase
      .from("matches")
      .select("id, home_team, away_team, match_date, status");

    if (dbError) {
      console.error("❌ Failed to load existing matches:", dbError.message);
      return { success: false, error: dbError.message };
    }

    // Build lookup: "HomeTeam_AwayTeam" → { id, status }
    const matchLookup = {};
    const currentStatusMap = {};
    existingMatches?.forEach((m) => {
      const key = `${normalizeTeam(m.home_team)}_${normalizeTeam(m.away_team)}`;
      matchLookup[key] = m.id;
      currentStatusMap[m.id] = m.status ?? "upcoming";
    });

    let synced = 0;
    let skipped = 0;
    const errors = [];
    const newlyFinished = [];

    for (const fixture of fixtures) {
      const homeTeam = normalizeTeam(fixture.teams.home.name);
      const awayTeam = normalizeTeam(fixture.teams.away.name);
      const key = `${homeTeam}_${awayTeam}`;
      const matchId = matchLookup[key];

      if (!matchId) {
        skipped++;
        continue; // No matching DB match — skip (TBD knockout matches)
      }

      const short = fixture.fixture.status.short;
      const dbStatus = toDbStatus(short);
      const matchStatus = STATUS_LABEL[short] || fixture.fixture.status.long || "Unknown";

      const updateData = {
        status: dbStatus,
        match_status: matchStatus,
        actual_home_score: fixture.goals?.home ?? null,
        actual_away_score: fixture.goals?.away ?? null,
      };

      const { error } = await supabase
        .from("matches")
        .update(updateData)
        .eq("id", matchId);

      if (error) {
        errors.push({ matchId, error: error.message });
        console.error(`❌ Failed to update ${matchId}:`, error.message);
      } else {
        synced++;
        // Detect transition to finished so we can score predictions
        if (dbStatus === "finished" && currentStatusMap[matchId] !== "finished") {
          newlyFinished.push(matchId);
        }
      }
    }

    // Score predictions for any matches that just finished
    if (newlyFinished.length > 0) {
      console.log(`🎯 Scoring predictions for ${newlyFinished.length} newly finished match(es):`, newlyFinished);
      for (const matchId of newlyFinished) {
        await updatePredictionResults(matchId);
      }
    }

    console.log(
      `✅ Sync complete: ${synced} updated, ${skipped} skipped, ${newlyFinished.length} scored, ${errors.length} errors.`,
    );
    return { success: true, synced, skipped, newlyFinished, errors };
  } catch (error) {
    console.error("❌ API Sync failed:", error);
    return { success: false, error: error.message };
  }
};

export const getLiveMatches = async () => {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "live");
  return { data, error };
};

export const getFinishedMatches = async () => {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "finished");
  return { data, error };
};
