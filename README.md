# World Cup Budget Picks

A lightweight static leaderboard for a 12-person fantasy football draft-order contest using the 2026 FIFA World Cup.

Participants submit exactly 5 national teams with a total contest cost of $100 or less. Teams score points for group results, goals scored, and cumulative tournament advancement bonuses.

## File Structure

```txt
world-cup-budget-picks/
|-- index.html
|-- style.css
|-- data-loader.js
|-- scoring.js
|-- leaderboard.js
|-- data/
|   |-- participants.json
|   |-- teams.json
|   |-- team-results.json
|   `-- scoring-config.json
`-- .github/
    `-- workflows/
        `-- deploy.yml
```

## Run Locally

JSON files must be loaded through a local web server.

```bash
cd world-cup-budget-picks
python -m http.server 8000
```

Open:

```txt
http://localhost:8000
```

## Update Participants

Edit `data/participants.json`.

Each participant has a `picks` array. Leave it empty until the lineup is submitted.

```json
{
  "id": "cory-pahl",
  "teamName": "Team Pahl",
  "owners": ["Cory Pahl"],
  "previousRank": 9,
  "picks": ["BRA", "NED", "MAR", "JPN", "SUI"]
}
```

Lineups are validated for:

- exactly 5 picks
- total cost of $100 or less
- team IDs that exist in `data/teams.json`
- no duplicate teams inside the same lineup

## Update Team Results

Edit `data/team-results.json`.

This is the main manual update file during the tournament.

```json
{
  "teamId": "BRA",
  "groupWins": 1,
  "groupDraws": 0,
  "goalsFor": 3,
  "reachedRoundOf32": true,
  "reachedRoundOf16": false,
  "reachedQuarterfinal": false,
  "reachedSemifinal": false,
  "reachedFinal": false,
  "wonWorldCup": false,
  "eliminated": false,
  "notes": ""
}
```

Update the top-level `lastUpdated` field whenever results are changed.

## Scoring

Scoring values live in `data/scoring-config.json`.

| Event | Points |
| --- | ---: |
| Group stage win | +3 |
| Group stage draw | +1 |
| Every goal scored | +1 |
| Reaches Round of 32 | +5 |
| Reaches Round of 16 | +8 |
| Reaches Quarterfinal | +12 |
| Reaches Semifinal | +18 |
| Reaches Final | +25 |
| Wins World Cup | +40 |

Advancement bonuses are cumulative. A semifinalist receives the Round of 32, Round of 16, Quarterfinal, and Semifinal bonuses.

## Leaderboard Sorting

The leaderboard sorts by:

1. Total points, descending
2. Highest goals scored by a single team on the roster, descending
3. Original participant order if still tied

Rows with equal total points and equal tiebreaker display the same rank.

## Deploy to GitHub Pages

This folder includes a GitHub Pages workflow template at `.github/workflows/deploy.yml`.

For a standalone repository:

1. Put these files at the repository root.
2. Push to `main` or `master`.
3. In GitHub, go to `Settings` -> `Pages`.
4. Set the source to `GitHub Actions`.
5. Run the deploy workflow or push a change.

The site has no backend, build step, database, login, or paid API dependency.
