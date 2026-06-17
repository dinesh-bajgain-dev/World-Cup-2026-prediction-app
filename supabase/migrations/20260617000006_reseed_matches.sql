-- ═══════════════════════════════════════════════════════════════════
-- Migration: Add missing columns + re-seed all group + knockout matches
-- Sources: FIFA.com, Al Jazeera, NBC Sports, DirecTV schedule PDF.
-- All kickoff times are UTC. Prediction deadline = 30 min before.
-- Safe to re-run — ON CONFLICT (id) DO NOTHING.
-- ═══════════════════════════════════════════════════════════════════

-- Ensure every column exists (production DB had a partial schema)
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS group_id            TEXT,
  ADD COLUMN IF NOT EXISTS matchday            INTEGER,
  ADD COLUMN IF NOT EXISTS home_team           TEXT,
  ADD COLUMN IF NOT EXISTS away_team           TEXT,
  ADD COLUMN IF NOT EXISTS match_date          DATE,
  ADD COLUMN IF NOT EXISTS match_time          TIME,
  ADD COLUMN IF NOT EXISTS venue               TEXT,
  ADD COLUMN IF NOT EXISTS venue_city          TEXT,
  ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'upcoming',
  ADD COLUMN IF NOT EXISTS match_status        TEXT,
  ADD COLUMN IF NOT EXISTS actual_home_score   INTEGER,
  ADD COLUMN IF NOT EXISTS actual_away_score   INTEGER,
  ADD COLUMN IF NOT EXISTS prediction_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS base_odds_home      NUMERIC(6,2) DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS base_odds_draw      NUMERIC(6,2) DEFAULT 3.2,
  ADD COLUMN IF NOT EXISTS base_odds_away      NUMERIC(6,2) DEFAULT 3.5,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP STAGE (72 matches)
-- Tournament schedule: June 11 – June 27
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.matches
  (id, stage, group_id, matchday, home_team, away_team,
   match_date, match_time, venue, venue_city, prediction_deadline)
VALUES

-- ── GROUP A: Mexico · South Africa · South Korea · Czechia ───────────────────
-- Md1 June 11-12 | Md2 June 18-19 | Md3 June 24 simultaneous
('A1','group','A',1,'Mexico','South Africa',       '2026-06-11','19:00','Estadio Azteca',          'Mexico City, MEX','2026-06-11 18:30:00+00'),
('A2','group','A',1,'South Korea','Czechia',        '2026-06-12','02:00','Estadio Akron',           'Guadalajara, MEX','2026-06-12 01:30:00+00'),
('A3','group','A',2,'Czechia','South Africa',       '2026-06-18','16:00','Mercedes-Benz Stadium',  'Atlanta, GA',     '2026-06-18 15:30:00+00'),
('A4','group','A',2,'Mexico','South Korea',         '2026-06-19','02:00','Estadio Akron',           'Guadalajara, MEX','2026-06-19 01:30:00+00'),
('A5','group','A',3,'Mexico','Czechia',             '2026-06-24','23:00','Estadio Azteca',          'Mexico City, MEX','2026-06-24 22:30:00+00'),
('A6','group','A',3,'South Africa','South Korea',   '2026-06-24','23:00','Estadio Akron',           'Guadalajara, MEX','2026-06-24 22:30:00+00'),

-- ── GROUP B: Canada · Bosnia-Herzegovina · Qatar · Switzerland ───────────────
-- Md1 June 12 | Md2 June 18 | Md3 June 25 simultaneous
('B1','group','B',1,'Canada','Bosnia-Herzegovina', '2026-06-12','19:00','BMO Field',               'Toronto, CAN',    '2026-06-12 18:30:00+00'),
('B2','group','B',1,'Qatar','Switzerland',          '2026-06-12','19:00','Levi''s Stadium',         'Santa Clara, CA', '2026-06-12 18:30:00+00'),
('B3','group','B',2,'Switzerland','Bosnia-Herzegovina','2026-06-18','19:00','SoFi Stadium',         'Los Angeles, CA', '2026-06-18 18:30:00+00'),
('B4','group','B',2,'Canada','Qatar',               '2026-06-18','22:00','BC Place',                'Vancouver, CAN',  '2026-06-18 21:30:00+00'),
('B5','group','B',3,'Bosnia-Herzegovina','Qatar',  '2026-06-25','19:00','BMO Field',               'Toronto, CAN',    '2026-06-25 18:30:00+00'),
('B6','group','B',3,'Switzerland','Canada',         '2026-06-25','19:00','Levi''s Stadium',         'Santa Clara, CA', '2026-06-25 18:30:00+00'),

