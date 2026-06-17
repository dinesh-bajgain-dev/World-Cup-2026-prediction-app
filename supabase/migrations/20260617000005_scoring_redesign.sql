-- ══════════════════════════════════════════════════════════════════════════════
-- WC 2026 PREDICTION PLATFORM — SCORING SYSTEM REDESIGN
-- Migration: 20260617000005
--
-- Philosophy change:
--   OLD: Match score predictions are the only scored element (exact=10, correct=5)
--   NEW: Tournament bracket prediction is the main game; match scores are a bonus
--
-- Points summary (new):
--   Group qual  → 1st correct +5 · 2nd correct +5 · both correct (any order) +3
--   R32 winner  → +2 per correct match winner
--   R16 winner  → +2 per correct match winner
--   QF  winner  → +3 per correct match winner
--   SF  winner  → +5 per correct match winner (= correct finalist)
--   TP  winner  → +2 (3rd place match)
--   Champion    → +10
--   Score bonus → exact +3  ·  correct outcome +1  (was 10/5)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Reduce score-prediction bonus values in scoring_config ─────────────────
INSERT INTO public.scoring_config (key, value, description)
VALUES
  ('exact_score',    3, 'Points for exact scoreline — bonus side game'),
  ('correct_result', 1, 'Points for correct outcome  — bonus side game')
ON CONFLICT (key) DO UPDATE
  SET value       = EXCLUDED.value,
      description = EXCLUDED.description;

-- ── 2. Add breakdown columns to profiles ─────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS group_qual_points     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knockout_r32_points   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knockout_r16_points   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knockout_qf_points    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knockout_sf_points    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS knockout_final_points INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_bonus_points    INT NOT NULL DEFAULT 0;

-- ── 3. Add scoring columns to group_qualifications ───────────────────────────
ALTER TABLE public.group_qualifications
  ADD COLUMN IF NOT EXISTS points_earned INT,
  ADD COLUMN IF NOT EXISTS scored_at     TIMESTAMPTZ;

-- ── 4. Add scoring columns to knockout_predictions ───────────────────────────
ALTER TABLE public.knockout_predictions
  ADD COLUMN IF NOT EXISTS points_earned INT,
  ADD COLUMN IF NOT EXISTS scored_at     TIMESTAMPTZ;

