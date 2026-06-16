-- ═══════════════════════════════════════════════════════════════════
-- Migration: Custom email OTP verification table
-- Safe to re-run — all statements are idempotent
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create the table (skipped if it already exists)
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT        NOT NULL,
  code       TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Index for fast OTP lookups (skipped if already exists)
CREATE INDEX IF NOT EXISTS email_verifications_lookup
  ON public.email_verifications (email, code)
  WHERE used = FALSE;

-- 3. Enable Row Level Security
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

-- 4. Drop policies first so this is safe to re-run
DROP POLICY IF EXISTS ev_insert ON public.email_verifications;
DROP POLICY IF EXISTS ev_select ON public.email_verifications;
DROP POLICY IF EXISTS ev_update ON public.email_verifications;

-- 5. Recreate policies
--    Anyone can insert (users request OTP before they have a session)
CREATE POLICY ev_insert ON public.email_verifications
  FOR INSERT WITH CHECK (TRUE);

--    Anyone can read (the 6-digit code itself is the secret; it expires in 10 min)
CREATE POLICY ev_select ON public.email_verifications
  FOR SELECT USING (TRUE);

--    Anyone can mark a code as used after verification
CREATE POLICY ev_update ON public.email_verifications
  FOR UPDATE USING (TRUE);

-- 6. Helper function to purge expired / used codes (call manually or via pg_cron)
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.email_verifications
  WHERE used = TRUE OR expires_at < NOW();
$$;
