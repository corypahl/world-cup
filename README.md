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
|-- scripts/
|   `-- update-results.mjs
|-- data/
|   |-- participants.json
|   |-- teams.json
|   |-- team-results.json
|   |-- matches.json
|   |-- daily-summary.json
|   |-- standings-history.json
|   `-- scoring-config.json
`-- .github/
    `-- workflows/
        |-- daily-summary.yml
        |-- deploy.yml
        `-- update-results.yml
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

## Automatic World Cup Data

The scheduled updater lives in `scripts/update-results.mjs` and writes:

- `data/team-results.json` for scoring totals
- `data/matches.json` for today's games, previous results, and upcoming schedules

The GitHub Action at `.github/workflows/update-results.yml` runs:

- every 15 minutes from 12:00 PM ET through 1:00 AM ET during the tournament
- manually through `workflow_dispatch`

It fetches FIFA World Cup match data from ESPN's public soccer scoreboard endpoint and commits the generated data files after each successful fetch so the visible `lastUpdated` timestamp reflects the latest check. The same workflow deploys the updated static site to Pages. No API token is required.

## Daily AI Summary

The workflow at `.github/workflows/daily-summary.yml` runs at 9:00 AM ET and can also be started manually. It:

1. Calculates the current contest leaderboard from the checked-in data.
2. Selects completed matches from the previous Eastern Time calendar day.
3. Compares the current leaderboard against `data/standings-history.json`.
4. Calculates point gains, rank movement, remaining-team changes, and which picks produced points.
5. Sends those grounded facts to `gemini-2.5-flash-lite`.
6. Writes `data/daily-summary.json` and saves the current standings snapshot.
7. Commits the generated files and deploys GitHub Pages.

Create a free Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey), then add it to the repository:

1. Open `Settings` -> `Secrets and variables` -> `Actions`.
2. Select `New repository secret`.
3. Name it `GEMINI_API_KEY`.
4. Paste the key and save it.

The API key is only available to the GitHub Action and is never sent to the browser. Restrict the key to the Gemini API in Google AI Studio.

The first stored standings snapshot is a baseline. Movement commentary begins once a later daily run can compare against that snapshot. Re-running the workflow on the same date preserves the original snapshot for that date.

## Manual Team Results

Edit `data/team-results.json`.

This is the main manual update file during the tournament.

```json
{
  "teamId": "BRA",
  "groupWins": 1,
  "groupLosses": 0,
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

1. Current points, descending
2. Tiebreaker, descending
3. Original participant order if still tied

Rows with equal current points and tiebreaker display the same rank. The Remaining column is informational and shows how many of the participant's five teams have not been eliminated.

## Deploy to GitHub Pages

This folder includes a GitHub Pages workflow template at `.github/workflows/deploy.yml`.

For a standalone repository:

1. Put these files at the repository root.
2. Push to `main` or `master`.
3. In GitHub, go to `Settings` -> `Pages`.
4. Set the source to `GitHub Actions`.
5. Run the deploy workflow or push a change.

The site has no backend, build step, database, or login. Automated score updates depend on the scheduled ESPN workflow. The daily AI recap additionally requires the `GEMINI_API_KEY` repository secret.
