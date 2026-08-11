import type { ProjectionRecord, ScoringRules } from '../types'

export const DEFAULT_SCORING_RULES: ScoringRules = {
  passYds: 0.05,
  passTd: 4,
  interceptions: -1,
  pass2pt: 2,
  rushYds: 0.1,
  rushTd: 6,
  rush2pt: 2,
  reception: 1,
  recYds: 0.1,
  recTd: 6,
  rec2pt: 2,
  fumble: -1,
  fumbleLost: -2,
}

export function calculateProjectedFantasyPoints(
  projection: ProjectionRecord,
  scoringRules: ScoringRules = DEFAULT_SCORING_RULES,
): number {
  return (
    (projection.passYds ?? 0) * scoringRules.passYds +
    (projection.passTd ?? 0) * scoringRules.passTd +
    (projection.interceptions ?? 0) * scoringRules.interceptions +
    (projection.rushYds ?? 0) * scoringRules.rushYds +
    (projection.rushTd ?? 0) * scoringRules.rushTd +
    (projection.receptions ?? 0) * scoringRules.reception +
    (projection.recYds ?? 0) * scoringRules.recYds +
    (projection.recTd ?? 0) * scoringRules.recTd +
    (projection.fumbles ?? 0) * scoringRules.fumble +
    (projection.fumbles ?? 0) * scoringRules.fumbleLost
  )
}
