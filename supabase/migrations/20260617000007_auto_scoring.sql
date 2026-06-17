-- ══════════════════════════════════════════════════════════════════════════════
-- WC 2026 — Automated Scoring: pg_cron schedule + double-scoring safety
-- ══════════════════════════════════════════════════════════════════════════════
--
-- HOW THE AUTO-SCORING PIPELINE WORKS:
--   1. pg_cron calls the Edge Function `sync-matches` every 2 minutes
--   2. Edge Function fetches live results from API-Football and updates matches
--   3. DB trigger `on_match_finished` fires on any UPDATE to matches.status
--   4. Trigger calls score_match_predictions() which scores all predictions
--   5. score_match_predictions() calls refresh_user_full_stats() per user
--   6. Leaderboard view reads from profiles.total_points (always fresh)
--   7. Frontend Realtime subscription pushes changes to connected clients
--
-- RESULT: match finishes → predictions scored → leaderboard updated
--         in one automated chain with zero manual intervention.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Add scored_at column to matches (double-scoring audit trail) ───────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

-- ── 2. Update score_match_predictions trigger to stamp scored_at ──────────────
--    This also makes the "no-op if already scored" guard stronger.
CREATE OR REPLACE FUNCTION public.score_match_predictions()
RETURNS TRIGGER AS $$
DECLARE
  actual_home   INTEGER;
  actual_away   INTEGER;
  actual_winner TEXT;
  pts_exact     INTEGER;
  pts_correct   INTEGER;
  v_uid         UUID;
BEGIN
  -- Only run when status just became 'finished'
  IF NEW.status <> 'finished' THEN RETURN NEW; END IF;
  IF NEW.actual_home_score IS NULL OR NEW.actual_away_score IS NULL THEN RETURN NEW; END IF;

  -- Skip if nothing changed since last scoring run (prevents duplicate work)
  IF OLD.status = 'finished'
     AND OLD.actual_home_score IS NOT DISTINCT FROM NEW.actual_home_score
     AND OLD.actual_away_score IS NOT DISTINCT FROM NEW.actual_away_score
  THEN RETURN NEW; END IF;

  actual_home   := NEW.actual_home_score;
  actual_away   := NEW.actual_away_score;
  actual_winner := CASE
    WHEN actual_home > actual_away THEN 'home'
    WHEN actual_away > actual_home THEN 'away'
    ELSE 'draw'
  END;

  -- Read bonus point values from config (exact=3, correct=1)
  SELECT COALESCE(MAX(value) FILTER (WHERE key = 'exact_score'),    3),
         COALESCE(MAX(value) FILTER (WHERE key = 'correct_result'), 1)
  INTO pts_exact, pts_correct
  FROM public.scoring_config;

  -- Score predictions that have not been scored yet (result_status IS NULL)
  UPDATE public.predictions p
  SET
    result_status = CASE
      WHEN p.predicted_home_score = actual_home
       AND p.predicted_away_score = actual_away THEN 'exact'
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
       AND p.predicted_away_score = actual_away THEN pts_exact
      WHEN (
        CASE
          WHEN p.predicted_home_score > p.predicted_away_score THEN 'home'
          WHEN p.predicted_away_score > p.predicted_home_score THEN 'away'
          ELSE 'draw'
        END
      ) = actual_winner THEN pts_correct
      ELSE 0
    END
  WHERE p.match_id = NEW.id AND p.result_status IS NULL;

  -- If API later corrects the score, also re-score already-scored predictions
  -- (UPDATE where result_status IS NOT NULL but score changed)
  IF OLD.status = 'finished'
     AND (OLD.actual_home_score IS DISTINCT FROM NEW.actual_home_score
          OR OLD.actual_away_score IS DISTINCT FROM NEW.actual_away_score)
  THEN
    UPDATE public.predictions p
    SET
      result_status = CASE
        WHEN p.predicted_home_score = actual_home
         AND p.predicted_away_score = actual_away THEN 'exact'
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
         AND p.predicted_away_score = actual_away THEN pts_exact
        WHEN (
          CASE
            WHEN p.predicted_home_score > p.predicted_away_score THEN 'home'
            WHEN p.predicted_away_score > p.predicted_home_score THEN 'away'
            ELSE 'draw'
          END
        ) = actual_winner THEN pts_correct
        ELSE 0
      END
    WHERE p.match_id = NEW.id AND p.result_status IS NOT NULL;
  END IF;

  -- Refresh full stats for every affected user
  FOR v_uid IN
    SELECT DISTINCT user_id FROM public.predictions WHERE match_id = NEW.id
  LOOP
    PERFORM public.refresh_user_full_stats(v_uid);
  END LOOP;

  -- Stamp when this match was scored
  NEW.scored_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger
DROP TRIGGER IF EXISTS on_match_finished ON public.matches;
CREATE TRIGGER on_match_finished
  BEFORE UPDATE OF status, actual_home_score, actual_away_score ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.score_match_predictions();

-- ── 3. Enable pg_cron and pg_net extensions (required for scheduling) ─────────
-- NOTE: These extensions must also be enabled in the Supabase Dashboard at:
-- Project Settings → Extensions → search "pg_cron" and "pg_net" → Enable both
--
-- If already enabled this block is a no-op.
CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;

-- ── 4. Schedule the sync Edge Function every 2 minutes ───────────────────────
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> with your actual values.
-- Find them at: Supabase Dashboard → Project Settings → API
--
-- To install: run the SELECT below once after replacing the placeholders.
-- To view:    SELECT * FROM cron.job;
-- To remove:  SELECT cron.unschedule('wc2026-match-sync');
--
-- IMPORTANT: Run the statement below MANUALLY in the Supabase SQL Editor
-- after replacing <PROJECT_REF> and <SERVICE_ROLE_KEY> with real values.
-- It is NOT executed here because it contains secrets.
--
-- SELECT cron.schedule(
--   'wc2026-match-sync',
--   '*/2 * * * *',
--   $$
--   SELECT extensions.http_post(
--     url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-matches',
--     body   := '{}',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb
--   );
--   $$
-- );

-- ── 5. Grant permissions for Realtime on profiles (leaderboard push) ─────────
-- Supabase Realtime needs SELECT permission on the table it's listening to.
-- This is already granted but we ensure it here for completeness.
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.matches  TO authenticated;

-- ── 6. Enable Realtime publication for profiles and matches ───────────────────
-- This is normally done via Supabase Dashboard (Database → Replication),
-- but can also be done here. Errors are suppressed if already added.
DO $$
BEGIN
  -- Add profiles to realtime publication
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- already added, ignore
  END;

  -- Add matches to realtime publication
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
