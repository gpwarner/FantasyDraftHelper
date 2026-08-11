import type { PlayerIdentity, PlayerValuation } from '../types'
import { evaluatePlayer, evaluateRosterCounts } from './valuation'

export interface PairRecommendation {
  playerA: PlayerValuation
  playerB: PlayerValuation
  score: number
  label: string
  reason: string
}

function makePairLabel(a: PlayerIdentity, b: PlayerIdentity): string {
  const positions = [a.position, b.position]
  const hasQB = positions.includes('QB') || positions.includes('SUPER_FLEX')
  const hasTE = positions.includes('TE')
  const skillCount = positions.filter((pos) => pos === 'RB' || pos === 'WR' || pos === 'FLEX').length

  if (hasQB && skillCount >= 1) return 'QB + Skill Pair'
  if (hasQB && hasTE) return 'QB + TE Pair'
  if (hasQB) return 'QB-Heavy Pair'
  if (hasTE && skillCount >= 1) return 'TE-Skill Pair'
  if (skillCount >= 2) return 'Skill-Position Pair'
  return 'Balanced Pair'
}

function makePairReason(label: string, a: PlayerIdentity, b: PlayerIdentity): string {
  if (label === 'QB + Skill Pair') {
    return `This pair combines a quarterback with a skill player to secure both QB depth and offensive upside.`
  }
  if (label === 'QB + TE Pair') {
    return `This pair locks in a strong QB option alongside tight end value for structural balance.`
  }
  if (label === 'QB-Heavy Pair') {
    return `This pair strengthens superflex/QB depth ahead of the long 18-pick gap.`
  }
  if (label === 'TE-Skill Pair') {
    return `This pair improves tight end floor while adding a high-utility skill asset.`
  }
  if (label === 'Skill-Position Pair') {
    return `This pair is focused on RB/WR depth and starter-quality skill support.`
  }
  return `This pair maximizes combined baseline value and roster fit for the current turn.`
}

export function buildPairRecommendations(
  availableIds: string[],
  players: Record<string, PlayerIdentity>,
  rosterIds: string[],
  maxCandidates = 20,
): PairRecommendation[] {
  const rosterCounts = evaluateRosterCounts(rosterIds, players)
  const candidates = availableIds
    .map((id) => {
      const player = players[id]
      if (!player) return null
      return {
        id,
        valuation: evaluatePlayer(player, 1, maxCandidates, rosterCounts),
      }
    })
    .filter((entry): entry is { id: string; valuation: PlayerValuation } => entry !== null)
    .sort((a, b) => b.valuation.draftScore - a.valuation.draftScore)
    .slice(0, maxCandidates)

  const recommendations: PairRecommendation[] = []

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const first = candidates[i].valuation
      const secondPlayer = players[candidates[j].id]
      if (!secondPlayer) continue
      const secondRosterCounts = evaluateRosterCounts([...rosterIds, first.sleeperId], players)
      const second = evaluatePlayer(
        secondPlayer,
        j + 1,
        candidates.length,
        secondRosterCounts,
      )

      const combinedScore = Number(
        (first.draftScore + second.draftScore + first.rosterFitScore + second.rosterFitScore).toFixed(2),
      )

      const secondIdentity = players[candidates[j].id]
      const firstIdentity = players[first.sleeperId]
      const label = makePairLabel(firstIdentity, secondIdentity)
      recommendations.push({
        playerA: first,
        playerB: second,
        score: combinedScore,
        label,
        reason: makePairReason(label, firstIdentity, secondIdentity),
      })
    }
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 5)
}
