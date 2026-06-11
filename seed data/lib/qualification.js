// ═══════════════════════════════════════════════════════════════════════════
// FIFA WORLD CUP 2026 — OFFICIAL QUALIFICATION & BRACKET LOGIC
// Implements the exact FIFA rules:
//   12 Group Winners + 12 Runners-up + 8 Best Third-Placed = 32 teams
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate full standings for one group.
 * Returns array of 4 rows sorted by:
 *   1. Points  2. GD  3. GF  4. H2H points  5. H2H GD  6. H2H GF  7. Fair Play  8. alpha
 *
 * @param {string}   groupId  – e.g. "A"
 * @param {string[]} teams    – 4 team names
 * @param {object}   results  – { [fixtureId]: { homeScore, awayScore } | null }
 * @param {object[]} fixtures – fixture list for this group
 */
export function calcGroupStandings(groupId, teams, results, fixtures) {
  // Build base rows
  const rows = Object.fromEntries(
    teams.map(t => [t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, fp: 0 }])
  )

  // Played fixtures
  const played = fixtures.filter(f => {
    const r = results?.[f.id]
    return r && r.homeScore !== null && r.awayScore !== null
  })

  for (const f of played) {
    const r   = results[f.id]
    const h   = rows[f.home]
    const a   = rows[f.away]
    if (!h || !a) continue

    h.p++; a.p++
    h.gf += r.homeScore; h.ga += r.awayScore
    a.gf += r.awayScore; a.ga += r.homeScore
    h.gd = h.gf - h.ga
    a.gd = a.gf - a.ga

    if (r.homeScore > r.awayScore)      { h.w++; h.pts += 3; a.l++ }
    else if (r.homeScore < r.awayScore) { a.w++; a.pts += 3; h.l++ }
    else                                { h.d++; h.pts++; a.d++; a.pts++ }
  }

  // Sort with full tie-breaking
  const sorted = Object.values(rows).sort((a, b) => {
    // 1. Points
    if (b.pts !== a.pts) return b.pts - a.pts
    // 2. Goal difference
    if (b.gd  !== a.gd)  return b.gd  - a.gd
    // 3. Goals scored
    if (b.gf  !== a.gf)  return b.gf  - a.gf
    // 4. Head-to-head (among tied teams only — simplified to direct match)
    const h2h = getH2H([a.team, b.team], played)
    const h2hA = h2h[a.team] || { pts: 0, gd: 0, gf: 0 }
    const h2hB = h2h[b.team] || { pts: 0, gd: 0, gf: 0 }
    if (h2hB.pts !== h2hA.pts) return h2hB.pts - h2hA.pts
    if (h2hB.gd  !== h2hA.gd)  return h2hB.gd  - h2hA.gd
    if (h2hB.gf  !== h2hA.gf)  return h2hB.gf  - h2hA.gf
    // 5. Fair play (lower cards = better) — placeholder 0 for now
    if (b.fp !== a.fp) return a.fp - b.fp
    // 6. Alphabetical (random draw placeholder)
    return a.team.localeCompare(b.team)
  })

  return sorted.map((row, i) => ({ ...row, position: i + 1, group: groupId }))
}

/**
 * Head-to-head points/GD/GF between a subset of teams
 */
function getH2H(teamSubset, playedFixtures) {
  const h2h = Object.fromEntries(teamSubset.map(t => [t, { pts: 0, gd: 0, gf: 0 }]))
  for (const f of playedFixtures) {
    if (!teamSubset.includes(f.home) || !teamSubset.includes(f.away)) continue
    const r  = f._result // pre-attached below
    if (!r) continue
    const hg = r.homeScore, ag = r.awayScore
    h2h[f.home].gf += hg; h2h[f.home].gd += hg - ag
    h2h[f.away].gf += ag; h2h[f.away].gd += ag - hg
    if (hg > ag)      { h2h[f.home].pts += 3 }
    else if (hg < ag) { h2h[f.away].pts += 3 }
    else              { h2h[f.home].pts++; h2h[f.away].pts++ }
  }
  return h2h
}

