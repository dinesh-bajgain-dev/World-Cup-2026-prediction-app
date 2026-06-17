-- ═══════════════════════════════════════════════════════════════════
-- Migration: Leaderboard Production-Ready Fix
-- Safe to re-run — every statement is idempotent.
--
-- Root-cause fixed here:
--   1. GRANT SELECT on the leaderboard view was missing.
--      After Supabase's 2026-05-30 change (auto_expose_new_tables=false),
--      any view without an explicit GRANT is invisible to PostgREST.
--      Every getLeaderboard/getPlayers call was returning a silent 403,
--      which the client interpreted as empty data.
--
--   2. profiles_select_all policy was missing. Without it, the leaderboard
--      view's inner query on profiles returns only the calling user's own
--      row (SECURITY INVOKER behaviour for anon/authenticated roles).
--
--   3. country column was missing from profiles — added here.
--
--   4. Auto-scoring trigger was missing — added here. When a match is set
--      to 'finished' with actual scores, predictions are scored and profile
--      totals are updated automatically. No cron job needed.
--
--   5. Leaderboard view is rebuilt with the correct column set and proper
--      tiebreaking: points → exact scores → correct results → reg date.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Ensure profiles has all required columns ──────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country      TEXT,
  ADD COLUMN IF NOT EXISTS role         TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS total_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bets   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_bets INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add the role CHECK constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND constraint_name LIKE '%role%check%'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin'));
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- constraint already exists under a different name; safe to continue
END $$;

-- ── 2. Ensure predictions has all scoring columns ────────────────────────────
--    If predictions was created from an older schema (before result_status was
--    added), CREATE TABLE IF NOT EXISTS silently skipped the column. Fix here.
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS result_status TEXT,
  ADD COLUMN IF NOT EXISTS points_earned INTEGER;

