-- ═══════════════════════════════════════════════════════════════════
-- Migration: Add match_status column for granular API status display
-- Run this in your Supabase SQL Editor (Project → SQL Editor)
-- ═══════════════════════════════════════════════════════════════════

-- Add match_status for human-readable API status ("1st Half", "Half Time", etc.)
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_status TEXT;

-- Add get_server_time RPC used for server-side deadline checks
-- (Skip if it already exists in your project)
CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS TABLE (server_time TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT NOW() AS server_time;
$$;

GRANT EXECUTE ON FUNCTION public.get_server_time() TO authenticated;

-- Back-fill match_status only if the status column already exists
-- (guards against running on a fresh DB where matches may not be seeded yet)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'matches'
      AND column_name  = 'status'
  ) THEN
    UPDATE public.matches SET match_status = 'Not Started'
      WHERE match_status IS NULL AND status = 'upcoming';
    UPDATE public.matches SET match_status = 'Finished'
      WHERE match_status IS NULL AND status = 'finished';
    UPDATE public.matches SET match_status = 'Live'
      WHERE match_status IS NULL AND status = 'live';
  END IF;
END $$;
