# Fantasy Football Draft Assistant — Build Specification

## 1. Project Goal

Build a standalone local fantasy-football draft assistant for a Sleeper.com redraft league.

The application should function primarily as a **live draft dashboard**. It should automatically synchronize with Sleeper, maintain the current draft state, rank available players using league-specific valuation, and surface recommended picks without requiring the user to type a question every turn.

A conversational/chat layer is desirable later, but it is **secondary to the dashboard and recommendation engine**. The core product should remain useful even if no AI/chat integration is present.

The main optimization challenge is the user's draft position: **pick #1 in a 10-team snake draft**. After 1.01, nearly every user turn consists of two consecutive picks followed by an 18-pick wait. The assistant should therefore optimize **two-player turn combinations**, not merely recommend the best individual player.

---

## 2. Known Sleeper Identifiers

```text
League ID:       1389719771653615616
Draft ID:        1389719771653615617
Team roster ID:  3

Primary owner:
  Sleeper display name: lingav
  Sleeper user ID:      863800422035472384

Co-owner / user of this assistant:
  Sleeper display name: gpwarner
  Sleeper user ID:      865756813503668224

Mistaken duplicate account to ignore:
  Sleeper display name: gavinpwarner
  Sleeper user ID:      1390760125249118208
```

The assistant should treat **roster_id = 3** as the user's fantasy team. This avoids problems if either co-owner makes a Sleeper selection.

---

## 3. League Configuration

### General

```text
League: League 3 - Bretagne Fantasy Football League
Season: 2026
Teams: 10
Format: Redraft / fresh draft every season
Keepers: NONE in actual use
Draft type: Snake
Draft position: #1
Draft rounds: 16
Pick timer: 90 seconds
Scoring: Full PPR
Superflex: Yes
Best ball: No
Playoff teams: 6
Playoffs begin: Week 15
Trade deadline: Week 12
FAAB budget: 1000
Reserve/IR slots: 0
Bench slots: 5
```

Sleeper's league settings contain legacy/unused keeper-related values such as `max_keepers: 3` and `draft_rounds: 3`. These should **not** be interpreted as active keeper rules. This league is a fresh redraft and the active draft is 16 rounds.

### Current Roster Format

```text
1 QB
1 RB
1 WR
1 TE
4 FLEX
1 SUPER_FLEX
1 K
1 DEF
5 BN
```

Total roster size: **16 players**.

Total weekly starters: **11**.

Ignoring K and DEF, the practical weekly offensive structure is usually:

```text
2 QB
1 TE
6 RB/WR
```

The four FLEX spots mean RB and WR should be treated primarily as a **shared starting pool**, rather than using conventional RB1/RB2/WR1/WR2 roster logic.

---

## 4. Scoring Rules

### Passing

```text
Passing yards:         0.05 / yard   (1 point per 20 yards)
Passing TD:            4
Interception thrown:  -1
Passing 2PT:           2
```

### Rushing

```text
Rushing yards:         0.10 / yard
Rushing TD:            6
Rushing 2PT:           2
```

### Receiving

```text
Reception:             1.0
Receiving yards:       0.10 / yard
Receiving TD:          6
Receiving 2PT:         2
```

### Fumbles

```text
Fumble:               -1
Fumble lost:          -2
```

### Kicker

```text
FG 0-19:               3
FG 20-29:              3
FG 30-39:              3
FG 40-49:              4
FG 50+:                 5
Missed FG:            -1
Extra point:           1
Missed XP:             -1
```

### Defense / Special Teams

```text
Sack:                   1
Interception:           2
Fumble recovery:        2
Safety:                  2
Blocked kick:           2
Def/ST TD:               6

Points allowed:
0:                     15
1-6:                   12
7-13:                   9
14-20:                  6
21-27:                  3
28-34:                  0
35+:                     0
```

### Strategic Scoring Implications

- Full PPR increases the importance of target volume.
- 0.05 points per passing yard is more QB-friendly than the common 0.04 rate.
- Only -1 for interceptions is relatively forgiving.
- Superflex plus favorable passing scoring should push quarterbacks up significantly.
- Four FLEX spots create unusually deep weekly demand for RB/WR skill players.

---

## 5. Draft Slot and Pick Sequence

The user's team drafts from **slot #1**.