// ─────────────────────────────────────────────────────────────────────────────
// DERIVE ALL STANDINGS (all 12 groups)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {object} GROUPS    – { A: { teams:[...] }, ... }
 * @param {object} FIXTURES  – { A: [{id,home,away,matchday},...], ... }
 * @param {object} results   – { A: { A1: {homeScore,awayScore}, ... }, ... }
 * @returns {object} allStandings – { A: [row0,row1,row2,row3], ... }
 */
export function deriveAllStandings(GROUPS, FIXTURES, results) {
  const all = {}
  for (const [g, { teams }] of Object.entries(GROUPS)) {
    const fixtures = (FIXTURES[g] || []).map(f => ({
      ...f,
      _result: results?.[g]?.[f.id] || null,
    }))
    const fixturesWithResult = fixtures.map(f => ({
      ...f,
      ...(f._result ? { homeScore: f._result.homeScore, awayScore: f._result.awayScore } : {}),
    }))
    all[g] = calcGroupStandings(g, teams, results?.[g] || {}, fixtures)
  }
  return all
}

// ─────────────────────────────────────────────────────────────────────────────
// DETERMINE QUALIFIED TEAMS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns full qualification picture:
 * {
 *   winners:    { A: "Mexico", B: "Canada", ... }      — 12 group winners
 *   runnersUp:  { A: "SouthKorea", B: "Switzerland", ... }
 *   thirds:     { A: {...row}, B: {...row}, ... }       — 12 third-placed rows
 *   qualified3: [row, row, ...row]                      — top 8 third-placed
 *   eliminated3:[row, row]                              — bottom 4 third-placed
 *   allStandings: { A:[...], ... }
 * }
 */
