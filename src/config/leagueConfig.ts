import type { LeagueSettings } from '../types'

export const SLEEPER_LEAGUE_ID = '1389719771653615616'
export const SLEEPER_DRAFT_ID = '1389719771653615617'
export const USER_ROSTER_ID = 3

export const LEAGUE_SETTINGS: LeagueSettings = {
  teams: 10,
  rounds: 16,
  superflex: true,
  draftPosition: 1,
  benchSlots: 5,
  scoringRules: {
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
  },
}

export const DRAFT_SEQUENCE = [
  1, 20, 21, 40, 41, 60, 61, 80, 81, 100, 101, 120, 121, 140, 141, 160,
]