```text
Round  1:  1.01  / overall   1
Round  2:  2.10  / overall  20
Round  3:  3.01  / overall  21
Round  4:  4.10  / overall  40
Round  5:  5.01  / overall  41
Round  6:  6.10  / overall  60
Round  7:  7.01  / overall  61
Round  8:  8.10  / overall  80
Round  9:  9.01  / overall  81
Round 10: 10.10  / overall 100
Round 11: 11.01  / overall 101
Round 12: 12.10  / overall 120
Round 13: 13.01  / overall 121
Round 14: 14.10  / overall 140
Round 15: 15.01  / overall 141
Round 16: 16.10  / overall 160
```

After the first pick, the team receives back-to-back selections at nearly every turn, then waits **18 opponent selections** before picking again.

This is central to the recommendation model.

---

## 6. Primary User Experience

The app should be a local dashboard that is useful **without typing anything**.

When a Sleeper pick occurs, the app should automatically:

1. Detect the new pick.
2. Remove that player from the available pool.
3. Update the drafting team's roster.
4. Update positional demand for every team.
5. Update position-run information.
6. Recalculate player return probabilities.
7. Recalculate live draft scores.
8. Recalculate the user's best two-player turn combinations.
9. Refresh the dashboard.

The chat layer, if added, should be a secondary panel for questions such as:

- Why do you prefer Player A over Player B?
- What if we take QB/QB here?
- Show the best RB/WR combination.
- Which WR is safest?
- Who is most likely to survive until our next turn?
- Ignore TE for the next two rounds.
- I do not want Player X.

The chat layer should consume **calculated application state**. It should not invent its own independent rankings.

---

## 7. Suggested UI Layout

### A. Your Roster

Display prominently:

- Current players by position.
- Which offensive players currently project into the optimal weekly lineup.
- QB count and QB1/QB2/QB3 status.
- RB/WR top-six starter pool.
- TE status.
- Bench depth.
- Roster-health indicators.

Example health concepts:

```text
QB starters         Strong / Important / Critical
RB/WR starters      5 of 6 secured
TE                   Satisfied
QB insurance        Missing QB3
RB/WR depth         Thin
Bye resilience      Good
```

### B. Recommended Picks

Show:
- Best overall recommendation.
- 4-5 alternatives.
- Short reason for each.
- Custom rank.
- Position rank.
- Tier.
- Baseline value.
- Live Draft Score.
- Estimated chance to survive until the user's next turn.
- Recommendation confidence.

Useful recommendation categories:

```text
Recommended
Best Value
Most Urgent
Best Roster Fit
Highest Upside
Safest
```

### C. Best Turn Pair

At back-to-back picks, prominently show:

```text
Best two-player combination
Best alternative combination
QB-aggressive combination
Highest-value combination
Upside combination
```

Example:

```text
Recommended pair: QB A + WR B

Reason:
QB A is the final player in QB Tier 2.
WR B is the strongest remaining skill-position value.
Comparable RBs are more likely to remain available at the next turn.
```

### D. Available Player Table

Potential columns:

```text
Player
Position
NFL Team
Bye
Our Rank
Position Rank
ECR
Projection
Projected Fantasy Points
VORP
Tier
Baseline Value
Draft Score
Return Probability
Return Confidence
Preference Flag
```

Filters:

- Position.
- Tier.
- Available only.
- Target/Boost/Fade/DND.
- Search by name.

### E. Draft Board / Opponent Rosters

Show all 10 teams and their selections so the user can quickly see:

- QB counts.
- RB/WR construction.
- TE status.
- Which teams between the user's picks are likely to need a position.

### F. Turn Information

Show:

- Current overall pick.
- Current team on clock.
- Picks until user's next selection.
- User's next two picks.
- Recent position runs.
- Tier alerts.

Example:

```text
6 QBs taken in last 10 picks
QB Tier 3 has 1 player remaining
```

### G. Optional Chat Panel

Secondary to the dashboard.

---

## 8. Technical Architecture

Recommended initial stack:

```text
Frontend:      React + TypeScript + Vite
Backend:       Node.js + TypeScript
Local storage: SQLite or local JSON
Live source:   Sleeper public API
Rankings:      Free external ECR/ranking source
Projections:   Free source or CSV import
```

The app should be runnable locally and should not require Sleeper credentials.

