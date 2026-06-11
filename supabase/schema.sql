-- ═══════════════════════════════════════════════════════════════════
-- FIFA WORLD CUP 2026 — SUPABASE SCHEMA
-- Run this entire file in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS (extends Supabase auth.users) ────────────────────────────
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  total_points  INTEGER NOT NULL DEFAULT 0,
  total_bets    INTEGER NOT NULL DEFAULT 0,
  correct_bets  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MATCHES ────────────────────────────────────────────────────────
CREATE TABLE public.matches (
  id              TEXT PRIMARY KEY,            -- e.g. "A1", "R32-1", "QF-1"
  stage           TEXT NOT NULL CHECK (stage IN ('group','r32','r16','qf','sf','final')),
  group_id        TEXT,                        -- A-L, null for knockout
  matchday        INTEGER,                     -- 1-3 for group, null for knockout
  home_team       TEXT NOT NULL,
  away_team       TEXT NOT NULL,
  match_date      DATE NOT NULL,
  match_time      TIME NOT NULL,
  venue           TEXT NOT NULL,
  venue_city      TEXT NOT NULL,
  prediction_deadline TIMESTAMPTZ NOT NULL,   -- when predictions lock
  actual_home_score   INTEGER,                -- filled after match
  actual_away_score   INTEGER,
  status          TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','live','finished')),
  base_odds_home  NUMERIC(6,2) DEFAULT 2.0,
  base_odds_draw  NUMERIC(6,2) DEFAULT 3.2,
  base_odds_away  NUMERIC(6,2) DEFAULT 3.5,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── PREDICTIONS ────────────────────────────────────────────────────
CREATE TABLE public.predictions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id            TEXT NOT NULL REFERENCES public.matches(id),
  predicted_home_score INTEGER NOT NULL CHECK (predicted_home_score >= 0 AND predicted_home_score <= 20),
  predicted_away_score INTEGER NOT NULL CHECK (predicted_away_score >= 0 AND predicted_away_score <= 20),
  predicted_winner    TEXT NOT NULL,           -- home | draw | away
  stake_amount        NUMERIC(10,2) NOT NULL DEFAULT 10.0,
  odds_at_submission  NUMERIC(8,2) NOT NULL,   -- LOCKED at submission time
  potential_payout    NUMERIC(10,2) NOT NULL,
  is_locked           BOOLEAN NOT NULL DEFAULT FALSE,
  points_earned       INTEGER,                 -- filled after match
  result_status       TEXT CHECK (result_status IN ('exact','correct','wrong','pending')),
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at           TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- prevent duplicate predictions per user per match
  CONSTRAINT unique_user_match UNIQUE (user_id, match_id)
);

-- ─── GROUP QUALIFICATIONS (user's predicted 1st/2nd per group) ──────
CREATE TABLE public.group_qualifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id    TEXT NOT NULL,                   -- A-L
  predicted_first  TEXT NOT NULL,
  predicted_second TEXT NOT NULL,
  is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at   TIMESTAMPTZ,
  CONSTRAINT unique_user_group UNIQUE (user_id, group_id)
);

-- ─── KNOCKOUT PREDICTIONS (who user thinks advances each round) ──────
CREATE TABLE public.knockout_predictions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('r32','r16','qf','sf','final')),
  slot_index  INTEGER NOT NULL,               -- 0-based position in bracket
  predicted_winner TEXT NOT NULL,
  is_locked   BOOLEAN NOT NULL DEFAULT FALSE,
  points_earned INTEGER,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at   TIMESTAMPTZ,
  CONSTRAINT unique_user_stage_slot UNIQUE (user_id, stage, slot_index)
);