-- ── 5. Create group_standings table (admin records actual final standings) ───
CREATE TABLE IF NOT EXISTS public.group_standings (
  group_id     CHAR(1)    PRIMARY KEY,
  first_place  TEXT       NOT NULL,
  second_place TEXT       NOT NULL,
  scored_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.group_standings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gs_read_all"    ON public.group_standings;
DROP POLICY IF EXISTS "gs_admin_write" ON public.group_standings;

CREATE POLICY "gs_read_all" ON public.group_standings
  FOR SELECT USING (TRUE);

CREATE POLICY "gs_admin_write" ON public.group_standings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

GRANT SELECT ON public.group_standings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.group_standings TO authenticated;

-- ── 6. refresh_user_full_stats — idempotent full recalculation ───────────────
CREATE OR REPLACE FUNCTION public.refresh_user_full_stats(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_score_bonus    INT;
  v_group_qual     INT;
  v_ko_r32         INT;
  v_ko_r16         INT;
  v_ko_qf          INT;
  v_ko_sf          INT;
  v_ko_final       INT;
  v_total_bets     INT;
  v_correct_bets   INT;
BEGIN
  -- Score bonus: sum points from match-score predictions (group stage)
  SELECT
    COALESCE(SUM(points_earned),                                          0),
    COALESCE(COUNT(*) FILTER (WHERE result_status IS NOT NULL),           0),
    COALESCE(COUNT(*) FILTER (WHERE result_status IN ('exact','correct')),0)
  INTO v_score_bonus, v_total_bets, v_correct_bets
  FROM public.predictions
  WHERE user_id = p_user_id AND result_status IS NOT NULL;

  -- Group qual points
  SELECT COALESCE(SUM(points_earned), 0)
  INTO v_group_qual
  FROM public.group_qualifications
  WHERE user_id = p_user_id AND points_earned IS NOT NULL;

  -- Knockout points split by stage
  SELECT
    COALESCE(SUM(points_earned) FILTER (WHERE stage = 'r32'),            0),
    COALESCE(SUM(points_earned) FILTER (WHERE stage = 'r16'),            0),
    COALESCE(SUM(points_earned) FILTER (WHERE stage = 'qf'),             0),
    COALESCE(SUM(points_earned) FILTER (WHERE stage = 'sf'),             0),
    COALESCE(SUM(points_earned) FILTER (WHERE stage IN ('tp','final')),  0)
  INTO v_ko_r32, v_ko_r16, v_ko_qf, v_ko_sf, v_ko_final
  FROM public.knockout_predictions
  WHERE user_id = p_user_id AND points_earned IS NOT NULL;

  UPDATE public.profiles SET
    score_bonus_points    = v_score_bonus,
    group_qual_points     = v_group_qual,
    knockout_r32_points   = v_ko_r32,
    knockout_r16_points   = v_ko_r16,
    knockout_qf_points    = v_ko_qf,
    knockout_sf_points    = v_ko_sf,
    knockout_final_points = v_ko_final,
    total_points = v_score_bonus + v_group_qual
                 + v_ko_r32 + v_ko_r16 + v_ko_qf + v_ko_sf + v_ko_final,
    total_bets   = v_total_bets,
    correct_bets = v_correct_bets,
    updated_at   = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.refresh_user_full_stats(UUID) TO authenticated;

-- ── 7. score_group_qual — admin RPC to score one group's qualifier picks ─────
--
-- Points per user prediction:
--   +5 if first  matches actual first
--   +5 if second matches actual second
--   +3 if both predicted teams are in the actual top-2 (regardless of order)
--      → max possible = 13 (5+5+3 when perfectly ordered)
--      → order-swapped = 3 (neither position bonus, but both-correct bonus)
--
CREATE OR REPLACE FUNCTION public.score_group_qual(
  p_group_id CHAR(1),
  p_first    TEXT,
  p_second   TEXT
)
RETURNS INT AS $$
DECLARE
  v_uid       UUID;
  v_pred_first  TEXT;
  v_pred_second TEXT;
  v_pts       INT;
  v_total     INT := 0;
BEGIN
  -- Record / update the official standings
  INSERT INTO public.group_standings (group_id, first_place, second_place)
  VALUES (p_group_id, p_first, p_second)
  ON CONFLICT (group_id) DO UPDATE
    SET first_place  = EXCLUDED.first_place,
        second_place = EXCLUDED.second_place,
        scored_at    = NOW();

  -- Score every user prediction for this group (re-runnable)
  FOR v_uid IN
    SELECT DISTINCT user_id FROM public.group_qualifications WHERE group_id = p_group_id
  LOOP
    SELECT first, second
    INTO v_pred_first, v_pred_second
    FROM public.group_qualifications
    WHERE user_id = v_uid AND group_id = p_group_id;

    v_pts :=
      -- Exact position match
      (CASE WHEN v_pred_first  = p_first  THEN 5 ELSE 0 END) +
      (CASE WHEN v_pred_second = p_second THEN 5 ELSE 0 END) +
      -- Both teams correct regardless of order (additional bonus)
      (CASE WHEN v_pred_first  IN (p_first, p_second)
             AND v_pred_second IN (p_first, p_second)
             AND v_pred_first <> v_pred_second
            THEN 3 ELSE 0 END);

    UPDATE public.group_qualifications
    SET points_earned = v_pts, scored_at = NOW()
    WHERE user_id = v_uid AND group_id = p_group_id;

    PERFORM public.refresh_user_full_stats(v_uid);
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.score_group_qual(CHAR, TEXT, TEXT) TO authenticated;

-- ── 8. score_knockout_slot — admin RPC to score one KO match slot ────────────
--
-- Points per stage:
--   r32  → +2    r16  → +2    qf   → +3
--   sf   → +5    tp   → +2    final → +10
--
CREATE OR REPLACE FUNCTION public.score_knockout_slot(
  p_stage        TEXT,
  p_slot_index   INT,
  p_actual_winner TEXT
)
RETURNS INT AS $$
DECLARE
  v_pts   INT;
  v_uid   UUID;
  v_total INT := 0;
BEGIN
  v_pts := CASE p_stage
    WHEN 'r32'   THEN 2
    WHEN 'r16'   THEN 2
    WHEN 'qf'    THEN 3
    WHEN 'sf'    THEN 5
    WHEN 'tp'    THEN 2
    WHEN 'final' THEN 10
    ELSE 0
  END;

  -- Score all predictions for this slot (re-runnable)
  UPDATE public.knockout_predictions
  SET
    points_earned = CASE WHEN predicted_winner = p_actual_winner THEN v_pts ELSE 0 END,
    scored_at     = NOW()
  WHERE stage = p_stage AND slot_index = p_slot_index;

  -- Refresh affected users
  FOR v_uid IN
    SELECT DISTINCT user_id FROM public.knockout_predictions
    WHERE stage = p_stage AND slot_index = p_slot_index
  LOOP
    PERFORM public.refresh_user_full_stats(v_uid);
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.score_knockout_slot(TEXT, INT, TEXT) TO authenticated;

-- ── 9. Update the existing match-score trigger to use refresh_user_full_stats ─
--    The trigger now updates score_bonus_points via the full-stats refresh,
--    keeping total_points consistent across all scoring sources.
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
  IF NEW.status <> 'finished' THEN RETURN NEW; END IF;
  IF NEW.actual_home_score IS NULL OR NEW.actual_away_score IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'finished'
     AND OLD.actual_home_score = NEW.actual_home_score
     AND OLD.actual_away_score = NEW.actual_away_score
  THEN RETURN NEW; END IF;

  actual_home   := NEW.actual_home_score;
  actual_away   := NEW.actual_away_score;
  actual_winner := CASE
    WHEN actual_home > actual_away THEN 'home'
    WHEN actual_away > actual_home THEN 'away'
    ELSE 'draw'
  END;

  -- Read bonus point values from config (defaults: exact=3, correct=1)
  SELECT COALESCE(MAX(value) FILTER (WHERE key = 'exact_score'),    3)
    INTO pts_exact   FROM public.scoring_config;
  SELECT COALESCE(MAX(value) FILTER (WHERE key = 'correct_result'), 1)
    INTO pts_correct FROM public.scoring_config;

  -- Score all un-scored predictions for this match
  UPDATE public.predictions p
  SET
    result_status = CASE
      WHEN p.predicted_home_score = actual_home
       AND p.predicted_away_score = actual_away
        THEN 'exact'
      WHEN (CASE
              WHEN p.predicted_home_score > p.predicted_away_score THEN 'home'
              WHEN p.predicted_away_score > p.predicted_home_score THEN 'away'
              ELSE 'draw'
            END) = actual_winner THEN 'correct'
      ELSE 'wrong'
    END,
    points_earned = CASE
      WHEN p.predicted_home_score = actual_home
       AND p.predicted_away_score = actual_away
        THEN pts_exact
      WHEN (CASE
              WHEN p.predicted_home_score > p.predicted_away_score THEN 'home'
              WHEN p.predicted_away_score > p.predicted_home_score THEN 'away'
              ELSE 'draw'
            END) = actual_winner THEN pts_correct
      ELSE 0
    END
  WHERE p.match_id = NEW.id AND p.result_status IS NULL;

  -- Refresh full stats for every affected user
  FOR v_uid IN
    SELECT DISTINCT user_id FROM public.predictions WHERE match_id = NEW.id
  LOOP
    PERFORM public.refresh_user_full_stats(v_uid);
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger (replaces the old version)
DROP TRIGGER IF EXISTS on_match_finished ON public.matches;
CREATE TRIGGER on_match_finished
  AFTER UPDATE OF status, actual_home_score, actual_away_score ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.score_match_predictions();

-- ── 10. Rebuild leaderboard view with new columns and knockout-first ordering ─
DO $$
BEGIN
  -- Drop existing view/table/matview whichever form it has
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='leaderboard') THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.leaderboard';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='leaderboard') THEN
    EXECUTE 'DROP VIEW public.leaderboard CASCADE';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='leaderboard') THEN
    EXECUTE 'DROP TABLE public.leaderboard CASCADE';
  END IF;
