import { SLEEPER_LEAGUE_ID, SLEEPER_DRAFT_ID } from '../config/leagueConfig'

const SLEEPER_BASE = 'https://api.sleeper.app/v1'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Sleeper fetch failed: ${response.status}`)
  }
  return response.json()
}

export function fetchSleeperLeague() {
  return fetchJson(`${SLEEPER_BASE}/league/${SLEEPER_LEAGUE_ID}`)
}

export function fetchSleeperDraft() {
  return fetchJson(`${SLEEPER_BASE}/draft/${SLEEPER_DRAFT_ID}`)
}

export function fetchSleeperDraftPicks() {
  return fetchJson(`${SLEEPER_BASE}/draft/${SLEEPER_DRAFT_ID}/picks`)
}

export function fetchSleeperRosters() {
  return fetchJson(`${SLEEPER_BASE}/league/${SLEEPER_LEAGUE_ID}/rosters`)
}

export function fetchSleeperUsers() {
  return fetchJson(`${SLEEPER_BASE}/league/${SLEEPER_LEAGUE_ID}/users`)
}

export function fetchSleeperPlayers() {
  return fetchJson(`${SLEEPER_BASE}/players/nfl`)
}