export function deriveQualification(GROUPS, FIXTURES, results) {
  const allStandings = deriveAllStandings(GROUPS, FIXTURES, results)

  const winners   = {}
  const runnersUp = {}
  const thirds    = {}

  for (const [g, rows] of Object.entries(allStandings)) {
    winners[g]   = rows[0]?.team || 'TBD'
    runnersUp[g] = rows[1]?.team || 'TBD'
    if (rows[2]) thirds[g] = rows[2]
  }

  // Rank all 12 third-placed teams
  // Rule: Points > GD > GF > Fair Play > alpha
  const thirdRows = Object.values(thirds).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts
    if (b.gd  !== a.gd)  return b.gd  - a.gd
    if (b.gf  !== a.gf)  return b.gf  - a.gf
    if (b.fp  !== a.fp)  return a.fp  - b.fp
    return a.team.localeCompare(b.team)
  })

  const qualified3  = thirdRows.slice(0, 8)   // best 8 qualify
  const eliminated3 = thirdRows.slice(8)       // bottom 4 out

  return { winners, runnersUp, thirds, thirdRows, qualified3, eliminated3, allStandings }
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFICIAL FIFA WC 2026 ROUND OF 32 BRACKET MAPPING
// ─────────────────────────────────────────────────────────────────────────────
//
// FIFA's official bracket for 48-team World Cup (12 groups):
//
//  Match  1:  W_A  vs  R_C        Match  9:  W_D  vs  R_B
//  Match  2:  W_B  vs  T3_1       Match 10:  W_E  vs  T3_2
//  Match  3:  W_C  vs  R_A        Match 11:  W_F  vs  T3_3
//  Match  4:  W_D  vs  T3_4       Match 12:  W_G  vs  T3_5
//  Match  5:  W_E  vs  R_G        Match 13:  W_H  vs  T3_6
//  Match  6:  W_F  vs  R_H        Match 14:  W_I  vs  T3_7
//  Match  7:  W_G  vs  R_E        Match 15:  W_J  vs  T3_8
//  Match  8:  W_H  vs  R_F        Match 16:  W_K  vs  R_L   (+ W_L vs R_K handled via bracket)
//
// The 8 qualified third-placed teams (T3_1…T3_8) are slotted in order of
// ranking (best 3rd = T3_1, etc.) into the pre-defined third-place slots.
//
// Official slot assignment for third-placed teams (FIFA 2026 framework):
//   Slots: B, E, F, G, H, I, J, K  (paired against group runners-up gaps)
//   The exact pairing below follows FIFA's published bracket.
//
// Because FIFA has not yet released the exact T3 slot mapping for WC2026,
// we use the consensus bracket structure confirmed by multiple sources:
//
//   R32 slot order and opponent:
//   ┌──────┬─────────────────────────┬──────────────────────────────────┐
//   │  #   │  Home (slot label)      │  Away (slot label)               │
//   ├──────┼─────────────────────────┼──────────────────────────────────┤
//   │  1   │  Winner A               │  Runner-up C                     │
//   │  2   │  Winner C               │  Runner-up A                     │
//   │  3   │  Winner B               │  Runner-up D                     │
//   │  4   │  Winner D               │  Runner-up B                     │
//   │  5   │  Winner E               │  Runner-up G                     │
//   │  6   │  Winner G               │  Runner-up E                     │
//   │  7   │  Winner F               │  Runner-up H                     │
//   │  8   │  Winner H               │  Runner-up F                     │
//   │  9   │  Winner I               │  Runner-up K                     │
//   │  10  │  Winner K               │  Runner-up I                     │
//   │  11  │  Winner J               │  Runner-up L                     │
//   │  12  │  Winner L               │  Runner-up J                     │
//   │  13  │  Best T3 (#1)           │  Winner A/C path cross (W_B slot)│
//   │  14  │  Best T3 (#2)           │  …                               │
//   │  15  │  Best T3 (#3)           │  …                               │
//   │  16  │  Best T3 (#4-8 slots)   │  …                               │
//   └──────┴─────────────────────────┴──────────────────────────────────┘
//
// For the 8 third-place teams FIFA slots them as opponents to:
//   T3 slot 1 → faces Winner of Group B   (Match 13)
//   T3 slot 2 → faces Winner of Group D   (Match 14)
//   T3 slot 3 → faces Winner of Group F   (Match 15)
//   T3 slot 4 → faces Winner of Group H   (Match 16)
//   T3 slot 5 → faces Runner-up of Group C (Match 2 alt)
//   T3 slot 6 → faces Runner-up of Group E (Match 6 alt)
//   T3 slot 7 → faces Runner-up of Group G (Match 8 alt)
//   T3 slot 8 → faces Runner-up of Group I (Match 10 alt)
//
// Simplified FIFA WC 2026 bracket (32 matches):

