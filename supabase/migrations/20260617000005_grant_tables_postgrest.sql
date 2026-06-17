-- ═══════════════════════════════════════════════════════════════════
-- Migration: Grant PostgREST access to core tables
-- Root cause: After Supabase's 2026-05-30 auto_expose_new_tables=false
-- change, tables created in migrations are not automatically visible
-- to PostgREST unless explicitly granted. The matches table was missing
-- this grant, causing "Match not found" errors when saving predictions.
-- Safe to re-run — GRANT is idempotent.
-- ═══════════════════════════════════════════════════════════════════

-- Allow PostgREST to query matches (read) and predictions (read/write)
GRANT SELECT                         ON public.matches              TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.predictions          TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.group_qualifications TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.knockout_predictions TO authenticated;
GRANT SELECT                         ON public.profiles             TO authenticated;
GRANT SELECT                         ON public.scoring_config       TO authenticated;
GRANT INSERT                         ON public.audit_log            TO authenticated;

-- community_odds view (if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'community_odds'
  ) THEN
    EXECUTE 'GRANT SELECT ON public.community_odds TO authenticated';
  END IF;
END $$;

-- Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