-- ── GROUP C: Brazil · Morocco · Haiti · Scotland ─────────────────────────────
-- Md1 June 12-14 | Md2 June 19 | Md3 June 25 simultaneous
('C1','group','C',1,'Brazil','Morocco',             '2026-06-12','22:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-12 21:30:00+00'),
('C2','group','C',1,'Haiti','Scotland',             '2026-06-14','01:00','Gillette Stadium',        'Boston, MA',      '2026-06-14 00:30:00+00'),
('C3','group','C',2,'Morocco','Haiti',              '2026-06-19','16:00','Gillette Stadium',        'Boston, MA',      '2026-06-19 15:30:00+00'),
('C4','group','C',2,'Brazil','Scotland',            '2026-06-19','22:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-19 21:30:00+00'),
('C5','group','C',3,'Brazil','Haiti',               '2026-06-25','23:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-25 22:30:00+00'),
('C6','group','C',3,'Scotland','Morocco',           '2026-06-25','23:00','Gillette Stadium',        'Boston, MA',      '2026-06-25 22:30:00+00'),

-- ── GROUP D: USA · Paraguay · Australia · Türkiye ────────────────────────────
-- Md1 June 13-14 | Md2 June 20 | Md3 June 26 simultaneous
('D1','group','D',1,'USA','Paraguay',               '2026-06-13','01:00','SoFi Stadium',            'Los Angeles, CA', '2026-06-13 00:30:00+00'),
('D2','group','D',1,'Australia','Türkiye',          '2026-06-14','04:00','BC Place',                'Vancouver, CAN',  '2026-06-14 03:30:00+00'),
('D3','group','D',2,'Paraguay','Türkiye',           '2026-06-20','01:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-20 00:30:00+00'),
('D4','group','D',2,'USA','Australia',              '2026-06-20','19:00','SoFi Stadium',            'Los Angeles, CA', '2026-06-20 18:30:00+00'),
('D5','group','D',3,'Türkiye','USA',                '2026-06-26','22:00','SoFi Stadium',            'Los Angeles, CA', '2026-06-26 21:30:00+00'),
('D6','group','D',3,'Paraguay','Australia',         '2026-06-26','22:00','BC Place',                'Vancouver, CAN',  '2026-06-26 21:30:00+00'),

-- ── GROUP E: Germany · Curaçao · Ivory Coast · Ecuador ──────────────────────
-- Md1 June 14-15 | Md2 June 20-21 | Md3 June 26 simultaneous
('E1','group','E',1,'Germany','Curaçao',            '2026-06-14','16:00','Lincoln Financial Field', 'Philadelphia, PA','2026-06-14 15:30:00+00'),
('E2','group','E',1,'Ivory Coast','Ecuador',        '2026-06-15','01:00','Arrowhead Stadium',       'Kansas City, MO', '2026-06-15 00:30:00+00'),
('E3','group','E',2,'Ecuador','Germany',            '2026-06-20','22:00','Lincoln Financial Field', 'Philadelphia, PA','2026-06-20 21:30:00+00'),
('E4','group','E',2,'Ivory Coast','Curaçao',        '2026-06-21','01:00','Arrowhead Stadium',       'Kansas City, MO', '2026-06-21 00:30:00+00'),
('E5','group','E',3,'Ecuador','Ivory Coast',        '2026-06-26','19:00','Lincoln Financial Field', 'Philadelphia, PA','2026-06-26 18:30:00+00'),
('E6','group','E',3,'Curaçao','Germany',            '2026-06-26','19:00','Arrowhead Stadium',       'Kansas City, MO', '2026-06-26 18:30:00+00'),

