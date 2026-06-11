import { createClient } from "@supabase/supabase-js";

// Replace these with your actual Supabase project credentials
// from https://app.supabase.com → Settings → API
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

// ─── Auth helpers ─────────────────────────────────────────────────────────────
export const signUp = (email, password, username) =>
  supabase.auth.signUp({ email, password, options: { data: { username } } });

export const signIn = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

const normalizeUsername = (value) => {
  if (!value || typeof value !== "string") return "user";
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  return cleaned || "user";
};

// ─── Profile helpers ──────────────────────────────────────────────────────────
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
      {
        id: userId,
        username: baseUsername,
        display_name: username || baseUsername,
      },
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
  const { data, error } = await supabase
    .from("predictions")
    .upsert(prediction, { onConflict: "user_id,match_id" })
    .select()
    .single();
  return { data, error };
};

// ─── Group qualification helpers ──────────────────────────────────────────────
export const getUserGroupQuals = async (userId) =>
  supabase.from("group_qualifications").select("*").eq("user_id", userId);

export const upsertGroupQual = async (qual) =>
  supabase
    .from("group_qualifications")
    .upsert(qual, { onConflict: "user_id,group_id" })
    .select()
    .single();

// ─── Knockout prediction helpers ──────────────────────────────────────────────
export const getUserKnockoutPreds = async (userId) =>
  supabase.from("knockout_predictions").select("*").eq("user_id", userId);

export const upsertKnockoutPred = async (pred) =>
  supabase
    .from("knockout_predictions")
    .upsert(pred, { onConflict: "user_id,stage,slot_index" })
    .select()
    .single();

// ─── Community odds ───────────────────────────────────────────────────────────
export const getCommunityOdds = async (matchId) =>
  supabase
    .from("community_odds")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();

// ─── Leaderboard ──────────────────────────────────────────────────────────────
export const getLeaderboard = async (limit = 50) =>
  supabase
    .from("leaderboard")
    .select("*")
    .order("total_points", { ascending: false })
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
      "*, profiles(username,display_name), matches(stage,group_id,home_team,away_team,match_date,home_score,away_score)",
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
    .not("home_score", "is", null)
    .not("away_score", "is", null);

export const updatePredictionResults = async () => {
  const { data: matches, error: matchError } = await getFinishedMatches();
  if (matchError) return { error: matchError };

  let totalCorrect = 0;
  let totalUsers = 0;

  for (const match of matches) {
    const { data: predictions, error: predError } = await supabase
      .from("predictions")
      .select("*")
      .eq("match_id", match.id);

    if (predError) continue;

    const actualWinner = match.home_score > match.away_score ? "home" 
                       : match.away_score > match.home_score ? "away" 
                       : "draw";

    for (const pred of predictions) {
      const userWinner = pred.predicted_home_score > pred.predicted_away_score ? "home"
                       : pred.predicted_away_score > pred.predicted_home_score ? "away"
                       : "draw";

      const isCorrect = userWinner === actualWinner;
      const pointsEarned = isCorrect ? 10 : 0;

      await supabase
        .from("predictions")
        .update({
          is_correct: isCorrect,
          points_earned: pointsEarned,
          final_score: `${match.home_score}-${match.away_score}`,
        })
        .eq("id", pred.id);

      if (isCorrect) totalCorrect++;
      totalUsers++;
    }
  }

  return { data: { totalCorrect, totalUsers }, error: null };
};

export const updateLeaderboard = async () => {
  const { data: users, error } = await supabase
    .from("profiles")
    .select("id, username");

  if (error) return { error };

  for (const user of users) {
    const { data: predictions } = await supabase
      .from("predictions")
      .select("points_earned")
      .eq("user_id", user.id)
      .eq("is_correct", true);

    const totalPoints = predictions?.reduce((sum, p) => sum + (p.points_earned || 0), 0) || 0;

    await supabase
      .from("leaderboard")
      .upsert({
        user_id: user.id,
        total_points: totalPoints,
        correct_predictions: predictions?.length || 0,
      })
      .eq("user_id", user.id);
  }

  return { data: null, error: null };
};