-- ─── AUDIT LOG (immutable record of all changes) ────────────────────
CREATE TABLE public.audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.profiles(id),
  action      TEXT NOT NULL,                  -- 'prediction_submit','prediction_lock', etc.
  table_name  TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── LEADERBOARD VIEW ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  p.total_points,
  p.total_bets,
  p.correct_bets,
  CASE WHEN p.total_bets > 0
    THEN ROUND((p.correct_bets::NUMERIC / p.total_bets) * 100, 1)
    ELSE 0
  END AS accuracy_pct,
  COALESCE(SUM(pr.potential_payout) FILTER (WHERE pr.result_status = 'exact'), 0) AS total_exact_payouts,
  COUNT(pr.id) FILTER (WHERE pr.result_status = 'exact') AS exact_predictions,
  COUNT(pr.id) FILTER (WHERE pr.result_status = 'correct') AS correct_predictions,
  RANK() OVER (ORDER BY p.total_points DESC) AS rank
FROM public.profiles p
LEFT JOIN public.predictions pr ON pr.user_id = p.id
WHERE p.role = 'user'
GROUP BY p.id, p.username, p.display_name, p.avatar_url,
         p.total_points, p.total_bets, p.correct_bets;

-- ─── ODDS COMMUNITY VIEW ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.community_odds AS
SELECT
  match_id,
  COUNT(*) AS total_predictions,
  ROUND(COUNT(*) FILTER (WHERE predicted_winner = 'home')::NUMERIC / NULLIF(COUNT(*),0) * 100, 1) AS home_pct,
  ROUND(COUNT(*) FILTER (WHERE predicted_winner = 'draw')::NUMERIC / NULLIF(COUNT(*),0) * 100, 1) AS draw_pct,
  ROUND(COUNT(*) FILTER (WHERE predicted_winner = 'away')::NUMERIC / NULLIF(COUNT(*),0) * 100, 1) AS away_pct
FROM public.predictions
GROUP BY match_id;

-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) — Tamper-proof rules
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_qualifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knockout_predictions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log             ENABLE ROW LEVEL SECURITY;

-- profiles: users see own, admins see all
CREATE POLICY "profiles_select_own"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_select_admin" ON public.profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "profiles_update_own"   ON public.profiles FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (role = (SELECT role FROM public.profiles WHERE id = auth.uid())); -- can't self-promote

-- matches: readable by all authenticated users
CREATE POLICY "matches_select_all" ON public.matches FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "matches_admin_write" ON public.matches FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- predictions: own predictions + locked predictions cannot be updated
CREATE POLICY "predictions_select_own" ON public.predictions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "predictions_select_admin" ON public.predictions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "predictions_insert" ON public.predictions FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND NOT EXISTS (  -- deadline not passed
    SELECT 1 FROM public.matches m
    WHERE m.id = match_id AND m.prediction_deadline < NOW()
  )
);
CREATE POLICY "predictions_update" ON public.predictions FOR UPDATE USING (
  auth.uid() = user_id
  AND is_locked = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.id = match_id AND m.prediction_deadline < NOW()
  )
) WITH CHECK (auth.uid() = user_id AND is_locked = FALSE);

-- CRITICAL: no one can delete predictions ever
CREATE POLICY "predictions_no_delete" ON public.predictions FOR DELETE USING (FALSE);

-- group_qualifications: same pattern
CREATE POLICY "gq_select_own"   ON public.group_qualifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "gq_select_admin" ON public.group_qualifications FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "gq_insert" ON public.group_qualifications FOR INSERT WITH CHECK (
  auth.uid() = user_id AND is_locked = FALSE
);
CREATE POLICY "gq_update" ON public.group_qualifications FOR UPDATE USING (
  auth.uid() = user_id AND is_locked = FALSE
);
CREATE POLICY "gq_no_delete" ON public.group_qualifications FOR DELETE USING (FALSE);

-- knockout_predictions
CREATE POLICY "kp_select_own"   ON public.knockout_predictions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "kp_select_admin" ON public.knockout_predictions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "kp_insert" ON public.knockout_predictions FOR INSERT WITH CHECK (
  auth.uid() = user_id AND is_locked = FALSE
);
CREATE POLICY "kp_update" ON public.knockout_predictions FOR UPDATE USING (
  auth.uid() = user_id AND is_locked = FALSE
);
CREATE POLICY "kp_no_delete" ON public.knockout_predictions FOR DELETE USING (FALSE);