### Design Principle

Separate source data from calculated data.

```text
Player Identity
    ↓
Source Rankings
    ↓
Source Projections
    ↓
Derived League Values
    ↓
Live Draft State
    ↓
User Preferences
```

Avoid one monolithic mutable player object where one data source overwrites another.

---

## 9. Sleeper Integration

Important endpoints:

```text
League:
https://api.sleeper.app/v1/league/1389719771653615616

Draft:
https://api.sleeper.app/v1/draft/1389719771653615617

Draft picks:
https://api.sleeper.app/v1/draft/1389719771653615617/picks

League rosters:
https://api.sleeper.app/v1/league/1389719771653615616/rosters

League users:
https://api.sleeper.app/v1/league/1389719771653615616/users

Sleeper NFL players:
https://api.sleeper.app/v1/players/nfl
```

### Polling

Polling the draft picks endpoint every few seconds should be sufficient.

Suggested initial cadence:

```text
3-5 seconds during active draft
slower or stopped when draft is inactive
```

### Sleeper Player Cache

The full Sleeper NFL player database should be cached locally rather than fetched constantly.

Use Sleeper IDs as the canonical runtime identity.

```ts
type PlayerId = string; // Sleeper player_id
```

### User Team Detection

Use:

```text
roster_id = 3
```

rather than relying only on the person who clicked the Sleeper draft button.

---

## 10. External Data Strategy — Free First

The user prefers **not to pay for data unless paid data is exceptionally better**.

The tool should therefore be source-adapter based so a free ranking source can later be swapped for a paid source without rewriting the recommendation engine.

### Ranking Candidates

Initial preferred concept:

- FantasyPros-style Expert Consensus Rankings via a free/open downstream dataset such as DynastyProcess/nflverse ecosystem data.
- Potential Sleeper search rank only as secondary market information if useful.
- Manual CSV import as fallback.

### Projection Candidates

Prefer projected **stat lines**, not just projected fantasy-point totals.

Potential sources:

- Free projection export/import.
- User-provided CSV.
- Other open data sources.

The projection layer should be replaceable.

### Why Raw Stat Projections Are Preferred

The application should calculate fantasy points using the league's scoring itself.

Do not trust an external `projectedFantasyPoints` value unless the source scoring is known to match the league.

---

## 11. Player Data Model

### Identity

```ts
interface PlayerIdentity {
  sleeperId: string;

  firstName: string;
  lastName: string;
  fullName: string;

  position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
  nflTeam: string | null;

  active: boolean;
  byeWeek?: number;
  injuryStatus?: string | null;
  depthChartOrder?: number | null;

  externalIds: {
    espn?: string;
    fantasyData?: string;
    sportradar?: string;
    yahoo?: string;
    gsis?: string;
    fantasyPros?: string;
  };
}
```

### Ranking Record

```ts
interface RankingRecord {
  sleeperId: string;
  source: string;

  overallRank: number;
  positionRank?: number;
  tier?: number;

  rankBest?: number;
  rankWorst?: number;
  rankStdDev?: number;

  format?: "ppr" | "superflex" | "overall";
  updatedAt: string;
}
```

### Projection Record

```ts
interface ProjectionRecord {
  sleeperId: string;
  source: string;

  passYds?: number;
  passTd?: number;
  interceptions?: number;

  rushYds?: number;
  rushTd?: number;

  receptions?: number;
  recYds?: number;
  recTd?: number;

  fumbles?: number;
  games?: number;

  updatedAt: string;
}
```

### Derived Valuation

```ts
interface PlayerValuation {
  sleeperId: string;

  projectedPoints: number;

  baselineValue: number;
  vorp: number;
  customRank: number;
  tier: number;

  tierScarcityScore: number;
  rosterFitScore: number;
  opponentDemandScore: number;

  returnProbability: number;
  returnConfidence: "low" | "medium" | "high";

  urgencyScore: number;
  draftScore: number;
}
```

### User Preference

```ts
interface PlayerPreference {
  sleeperId: string;
  preference: "target" | "boost" | "neutral" | "fade" | "dnd";
  adjustment: number;
  note?: string;
}
```

### Drafted Player State

```ts
interface DraftedPlayer {
  sleeperId: string;
  pickNumber: number;
  round: number;
  draftSlot: number;
  rosterId: number;
  pickedBy?: string;
}
```

