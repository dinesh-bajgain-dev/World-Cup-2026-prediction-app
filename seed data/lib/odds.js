// ─── ODDS ENGINE ─────────────────────────────────────────────────────────────
// Dynamic odds calculation based on team strength, stage, and community picks

export const TEAM_STRENGTH = {
  // Tier 1 (1.0 = weakest underdog, 10.0 = strongest favourite)
  "Argentina":10.0,"France":9.8,"Brazil":9.5,"England":9.2,"Spain":9.0,
  "Portugal":8.8,"Belgium":8.5,"Netherlands":8.3,"Germany":8.0,"Croatia":7.8,
  "Uruguay":7.5,"USA":7.2,"Mexico":7.0,"Morocco":6.8,"Senegal":6.5,
  "Colombia":6.5,"Switzerland":6.3,"Denmark":6.2,"Japan":6.0,"Australia":5.8,
  "South Korea":5.8,"Turkey":5.5,"Austria":5.5,"Norway":5.3,"Ecuador":5.0,
  "Ivory Coast":5.0,"Sweden":4.8,"Iran":4.5,"Serbia":4.5,"Canada":4.5,
  "Algeria":4.3,"Egypt":4.2,"Tunisia":4.0,"Saudi Arabia":3.8,"Ghana":3.5,
  "Poland":3.5,"Paraguay":3.3,"Cape Verde":3.0,"Panama":2.8,"DR Congo":2.8,
  "Uzbekistan":2.5,"Qatar":2.3,"Bosnia-Herzegovina":2.2,"Czechia":3.0,
  "Scotland":3.2,"Haiti":2.0,"South Africa":2.5,"Curacao":1.8,"New Zealand":2.0,
  "Jordan":2.0,"Iraq":2.2,"Bolivia":1.5,
}

// Stage multipliers — higher stage = higher risk = higher odds
export const STAGE_MULTIPLIERS = {
  group: 1.0,
  r32:   1.8,
  r16:   2.5,
  qf:    4.0,
  sf:    6.5,
  final: 10.0,
}

// Accumulator odds by number of predictions
export const ACCUMULATOR_ODDS = {
  1: 1.2, 2: 1.5, 3: 1.8, 5: 2.5, 7: 3.5, 10: 5.0,
  15: 8.0, 20: 12.0, 30: 18.0, 40: 25.0, 48: 35.0,
  // Full bracket bonuses
  group_stage_complete: 10.0,
  r32_complete:         20.0,
  r16_complete:         35.0,
  qf_complete:          50.0,
  sf_complete:          80.0,
  finalists:           120.0,
  champion:            250.0,
}

/**
 * Calculate odds for a single match prediction
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {'home'|'draw'|'away'} prediction
 * @param {string} stage - 'group','r32','r16','qf','sf','final'
 * @param {object} communityOdds - { home_pct, draw_pct, away_pct, total_predictions }
 * @returns {{ home: number, draw: number, away: number, selected: number }}
 */
export function calculateMatchOdds(homeTeam, awayTeam, prediction, stage = 'group', communityOdds = null) {
  const homeStr = TEAM_STRENGTH[homeTeam] || 5.0
  const awayStr = TEAM_STRENGTH[awayTeam] || 5.0
  const stageMul = STAGE_MULTIPLIERS[stage] || 1.0

  // Base odds from team strength ratio
  const total = homeStr + awayStr
  const homeProb = homeStr / total
  const awayProb = awayStr / total
  const drawProb = 0.25 // football draw base probability

  // Normalise
  const norm = homeProb + awayProb + drawProb
  let homeBaseOdds = (1 / (homeProb / norm)) * stageMul
  let drawBaseOdds = (1 / (drawProb / norm)) * stageMul
  let awayBaseOdds = (1 / (awayProb / norm)) * stageMul

  // Community adjustment — popular picks get lower odds, underdogs get higher
  if (communityOdds && communityOdds.total_predictions > 10) {
    const homePct = (communityOdds.home_pct || 33) / 100
    const drawPct = (communityOdds.draw_pct || 33) / 100
    const awayPct = (communityOdds.away_pct || 33) / 100

    // If >60% pick home, home odds drop 15%
    homeBaseOdds *= homePct > 0.6 ? 0.85 : homePct < 0.2 ? 1.3 : 1.0
    drawBaseOdds *= drawPct > 0.6 ? 0.85 : drawPct < 0.2 ? 1.3 : 1.0
    awayBaseOdds *= awayPct > 0.6 ? 0.85 : awayPct < 0.2 ? 1.3 : 1.0
  }

  // Apply house margin (5%) and round
  const margin = 1.05
  const round2 = (v) => Math.round((v / margin) * 100) / 100

  const odds = {
    home: Math.max(1.05, round2(homeBaseOdds)),
    draw: Math.max(1.05, round2(drawBaseOdds)),
    away: Math.max(1.05, round2(awayBaseOdds)),
  }

  odds.selected = prediction === 'home' ? odds.home
                : prediction === 'draw' ? odds.draw
                : odds.away

  return odds
}