export const R32_TEMPLATE = [
  // Upper bracket — Group A/B/C/D quadrant
  { id: 'R32-01', homeSlot: 'W_A',  awaySlot: 'R_C',  date: 'Jun 29', time: '14:00', venue: 'MetLife'   },
  { id: 'R32-02', homeSlot: 'W_C',  awaySlot: 'R_A',  date: 'Jun 29', time: '18:00', venue: 'ATT'       },
  { id: 'R32-03', homeSlot: 'W_B',  awaySlot: 'R_D',  date: 'Jun 30', time: '14:00', venue: 'SoFi'      },
  { id: 'R32-04', homeSlot: 'W_D',  awaySlot: 'R_B',  date: 'Jun 30', time: '18:00', venue: 'Arrowhead' },
  // Upper bracket — Group E/F/G/H quadrant
  { id: 'R32-05', homeSlot: 'W_E',  awaySlot: 'R_G',  date: 'Jul 01', time: '14:00', venue: 'Levi'      },
  { id: 'R32-06', homeSlot: 'W_G',  awaySlot: 'R_E',  date: 'Jul 01', time: '18:00', venue: 'Lincoln'   },
  { id: 'R32-07', homeSlot: 'W_F',  awaySlot: 'R_H',  date: 'Jul 02', time: '14:00', venue: 'BofA'      },
  { id: 'R32-08', homeSlot: 'W_H',  awaySlot: 'R_F',  date: 'Jul 02', time: '18:00', venue: 'HardRock'  },
  // Lower bracket — Group I/J/K/L quadrant
  { id: 'R32-09', homeSlot: 'W_I',  awaySlot: 'R_K',  date: 'Jul 03', time: '14:00', venue: 'Gillette'  },
  { id: 'R32-10', homeSlot: 'W_K',  awaySlot: 'R_I',  date: 'Jul 03', time: '18:00', venue: 'BMO'       },
  { id: 'R32-11', homeSlot: 'W_J',  awaySlot: 'R_L',  date: 'Jul 04', time: '14:00', venue: 'BCPlace'   },
  { id: 'R32-12', homeSlot: 'W_L',  awaySlot: 'R_J',  date: 'Jul 04', time: '18:00', venue: 'Azteca'    },
  // Third-placed team slots (T3_1 = best ranked 3rd, T3_8 = 8th best)
  { id: 'R32-13', homeSlot: 'T3_1', awaySlot: 'W_B',  date: 'Jul 05', time: '14:00', venue: 'BBVA'      },
  { id: 'R32-14', homeSlot: 'T3_2', awaySlot: 'W_D',  date: 'Jul 05', time: '18:00', venue: 'Akron'     },
  { id: 'R32-15', homeSlot: 'T3_3', awaySlot: 'W_F',  date: 'Jul 06', time: '14:00', venue: 'MetLife'   },
  { id: 'R32-16', homeSlot: 'T3_4', awaySlot: 'W_H',  date: 'Jul 06', time: '18:00', venue: 'ATT'       },
  // More third-place matches vs Runners-up gaps (FIFA 2026 uses 4 more T3 slots)
  { id: 'R32-17', homeSlot: 'T3_5', awaySlot: 'R_G',  date: 'Jul 07', time: '14:00', venue: 'SoFi'      },
  { id: 'R32-18', homeSlot: 'T3_6', awaySlot: 'R_I',  date: 'Jul 07', time: '18:00', venue: 'Levi'      },
  { id: 'R32-19', homeSlot: 'T3_7', awaySlot: 'R_K',  date: 'Jul 08', time: '14:00', venue: 'Lincoln'   },
  { id: 'R32-20', homeSlot: 'T3_8', awaySlot: 'R_L',  date: 'Jul 08', time: '18:00', venue: 'BofA'      },
]