Draft availability should be determined from draft state rather than mutating the canonical identity record.

---

## 12. Player-ID Reconciliation

Recommended matching priority:

```text
1. Explicit Sleeper ID match
2. External provider ID match
3. Stable NFL/ESPN/GSIS/etc. ID match
4. Name + team + position
5. Name + position
6. Manual override
```

Do not silently accept low-confidence fuzzy matches.

Maintain a manual override table/file, for example:

```ts
interface PlayerIdOverride {
  source: string;
  sourcePlayerId: string;
  sleeperId: string;
}
```

Potential problem cases:

- Rookies.
- Players with suffixes such as Jr./III.
- Recent team changes.
- Duplicate names.
- Name changes.

### Defense Handling

Treat team defenses as pseudo-players.

Example:

```text
{
  sleeperId: "PHI",
  fullName: "Philadelphia Eagles",
  position: "DEF",
  nflTeam: "PHI"
}
```

---

## 13. Data Provenance

Every imported external record should retain metadata such as:

```text
{
  source: "dynastyprocess",
  sourceUpdatedAt: "...",
  importedAt: "...",
  season: 2026
}
```

The UI should be able to show data freshness and warn if rankings/projections are stale.

Example:

```text
FantasyPros ECR — updated Aug. 10
Projection data — 9 days old; refresh recommended
```

---

## 14. Custom Fantasy-Point Calculation

The app should calculate fantasy points from raw projections using the league scoring.

Example offensive formula:

```ts
projectedFantasyPoints =
    passYds * 0.05
  + passTd * 4
  - interceptions
  + rushYds * 0.10
  + rushTd * 6
  + receptions * 1.0
  + recYds * 0.10
  + recTd * 6;
```

Add applicable 2-point conversion/fumble fields if supplied by the projection source.

---

## 15. Baseline Player Valuation

The baseline value should answer:

> Ignoring the current live draft board, how valuable is this player in this league?

It should remain relatively stable during the draft.

### Normalize Inputs

Avoid directly averaging raw ranks.

Normalize major components to a common 0-100 scale:

```text
VORP Score
ECR Score
Projection Score
```

### Initial Baseline Formula

Starting proposal:

```text
Baseline Player Value =
    45% league-adjusted VORP
  + 35% ECR
  + 20% projection quality
```

These are initial tuning values, not immutable rules.

All weights should be configuration-driven.

### Graceful Degradation

If projections are unavailable:

```text
Use ECR-heavy mode and clearly show that projection data is unavailable.
```

If ECR is unavailable:

```text
Use projection/VORP mode.
```

The application should not fail because one external data source is unavailable.

---

## 16. VORP / Replacement Value

Raw projected points should not be compared directly across positions.

```text
VORP = projected fantasy points - replacement-level fantasy points
```

### League-Specific Demand

Approximate starting demand:

```text
QB/SF: ~20 weekly QB slots
RB/WR: 60 combined weekly starting slots
TE:    10 required, plus occasional FLEX use
```

### Initial Replacement Calibration

Version 1 may use configurable defaults such as:

```text
QB replacement: approximately QB22-24
RB replacement: approximately RB35-40
WR replacement: approximately WR45-50
TE replacement: approximately TE12-14
```

These are calibration values only and should be tunable after mock drafts.

### Better FLEX-Aware Replacement Model

Eventually:

1. Reserve mandatory top 10 RB.
2. Reserve mandatory top 10 WR.
3. Reserve mandatory top 10 TE.
4. Put remaining RB/WR/TE into one FLEX pool.
5. Consume the next 40 highest-valued FLEX players.
6. Account for estimated bench demand.
7. Infer the marginal replacement player at each position.

---

## 17. Tiering

Maintain both:

```text
Overall custom rank
Position rank
Position-specific tier
```

Do not treat overall rank and position tier as the same concept.

### Tier Detection

Create position tiers from meaningful gaps in baseline value.

Simple MVP concept:

```text
gap = previous.baselineValue - current.baselineValue;
if (gap >= configuredThresholdForPosition) {
  startNewTier();
}
```

Later improvement:

```text
Tier Break Strength = adjacent gap / typical adjacent gap at that position
```

### Drop After Player

For each player calculate the value drop to the next tier.