-- ── GROUP F: Netherlands · Romania · Japan · Tunisia ─────────────────────────
-- Romania = UEFA Playoff B winner
-- Md1 June 14-15 | Md2 June 21 | Md3 June 27 simultaneous
('F1','group','F',1,'Netherlands','Romania',        '2026-06-14','22:00','Levi''s Stadium',         'Santa Clara, CA', '2026-06-14 21:30:00+00'),
('F2','group','F',1,'Japan','Tunisia',              '2026-06-15','16:00','Hard Rock Stadium',       'Miami, FL',       '2026-06-15 15:30:00+00'),
('F3','group','F',2,'Romania','Japan',              '2026-06-21','19:00','Hard Rock Stadium',       'Miami, FL',       '2026-06-21 18:30:00+00'),
('F4','group','F',2,'Netherlands','Tunisia',        '2026-06-21','22:00','Levi''s Stadium',         'Santa Clara, CA', '2026-06-21 21:30:00+00'),
('F5','group','F',3,'Japan','Netherlands',          '2026-06-27','01:00','Levi''s Stadium',         'Santa Clara, CA', '2026-06-27 00:30:00+00'),
('F6','group','F',3,'Tunisia','Romania',            '2026-06-27','01:00','Hard Rock Stadium',       'Miami, FL',       '2026-06-27 00:30:00+00'),

-- ── GROUP G: Belgium · Egypt · IR Iran · New Zealand ────────────────────────
-- Md1 June 15 | Md2 June 21-22 | Md3 June 27 simultaneous
('G1','group','G',1,'Belgium','Egypt',              '2026-06-15','19:00','Gillette Stadium',        'Boston, MA',      '2026-06-15 18:30:00+00'),
('G2','group','G',1,'Iran','New Zealand',           '2026-06-15','22:00','Estadio Azteca',          'Mexico City, MEX','2026-06-15 21:30:00+00'),
('G3','group','G',2,'Egypt','Iran',                 '2026-06-21','16:00','Estadio Azteca',          'Mexico City, MEX','2026-06-21 15:30:00+00'),
('G4','group','G',2,'Belgium','New Zealand',        '2026-06-22','01:00','Gillette Stadium',        'Boston, MA',      '2026-06-22 00:30:00+00'),
('G5','group','G',3,'Iran','Belgium',               '2026-06-27','22:00','Estadio Azteca',          'Mexico City, MEX','2026-06-27 21:30:00+00'),
('G6','group','G',3,'New Zealand','Egypt',          '2026-06-27','22:00','Gillette Stadium',        'Boston, MA',      '2026-06-27 21:30:00+00'),

-- ── GROUP H: Spain · Cabo Verde · Saudi Arabia · Uruguay ─────────────────────
-- Md1 June 15-16 | Md2 June 22 | Md3 June 27 simultaneous
('H1','group','H',1,'Spain','Cabo Verde',           '2026-06-15','16:00','Estadio BBVA',            'Monterrey, MEX',  '2026-06-15 15:30:00+00'),
('H2','group','H',1,'Saudi Arabia','Uruguay',       '2026-06-16','01:00','Estadio Akron',           'Guadalajara, MEX','2026-06-16 00:30:00+00'),
('H3','group','H',2,'Uruguay','Spain',              '2026-06-22','19:00','Estadio BBVA',            'Monterrey, MEX',  '2026-06-22 18:30:00+00'),
('H4','group','H',2,'Saudi Arabia','Cabo Verde',    '2026-06-22','22:00','Estadio Akron',           'Guadalajara, MEX','2026-06-22 21:30:00+00'),
('H5','group','H',3,'Cabo Verde','Uruguay',         '2026-06-27','19:00','Estadio BBVA',            'Monterrey, MEX',  '2026-06-27 18:30:00+00'),
('H6','group','H',3,'Spain','Saudi Arabia',         '2026-06-27','19:00','Estadio Akron',           'Guadalajara, MEX','2026-06-27 18:30:00+00'),

