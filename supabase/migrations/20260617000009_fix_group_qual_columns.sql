  -- ══════════════════════════════════════════════════════════════════════════════
  -- Fix: group_qualifications column name inconsistency
  --
  -- Root cause: The JS client sends { predicted_first, predicted_second } to
  -- PostgREST, but the running DB table may have been created with short column
  -- names (first / second) or without these columns at all. This migration
  -- ensures the canonical column names predicted_first / predicted_second exist
  -- in all cases and rewrites score_group_qual to use them correctly.
  --
  -- Safe to re-run — all statements are idempotent.
  -- ══════════════════════════════════════════════════════════════════════════════

  -- ── 1. Add canonical columns if they don't already exist ─────────────────────
  ALTER TABLE public.group_qualifications
    ADD COLUMN IF NOT EXISTS predicted_first  TEXT,
    ADD COLUMN IF NOT EXISTS predicted_second TEXT;

  -- ── 2. Backfill from legacy short-name columns (if they existed) ──────────────
  --    Handles three possible legacy schemas:
  --      a) columns named "first" / "second"
  --      b) columns named "first_team" / "second_team"
  --      c) columns named "first_place" / "second_place"
  --    The DO block is a no-op when none of those columns exist.
  DO $$
  BEGIN
    -- Case (a): columns named first / second
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'group_qualifications'
        AND column_name = 'first'
    ) THEN
      UPDATE public.group_qualifications
      SET predicted_first  = "first",
          predicted_second = "second"
      WHERE predicted_first IS NULL OR predicted_second IS NULL;
    END IF;

    -- Case (b): columns named first_team / second_team
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'group_qualifications'
        AND column_name = 'first_team'
    ) THEN
      UPDATE public.group_qualifications
      SET predicted_first  = first_team,
          predicted_second = second_team
      WHERE predicted_first IS NULL OR predicted_second IS NULL;
    END IF;

    -- Case (c): columns named first_place / second_place
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'group_qualifications'
        AND column_name = 'first_place'
    ) THEN
      UPDATE public.group_qualifications
      SET predicted_first  = first_place,
          predicted_second = second_place
      WHERE predicted_first IS NULL OR predicted_second IS NULL;
    END IF;
  END $$;

  -- ── 3. Set NOT NULL + default on canonical columns ────────────────────────────
  --    Only enforce NOT NULL when the table is empty or all rows are populated.
  --    Use a safe ALTER that fails quietly if constraint already present.
  ALTER TABLE public.group_qualifications
    ALTER COLUMN predicted_first  SET DEFAULT '',
    ALTER COLUMN predicted_second SET DEFAULT '';

  UPDATE public.group_qualifications
  SET predicted_first  = COALESCE(predicted_first,  ''),
      predicted_second = COALESCE(predicted_second, '')
  WHERE predicted_first IS NULL OR predicted_second IS NULL;

  -- ── 4. Rebuild score_group_qual to use the correct column names ───────────────
  --    The previous version used "SELECT first, second" which failed when the
  --    columns are named predicted_first / predicted_second.
  CREATE OR REPLACE FUNCTION public.score_group_qual(
    p_group_id CHAR(1),
    p_first    TEXT,
    p_second   TEXT
  )
  RETURNS INT AS $$
  DECLARE
    v_uid         UUID;
    v_pred_first  TEXT;
    v_pred_second TEXT;
    v_pts         INT;
    v_total       INT := 0;
  BEGIN
    -- Record / update the official standings
    INSERT INTO public.group_standings (group_id, first_place, second_place)
    VALUES (p_group_id, p_first, p_second)
    ON CONFLICT (group_id) DO UPDATE
      SET first_place  = EXCLUDED.first_place,
          second_place = EXCLUDED.second_place,
          scored_at    = NOW();

    -- Score every user prediction for this group (fully re-runnable)
    FOR v_uid IN
      SELECT DISTINCT user_id
      FROM public.group_qualifications
      WHERE group_id = p_group_id
    LOOP
      SELECT predicted_first, predicted_second
      INTO v_pred_first, v_pred_second
      FROM public.group_qualifications
      WHERE user_id = v_uid AND group_id = p_group_id;

      v_pts :=
        -- Exact position match
        (CASE WHEN v_pred_first  = p_first  THEN 5 ELSE 0 END) +
        (CASE WHEN v_pred_second = p_second THEN 5 ELSE 0 END) +
        -- Both teams correct regardless of order (additive bonus)
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

  -- ── 5. Force PostgREST to reload its schema cache ────────────────────────────
  NOTIFY pgrst, 'reload schema';
