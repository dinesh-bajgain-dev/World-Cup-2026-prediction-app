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

-- Update existing 'upcoming' matches to have a default match_status
UPDATE public.matches
SET match_status = 'Not Started'
WHERE match_status IS NULL AND status = 'upcoming';

UPDATE public.matches
SET match_status = 'Finished'
WHERE match_status IS NULL AND status = 'finished';

UPDATE public.matches
SET match_status = 'Live'
WHERE match_status IS NULL AND status = 'live';