-- ── GROUP I: France · Senegal · Iraq · Norway ────────────────────────────────
-- Iraq = FIFA intercontinental playoff 2 winner (confirmed: Senegal vs Iraq June 17)
-- Md1 June 16-17 | Md2 June 22 | Md3 June 27 simultaneous
('I1','group','I',1,'France','Senegal',             '2026-06-16','22:00','AT&T Stadium',            'Arlington, TX',   '2026-06-16 21:30:00+00'),
('I2','group','I',1,'Norway','Iraq',               '2026-06-16','19:00','Arrowhead Stadium',       'Kansas City, MO', '2026-06-16 18:30:00+00'),
('I3','group','I',2,'France','Norway',             '2026-06-21','22:00','AT&T Stadium',            'Arlington, TX',   '2026-06-21 21:30:00+00'),
('I4','group','I',2,'Senegal','Iraq',              '2026-06-22','16:00','Arrowhead Stadium',       'Kansas City, MO', '2026-06-22 15:30:00+00'),
('I5','group','I',3,'France','Iraq',               '2026-06-27','16:00','AT&T Stadium',            'Arlington, TX',   '2026-06-27 15:30:00+00'),
('I6','group','I',3,'Norway','Senegal',            '2026-06-27','16:00','Arrowhead Stadium',       'Kansas City, MO', '2026-06-27 15:30:00+00'),

-- ── GROUP J: Argentina · Algeria · Austria · Jordan ─────────────────────────
-- Md1 June 16-17 | Md2 June 22-23 | Md3 June 28 simultaneous
('J1','group','J',1,'Argentina','Algeria',          '2026-06-16','19:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-16 18:30:00+00'),
('J2','group','J',1,'Austria','Jordan',             '2026-06-17','22:00','Lincoln Financial Field', 'Philadelphia, PA','2026-06-17 21:30:00+00'),
('J3','group','J',2,'Algeria','Austria',            '2026-06-22','22:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-22 21:30:00+00'),
('J4','group','J',2,'Argentina','Jordan',           '2026-06-23','01:00','Lincoln Financial Field', 'Philadelphia, PA','2026-06-23 00:30:00+00'),
('J5','group','J',3,'Jordan','Algeria',             '2026-06-28','01:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-28 00:30:00+00'),
('J6','group','J',3,'Austria','Argentina',          '2026-06-28','01:00','Lincoln Financial Field', 'Philadelphia, PA','2026-06-28 00:30:00+00'),

-- ── GROUP K: Portugal · DR Congo · Uzbekistan · Colombia ────────────────────
-- June 17: Portugal vs DR Congo confirmed (Houston, noon CDT = 17:00 UTC)
-- June 17: Uzbekistan vs Colombia confirmed (Mexico City, 10pm ET = 02:00 UTC Jun 18)
-- Md1 June 17-18 | Md2 June 23-24 | Md3 June 28 simultaneous
('K1','group','K',1,'Portugal','DR Congo',          '2026-06-17','17:00','NRG Stadium',             'Houston, TX',     '2026-06-17 16:30:00+00'),
('K2','group','K',1,'Uzbekistan','Colombia',        '2026-06-18','02:00','Estadio Azteca',          'Mexico City, MEX','2026-06-18 01:30:00+00'),
('K3','group','K',2,'Colombia','Portugal',          '2026-06-23','22:00','NRG Stadium',             'Houston, TX',     '2026-06-23 21:30:00+00'),
('K4','group','K',2,'DR Congo','Uzbekistan',        '2026-06-24','01:00','Estadio Azteca',          'Mexico City, MEX','2026-06-24 00:30:00+00'),
('K5','group','K',3,'DR Congo','Colombia',          '2026-06-28','19:00','NRG Stadium',             'Houston, TX',     '2026-06-28 18:30:00+00'),
('K6','group','K',3,'Uzbekistan','Portugal',        '2026-06-28','19:00','Estadio Azteca',          'Mexico City, MEX','2026-06-28 18:30:00+00'),