END $$;

CREATE VIEW public.leaderboard AS
WITH agg AS (
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.country,
    p.avatar_url,
    p.created_at,
    -- Authoritative totals stored on profiles
    p.total_points,
    p.total_bets,
    p.correct_bets,
    p.group_qual_points,
    p.knockout_r32_points,
    p.knockout_r16_points,
    p.knockout_qf_points,
    p.knockout_sf_points,
    p.knockout_final_points,
    p.score_bonus_points,
    -- Derived knockout total (for tiebreaking)
    (p.knockout_r32_points + p.knockout_r16_points + p.knockout_qf_points
     + p.knockout_sf_points + p.knockout_final_points) AS knockout_points,
    -- Exact-score count (secondary tiebreaker within bonus layer)
    COALESCE(COUNT(pr.id) FILTER (WHERE pr.result_status = 'exact'),   0) AS exact_count,
    COALESCE(COUNT(pr.id) FILTER (WHERE pr.result_status = 'correct'), 0) AS correct_count,
    COALESCE(COUNT(pr.id) FILTER (WHERE pr.result_status = 'wrong'),   0) AS wrong_count
  FROM public.profiles p
  LEFT JOIN public.predictions pr ON pr.user_id = p.id
  WHERE COALESCE(p.role, 'user') != 'admin'
  GROUP BY
    p.id, p.username, p.display_name, p.country, p.avatar_url, p.created_at,
    p.total_points, p.total_bets, p.correct_bets,
    p.group_qual_points, p.knockout_r32_points, p.knockout_r16_points,
    p.knockout_qf_points, p.knockout_sf_points, p.knockout_final_points,
    p.score_bonus_points
)
SELECT
  id, username, display_name, country, avatar_url, created_at,
  -- Totals
  total_points,
  group_qual_points,
  knockout_r32_points,
  knockout_r16_points,
  knockout_qf_points,
  knockout_sf_points,
  knockout_final_points,
  knockout_points,
  score_bonus_points,
  -- Legacy compatibility
  total_bets                                               AS total_predictions,
  correct_bets                                             AS predictions_won,
  GREATEST(0, total_bets - correct_bets)                  AS predictions_lost,
  CASE WHEN total_bets > 0
    THEN ROUND((correct_bets::NUMERIC / total_bets) * 100, 1)
    ELSE 0
  END                                                      AS accuracy_pct,
  exact_count                                              AS exact_predictions,
  correct_count                                            AS correct_predictions,
  wrong_count                                              AS wrong_predictions,
  -- Ranking: total pts first, then knockout dominance, then stage depth, then bonus
  RANK() OVER (
    ORDER BY
      total_points          DESC,  -- primary: all sources combined
      knockout_points       DESC,  -- tie: prefer knockout accuracy overall
      knockout_final_points DESC,  -- tie: champion/final depth
      knockout_sf_points    DESC,  -- tie: SF depth
      knockout_qf_points    DESC,
      knockout_r16_points   DESC,
      knockout_r32_points   DESC,
      group_qual_points     DESC,  -- tie: group stage accuracy
      exact_count           DESC,  -- tie: bonus exact scores
      created_at            ASC    -- final tie: earliest registration wins
  ) AS rank
FROM agg;

GRANT SELECT ON public.leaderboard TO anon, authenticated;
