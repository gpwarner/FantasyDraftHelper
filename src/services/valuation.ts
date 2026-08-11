import type { LeagueSettings, PlayerIdentity, PlayerValuation } from '../types'

const POSITION_BASE_VALUES: Record<string, number> = {
  QB: 95,
  SUPER_FLEX: 95,
  RB: 90,
  WR: 88,
  TE: 82,
  FLEX: 86,
  K: 40,
  DEF: 36,
}

const POSITION_BONUS: Record<string, number> = {
  QB: 8,
  SUPER_FLEX: 8,
  RB: 6,
  WR: 6,
  TE: 4,
  FLEX: 5,
  K: 0,
  DEF: 0,
}

export function getBaselineValue(
  player: PlayerIdentity,
  positionRank: number,
  positionPoolSize: number,
): number {
  const base = POSITION_BASE_VALUES[player.position] ?? 70
  const depthFactor = Math.max(0, 1 - positionRank / Math.max(positionPoolSize, 20))
  const rankBonus = depthFactor * 12
  const positionBonus = POSITION_BONUS[player.position] ?? 0
  return Number((base + rankBonus + positionBonus).toFixed(2))
}

export function evaluateRosterCounts(
  rosterPlayerIds: string[],
  players: Record<string, PlayerIdentity>,
) {
  const counts = {
    qb: 0,
    rb: 0,
    wr: 0,
    te: 0,
    k: 0,
    def: 0,
    rbwr: 0,
  }

  rosterPlayerIds.forEach((id) => {
    const player = players[id]
    if (!player) return

    switch (player.position) {
      case 'QB':
      case 'SUPER_FLEX':
        counts.qb += 1
        break
      case 'RB':
        counts.rb += 1
        counts.rbwr += 1
        break
      case 'WR':
        counts.wr += 1
        counts.rbwr += 1
        break
      case 'TE':
        counts.te += 1
        break
      case 'K':
        counts.k += 1
        break
      case 'DEF':
        counts.def += 1
        break
    }
  })

  return counts
}

function scoreRosterNeed(
  player: PlayerIdentity,
  rosterCounts: ReturnType<typeof evaluateRosterCounts>,
): number {
  if (player.position === 'QB' || player.position === 'SUPER_FLEX') {
    if (rosterCounts.qb < 2) return 24
    if (rosterCounts.qb === 2) return 12
    return -8
  }

  if (player.position === 'RB' || player.position === 'WR' || player.position === 'FLEX') {
    if (rosterCounts.rbwr < 6) return 18
    if (rosterCounts.rbwr < 8) return 8
    return 2
  }

  if (player.position === 'TE') {
    if (rosterCounts.te < 1) return 20
    if (rosterCounts.te < 2) return 8
    return -4
  }

  if (player.position === 'K') {
    return rosterCounts.k === 0 ? 4 : -8
  }

  if (player.position === 'DEF') {
    return rosterCounts.def === 0 ? 4 : -8
  }

  return 0
}

export function evaluatePlayer(
  player: PlayerIdentity,
  positionRank: number,
  positionPoolSize: number,
  rosterCounts: ReturnType<typeof evaluateRosterCounts>,
): PlayerValuation {
  const baselineValue = getBaselineValue(player, positionRank, positionPoolSize)
  const rosterFitScore = scoreRosterNeed(player, rosterCounts)
  const urgencyScore = 0
  const draftScore = Number(
    (baselineValue * 0.62 + rosterFitScore * 1.1 + urgencyScore * 0.3).toFixed(2),
  )

  return {
    sleeperId: player.sleeperId,
    projectedPoints: 0,
    baselineValue,
    vorp: 0,
    customRank: 0,
    tier: 0,
    tierScarcityScore: 0,
    rosterFitScore,
    opponentDemandScore: 0,
    returnProbability: 0,
    returnConfidence: 'low',
    urgencyScore,
    draftScore,
  }
}