-- ── GROUP L: England · Croatia · Ghana · Panama ──────────────────────────────
-- June 17: England vs Croatia confirmed (Arlington, 3pm CDT = 20:00 UTC)
-- June 17: Ghana vs Panama confirmed (Toronto, 7pm ET = 23:00 UTC)
-- Md1 June 17 | Md2 June 23 | Md3 June 28 simultaneous
('L1','group','L',1,'England','Croatia',            '2026-06-17','20:00','AT&T Stadium',            'Arlington, TX',   '2026-06-17 19:30:00+00'),
('L2','group','L',1,'Ghana','Panama',               '2026-06-17','23:00','BMO Field',               'Toronto, CAN',    '2026-06-17 22:30:00+00'),
('L3','group','L',2,'Croatia','Ghana',              '2026-06-23','16:00','BMO Field',               'Toronto, CAN',    '2026-06-23 15:30:00+00'),
('L4','group','L',2,'England','Panama',             '2026-06-23','22:00','AT&T Stadium',            'Arlington, TX',   '2026-06-23 21:30:00+00'),
('L5','group','L',3,'Panama','Croatia',             '2026-06-28','22:00','AT&T Stadium',            'Arlington, TX',   '2026-06-28 21:30:00+00'),
('L6','group','L',3,'Ghana','England',              '2026-06-28','22:00','BMO Field',               'Toronto, CAN',    '2026-06-28 21:30:00+00'),

-- ─────────────────────────────────────────────────────────────────────────────
-- ROUND OF 32 — June 28 – July 3 (16 matches, TBD teams)
-- ─────────────────────────────────────────────────────────────────────────────
('R32-1','r32',NULL,NULL,'TBD','TBD', '2026-06-28','17:00','MetLife Stadium',         'East Rutherford, NJ','2026-06-28 16:30:00+00'),
('R32-2','r32',NULL,NULL,'TBD','TBD', '2026-06-28','21:00','AT&T Stadium',            'Arlington, TX',   '2026-06-28 20:30:00+00'),
('R32-3','r32',NULL,NULL,'TBD','TBD', '2026-06-29','17:00','SoFi Stadium',            'Los Angeles, CA', '2026-06-29 16:30:00+00'),
('R32-4','r32',NULL,NULL,'TBD','TBD', '2026-06-29','21:00','Levi''s Stadium',         'Santa Clara, CA', '2026-06-29 20:30:00+00'),
('R32-5','r32',NULL,NULL,'TBD','TBD', '2026-06-30','17:00','Arrowhead Stadium',       'Kansas City, MO', '2026-06-30 16:30:00+00'),
('R32-6','r32',NULL,NULL,'TBD','TBD', '2026-06-30','21:00','Lincoln Financial Field', 'Philadelphia, PA','2026-06-30 20:30:00+00'),
('R32-7','r32',NULL,NULL,'TBD','TBD', '2026-07-01','17:00','Mercedes-Benz Stadium',  'Atlanta, GA',     '2026-07-01 16:30:00+00'),
('R32-8','r32',NULL,NULL,'TBD','TBD', '2026-07-01','21:00','Hard Rock Stadium',       'Miami, FL',       '2026-07-01 20:30:00+00'),
('R32-9','r32',NULL,NULL,'TBD','TBD', '2026-07-02','17:00','Gillette Stadium',        'Boston, MA',      '2026-07-02 16:30:00+00'),
('R32-10','r32',NULL,NULL,'TBD','TBD','2026-07-02','21:00','BMO Field',               'Toronto, CAN',    '2026-07-02 20:30:00+00'),
('R32-11','r32',NULL,NULL,'TBD','TBD','2026-07-03','17:00','BC Place',                'Vancouver, CAN',  '2026-07-03 16:30:00+00'),
('R32-12','r32',NULL,NULL,'TBD','TBD','2026-07-03','21:00','Estadio Azteca',          'Mexico City, MEX','2026-07-03 20:30:00+00'),
('R32-13','r32',NULL,NULL,'TBD','TBD','2026-07-04','01:00','Estadio BBVA',            'Monterrey, MEX',  '2026-07-04 00:30:00+00'),
('R32-14','r32',NULL,NULL,'TBD','TBD','2026-07-04','04:00','Estadio Akron',           'Guadalajara, MEX','2026-07-04 03:30:00+00'),
('R32-15','r32',NULL,NULL,'TBD','TBD','2026-07-04','17:00','NRG Stadium',             'Houston, TX',     '2026-07-04 16:30:00+00'),
('R32-16','r32',NULL,NULL,'TBD','TBD','2026-07-05','17:00','AT&T Stadium',            'Arlington, TX',   '2026-07-05 16:30:00+00'),