```text
dropAfterPlayer = player baseline value - best player in next tier
```

This becomes an important urgency/scarcity signal.

---

## 18. Tier Scarcity

Scarcity should consider both:

```text
Size of drop to next tier
AND
How depleted the current tier is
```

Conceptually:

```text
Tier Scarcity Score = normalized tier drop × tier depletion factor
```

Do not automatically panic because only one player remains if the next tier is almost identical.

---

## 19. Return Probability

For every available player estimate:

```text
P(return) = probability player is still available at the user's next turn
```

This is particularly important because the user waits 18 picks between turns.

### MVP Inputs

```text
1. Market rank / ADP
2. Number of picks until next user turn
3. Positional demand among intervening teams
4. Live draft position pressure / runs
```

### MVP Risk Model

Starting conceptual weighting:

```text
Return Risk =
    55% ADP proximity
  + 25% opponent positional demand
  + 20% live position pressure
```

Map the result to both a rough percentage and a descriptive category:

```text
Very likely to return
Likely
Coin flip
Unlikely
Very unlikely
```

Do not imply false precision.

### Important Distinction

Low return probability does **not** automatically mean a player should be drafted now.

Urgency should also require player value and meaningful tier drop.

Conceptually:

```text
Urgency = player value × risk of not returning × tier-drop severity
```
```

---

## 20. Live Positional Pressure

Track actual positional selections versus expected positional selections.

Example:

```text
Expected QBs through pick 30: 10
Actual QBs through pick 30:   15
QB Draft Pressure:            1.50
```

If a position is being drafted faster than expected, reduce return probabilities for that position.

Do not chase positional runs blindly. Runs matter primarily when they threaten a meaningful tier.

---

## 21. Opponent Demand — MVP Concept

Full personalized opponent modeling can wait.

For MVP, calculate generic positional need for every intervening team based on current roster construction.

Example QB need concept:

```text
0 QBs drafted: very high QB demand
1 QB drafted:  high QB demand
2 QBs drafted: low/moderate
3 QBs drafted: very low
```

RB/WR demand should be softer because of four FLEX positions.

Represent need numerically, for example:

```text
Need(team, position) = 0.0 to 1.0
```

Then opponent draft threat can conceptually use:

```text
P(team selects player) = player attractiveness at that pick × positional need
```

More sophisticated owner-specific tendency modeling is a later enhancement.

---

## 22. Roster-Fit Model

Roster fit should be **soft guidance early** and become increasingly important later.

Do not implement rigid logic such as:

```text
"Already have two WRs, therefore draft RB."
```

### Practical Offensive Structure

Optimize around:

```text
2 QB
1 TE
6 best RB/WR weekly starters
```

### RB/WR Shared Pool

For RB/WR candidates:

1. Hypothetically add candidate.
2. Sort the team's RB/WR pool by projected/derived value.
3. Determine whether candidate enters the top six.
4. Measure improvement to the sixth starter and overall top-six quality.

This is more important than raw RB/WR counts.

### QB Logic

```text
QB1: essential
QB2: essential
QB3: useful insurance / bye / scarcity protection
QB4: luxury and usually undesirable
```

The user generally prefers leaving the draft with three QBs unless market value makes that unreasonable.

### TE Logic

```text
Elite TE1:          TE2 need low
Mid-tier TE1:       TE2 need moderate
Late speculative TE1: TE2 need higher
```

Do not force two TEs.

### Finished Roster Examples

Potential healthy distributions among 14 offensive players:

```text
3 QB / 4 RB / 5 WR / 2 TE
3 QB / 4 RB / 6 WR / 1 TE
3 QB / 5 RB / 5 WR / 1 TE
2 QB / 4 RB / 6 WR / 2 TE
```

These are examples, not quotas.

### Roster Fit Components

Conceptually:

```text
Roster Fit =
    Starting Lineup Utility
  + Depth Utility
  + Positional Insurance
  - Concentration Penalty