-- audit_log: admin read-only, system inserts only
CREATE POLICY "audit_select_admin" ON public.audit_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "audit_insert_system" ON public.audit_log FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "audit_no_update" ON public.audit_log FOR UPDATE USING (FALSE);
CREATE POLICY "audit_no_delete" ON public.audit_log FOR DELETE USING (FALSE);

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════

-- Auto-lock predictions when deadline passes
CREATE OR REPLACE FUNCTION lock_predictions_on_deadline()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.predictions p
  SET is_locked = TRUE, locked_at = NOW()
  FROM public.matches m
  WHERE p.match_id = m.id
    AND m.prediction_deadline <= NOW()
    AND p.is_locked = FALSE;

  UPDATE public.group_qualifications
  SET is_locked = TRUE, locked_at = NOW()
  WHERE group_id IN (
    SELECT DISTINCT SUBSTRING(id FROM 1 FOR 1)
    FROM public.matches
    WHERE prediction_deadline <= NOW() AND stage = 'group'
  ) AND is_locked = FALSE;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', SPLIT_PART(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Audit trigger for predictions
CREATE OR REPLACE FUNCTION audit_prediction_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_value, new_value)
  VALUES (
    COALESCE(NEW.user_id, OLD.user_id),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    CASE WHEN TG_OP != 'INSERT' THEN row_to_json(OLD)::JSONB ELSE NULL END,
    CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW)::JSONB ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_predictions
  AFTER INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION audit_prediction_changes();

-- Update profile points after prediction result
CREATE OR REPLACE FUNCTION update_user_points()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.result_status IS NOT NULL AND OLD.result_status IS NULL THEN
    UPDATE public.profiles
    SET
      total_points = total_points + COALESCE(NEW.points_earned, 0),
      total_bets   = total_bets + 1,
      correct_bets = correct_bets + CASE WHEN NEW.result_status IN ('exact','correct') THEN 1 ELSE 0 END,
      updated_at   = NOW()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_prediction_result
  AFTER UPDATE OF result_status ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION update_user_points();

