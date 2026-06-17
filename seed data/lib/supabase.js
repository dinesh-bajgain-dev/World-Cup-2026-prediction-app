import { createClient } from "@supabase/supabase-js";
import { syncMatchesWithAPI } from "./api-football";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "YOUR_ANON_KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export { syncMatchesWithAPI };

// ─── Auth helpers ─────────────────────────────────────────────────────────────
export const signUp = (email, password, username, country = null) =>
  supabase.auth.signUp({
    email,
    password,
    options: { data: { username, ...(country ? { country } : {}) } },
  });

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

const normalizeUsername = (value) => {
  if (!value || typeof value !== "string") return "user";
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  return cleaned || "user";
};

// ─── Profile helpers ──────────────────────────────────────────────────────────
export const isUsernameTaken = async (username) => {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username.trim())
    .maybeSingle();
  return !!data;
};

export const getProfile = async (userId) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return { data, error };
};

export const ensureProfile = async (userId, username = null) => {
  if (!userId) return { data: null, error: new Error("Missing user id") };

  const { data: existing, error: selectError } = await getProfile(userId);
  if (selectError) return { data: null, error: selectError };
  if (existing) return { data: existing, error: null };

  const baseUsername = normalizeUsername(username || "user");
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      { id: userId, username: baseUsername, display_name: username || baseUsername },
      { onConflict: "id" },
    )
    .select()
    .single();

  return { data, error };
};

// ─── Match helpers ────────────────────────────────────────────────────────────
export const getMatches = async (stage = null) => {
  let q = supabase
    .from("matches")
    .select("*")
    .order("match_date")
    .order("match_time");
  if (stage) q = q.eq("stage", stage);
  return q;
};

export const getMatch = async (matchId) =>
  supabase.from("matches").select("*").eq("id", matchId).single();

// ─── Prediction helpers ───────────────────────────────────────────────────────
export const getUserPredictions = async (userId) =>
  supabase.from("predictions").select("*, matches(*)").eq("user_id", userId);

export const getPrediction = async (userId, matchId) =>
  supabase
    .from("predictions")
    .select("*")
    .eq("user_id", userId)
    .eq("match_id", matchId)
    .maybeSingle();

export const upsertPrediction = async (prediction) => {
  // ⛔ Server-side lock check: use prediction_deadline from DB (server timestamp)
  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("prediction_deadline, status")
    .eq("id", prediction.match_id)
    .maybeSingle();

  if (matchError) return { data: null, error: matchError };

  if (!match) {
    return {
      data: null,
      error: new Error("Match not found in database — please refresh and try again"),
    };
  }

  if (match) {
    // Block if match is already live or finished
    if (match.status === "live" || match.status === "finished") {
      return {
        data: null,
        error: new Error("Match has started — predictions cannot be changed"),
      };
    }

    // Check 30-min deadline using server time
    const { data: serverTime, error: timeError } = await supabase
      .rpc("get_server_time")
      .maybeSingle();

    if (timeError) {
      // Fall back to prediction_deadline comparison against client time
      const deadline = new Date(match.prediction_deadline);
      if (new Date() >= deadline) {
        return {
          data: null,
          error: new Error(
            "Prediction deadline has passed (30 min before kick-off)",
          ),
        };
      }
    } else {
      const serverNow = serverTime?.server_time
        ? new Date(serverTime.server_time)
        : new Date();
      const deadline = new Date(match.prediction_deadline);
      if (serverNow >= deadline) {
        return {
          data: null,
          error: new Error(
            "Prediction deadline has passed (30 min before kick-off)",
          ),
        };
      }
    }
  }

  const { data, error } = await supabase
    .from("predictions")
    .upsert(prediction, { onConflict: "user_id,match_id" })
    .select()
    .single();
  return { data, error };
};

// ─── Group qualification helpers ──────────────────────────────────────────────
export const getUserGroupQuals = async (userId) =>
  supabase
    .from("group_qualifications")
    .select("group_id, predicted_first, predicted_second, points_earned, scored_at")
    .eq("user_id", userId);

export const upsertGroupQual = async (qual) => {
  return supabase
    .from("group_qualifications")
    .upsert(
      {
        user_id:          qual.user_id,
        group_id:         qual.group_id,
        predicted_first:  qual.predicted_first,
        predicted_second: qual.predicted_second,
      },
      { onConflict: "user_id,group_id" }
    )
    .select("group_id, predicted_first, predicted_second")
    .single();
};