```

### Draft Stage Behavior

#### Rounds 1-5 — Value Accumulation

- Baseline talent/value dominates.
- Roster fit relatively light except QB structural needs.

#### Rounds 6-10 — Lineup Construction

- Ensure two usable QBs.
- Build six competitive RB/WR starters.
- Address TE.
- Roster fit becomes more meaningful.

#### Rounds 11-14 — Depth / Insurance

- QB3.
- RB/WR upside and injury insurance.
- TE2 if needed.
- Bye resilience.

#### Rounds 15-16

- Usually K and DEF unless manually overridden or lineup construction remains incomplete.

### Need Labels

Useful UI labels:

```text
CRITICAL
IMPORTANT
USEFUL
SATISFIED
LUXURY
```

### Bye Weeks

Bye conflicts should be a tiebreaker, not a primary draft strategy.

QB bye conflicts may increase QB3 value modestly.

### Bench Utility

With only five bench spots, penalize low-ceiling players with little path to entering the lineup.

Late picks should ideally offer at least one of:

```text
High upside
Injury insurance
QB scarcity protection
Immediate FLEX usability
TE contingency
```

---

## 23. Hard / Near-Hard Safeguards

Most logic should be soft scoring, but include guardrails:

- Do not finish with fewer than 2 QBs.
- Strongly discourage QB4 unless exceptional value or manual override.
- Do not draft a second K.
- Do not draft a second DEF.
- Strongly discourage K/DEF before late rounds.
- Ensure at least one TE before draft end.
- Ensure enough viable RB/WR players to fill the six weekly RB/WR starting slots.
- Never recommend a roster that cannot legally fill the starting lineup.
- Manual override should always be possible.

---

## 24. User Preference Controls

Clicking a player should support:

```text
Target
Boost
Neutral
Fade
Do Not Draft
```

Initial conceptual modifiers:

```text
Target: +8
Boost:  +4
Neutral: 0
Fade:   -6
DND:    remove from recommendations
```

These values are tunable.

Preferences should modify recommendations without overwriting source rankings.

Persist preferences locally across app restarts.

---

## 25. Live Draft Score

Maintain a distinction between:

```text
Custom Rank / Baseline Value = stable pre-draft evaluation
Live Draft Score = best selection right now
```

A lower-ranked player may have a higher live Draft Score because of scarcity, urgency, opponent demand, or roster structure.

### Candidate Live Components

```text
Baseline Value
Tier Scarcity
Urgency / Return Risk
Roster Fit
Opponent Demand
User Preference
```

### Draft-Stage Weights — Initial Proposal

#### Early Draft

```text
Baseline:        60%
Scarcity:        15%
Urgency:         15%
Roster Fit:       5%
Opponent Demand:  5%
```

#### Middle Draft

```text
Baseline:        45%
Scarcity:        15%
Urgency:         15%
Roster Fit:      15%
Opponent Demand: 10%
```

#### Late Draft

```text
Baseline:        35%
Scarcity:        10%
Urgency:         10%
Roster Fit:      35%
Opponent Demand: 10%
```

These are starting values only.

Store all scoring weights in configuration rather than hardcoding them throughout the code.

---

## 26. Special Handling for Pick 1.01

The first pick has no meaningful immediate return-probability problem.

Recommendation at 1.01 should be mostly driven by baseline league-specific player value and strategic positional value.

Do not overcomplicate 1.01 merely because the rest of the model is dynamic.

---

## 27. Pair Optimization

This is a core feature because of the user's draft slot.

The goal is **not**:

```text
Take the two highest individual Draft Scores.
```

The goal is:

```text
Choose the two-player combination that leaves the roster in the strongest state after the current turn and before the next one.
```

### Candidate Pool

At each turn:

1. Select approximately the top 12-20 available players by live score/value.
2. Generate every unique two-player combination.
3. Evaluate each pair after adding both players to a hypothetical copy of the roster.

15 candidates create only 105 pair combinations, which is trivial computationally.

### Sequential Roster Recalculation

The second player in a pair should be scored after the first player has hypothetically been added.

Example:

```text
Current roster: QB1
Pair: QB A + QB B

QB A becomes QB2 and receives major roster value.
QB B then becomes QB3 and receives much less roster urgency.
```

Do not simply add the two original individual scores.

### Pair Score Components

Initial concept:

```text
Pair Score =
    Combined Player Value
  + Post-Pair Roster Improvement
  + Tier Capture
  + Future Board Quality
  + Small Preference/Complementarity Effect
  - Concentration Penalties
```

### Initial Pair Weights

```text
45% Combined Baseline Value
20% Post-Pair Roster Health
15% Tier Capture
15% Future Board Quality
 5% Preference / Complementarity