/**
 * Calculate points earned for a prediction result
 * @param {object} prediction - { predicted_home_score, predicted_away_score, predicted_winner, odds_at_submission }
 * @param {object} actualResult - { actual_home_score, actual_away_score }
 * @returns {{ points: number, status: 'exact'|'correct'|'wrong', breakdown: string[] }}
 */
export function calculatePoints(prediction, actualResult) {
  const { predicted_home_score: ph, predicted_away_score: pa, odds_at_submission } = prediction
  const { actual_home_score: ah, actual_away_score: aa } = actualResult

  const breakdown = []
  let points = 0
  let status = 'wrong'

  const actualWinner = ah > aa ? 'home' : aa > ah ? 'away' : 'draw'
  const predictedWinner = ph > pa ? 'home' : pa > ph ? 'away' : 'draw'

  // Exact score: 100 base pts × odds
  if (ph === ah && pa === aa) {
    points = Math.round(100 * odds_at_submission)
    status = 'exact'
    breakdown.push(`🎯 Exact score! +${points} pts (100 × ${odds_at_submission}x odds)`)
  }
  // Correct winner/draw: 40 base pts × odds
  else if (predictedWinner === actualWinner) {
    points = Math.round(40 * odds_at_submission)
    status = 'correct'
    breakdown.push(`✅ Correct result! +${points} pts (40 × ${odds_at_submission}x odds)`)
  } else {
    breakdown.push('❌ Incorrect prediction — 0 pts')
  }

  // Bonus: correct goal difference
  if (ph - pa === ah - aa && status !== 'wrong') {
    const bonus = 10
    points += bonus
    breakdown.push(`+${bonus} bonus pts (correct goal difference)`)
  }

  return { points, status, breakdown }
}

/**
 * Calculate knockout prediction points
 * @param {string} predicted - team predicted to win slot
 * @param {string} actual - team that actually won
 * @param {string} stage
 * @returns {{ points: number, correct: boolean }}
 */
export function calculateKnockoutPoints(predicted, actual, stage) {
  if (predicted !== actual) return { points: 0, correct: false }
  const stagePoints = { r32: 15, r16: 25, qf: 40, sf: 60, final: 100 }
  return { points: stagePoints[stage] || 0, correct: true }
}

/**
 * Get accumulator multiplier based on total predictions count
 */
export function getAccumulatorMultiplier(count) {
  const thresholds = Object.keys(ACCUMULATOR_ODDS).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b)
  let mul = 1.0
  for (const t of thresholds) {
    if (count >= t) mul = ACCUMULATOR_ODDS[t]
  }
  return mul
}

/**
 * Calculate odds label/badge
 */
export function getOddsLabel(odds) {
  if (odds >= 200) return { label: 'LEGENDARY', color: '#ff6b35' }
  if (odds >= 80)  return { label: 'EPIC',       color: '#a855f7' }
  if (odds >= 30)  return { label: 'HIGH RISK',  color: '#ef4444' }
  if (odds >= 10)  return { label: 'BOLD',       color: '#f97316' }
  if (odds >= 4)   return { label: 'MODERATE',   color: '#eab308' }
  return               { label: 'SAFE',       color: '#22c55e' }
}

/**
 * Format odds for display
 */
export function fmtOdds(v) {
  if (!v) return '—'
  return `${parseFloat(v).toFixed(2)}x`
}
