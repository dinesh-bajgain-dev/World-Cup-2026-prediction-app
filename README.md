# FIFA World Cup 2026 — Full-Stack Prediction Platform

A production-ready, tamper-proof World Cup prediction app with Supabase backend,
dynamic odds engine, admin dashboard, and official qualification logic.

---

## Quick Start (5 steps)

### 1. Create Supabase project
Go to https://app.supabase.com → New Project → note your URL and anon key.

### 2. Run the database schema
In Supabase Dashboard → SQL Editor → paste the entire contents of
`supabase/schema.sql` and click Run. This creates all tables, RLS policies,
triggers, and seeds all 72 group + knockout fixture rows.

### 3. Set environment variables
```bash
cp .env.example .env
# Edit .env and fill in your Supabase URL and anon key
```

### 4. Install and run
```bash
npm install
npm run dev
```
Open http://localhost:5173

### 5. Create your first admin user
After registering normally, run this in Supabase SQL Editor:
```sql
UPDATE public.profiles
SET role = 'admin'
WHERE username = 'your_username_here';
```
Then sign out and back in — you'll see the Admin Panel.

---

## Project Structure

```
wc2026-fullstack/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── supabase/
│   └── schema.sql          ← Full DB schema, RLS, triggers, seed data
└── src/
    ├── main.jsx
    ├── App.jsx              ← All UI: Auth, User app, Admin panel
    ├── contexts/
    │   └── AuthContext.jsx  ← Supabase auth session management
    └── lib/
        ├── supabase.js      ← All DB queries and auth helpers
        ├── odds.js          ← Dynamic odds engine + points calculator
        └── qualification.js ← Official FIFA qualification logic + bracket
```

---

## Feature Overview

### User Features
| Feature | Description |
|---|---|
| Auth | Email/password register & sign-in via Supabase Auth |
| Group Stage | Predict all 72 matches with line-graph score predictor |
| Live Standings | Real-time group tables with FIFA tie-breaking rules |
| 3rd Place Race | All 12 third-placed teams ranked — top 8 qualify |
| Round of 32 | Fixed FIFA bracket: 12 Winners + 12 Runners-up + 8 Best 3rds |
| Round of 16 → Final | Full knockout bracket click-to-advance |
| 3rd Place Match | SF losers compete for bronze |
| Dynamic Odds | Risk-based odds per match updated by community picks |
| Accumulator | Multiplier grows with number of predictions (1.2x → 250x+) |
| Leaderboard | Global rankings by points, accuracy, exact scores |
| My Predictions | Full history with odds, lock status, result |
| Dark / Light mode | Full theme toggle, persisted per session |

### Admin Features
| Feature | Description |
|---|---|
| Overview | Platform stats: users, predictions, locked count, exact scores |
| All Users | Browse all registered users, click to view their predictions |
| All Predictions | Full table: user, match, score, odds, payout, date, lock, result |
| Audit Log | Immutable log of every prediction INSERT/UPDATE |
| Read-Only | Admins cannot edit, delete, or alter any prediction data |

---

## Qualification Logic (Official FIFA WC 2026)

Implemented in `src/lib/qualification.js`:

```
Group Stage (72 matches, 12 groups × 6 fixtures)
    ↓
Per-group standings ranked by:
  1. Points  2. Goal Difference  3. Goals For
  4. Head-to-Head  5. Fair Play  6. Alpha

12 Group Winners  ──────────────────────────────┐
12 Group Runners-up ────────────────────────────┤  = 32 teams
8 Best Third-Placed (ranked across ALL 12 groups)┘
    ↓ (bottom 4 thirds eliminated)

Round of 32 — Fixed FIFA bracket positions:
  Match 1–12:  Winner_X  vs  Runner-up_Y  (cross-group pairings)
  Match 13–16: T3-1 vs T3-2, T3-3 vs T3-4, T3-5 vs T3-6, T3-7 vs T3-8
    ↓
Round of 16 → Quarter Finals → Semi Finals
    ↓
3rd Place Match (SF losers) + The Final (SF winners)
```

Key rule: **any** third-placed team from Groups A–L can qualify based purely
on their ranking. A T3 from Group L with 5 pts beats a T3 from Group A with 2 pts.

---

## Database Security Model

All security is enforced at the **Postgres / Supabase RLS level** — not just
the frontend. This means no client-side bypass is possible.

| Rule | Enforcement |
|---|---|
| Users only see own predictions | RLS SELECT policy on `predictions` |
| Predictions locked after deadline | RLS UPDATE policy + deadline timestamp check |
| Predictions can NEVER be deleted | RLS DELETE policy: `USING (FALSE)` |
| Admins are read-only | No UPDATE/DELETE policies for admin role |
| Audit log is append-only | Trigger on predictions, no UPDATE/DELETE allowed |
| Users cannot self-promote to admin | RLS UPDATE WITH CHECK prevents role change |
| Auto-lock trigger | DB function locks predictions when deadline passes |
| Auto-create profile | Trigger creates profile row on auth.users INSERT |
| Points updated by trigger | `update_user_points()` fires after result_status set |

---

## Odds Engine

Implemented in `src/lib/odds.js`:

- **Base odds** calculated from team FIFA strength ratio
- **Stage multiplier** applied (group=1×, final=10×)
- **Community adjustment**: popular picks get lower odds, underdogs higher
- **House margin** of 5% applied
- **Accumulator** grows with prediction count (1.2× → 250×+)
- Odds are **permanently locked** in the DB at submission time — cannot be changed

### Points System
| Result | Formula |
|---|---|
| Exact score | 100 × odds_at_submission |
| Correct winner | 40 × odds_at_submission |
| Correct goal difference bonus | +10 pts |
| Knockout correct advance | 15–100 pts by stage |

---

## Environment Variables

```
VITE_SUPABASE_URL       Your Supabase project URL
VITE_SUPABASE_ANON_KEY  Your Supabase anon/public key
```

Both are safe to use client-side (Supabase anon key is designed for this).
RLS policies enforce all security server-side regardless.