-- ═══════════════════════════════════════════════════════════════════
-- SEED MATCHES DATA (all 72 group + knockout fixtures)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO public.matches (id, stage, group_id, matchday, home_team, away_team, match_date, match_time, venue, venue_city, prediction_deadline) VALUES
-- GROUP A
('A1','group','A',1,'Mexico','South Africa','2026-06-11','18:00','Estadio Azteca','Mexico City, MEX','2026-06-11 16:00:00+00'),
('A2','group','A',1,'South Korea','Czechia','2026-06-12','15:00','AT&T Stadium','Arlington, TX','2026-06-12 13:00:00+00'),
('A3','group','A',2,'Mexico','Czechia','2026-06-16','15:00','Estadio Azteca','Mexico City, MEX','2026-06-16 13:00:00+00'),
('A4','group','A',2,'South Korea','South Africa','2026-06-16','18:00','AT&T Stadium','Arlington, TX','2026-06-16 16:00:00+00'),
('A5','group','A',3,'Mexico','South Korea','2026-06-22','21:00','Estadio Azteca','Mexico City, MEX','2026-06-22 19:00:00+00'),
('A6','group','A',3,'South Africa','Czechia','2026-06-22','21:00','AT&T Stadium','Arlington, TX','2026-06-22 19:00:00+00'),
-- GROUP B
('B1','group','B',1,'Canada','Bosnia-Herzegovina','2026-06-12','18:00','BMO Field','Toronto, CAN','2026-06-12 16:00:00+00'),
('B2','group','B',1,'Qatar','Switzerland','2026-06-13','15:00','BC Place','Vancouver, CAN','2026-06-13 13:00:00+00'),
('B3','group','B',2,'Canada','Switzerland','2026-06-17','15:00','BMO Field','Toronto, CAN','2026-06-17 13:00:00+00'),
('B4','group','B',2,'Qatar','Bosnia-Herzegovina','2026-06-17','18:00','BC Place','Vancouver, CAN','2026-06-17 16:00:00+00'),
('B5','group','B',3,'Canada','Qatar','2026-06-22','21:00','BMO Field','Toronto, CAN','2026-06-22 19:00:00+00'),
('B6','group','B',3,'Bosnia-Herzegovina','Switzerland','2026-06-22','21:00','BC Place','Vancouver, CAN','2026-06-22 19:00:00+00'),
-- GROUP C
('C1','group','C',1,'Brazil','Morocco','2026-06-14','15:00','MetLife Stadium','East Rutherford, NJ','2026-06-14 13:00:00+00'),
('C2','group','C',1,'Haiti','Scotland','2026-06-14','18:00','SoFi Stadium','Los Angeles, CA','2026-06-14 16:00:00+00'),
('C3','group','C',2,'Brazil','Haiti','2026-06-18','15:00','MetLife Stadium','East Rutherford, NJ','2026-06-18 13:00:00+00'),
('C4','group','C',2,'Morocco','Scotland','2026-06-18','18:00','SoFi Stadium','Los Angeles, CA','2026-06-18 16:00:00+00'),
('C5','group','C',3,'Brazil','Scotland','2026-06-23','21:00','MetLife Stadium','East Rutherford, NJ','2026-06-23 19:00:00+00'),
('C6','group','C',3,'Morocco','Haiti','2026-06-23','21:00','SoFi Stadium','Los Angeles, CA','2026-06-23 19:00:00+00'),
-- GROUP D
('D1','group','D',1,'USA','Paraguay','2026-06-13','18:00','MetLife Stadium','East Rutherford, NJ','2026-06-13 16:00:00+00'),
('D2','group','D',1,'Australia','Turkey','2026-06-14','15:00','Arrowhead Stadium','Kansas City, MO','2026-06-14 13:00:00+00'),
('D3','group','D',2,'USA','Australia','2026-06-19','15:00','SoFi Stadium','Los Angeles, CA','2026-06-19 13:00:00+00'),
('D4','group','D',2,'Paraguay','Turkey','2026-06-19','18:00','MetLife Stadium','East Rutherford, NJ','2026-06-19 16:00:00+00'),
('D5','group','D',3,'USA','Turkey','2026-06-23','21:00','Arrowhead Stadium','Kansas City, MO','2026-06-23 19:00:00+00'),
('D6','group','D',3,'Paraguay','Australia','2026-06-23','21:00','SoFi Stadium','Los Angeles, CA','2026-06-23 19:00:00+00'),
-- GROUP E
('E1','group','E',1,'Germany','Curacao','2026-06-14','18:00','Lincoln Financial Field','Philadelphia, PA','2026-06-14 16:00:00+00'),
('E2','group','E',1,'Ivory Coast','Ecuador','2026-06-15','15:00','Bank of America Stadium','Charlotte, NC','2026-06-15 13:00:00+00'),
('E3','group','E',2,'Germany','Ecuador','2026-06-19','18:00','Lincoln Financial Field','Philadelphia, PA','2026-06-19 16:00:00+00'),
('E4','group','E',2,'Ivory Coast','Curacao','2026-06-20','15:00','Bank of America Stadium','Charlotte, NC','2026-06-20 13:00:00+00'),
('E5','group','E',3,'Germany','Ivory Coast','2026-06-24','21:00','Lincoln Financial Field','Philadelphia, PA','2026-06-24 19:00:00+00'),
('E6','group','E',3,'Ecuador','Curacao','2026-06-24','21:00','Bank of America Stadium','Charlotte, NC','2026-06-24 19:00:00+00'),
-- GROUP F
('F1','group','F',1,'Netherlands','Japan','2026-06-14','21:00','Levi''s Stadium','Santa Clara, CA','2026-06-14 19:00:00+00'),
('F2','group','F',1,'Sweden','Tunisia','2026-06-15','18:00','Hard Rock Stadium','Miami, FL','2026-06-15 16:00:00+00'),
('F3','group','F',2,'Netherlands','Sweden','2026-06-20','18:00','Levi''s Stadium','Santa Clara, CA','2026-06-20 16:00:00+00'),
('F4','group','F',2,'Japan','Tunisia','2026-06-20','21:00','Hard Rock Stadium','Miami, FL','2026-06-20 19:00:00+00'),
('F5','group','F',3,'Netherlands','Tunisia','2026-06-25','21:00','Levi''s Stadium','Santa Clara, CA','2026-06-25 19:00:00+00'),
('F6','group','F',3,'Japan','Sweden','2026-06-25','21:00','Hard Rock Stadium','Miami, FL','2026-06-25 19:00:00+00'),
-- GROUP G
('G1','group','G',1,'Belgium','Egypt','2026-06-15','21:00','Gillette Stadium','Foxborough, MA','2026-06-15 19:00:00+00'),
('G2','group','G',1,'Iran','New Zealand','2026-06-16','15:00','Estadio Azteca','Mexico City, MEX','2026-06-16 13:00:00+00'),
('G3','group','G',2,'Belgium','Iran','2026-06-21','15:00','Gillette Stadium','Foxborough, MA','2026-06-21 13:00:00+00'),
('G4','group','G',2,'Egypt','New Zealand','2026-06-21','18:00','Estadio Azteca','Mexico City, MEX','2026-06-21 16:00:00+00'),
('G5','group','G',3,'Belgium','New Zealand','2026-06-26','21:00','Gillette Stadium','Foxborough, MA','2026-06-26 19:00:00+00'),
('G6','group','G',3,'Egypt','Iran','2026-06-26','21:00','Estadio Azteca','Mexico City, MEX','2026-06-26 19:00:00+00'),
-- GROUP H
('H1','group','H',1,'Spain','Cape Verde','2026-06-15','15:00','Estadio BBVA','Monterrey, MEX','2026-06-15 13:00:00+00'),
('H2','group','H',1,'Saudi Arabia','Uruguay','2026-06-16','18:00','Estadio Akron','Guadalajara, MEX','2026-06-16 16:00:00+00'),
('H3','group','H',2,'Spain','Saudi Arabia','2026-06-20','21:00','Estadio BBVA','Monterrey, MEX','2026-06-20 19:00:00+00'),
('H4','group','H',2,'Uruguay','Cape Verde','2026-06-21','21:00','Estadio Akron','Guadalajara, MEX','2026-06-21 19:00:00+00'),
('H5','group','H',3,'Spain','Uruguay','2026-06-26','21:00','Estadio BBVA','Monterrey, MEX','2026-06-26 19:00:00+00'),
('H6','group','H',3,'Cape Verde','Saudi Arabia','2026-06-26','21:00','Estadio Akron','Guadalajara, MEX','2026-06-26 19:00:00+00'),
-- GROUP I
('I1','group','I',1,'France','Norway','2026-06-16','21:00','AT&T Stadium','Arlington, TX','2026-06-16 19:00:00+00'),
('I2','group','I',1,'Senegal','Iraq','2026-06-17','15:00','Arrowhead Stadium','Kansas City, MO','2026-06-17 13:00:00+00'),
('I3','group','I',2,'France','Senegal','2026-06-21','21:00','AT&T Stadium','Arlington, TX','2026-06-21 19:00:00+00'),
('I4','group','I',2,'Norway','Iraq','2026-06-22','15:00','Arrowhead Stadium','Kansas City, MO','2026-06-22 13:00:00+00'),
('I5','group','I',3,'France','Iraq','2026-06-27','21:00','AT&T Stadium','Arlington, TX','2026-06-27 19:00:00+00'),
('I6','group','I',3,'Norway','Senegal','2026-06-27','21:00','Arrowhead Stadium','Kansas City, MO','2026-06-27 19:00:00+00'),
-- GROUP J
('J1','group','J',1,'Argentina','Algeria','2026-06-16','21:00','MetLife Stadium','East Rutherford, NJ','2026-06-16 19:00:00+00'),
('J2','group','J',1,'Austria','Jordan','2026-06-17','18:00','Lincoln Financial Field','Philadelphia, PA','2026-06-17 16:00:00+00'),
('J3','group','J',2,'Argentina','Austria','2026-06-22','18:00','MetLife Stadium','East Rutherford, NJ','2026-06-22 16:00:00+00'),
('J4','group','J',2,'Algeria','Jordan','2026-06-22','15:00','Lincoln Financial Field','Philadelphia, PA','2026-06-22 13:00:00+00'),
('J5','group','J',3,'Argentina','Jordan','2026-06-27','21:00','MetLife Stadium','East Rutherford, NJ','2026-06-27 19:00:00+00'),
('J6','group','J',3,'Austria','Algeria','2026-06-27','21:00','Lincoln Financial Field','Philadelphia, PA','2026-06-27 19:00:00+00'),
-- GROUP K
('K1','group','K',1,'Portugal','DR Congo','2026-06-17','21:00','SoFi Stadium','Los Angeles, CA','2026-06-17 19:00:00+00'),
('K2','group','K',1,'Colombia','Uzbekistan','2026-06-18','15:00','Bank of America Stadium','Charlotte, NC','2026-06-18 13:00:00+00'),
('K3','group','K',2,'Portugal','Uzbekistan','2026-06-22','21:00','SoFi Stadium','Los Angeles, CA','2026-06-22 19:00:00+00'),
('K4','group','K',2,'Colombia','DR Congo','2026-06-23','15:00','Bank of America Stadium','Charlotte, NC','2026-06-23 13:00:00+00'),
('K5','group','K',3,'Portugal','Colombia','2026-06-28','21:00','SoFi Stadium','Los Angeles, CA','2026-06-28 19:00:00+00'),
('K6','group','K',3,'DR Congo','Uzbekistan','2026-06-28','21:00','Bank of America Stadium','Charlotte, NC','2026-06-28 19:00:00+00'),
-- GROUP L
('L1','group','L',1,'England','Croatia','2026-06-18','21:00','Hard Rock Stadium','Miami, FL','2026-06-18 19:00:00+00'),
('L2','group','L',1,'Panama','Ghana','2026-06-18','18:00','Gillette Stadium','Foxborough, MA','2026-06-18 16:00:00+00'),
('L3','group','L',2,'England','Ghana','2026-06-23','18:00','Hard Rock Stadium','Miami, FL','2026-06-23 16:00:00+00'),
('L4','group','L',2,'Panama','Croatia','2026-06-23','15:00','Gillette Stadium','Foxborough, MA','2026-06-23 13:00:00+00'),
('L5','group','L',3,'England','Panama','2026-06-28','21:00','Hard Rock Stadium','Miami, FL','2026-06-28 19:00:00+00'),
('L6','group','L',3,'Croatia','Ghana','2026-06-28','21:00','Gillette Stadium','Foxborough, MA','2026-06-28 19:00:00+00'),
-- KNOCKOUT ROUNDS
('R32-1','r32',NULL,NULL,'TBD','TBD','2026-06-29','18:00','MetLife Stadium','East Rutherford, NJ','2026-06-29 16:00:00+00'),
('R32-2','r32',NULL,NULL,'TBD','TBD','2026-06-29','21:00','AT&T Stadium','Arlington, TX','2026-06-29 19:00:00+00'),
('R32-3','r32',NULL,NULL,'TBD','TBD','2026-06-30','18:00','SoFi Stadium','Los Angeles, CA','2026-06-30 16:00:00+00'),
('R32-4','r32',NULL,NULL,'TBD','TBD','2026-06-30','21:00','Arrowhead Stadium','Kansas City, MO','2026-06-30 19:00:00+00'),
('R32-5','r32',NULL,NULL,'TBD','TBD','2026-07-01','18:00','Levi''s Stadium','Santa Clara, CA','2026-07-01 16:00:00+00'),
('R32-6','r32',NULL,NULL,'TBD','TBD','2026-07-01','21:00','Lincoln Financial Field','Philadelphia, PA','2026-07-01 19:00:00+00'),
('R32-7','r32',NULL,NULL,'TBD','TBD','2026-07-02','18:00','Bank of America Stadium','Charlotte, NC','2026-07-02 16:00:00+00'),
('R32-8','r32',NULL,NULL,'TBD','TBD','2026-07-02','21:00','Hard Rock Stadium','Miami, FL','2026-07-02 19:00:00+00'),
('R32-9','r32',NULL,NULL,'TBD','TBD','2026-07-03','18:00','Gillette Stadium','Foxborough, MA','2026-07-03 16:00:00+00'),
('R32-10','r32',NULL,NULL,'TBD','TBD','2026-07-03','21:00','BMO Field','Toronto, CAN','2026-07-03 19:00:00+00'),
('R32-11','r32',NULL,NULL,'TBD','TBD','2026-07-04','18:00','BC Place','Vancouver, CAN','2026-07-04 16:00:00+00'),
('R32-12','r32',NULL,NULL,'TBD','TBD','2026-07-04','21:00','Estadio Azteca','Mexico City, MEX','2026-07-04 19:00:00+00'),
('R32-13','r32',NULL,NULL,'TBD','TBD','2026-07-05','18:00','Estadio BBVA','Monterrey, MEX','2026-07-05 16:00:00+00'),
('R32-14','r32',NULL,NULL,'TBD','TBD','2026-07-05','21:00','Estadio Akron','Guadalajara, MEX','2026-07-05 19:00:00+00'),
('R32-15','r32',NULL,NULL,'TBD','TBD','2026-07-06','18:00','MetLife Stadium','East Rutherford, NJ','2026-07-06 16:00:00+00'),
('R32-16','r32',NULL,NULL,'TBD','TBD','2026-07-06','21:00','AT&T Stadium','Arlington, TX','2026-07-06 19:00:00+00'),
('R16-1','r16',NULL,NULL,'TBD','TBD','2026-07-08','18:00','MetLife Stadium','East Rutherford, NJ','2026-07-08 16:00:00+00'),
('R16-2','r16',NULL,NULL,'TBD','TBD','2026-07-08','21:00','SoFi Stadium','Los Angeles, CA','2026-07-08 19:00:00+00'),
('R16-3','r16',NULL,NULL,'TBD','TBD','2026-07-09','18:00','AT&T Stadium','Arlington, TX','2026-07-09 16:00:00+00'),
('R16-4','r16',NULL,NULL,'TBD','TBD','2026-07-09','21:00','Levi''s Stadium','Santa Clara, CA','2026-07-09 19:00:00+00'),
('R16-5','r16',NULL,NULL,'TBD','TBD','2026-07-10','18:00','Arrowhead Stadium','Kansas City, MO','2026-07-10 16:00:00+00'),
('R16-6','r16',NULL,NULL,'TBD','TBD','2026-07-10','21:00','Lincoln Financial Field','Philadelphia, PA','2026-07-10 19:00:00+00'),
('R16-7','r16',NULL,NULL,'TBD','TBD','2026-07-11','18:00','Bank of America Stadium','Charlotte, NC','2026-07-11 16:00:00+00'),
('R16-8','r16',NULL,NULL,'TBD','TBD','2026-07-11','21:00','Hard Rock Stadium','Miami, FL','2026-07-11 19:00:00+00'),
('QF-1','qf',NULL,NULL,'TBD','TBD','2026-07-14','18:00','MetLife Stadium','East Rutherford, NJ','2026-07-14 16:00:00+00'),
('QF-2','qf',NULL,NULL,'TBD','TBD','2026-07-14','21:00','AT&T Stadium','Arlington, TX','2026-07-14 19:00:00+00'),
('QF-3','qf',NULL,NULL,'TBD','TBD','2026-07-15','18:00','SoFi Stadium','Los Angeles, CA','2026-07-15 16:00:00+00'),
('QF-4','qf',NULL,NULL,'TBD','TBD','2026-07-15','21:00','Levi''s Stadium','Santa Clara, CA','2026-07-15 19:00:00+00'),
('SF-1','sf',NULL,NULL,'TBD','TBD','2026-07-18','20:00','MetLife Stadium','East Rutherford, NJ','2026-07-18 18:00:00+00'),
('SF-2','sf',NULL,NULL,'TBD','TBD','2026-07-19','20:00','AT&T Stadium','Arlington, TX','2026-07-19 18:00:00+00'),
('FINAL','final',NULL,NULL,'TBD','TBD','2026-07-19','19:00','MetLife Stadium','East Rutherford, NJ','2026-07-19 17:00:00+00');