```

Tunable.

### No Return-Risk Penalty Between Back-to-Back Picks

At pick 20, pick 21 happens immediately.

Therefore, while choosing the pair:

```text
P(player survives from pick 20 to pick 21) ≈ 100%
```

The pair optimizer should treat the two picks as effectively simultaneous for opponent-risk purposes.

After pick 21, normal 18-pick return risk resumes for pick 40.

### Tier Capture

Pairs should receive credit for securing meaningful tiers before the 18-pick gap.

Example:

```text
Only 1 QB remains in Tier 2.
4 WRs remain in Tier 2.
```

A QB + WR pair may score better than WR + RB even if the latter has slightly better raw baseline value.

### Future Board Quality

After a hypothetical pair:

1. Remove both players from the available pool.
2. Recalculate return estimates for remaining candidates.
3. Estimate likely best targets at the next turn.
4. Produce a Future Board Score.

MVP can use expected survivors rather than full simulation.

### Rolling Horizon

Optimize:

```text
Current pair + likely next-turn state
```

Do **not** attempt to optimize the entire remaining draft at once.

Recalculate after every actual pick.

### Pair Categories in UI

Display multiple useful pair options:

```text
Recommended Pair
Highest-Value Pair
Scarcity Pair
QB-Aggressive Pair
Upside Pair
Safe Pair
```

### Pair Explanations

Keep clock-time explanations concise.

Example:

```text
QB A + WR B

QB A is the last player in QB Tier 2.
WR B is the best remaining skill-position value.
Comparable RBs have a better chance to remain available at the next turn.
```

---

## 28. Future Enhancement — Monte Carlo Draft Simulation

Not required for initial MVP.

Later, pair optimization and return probability can use simulations.

Possible process:

```text
For each candidate pair:
1. Hypothetically draft the pair.
2. Simulate intervening opponent picks until the next user turn.
3. Repeat 500-1000+ times.
4. Record each player's survival frequency.
5. Evaluate the expected quality of the user's next-turn options.
6. Average results into Future Board Quality.
```

This would improve both:

- Player return probability.
- Pair optimization.

Do not block MVP development on this.

---

## 29. Recommendation Confidence

The app should communicate uncertainty.

Examples:

```text
Take Player A — High confidence
Player A / Player B essentially tied — Low confidence
```

Confidence can consider:

- Gap between top recommendation scores.
- Agreement/disagreement among ranking sources.
- ECR standard deviation.
- Projection stability.
- Data freshness.
- How abnormal the live room is relative to market expectations.

Avoid false precision.

---

## 30. Useful Decision Flags

The dashboard should explicitly identify:

### DO NOT WAIT

```text
Player unlikely to survive and represents meaningful value/tier scarcity.
```

### SAFE TO WAIT

```text
Player has a reasonable chance to survive and comparable players remain.
```

### TIER ALERT

```text
Current position tier is nearly exhausted and next tier represents a meaningful drop.
```

### POSITION RUN

```text
A position is being drafted significantly faster than expected.
```

---

## 31. Debug / Developer Mode

This is important for tuning during mock drafts.

Clicking a player should optionally expose a score breakdown such as:

```text
PLAYER SCORE BREAKDOWN

Baseline               92.4
  VORP                  95.1
  ECR                   91.7
  Projection            87.2

Tier scarcity           96.0
Return urgency          93.4
Opponent demand         88.1
Roster fit              82.0
Preference adjustment   +4