// ─── Knockout prediction helpers ──────────────────────────────────────────────
export const getUserKnockoutPreds = async (userId) =>
  supabase.from("knockout_predictions").select("*").eq("user_id", userId);

export const upsertKnockoutPred = async (pred) => {
  // Knockout picks (R32 → Final) are not scored for points — they drive bracket
  // visualisation only. No deadline lock is applied here; individual match-score
  // predictions are locked separately in upsertPrediction.
  return supabase
    .from("knockout_predictions")
    .upsert(pred, { onConflict: "user_id,stage,slot_index" })
    .select()
    .single();
};

// ─── Community odds ───────────────────────────────────────────────────────────
export const getCommunityOdds = async (matchId) =>
  supabase
    .from("community_odds")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();

// ─── Players ──────────────────────────────────────────────────────────────────
// Fetch registered users from the leaderboard view.
// Supports search (by username or country), pagination (page 0-based), and
// configurable page size — suitable for millions of users via server-side filtering.
// Ordering mirrors the view's RANK() window: points → exact → correct → accuracy → reg date.
export const getPlayers = async ({ page = 0, limit = 50, search = "" } = {}) => {
  let q = supabase
    .from("leaderboard")
    .select("*", { count: "exact" })
    .order("total_points",       { ascending: false })
    .order("exact_predictions",  { ascending: false })
    .order("predictions_won",    { ascending: false })
    .order("accuracy_pct",       { ascending: false })
    .order("created_at",         { ascending: true  })
    .range(page * limit, page * limit + limit - 1);

  if (search?.trim()) {
    // Search username always; fall back gracefully if country is NULL
    q = q.or(`username.ilike.%${search.trim()}%,country.ilike.%${search.trim()}%`);
  }

  return q;
};

// ─── Leaderboard ──────────────────────────────────────────────────────────────
// Top-N leaderboard for context state (HomeView rank badge, MyPredictions rank).
// Ordering mirrors the view's RANK() tiebreak exactly.
export const getLeaderboard = async (limit = 500) =>
  supabase
    .from("leaderboard")
    .select("*")
    .order("total_points",      { ascending: false })
    .order("exact_predictions", { ascending: false })
    .order("predictions_won",   { ascending: false })
    .order("accuracy_pct",      { ascending: false })
    .order("created_at",        { ascending: true  })
    .limit(limit);

// ─── Admin helpers ────────────────────────────────────────────────────────────
export const adminGetAllUsers = async () =>
  supabase
    .from("profiles")
    .select("*")
    .order("total_points", { ascending: false });

export const adminGetUserPredictions = async (userId) =>
  supabase
    .from("predictions")
    .select("*, matches(*)")
    .eq("user_id", userId)
    .order("submitted_at", { ascending: false });

export const adminGetAuditLog = async (limit = 200) =>
  supabase
    .from("audit_log")
    .select("*, profiles(username)")
    .order("created_at", { ascending: false })
    .limit(limit);

export const adminGetAllPredictions = async ({
  matchId,
  stage,
  groupId,
} = {}) => {
  let q = supabase
    .from("predictions")
    .select(
      "*, profiles(username,display_name), matches(stage,group_id,home_team,away_team,match_date,actual_home_score,actual_away_score)",
    );
  if (matchId) q = q.eq("match_id", matchId);
  if (stage) q = q.eq("matches.stage", stage);
  return q.order("submitted_at", { ascending: false });
};

// ─── Match result helpers ─────────────────────────────────────────────────────
export const getFinishedMatches = async () =>
  supabase
    .from("matches")
    .select("*")
    .eq("status", "finished");

export const getLiveMatches = async () =>
  supabase
    .from("matches")
    .select("*")
    .eq("status", "live");

