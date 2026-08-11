export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | 'FLEX' | 'SUPER_FLEX'

export interface PlayerIdentity {
  sleeperId: string
  firstName: string
  lastName: string
  fullName: string
  position: Position
  nflTeam: string | null
  active: boolean
  byeWeek?: number
  injuryStatus?: string | null
  depthChartOrder?: number | null
  externalIds: {
    espn?: string
    fantasyData?: string
    sportradar?: string
    yahoo?: string
    gsis?: string
    fantasyPros?: string
  }
}

export interface RankingRecord {
  sleeperId: string
  source: string
  overallRank: number
  positionRank?: number
  tier?: number
  rankBest?: number
  rankWorst?: number
  rankStdDev?: number
  format?: 'ppr' | 'superflex' | 'overall'
  updatedAt: string
}

export interface ProjectionRecord {
  sleeperId: string
  source: string
  passYds?: number
  passTd?: number
  interceptions?: number
  rushYds?: number
  rushTd?: number
  receptions?: number
  recYds?: number
  recTd?: number
  fumbles?: number
  games?: number
  updatedAt: string
}

export interface PlayerValuation {
  sleeperId: string
  projectedPoints: number
  baselineValue: number
  vorp: number
  customRank: number
  tier: number
  tierScarcityScore: number
  rosterFitScore: number
  opponentDemandScore: number
  returnProbability: number
  returnConfidence: 'low' | 'medium' | 'high'
  urgencyScore: number
  draftScore: number
}

export interface PlayerPreference {
  sleeperId: string
  preference: 'target' | 'boost' | 'neutral' | 'fade' | 'dnd'
  adjustment: number
  note?: string
}

export interface DraftedPlayer {
  sleeperId: string
  fullName: string
  pickNumber: number
  round: number
  draftSlot: number
  rosterId: number
  pickedBy?: string
}

export interface LeagueSettings {
  teams: number
  rounds: number
  superflex: boolean
  draftPosition: number
  benchSlots: number
  scoringRules: ScoringRules
}

export interface ScoringRules {
  passYds: number
  passTd: number
  interceptions: number
  pass2pt: number
  rushYds: number
  rushTd: number
  rush2pt: number
  reception: number
  recYds: number
  recTd: number
  rec2pt: number
  fumble: number
  fumbleLost: number
}