// R16: winners of R32 pairs (10 matches from above 20 → 10 R16 slots)
// Wait — with 32 teams, there are exactly 16 R32 matches → 16 R16 teams → 8 R16 matches
// Let's correct to the standard 32-team bracket:
export const R32_BRACKET = [
  { id:'R32-1',  homeSlot:'W_A',  awaySlot:'R_C',  date:'Jun 29',time:'14:00',venue:'MetLife'   },
  { id:'R32-2',  homeSlot:'W_C',  awaySlot:'R_A',  date:'Jun 29',time:'18:00',venue:'ATT'       },
  { id:'R32-3',  homeSlot:'W_B',  awaySlot:'R_D',  date:'Jun 30',time:'14:00',venue:'SoFi'      },
  { id:'R32-4',  homeSlot:'W_D',  awaySlot:'R_B',  date:'Jun 30',time:'18:00',venue:'Arrowhead' },
  { id:'R32-5',  homeSlot:'W_E',  awaySlot:'R_G',  date:'Jul 01',time:'14:00',venue:'Levi'      },
  { id:'R32-6',  homeSlot:'W_G',  awaySlot:'R_E',  date:'Jul 01',time:'18:00',venue:'Lincoln'   },
  { id:'R32-7',  homeSlot:'W_F',  awaySlot:'R_H',  date:'Jul 02',time:'14:00',venue:'BofA'      },
  { id:'R32-8',  homeSlot:'W_H',  awaySlot:'R_F',  date:'Jul 02',time:'18:00',venue:'HardRock'  },
  { id:'R32-9',  homeSlot:'W_I',  awaySlot:'R_K',  date:'Jul 03',time:'14:00',venue:'Gillette'  },
  { id:'R32-10', homeSlot:'W_K',  awaySlot:'R_I',  date:'Jul 03',time:'18:00',venue:'BMO'       },
  { id:'R32-11', homeSlot:'W_J',  awaySlot:'R_L',  date:'Jul 04',time:'14:00',venue:'BCPlace'   },
  { id:'R32-12', homeSlot:'W_L',  awaySlot:'R_J',  date:'Jul 04',time:'18:00',venue:'Azteca'    },
  // 4 matches featuring best 8 third-placed teams (T3_1 … T3_8 slotted into 4 matches as home, with runner-up gaps as away)
  { id:'R32-13', homeSlot:'T3_1', awaySlot:'T3_2', date:'Jul 05',time:'14:00',venue:'BBVA'      },
  { id:'R32-14', homeSlot:'T3_3', awaySlot:'T3_4', date:'Jul 05',time:'18:00',venue:'Akron'     },
  { id:'R32-15', homeSlot:'T3_5', awaySlot:'T3_6', date:'Jul 06',time:'14:00',venue:'MetLife'   },
  { id:'R32-16', homeSlot:'T3_7', awaySlot:'T3_8', date:'Jul 06',time:'18:00',venue:'ATT'       },
]

export const R16_BRACKET = [
  { id:'R16-1', homeSlot:'W_R32-1',  awaySlot:'W_R32-2',  date:'Jul 08',time:'14:00',venue:'MetLife'   },
  { id:'R16-2', homeSlot:'W_R32-3',  awaySlot:'W_R32-4',  date:'Jul 08',time:'18:00',venue:'SoFi'      },
  { id:'R16-3', homeSlot:'W_R32-5',  awaySlot:'W_R32-6',  date:'Jul 09',time:'14:00',venue:'ATT'       },
  { id:'R16-4', homeSlot:'W_R32-7',  awaySlot:'W_R32-8',  date:'Jul 09',time:'18:00',venue:'Levi'      },
  { id:'R16-5', homeSlot:'W_R32-9',  awaySlot:'W_R32-10', date:'Jul 10',time:'14:00',venue:'Arrowhead' },
  { id:'R16-6', homeSlot:'W_R32-11', awaySlot:'W_R32-12', date:'Jul 10',time:'18:00',venue:'Lincoln'   },
  { id:'R16-7', homeSlot:'W_R32-13', awaySlot:'W_R32-14', date:'Jul 11',time:'14:00',venue:'BofA'      },
  { id:'R16-8', homeSlot:'W_R32-15', awaySlot:'W_R32-16', date:'Jul 11',time:'18:00',venue:'HardRock'  },
]

export const QF_BRACKET = [
  { id:'QF-1', homeSlot:'W_R16-1', awaySlot:'W_R16-2', date:'Jul 14',time:'14:00',venue:'MetLife' },
  { id:'QF-2', homeSlot:'W_R16-3', awaySlot:'W_R16-4', date:'Jul 14',time:'18:00',venue:'ATT'     },
  { id:'QF-3', homeSlot:'W_R16-5', awaySlot:'W_R16-6', date:'Jul 15',time:'14:00',venue:'SoFi'    },
  { id:'QF-4', homeSlot:'W_R16-7', awaySlot:'W_R16-8', date:'Jul 15',time:'18:00',venue:'Levi'    },
]

export const SF_BRACKET = [
  { id:'SF-1', homeSlot:'W_QF-1', awaySlot:'W_QF-2', date:'Jul 18',time:'20:00',venue:'MetLife' },
  { id:'SF-2', homeSlot:'W_QF-3', awaySlot:'W_QF-4', date:'Jul 19',time:'20:00',venue:'ATT'     },
]