// ─── Scoring constants ────────────────────────────────────────────────────────
// These mirror the DB scoring_config table values (used for UI display only;
// actual scoring runs server-side via DB functions).
export const SCORING = {
  // Score prediction — bonus/side game (reduced from 10/5)
  EXACT: 3,
  CORRECT: 1,
  WRONG: 0,

  // Group stage qualification
  GROUP_FIRST: 5,   // Correct 1st place prediction
  GROUP_SECOND: 5,  // Correct 2nd place prediction
  GROUP_BOTH: 3,    // Both teams correct regardless of order (additive bonus)

  // Knockout stages — per correct match winner
  R32_WINNER: 2,
  R16_WINNER: 2,
  QF_WINNER: 3,
  SF_WINNER: 5,    // also = correct finalist prediction
  TP_WINNER: 2,    // 3rd place match
  FINAL_WINNER: 10, // Champion
};

export const updatePredictionResults = async (matchId = null) => {
  // Score a specific match (when it just finished) or all finished matches
  let query = supabase.from("matches").select("*").eq("status", "finished");
  if (matchId) query = query.eq("id", matchId);

  const { data: matches, error: matchError } = await query;
  if (matchError) return { error: matchError };

  let totalScored = 0;
  let totalSkipped = 0;
  const errors = [];

  for (const match of matches) {
    if (match.actual_home_score == null || match.actual_away_score == null) {
      totalSkipped++;
      continue;
    }

    // Only score predictions that haven't been scored yet
    const { data: predictions, error: predError } = await supabase
      .from("predictions")
      .select("*")
      .eq("match_id", match.id)
      .is("result_status", null);

    if (predError) {
      errors.push({ matchId: match.id, error: predError.message });
      continue;
    }

    if (!predictions?.length) continue;

    const actualWinner =
      match.actual_home_score > match.actual_away_score
        ? "home"
        : match.actual_away_score > match.actual_home_score
          ? "away"
          : "draw";

    for (const pred of predictions) {
      const userWinner =
        pred.predicted_home_score > pred.predicted_away_score
          ? "home"
          : pred.predicted_away_score > pred.predicted_home_score
            ? "away"
            : "draw";

      const isExact =
        pred.predicted_home_score === match.actual_home_score &&
        pred.predicted_away_score === match.actual_away_score;
      const isCorrect = !isExact && userWinner === actualWinner;

      const resultStatus = isExact ? "exact" : isCorrect ? "correct" : "wrong";
      const pointsEarned = isExact ? SCORING.EXACT : isCorrect ? SCORING.CORRECT : SCORING.WRONG;

      const { error: updateErr } = await supabase
        .from("predictions")
        .update({ result_status: resultStatus, points_earned: pointsEarned })
        .eq("id", pred.id);

      if (updateErr) {
        errors.push({ predId: pred.id, error: updateErr.message });
      } else {
        totalScored++;
      }
    }
  }

  console.log(`[scoring] ✅ Scored ${totalScored} predictions, skipped ${totalSkipped} matches, ${errors.length} errors`);
  return { data: { totalScored, totalSkipped, errors }, error: null };
};

// Refresh all of a user's aggregated stats across every scoring source.
// Calls the DB function refresh_user_full_stats (idempotent).
export const refreshUserFullStats = async (userId) =>
  supabase.rpc("refresh_user_full_stats", { p_user_id: userId });

// ─── Group standings helpers ──────────────────────────────────────────────────
export const getGroupStandings = async () =>
  supabase.from("group_standings").select("*").order("group_id");

// Admin: record actual group standings and score all predictions for that group.
// Returns { data: number_of_users_scored, error }.
export const adminScoreGroupQual = async (groupId, first, second) =>
  supabase.rpc("score_group_qual", {
    p_group_id: groupId,
    p_first: first,
    p_second: second,
  });

// Admin: score one knockout match slot with the actual winner.
// stage ∈ 'r32' | 'r16' | 'qf' | 'sf' | 'tp' | 'final'
// slotIndex is 0-based within that stage.
export const adminScoreKnockoutSlot = async (stage, slotIndex, actualWinner) =>
  supabase.rpc("score_knockout_slot", {
    p_stage: stage,
    p_slot_index: slotIndex,
    p_actual_winner: actualWinner,
  });

// Admin: refresh all users' full stats in one pass.
export const adminRefreshAllStats = async () => {
  const { data: users, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "user");
  if (error) return { error };
  const errors = [];
  for (const u of users || []) {
    const { error: e } = await supabase.rpc("refresh_user_full_stats", {
      p_user_id: u.id,
    });
    if (e) errors.push({ userId: u.id, error: e.message });
  }
  return { data: { refreshed: users?.length || 0, errors }, error: null };
};
