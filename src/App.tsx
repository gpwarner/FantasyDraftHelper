import { useEffect, useState } from 'react'
import './App.css'
import { fetchSleeperDraftPicks, fetchSleeperPlayers, fetchSleeperRosters } from './services/sleeper'
import { calculateProjectedFantasyPoints } from './services/scoring'
import { buildPairRecommendations } from './services/pairOptimizer'
import { evaluatePlayer, evaluateRosterCounts } from './services/valuation'
import { DRAFT_SEQUENCE, LEAGUE_SETTINGS, USER_ROSTER_ID } from './config/leagueConfig'
import type { DraftedPlayer, PlayerIdentity, PlayerValuation, RankingRecord, ProjectionRecord } from './types'

function App() {
  const [draftPicks, setDraftPicks] = useState<DraftedPlayer[]>([])
  const [players, setPlayers] = useState<Record<string, PlayerIdentity>>({})
  const [availablePlayers, setAvailablePlayers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [picks, rosterData, sleeperPlayers] = (await Promise.all([
          fetchSleeperDraftPicks(),
          fetchSleeperRosters(),
          fetchSleeperPlayers(),
        ])) as [any[], any[], Record<string, any>]

        const parsedPlayers: Record<string, PlayerIdentity> = Object.entries(sleeperPlayers).reduce(
          (map, [id, player]) => {
            map[id] = {
              sleeperId: id,
              firstName: player.first_name ?? '',
              lastName: player.last_name ?? '',
              fullName: `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim(),
              position: player.position as PlayerIdentity['position'],
              nflTeam: player.team ?? null,
              active: player.active ?? true,
              byeWeek: player.bye_week,
              injuryStatus: player.injury_status ?? null,
              depthChartOrder: player.depth_chart_order ?? null,
              externalIds: {},
            }
            return map
          },
          {} as Record<string, PlayerIdentity>,
        )

        const drafted: DraftedPlayer[] = picks.map((pick: any) => ({
          sleeperId: pick.player_id,
          fullName: parsedPlayers[pick.player_id]?.fullName ?? 'Unknown Player',
          pickNumber: pick.pick_number,
          round: pick.round,
          draftSlot: pick.draft_slot,
          rosterId: pick.roster_id,
          pickedBy: pick.picked_by,
        }))

        const draftedIds = new Set(drafted.map((pick) => pick.sleeperId))
        const available = Object.keys(parsedPlayers).filter((id) => !draftedIds.has(id))

        setPlayers(parsedPlayers)
        setDraftPicks(drafted)
        setAvailablePlayers(available)
      } catch (err) {
        setError((err as Error).message)
      }
    }

    loadData()
  }, [])

  const userRoster = draftPicks.filter((pick) => pick.rosterId === USER_ROSTER_ID)
  const opponentRosterCount = draftPicks.length - userRoster.length
  const rosterCounts = evaluateRosterCounts(userRoster.map((pick) => pick.sleeperId), players)
  const pairRecommendations = buildPairRecommendations(
    availablePlayers,
    players,
    userRoster.map((pick) => pick.sleeperId),
  )
  const currentOverallPick = draftPicks.reduce((max, pick) => Math.max(max, pick.pickNumber), 0)
  const nextUserOverallPick = DRAFT_SEQUENCE.find((pick) => pick > currentOverallPick) ?? DRAFT_SEQUENCE[DRAFT_SEQUENCE.length - 1]
  const picksUntilNextUserTurn = nextUserOverallPick - currentOverallPick

  const topIndividualRecommendations = availablePlayers
    .map((id, idx) => {
      const player = players[id]
      if (!player) return null
      return evaluatePlayer(player, idx + 1, availablePlayers.length, rosterCounts)
    })
    .filter((entry): entry is PlayerValuation => entry !== null)
    .sort((a, b) => b.draftScore - a.draftScore)
    .slice(0, 6)

  const sampleProjection: ProjectionRecord = {
    sleeperId: 'sample',
    source: 'mock',
    passYds: 0,
    rushYds: 0,
    receptions: 0,
    recYds: 0,
    recTd: 0,
    updatedAt: new Date().toISOString(),
  }

  const projectedPoints = calculateProjectedFantasyPoints(sampleProjection, LEAGUE_SETTINGS.scoringRules)

  const [mockLog, setMockLog] = useState<string[]>([])
  const [mockRounds, setMockRounds] = useState<number>(6)
  const [mockTeams, setMockTeams] = useState<number>(LEAGUE_SETTINGS.teams)

  function runMockDraft(roundsToSimulate = 6, teamsToUse = LEAGUE_SETTINGS.teams) {
    if (!Object.keys(players).length || availablePlayers.length === 0) {
      setMockLog(['Players not loaded yet.'])
      return
    }

    const teams = teamsToUse
    const userTeam = LEAGUE_SETTINGS.draftPosition
    // build overall pick order for snake draft
    const pickOrder: number[] = []
    for (let r = 1; r <= roundsToSimulate; r += 1) {
      if (r % 2 === 1) {
        for (let t = 1; t <= teams; t += 1) pickOrder.push(t)
      } else {
        for (let t = teams; t >= 1; t -= 1) pickOrder.push(t)
      }
    }

    let available = availablePlayers.slice()
    const rosters: Record<number, string[]> = {}
    for (let t = 1; t <= teams; t += 1) rosters[t] = []

    const logs: string[] = []

    for (let idx = 0; idx < pickOrder.length; idx += 1) {
      const team = pickOrder[idx]

      // user's consecutive picks handled as pair
      if (team === userTeam && idx + 1 < pickOrder.length && pickOrder[idx + 1] === userTeam) {
        const pair = buildPairRecommendations(available, players, rosters[userTeam], 20)[0]
        if (pair) {
          rosters[userTeam].push(pair.playerA.sleeperId)
          rosters[userTeam].push(pair.playerB.sleeperId)
          available = available.filter((id) => id !== pair.playerA.sleeperId && id !== pair.playerB.sleeperId)
          logs.push(`User pair pick: ${players[pair.playerA.sleeperId]?.fullName ?? pair.playerA.sleeperId} + ${players[pair.playerB.sleeperId]?.fullName ?? pair.playerB.sleeperId} (${pair.label})`)
          idx += 1 // skip the next pick since it's consumed by the pair
          continue
        }
      }

      // regular single pick: pick highest draftScore for the team
      const teamRosterCounts = evaluateRosterCounts(rosters[team], players)
      const candidateVals = available
        .map((id, i) => ({ id, val: evaluatePlayer(players[id], i + 1, available.length, teamRosterCounts) }))
        .sort((a, b) => b.val.draftScore - a.val.draftScore)

      if (candidateVals.length === 0) break
      const pickId = candidateVals[0].id
      rosters[team].push(pickId)
      available = available.filter((id) => id !== pickId)
      if (team === userTeam) {
        logs.push(`User pick: ${players[pickId]?.fullName ?? pickId}`)
      }
    }

    logs.push(`User final roster after simulation (${roundsToSimulate} rounds):`)
    rosters[userTeam].forEach((id) => logs.push(` - ${players[id]?.fullName ?? id} (${players[id]?.position ?? 'N/A'})`))
    setMockLog(logs)
  }

  return (
    <div className="app-shell">
      <header>
        <h1>Fantasy Football Draft Helper</h1>
        <p>Live Sleeper draft dashboard scaffold with league scoring and draft state.</p>
        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Rounds:
            <input
              type="number"
              min={1}
              value={mockRounds}
              onChange={(e) => setMockRounds(Math.max(1, parseInt(e.target.value || '1', 10)))}
              style={{ width: 72 }}
            />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Teams:
            <input
              type="number"
              min={2}
              value={mockTeams}
              onChange={(e) => setMockTeams(Math.max(2, parseInt(e.target.value || '2', 10)))}
              style={{ width: 72 }}
            />
          </label>
          <button type="button" onClick={() => runMockDraft(mockRounds, mockTeams)}>Run mock draft</button>
        </div>
      </header>

      {error ? <div className="error">Error: {error}</div> : null}

      <section className="summary-cards">
        <article className="card">
          <h2>Draft Status</h2>
          <p>Picks recorded: {draftPicks.length}</p>
          <p>Your roster picks: {userRoster.length}</p>
          <p>Opponent picks: {opponentRosterCount}</p>
        </article>
        <article className="card">
          <h2>League</h2>
          <p>Teams: {LEAGUE_SETTINGS.teams}</p>
          <p>Superflex: {LEAGUE_SETTINGS.superflex ? 'Yes' : 'No'}</p>
        </article>
        <article className="card">
          <h2>Scoring Preview</h2>
          <p>Projected points example: {projectedPoints.toFixed(1)}</p>
          <p>Pass yards: {LEAGUE_SETTINGS.scoringRules.passYds} / yd</p>
          <p>Receptions: {LEAGUE_SETTINGS.scoringRules.reception} / catch</p>
        </article>
        <article className="card">
          <h2>Best Pair</h2>
          {pairRecommendations.length === 0 ? (
            <p>Analyzing draft state...</p>
          ) : (
            <>
              <p className="best-pair-name">
                {players[pairRecommendations[0].playerA.sleeperId]?.fullName ?? pairRecommendations[0].playerA.sleeperId}
                {' + '}
                {players[pairRecommendations[0].playerB.sleeperId]?.fullName ?? pairRecommendations[0].playerB.sleeperId}
              </p>
              <p>{pairRecommendations[0].label}</p>
              <p>Score: {pairRecommendations[0].score.toFixed(2)}</p>
              <p className="pair-reason">{pairRecommendations[0].reason}</p>
            </>
          )}
        </article>
        <article className="card">
          <h2>Next User Turn</h2>
          <p>Next draft slot: {nextUserOverallPick}</p>
          <p>Picks until next user turn: {picksUntilNextUserTurn}</p>
        </article>
      </section>

      <section className="draft-board">
        <h2>Your Roster</h2>
        {userRoster.length === 0 ? (
          <p>No roster picks yet.</p>
        ) : (
          <ul>
            {userRoster.map((pick) => (
              <li key={`${pick.round}-${pick.pickNumber}`}>
                {pick.fullName} — round {pick.round}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="available-board">
        <h2>Available Players</h2>
        <p>{availablePlayers.length} players remaining</p>

        <table className="valuation-table">
          <caption>Top individual valuations</caption>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Score</th>
              <th>Roster fit</th>
            </tr>
          </thead>
          <tbody>
            {topIndividualRecommendations.map((valuation) => {
              const player = players[valuation.sleeperId]
              return (
                <tr key={valuation.sleeperId}>
                  <td>{player?.fullName ?? valuation.sleeperId}</td>
                  <td>{player?.position ?? 'N/A'}</td>
                  <td>{valuation.draftScore.toFixed(2)}</td>
                  <td>{valuation.rosterFitScore.toFixed(0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="pair-recommendations">
        <h2>Top Pair Recommendations</h2>
        {pairRecommendations.length === 0 ? (
          <p>Loading recommendations...</p>
        ) : (
          <ol>
            {pairRecommendations.map((pair, index) => {
              const playerA = players[pair.playerA.sleeperId]
              const playerB = players[pair.playerB.sleeperId]
              return (
                <li key={index}>
                  <div className="pair-heading">
                    <strong>{playerA?.fullName ?? pair.playerA.sleeperId}</strong>
                    <span>{playerA?.position ?? ''}</span>
                    <span>+</span>
                    <strong>{playerB?.fullName ?? pair.playerB.sleeperId}</strong>
                    <span>{playerB?.position ?? ''}</span>
                  </div>
                  <p className="pair-label">{pair.label}</p>
                  <p>Combined score: {pair.score.toFixed(2)}</p>
                  <p>{pair.reason}</p>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section className="mock-log">
        <h2>Mock Draft Log</h2>
        {mockLog.length === 0 ? <p>No mock run yet.</p> : (
          <ol>
            {mockLog.map((line, i) => <li key={i}>{line}</li>)}
          </ol>
        )}
      </section>
    </div>
  )
}

export default App