-- ─────────────────────────────────────────────────────────────────────────────
-- ROUND OF 16 — July 4 – 7 (8 matches, TBD teams)
-- ─────────────────────────────────────────────────────────────────────────────
('R16-1','r16',NULL,NULL,'TBD','TBD','2026-07-06','17:00','MetLife Stadium',          'East Rutherford, NJ','2026-07-06 16:30:00+00'),
('R16-2','r16',NULL,NULL,'TBD','TBD','2026-07-06','21:00','SoFi Stadium',             'Los Angeles, CA', '2026-07-06 20:30:00+00'),
('R16-3','r16',NULL,NULL,'TBD','TBD','2026-07-07','17:00','AT&T Stadium',             'Arlington, TX',   '2026-07-07 16:30:00+00'),
('R16-4','r16',NULL,NULL,'TBD','TBD','2026-07-07','21:00','Levi''s Stadium',          'Santa Clara, CA', '2026-07-07 20:30:00+00'),
('R16-5','r16',NULL,NULL,'TBD','TBD','2026-07-08','17:00','Arrowhead Stadium',        'Kansas City, MO', '2026-07-08 16:30:00+00'),
('R16-6','r16',NULL,NULL,'TBD','TBD','2026-07-08','21:00','Lincoln Financial Field',  'Philadelphia, PA','2026-07-08 20:30:00+00'),
('R16-7','r16',NULL,NULL,'TBD','TBD','2026-07-09','17:00','Mercedes-Benz Stadium',   'Atlanta, GA',     '2026-07-09 16:30:00+00'),
('R16-8','r16',NULL,NULL,'TBD','TBD','2026-07-09','21:00','Hard Rock Stadium',        'Miami, FL',       '2026-07-09 20:30:00+00'),

-- ─────────────────────────────────────────────────────────────────────────────
-- QUARTER-FINALS — July 9 – 11 (4 matches, TBD teams)
-- ─────────────────────────────────────────────────────────────────────────────
('QF-1','qf',NULL,NULL,'TBD','TBD','2026-07-11','17:00','MetLife Stadium',            'East Rutherford, NJ','2026-07-11 16:30:00+00'),
('QF-2','qf',NULL,NULL,'TBD','TBD','2026-07-11','21:00','AT&T Stadium',               'Arlington, TX',   '2026-07-11 20:30:00+00'),
('QF-3','qf',NULL,NULL,'TBD','TBD','2026-07-12','17:00','SoFi Stadium',               'Los Angeles, CA', '2026-07-12 16:30:00+00'),
('QF-4','qf',NULL,NULL,'TBD','TBD','2026-07-12','21:00','Levi''s Stadium',            'Santa Clara, CA', '2026-07-12 20:30:00+00'),

-- ─────────────────────────────────────────────────────────────────────────────
-- SEMI-FINALS — July 14 – 15 (2 matches, TBD teams)
-- ─────────────────────────────────────────────────────────────────────────────
('SF-1','sf',NULL,NULL,'TBD','TBD','2026-07-14','21:00','MetLife Stadium',            'East Rutherford, NJ','2026-07-14 20:30:00+00'),
('SF-2','sf',NULL,NULL,'TBD','TBD','2026-07-15','21:00','AT&T Stadium',               'Arlington, TX',   '2026-07-15 20:30:00+00'),

-- ─────────────────────────────────────────────────────────────────────────────
-- FINAL — July 19 (MetLife Stadium, East Rutherford NJ)
-- ─────────────────────────────────────────────────────────────────────────────
('FINAL','final',NULL,NULL,'TBD','TBD','2026-07-19','21:00','MetLife Stadium',        'East Rutherford, NJ','2026-07-19 20:30:00+00')

ON CONFLICT (id) DO NOTHING;