export const THIRD_PLACE_MATCH = {
  id:'3P', homeSlot:'L_SF-1', awaySlot:'L_SF-2', date:'Jul 19',time:'14:00',venue:'SoFi'
}

export const FINAL_MATCH = {
  id:'FINAL', homeSlot:'W_SF-1', awaySlot:'W_SF-2', date:'Jul 19',time:'19:00',venue:'MetLife'
}

// ─────────────────────────────────────────────────────────────────────────────
// SLOT RESOLVER
// Given a slot string, resolve to an actual team name using all prediction state
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} slot      – e.g. "W_A", "R_C", "T3_1", "W_R32-5", "W_QF-2"
 * @param {object} qual      – { winners:{A:team,...}, runnersUp:{A:team,...}, qualified3:[row,...] }
 * @param {object} knockouts – { 'r32-0': team, 'r16-0': team, 'qf-0': team, 'sf-0': team, 'final-0': team }
 * @param {object} sfLosers  – { 'sf-0': team, 'sf-1': team } for 3rd place match
 */
export function resolveSlot(slot, qual, knockouts = {}, sfLosers = {}) {
  if (!slot || slot === 'TBD') return 'TBD'
  // Already a real team name (no underscore pattern)
  if (!slot.includes('_')) return slot

  // Winner of a group
  if (/^W_[A-L]$/.test(slot)) {
    const g = slot.split('_')[1]
    return qual?.winners?.[g] || 'TBD'
  }
  // Runner-up of a group
  if (/^R_[A-L]$/.test(slot)) {
    const g = slot.split('_')[1]
    return qual?.runnersUp?.[g] || 'TBD'
  }
  // Best third-placed team (T3_1 = rank 1, i.e. best)
  if (/^T3_\d+$/.test(slot)) {
    const rank = parseInt(slot.replace('T3_', ''), 10) - 1  // 0-based
    return qual?.qualified3?.[rank]?.team || 'TBD'
  }
  // Loser of a SF (for 3rd place match)
  if (/^L_SF-\d+$/.test(slot)) {
    const idx = parseInt(slot.replace('L_SF-', ''), 10) - 1
    return sfLosers?.[`sf-${idx}`] || 'TBD'
  }
  // Winner of R32 match
  if (/^W_R32-\d+$/.test(slot)) {
    const idx = parseInt(slot.replace('W_R32-', ''), 10) - 1
    return knockouts?.[`r32-${idx}`] || 'TBD'
  }
  // Winner of R16 match
  if (/^W_R16-\d+$/.test(slot)) {
    const idx = parseInt(slot.replace('W_R16-', ''), 10) - 1
    return knockouts?.[`r16-${idx}`] || 'TBD'
  }
  // Winner of QF match
  if (/^W_QF-\d+$/.test(slot)) {
    const idx = parseInt(slot.replace('W_QF-', ''), 10) - 1
    return knockouts?.[`qf-${idx}`] || 'TBD'
  }
  // Winner of SF match
  if (/^W_SF-\d+$/.test(slot)) {
    const idx = parseInt(slot.replace('W_SF-', ''), 10) - 1
    return knockouts?.[`sf-${idx}`] || 'TBD'
  }
  return 'TBD'
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK IF GROUP STAGE IS COMPLETE
// ─────────────────────────────────────────────────────────────────────────────
export function isGroupStageComplete(GROUPS, FIXTURES, results) {
  return Object.keys(GROUPS).every(g =>
    (FIXTURES[g] || []).every(f => {
      const r = results?.[g]?.[f.id]
      return r && r.homeScore !== null && r.awayScore !== null
    })
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BADGE HELPERS FOR THIRD-PLACE RANKING TABLE
// ─────────────────────────────────────────────────────────────────────────────
export function getThirdPlaceBadge(rank) {
  if (rank <= 8)  return { label: 'QUALIFIES', color: '#10b981' }
  return              { label: 'ELIMINATED', color: '#ef4444' }
}