-- Add result_status CHECK constraint only if it doesn't already exist
DO $$
BEGIN
  ALTER TABLE public.predictions
    ADD CONSTRAINT predictions_result_status_check
    CHECK (result_status IN ('exact', 'correct', 'wrong', 'pending'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ── 3. Ensure matches has all required columns ────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'upcoming',
  ADD COLUMN IF NOT EXISTS match_status         TEXT,
  ADD COLUMN IF NOT EXISTS actual_home_score    INTEGER,
  ADD COLUMN IF NOT EXISTS actual_away_score    INTEGER,
  ADD COLUMN IF NOT EXISTS prediction_deadline  TIMESTAMPTZ;

-- Add status CHECK constraint only if it doesn't already exist
DO $$
BEGIN
  ALTER TABLE public.matches
    ADD CONSTRAINT matches_status_check
    CHECK (status IN ('upcoming', 'live', 'finished'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ── 4. Ensure get_server_time RPC exists ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS TABLE (server_time TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT NOW() AS server_time;
$$;

GRANT EXECUTE ON FUNCTION public.get_server_time() TO authenticated;

-- ── 4. Scoring config table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scoring_config (
  key         TEXT PRIMARY KEY,
  value       INTEGER NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.scoring_config (key, value, description) VALUES
  ('exact_score',          10, 'Points for predicting exact scoreline'),
  ('correct_result',        5, 'Points for predicting correct winner or draw'),
  ('wrong_result',          0, 'Points for wrong prediction'),
  ('group_qualification',  10, 'Bonus: correctly predicted group qualifier'),
  ('r32_correct',          15, 'Bonus: correct R32 team'),
  ('r16_correct',          20, 'Bonus: correct R16 team'),
  ('qf_correct',           25, 'Bonus: correct QF team'),
  ('sf_correct',           30, 'Bonus: correct SF team'),
  ('finalist_correct',     40, 'Bonus: correct finalist'),
  ('champion_correct',     50, 'Bonus: correct champion')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.scoring_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scoring_config_read        ON public.scoring_config;
DROP POLICY IF EXISTS scoring_config_admin_write ON public.scoring_config;

CREATE POLICY scoring_config_read ON public.scoring_config
  FOR SELECT TO authenticated USING (TRUE);

-- Admin write policy: only created when the role column is confirmed to exist
-- (guards against running on a DB where profiles was created without role)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'role'
  ) THEN
    EXECUTE $p$
      CREATE POLICY scoring_config_admin_write ON public.scoring_config
        FOR ALL USING (
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    $p$;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- policy already exists from a previous run; safe to skip
END $$;

-- ── 5. Leaderboard view — drop any existing version, then rebuild ─────────────
--    Handles leaderboard existing as a table, plain view, or materialized view.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_matviews
    WHERE schemaname = 'public' AND matviewname = 'leaderboard'
  ) THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.leaderboard';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'leaderboard'
  ) THEN
    EXECUTE 'DROP VIEW public.leaderboard';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leaderboard'
      AND table_type = 'BASE TABLE'
  ) THEN
    EXECUTE 'DROP TABLE public.leaderboard CASCADE';
  END IF;
END $$;

-- Two-stage view:
--   Stage 1 (CTE "agg"): aggregate per-user prediction counts via GROUP BY.
--   Stage 2 (outer SELECT): apply RANK() OVER referencing only the already-computed
--   columns. This is required because PostgreSQL resolves window function ORDER BY
--   expressions after GROUP BY — table aliases (pr.*) are no longer in scope there.
CREATE OR REPLACE VIEW public.leaderboard AS
WITH agg AS (
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.country,
    p.created_at,
    p.total_points,
    p.total_bets,
    p.correct_bets,
    COALESCE(COUNT(pr.id) FILTER (WHERE pr.result_status = 'exact'),   0) AS exact_count,
    COALESCE(COUNT(pr.id) FILTER (WHERE pr.result_status = 'correct'), 0) AS correct_count,
    COALESCE(COUNT(pr.id) FILTER (WHERE pr.result_status = 'wrong'),   0) AS wrong_count
  FROM public.profiles p
  LEFT JOIN public.predictions pr ON pr.user_id = p.id
  WHERE COALESCE(p.role, 'user') != 'admin'
  GROUP BY
    p.id, p.username, p.display_name, p.country,
    p.total_points, p.total_bets, p.correct_bets, p.created_at
)
SELECT
  id,
  username,
  display_name,
  country,
  created_at,
  -- ── stored profile totals (authoritative for ranking) ────────────────────
  total_points,
  total_bets                                               AS total_predictions,
  correct_bets                                             AS predictions_won,
  GREATEST(0, total_bets - correct_bets)                  AS predictions_lost,
  CASE WHEN total_bets > 0
    THEN ROUND((correct_bets::NUMERIC / total_bets) * 100, 1)
    ELSE 0
  END                                                      AS accuracy_pct,
  -- ── prediction breakdowns ────────────────────────────────────────────────
  exact_count                                              AS exact_predictions,
  correct_count                                            AS correct_predictions,
  wrong_count                                              AS wrong_predictions,
  -- ── deterministic ranking ────────────────────────────────────────────────
  -- Tiebreak: points → exact scores → correct+exact total → accuracy → reg date
  RANK() OVER (
    ORDER BY
      total_points  DESC,
      exact_count   DESC,
      correct_bets  DESC,
      CASE WHEN total_bets > 0
           THEN (correct_bets::NUMERIC / total_bets)
           ELSE 0
      END           DESC,
      created_at    ASC
  )                                                        AS rank
FROM agg;

-- ── 6. Grant PostgREST access ─────────────────────────────────────────────────
--    THIS was the primary root cause of the empty leaderboard.
--    After Supabase's 2026-05-30 policy change, views need explicit GRANT.
GRANT SELECT ON public.leaderboard TO anon, authenticated;

-- ── 7. Allow all authenticated users to read all profiles ─────────────────────
--    Required so the leaderboard view's profiles scan returns every user.
--    Without this, SECURITY INVOKER views would only return the caller's own row.
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
CREATE POLICY profiles_select_all ON public.profiles
  FOR SELECT USING (TRUE);

-- ── 8. Auto-scoring trigger ───────────────────────────────────────────────────
--    Fires when a match row is updated with status='finished' and actual scores.
--    Scores all unscored predictions for that match, then refreshes profile totals.
--    This is the "Real-Time Scoring Engine": no cron job, no manual trigger.
CREATE OR REPLACE FUNCTION public.score_match_predictions()
RETURNS TRIGGER AS $$
DECLARE
  actual_home   INTEGER;
  actual_away   INTEGER;
  actual_winner TEXT;
  pts_exact     INTEGER;
  pts_correct   INTEGER;
BEGIN
  -- Only fire when transitioning to 'finished' with scores present
  IF NEW.status <> 'finished' THEN RETURN NEW; END IF;
  IF NEW.actual_home_score IS NULL OR NEW.actual_away_score IS NULL THEN RETURN NEW; END IF;
  -- Skip if nothing changed (prevents double-scoring on unrelated updates)
  IF OLD.status = 'finished'
     AND OLD.actual_home_score = NEW.actual_home_score
     AND OLD.actual_away_score = NEW.actual_away_score
  THEN
    RETURN NEW;
  END IF;

  actual_home  := NEW.actual_home_score;
  actual_away  := NEW.actual_away_score;
  actual_winner := CASE
    WHEN actual_home > actual_away THEN 'home'
    WHEN actual_away > actual_home THEN 'away'
    ELSE 'draw'
  END;

  -- Read configurable point values (fall back to flat defaults if table missing)
  SELECT COALESCE(MAX(value) FILTER (WHERE key = 'exact_score'),   10)
    INTO pts_exact  FROM public.scoring_config;
  SELECT COALESCE(MAX(value) FILTER (WHERE key = 'correct_result'),  5)
    INTO pts_correct FROM public.scoring_config;

  -- Score all un-scored predictions for this match
  UPDATE public.predictions p
  SET
    result_status = CASE
      WHEN p.predicted_home_score = actual_home
       AND p.predicted_away_score = actual_away
        THEN 'exact'
      WHEN (
        CASE
          WHEN p.predicted_home_score > p.predicted_away_score THEN 'home'
          WHEN p.predicted_away_score > p.predicted_home_score THEN 'away'
          ELSE 'draw'
        END
      ) = actual_winner THEN 'correct'
      ELSE 'wrong'
    END,
    points_earned = CASE
      WHEN p.predicted_home_score = actual_home
       AND p.predicted_away_score = actual_away
        THEN pts_exact
      WHEN (
        CASE
          WHEN p.predicted_home_score > p.predicted_away_score THEN 'home'
          WHEN p.predicted_away_score > p.predicted_home_score THEN 'away'
          ELSE 'draw'
        END
      ) = actual_winner THEN pts_correct
      ELSE 0
    END
  WHERE p.match_id = NEW.id
    AND p.result_status IS NULL;

  -- Re-aggregate profile totals for every user with a prediction on this match
  -- (idempotent: computes from scratch, so safe to run multiple times)
  UPDATE public.profiles prof
  SET
    total_points = (
      SELECT COALESCE(SUM(points_earned), 0)
      FROM public.predictions
      WHERE user_id = prof.id AND result_status IS NOT NULL
    ),
    total_bets = (
      SELECT COUNT(*)
      FROM public.predictions
      WHERE user_id = prof.id AND result_status IS NOT NULL
    ),
    correct_bets = (
      SELECT COUNT(*)
      FROM public.predictions
      WHERE user_id = prof.id AND result_status IN ('exact', 'correct')
    ),
    updated_at = NOW()
  WHERE prof.id IN (
    SELECT DISTINCT user_id FROM public.predictions WHERE match_id = NEW.id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_match_finished ON public.matches;
CREATE TRIGGER on_match_finished
  AFTER UPDATE OF status, actual_home_score, actual_away_score ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.score_match_predictions();

-- ── 9. handle_new_user — ensure country is stored on signup ──────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, country)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''),
      SPLIT_PART(NEW.email, '@', 1)
    ),
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''),
      SPLIT_PART(NEW.email, '@', 1)
    ),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'country', '')), '')
  )
  ON CONFLICT (id) DO UPDATE
    SET
      -- Update country if it was not set at registration time
      country     = COALESCE(
                      public.profiles.country,
                      NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'country', '')), '')
                    ),
      updated_at  = NOW()
  WHERE public.profiles.country IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 10. update_user_points trigger ───────────────────────────────────────────
--     Kept as a lightweight fallback: updates profile when a single prediction
--     result_status is set (e.g., via the JS updatePredictionResults helper).
CREATE OR REPLACE FUNCTION public.update_user_points()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.result_status IS NOT NULL AND OLD.result_status IS NULL THEN
    UPDATE public.profiles
    SET
      total_points = total_points + COALESCE(NEW.points_earned, 0),
      total_bets   = total_bets   + 1,
      correct_bets = correct_bets + CASE
                       WHEN NEW.result_status IN ('exact', 'correct') THEN 1
                       ELSE 0
                     END,
      updated_at   = NOW()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_prediction_result ON public.predictions;
CREATE TRIGGER on_prediction_result
  AFTER UPDATE OF result_status ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.update_user_points();

-- ── 11. Grant authenticated users access to scoring_config ────────────────────
GRANT SELECT ON public.scoring_config TO authenticated;
