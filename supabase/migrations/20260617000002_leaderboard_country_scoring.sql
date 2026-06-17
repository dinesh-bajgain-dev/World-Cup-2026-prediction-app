-- ═══════════════════════════════════════════════════════════════════
-- Migration: Country column, updated leaderboard view, flat scoring trigger
-- Run this in your Supabase SQL Editor (Project → SQL Editor)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add columns to profiles that may be missing on older DBs
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country    TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Scoring config table (configurable points, no code deploy required)
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

-- Grant authenticated users read access to scoring config
ALTER TABLE public.scoring_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scoring_config_read        ON public.scoring_config;
DROP POLICY IF EXISTS scoring_config_admin_write ON public.scoring_config;

CREATE POLICY scoring_config_read ON public.scoring_config
  FOR SELECT TO authenticated USING (TRUE);

-- Admin write: only created when the profiles.role column already exists
-- (safe for both fresh migrations and existing DBs)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'role'
  ) THEN
    CREATE POLICY scoring_config_admin_write ON public.scoring_config
      FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

-- 3. Drop and recreate leaderboard view with all required columns
--    Handles the case where leaderboard exists as a table, view, or materialized view
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews        WHERE schemaname = 'public' AND matviewname = 'leaderboard') THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.leaderboard';
  ELSIF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'leaderboard') THEN
    EXECUTE 'DROP VIEW public.leaderboard';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leaderboard' AND table_type = 'BASE TABLE') THEN
    EXECUTE 'DROP TABLE public.leaderboard CASCADE';
  END IF;
END $$;

CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.country,
  p.total_points,
  p.total_bets                                                    AS total_predictions,
  p.correct_bets                                                  AS predictions_won,
  GREATEST(0, p.total_bets - p.correct_bets)                     AS predictions_lost,
  CASE WHEN p.total_bets > 0
    THEN ROUND((p.correct_bets::NUMERIC / p.total_bets) * 100, 1)
    ELSE 0
  END                                                             AS accuracy_pct,
  COUNT(pr.id) FILTER (WHERE pr.result_status = 'exact')         AS exact_predictions,
  COUNT(pr.id) FILTER (WHERE pr.result_status = 'correct')       AS correct_predictions,
  COUNT(pr.id) FILTER (WHERE pr.result_status = 'wrong')         AS wrong_predictions,
  RANK() OVER (ORDER BY p.total_points DESC, p.correct_bets DESC) AS rank
FROM public.profiles p
LEFT JOIN public.predictions pr ON pr.user_id = p.id
WHERE COALESCE(p.role, 'user') != 'admin'
GROUP BY
  p.id, p.username, p.display_name, p.country,
  p.total_points, p.total_bets, p.correct_bets;

-- Grant PostgREST access to the leaderboard view
GRANT SELECT ON public.leaderboard TO anon, authenticated;

-- Allow all users to read public profile data (needed for leaderboard view to return rows)
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
CREATE POLICY profiles_select_all ON public.profiles
  FOR SELECT USING (TRUE);

-- 4. Auto-scoring DB function: score all unscored predictions for a finished match
--    Called by the trigger below whenever a match transitions to 'finished'
CREATE OR REPLACE FUNCTION public.score_match_predictions()
RETURNS TRIGGER AS $$
DECLARE
  actual_home  INTEGER;
  actual_away  INTEGER;
  actual_winner TEXT;
  pts_exact    INTEGER;
  pts_correct  INTEGER;
BEGIN
  -- Only fire when status changes to 'finished' and scores are present
  IF NEW.status <> 'finished' THEN RETURN NEW; END IF;
  IF NEW.actual_home_score IS NULL OR NEW.actual_away_score IS NULL THEN RETURN NEW; END IF;
  -- Skip if status didn't actually change (prevents re-scoring on unrelated updates)
  IF OLD.status = 'finished' AND OLD.actual_home_score = NEW.actual_home_score
     AND OLD.actual_away_score = NEW.actual_away_score THEN
    RETURN NEW;
  END IF;

  actual_home := NEW.actual_home_score;
  actual_away := NEW.actual_away_score;
  actual_winner := CASE
    WHEN actual_home > actual_away THEN 'home'
    WHEN actual_away > actual_home THEN 'away'
    ELSE 'draw'
  END;

  -- Read point values from config (fall back to flat defaults)
  SELECT COALESCE(MAX(value) FILTER (WHERE key = 'exact_score'),   10) INTO pts_exact   FROM public.scoring_config;
  SELECT COALESCE(MAX(value) FILTER (WHERE key = 'correct_result'),  5) INTO pts_correct FROM public.scoring_config;

  -- Score all predictions for this match that haven't been scored yet
  UPDATE public.predictions p
  SET
    result_status = CASE
      WHEN p.predicted_home_score = actual_home AND p.predicted_away_score = actual_away THEN 'exact'
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
      WHEN p.predicted_home_score = actual_home AND p.predicted_away_score = actual_away THEN pts_exact
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

  -- Update profile totals for every affected user (idempotent via subquery)
  UPDATE public.profiles prof
  SET
    total_points = (
      SELECT COALESCE(SUM(points_earned), 0)
      FROM public.predictions
      WHERE user_id = prof.id AND result_status IS NOT NULL
    ),
    total_bets = (
      SELECT COUNT(*) FROM public.predictions
      WHERE user_id = prof.id AND result_status IS NOT NULL
    ),
    correct_bets = (
      SELECT COUNT(*) FROM public.predictions
      WHERE user_id = prof.id AND result_status IN ('exact', 'correct')
    ),
    updated_at = NOW()
  WHERE prof.id IN (
    SELECT DISTINCT user_id FROM public.predictions WHERE match_id = NEW.id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach trigger to matches table
DROP TRIGGER IF EXISTS on_match_finished ON public.matches;
CREATE TRIGGER on_match_finished
  AFTER UPDATE OF status, actual_home_score, actual_away_score ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.score_match_predictions();

-- 6. Update handle_new_user trigger to support country field
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, country)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'country'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Allow profiles_update_own to include the country field
-- (existing policy already covers all columns via UPDATE ... USING auth.uid() = id)
-- No change needed for RLS — country is just another column on the same row.