FINAL DRAFT SCORE        93.8
```

This makes it possible to understand and tune bad recommendations.

All important model constants and weights should live in configuration.

---

## 32. Persistence / Reliability

Persist locally:

- User preference flags.
- Manual ID mappings.
- Cached Sleeper player data.
- Imported ranking data.
- Imported projection data.
- Configuration/tuning values.

The app should reconstruct the live draft state from Sleeper picks after restart.

A restart during the draft should not lose the user's configuration or require manual draft reconstruction.

### Manual Recovery

Provide a way to:

- Force refresh Sleeper state.
- Manually mark/unmark a player as drafted if synchronization ever fails.
- Reload external rankings/projections.
- Reset user preference flags selectively.

---

## 33. MVP-Critical Features

Version 1 should include:

- Sleeper league/draft connection.
- Automatic polling of draft picks.
- Available player pool.
- User roster display.
- Opponent roster display.
- External rankings import.
- Projection import if practical.
- League-specific fantasy-point calculation.
- VORP/baseline values.
- Position-specific tiers.
- Top individual recommendations.
- Picks-until-next-turn calculation.
- Approximate return probability.
- Basic opponent position demand.
- Position-run detection.
- Roster-fit scoring.
- User Target/Boost/Fade/DND preferences.
- Pair optimization at turn picks.
- Concise recommendation explanations.
- Debug score breakdown.
- Local persistence.

---

## 34. Explicitly Defer Until Later

Do not block the first usable build on:

- Natural-language chat.
- LLM integration.
- AI-generated explanations.
- Owner-specific historical tendency models.
- Injury/news feeds.
- Automatic scraping of proprietary ranking sites.
- Fully automated external ranking refresh.
- Machine learning.
- Complex full-draft optimization.
- Monte Carlo simulation.
- Historical-league behavioral modeling.

Build a transparent deterministic engine first.

---

## 35. Recommended Development Sequence

### Phase 1 — Sleeper State

- Create project shell.
- Load known league/draft IDs.
- Read Sleeper league, rosters, users, players, and draft picks.
- Identify roster ID 3 as user's team.
- Display current board and available players.
- Poll live picks.

### Phase 2 — Data Normalization

- Add external ranking adapter/import.
- Build player-ID matching.
- Add manual ID override support.
- Add projection import if available.
- Add data freshness/provenance.

### Phase 3 — League Valuation

- Calculate custom fantasy points.
- Calculate initial replacement levels/VORP.
- Normalize ECR/projection/VORP scores.
- Produce stable custom ranks.
- Generate position tiers.

### Phase 4 — Live Recommendation Engine

- Add tier scarcity.
- Add picks-until-next-turn.
- Add return estimates.
- Add live position pressure.
- Add basic opponent positional demand.
- Add roster-fit scoring.
- Produce live Draft Score.

### Phase 5 — Pair Optimization

- Generate candidate pairs.
- Recalculate hypothetical roster after each player.
- Add tier-capture score.
- Add future-board quality.
- Display recommended pair and alternatives.

### Phase 6 — Tuning / Mock Drafts

- Run mock drafts.
- Use debug breakdown to identify bad recommendations.
- Adjust configuration weights.
- Test QB aggressiveness.
- Test four-FLEX roster behavior.
- Test late-round K/DEF handling.
- Validate restart/recovery behavior.

### Phase 7 — Optional Chat / AI

Only after the deterministic system is trustworthy.

---

## 36. Core Design Principles

1. **Dashboard first, chat second.**
2. **Sleeper owns live draft identity/state.**
3. **External rankings/projections are replaceable adapters.**
4. **Source data and derived data stay separate.**
5. **Use league-specific scoring rather than generic fantasy points.**
6. **Treat RB/WR primarily as one shared six-player starting pool.**
7. **Superflex QB scarcity must be modeled explicitly.**
8. **Stable custom rank and live Draft Score are different things.**
9. **Tier drops matter more than arbitrary rank-number gaps.**
10. **Return probability matters heavily because of the 18-pick gaps.**
11. **The user's turn should be optimized as a two-player combination.**
12. **Do not let temporary urgency turn a bad player into a good pick.**
13. **Expose the math so bad recommendations can be debugged.**
14. **All major weights/thresholds should be configurable.**
15. **Gracefully degrade if an external data source is missing.**
16. **Manual override is always allowed.**
17. **Build a useful deterministic MVP before adding AI complexity.**

---

## 37. Initial Success Criteria

The first version is successful if, during a mock Sleeper draft, it can reliably:

1. Detect every pick without manual entry.
2. Maintain the correct available-player pool.
3. Maintain the correct user and opponent rosters.
4. Show a sensible league-adjusted player board.
5. Identify meaningful QB and other positional tier pressure.
6. Estimate whether candidates are likely to survive the 18-pick gap.
7. Avoid conventional roster-balance mistakes caused by the league's four FLEX spots.
8. Recommend a sensible two-player pair at each turn.
9. Explain the recommendation in a few readable sentences.
10. Expose enough score detail to tune any recommendation that looks wrong.
