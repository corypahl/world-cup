import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const easternTimeZone = "America/New_York";
const outputPath = resolve(process.argv[2] || ".tmp/daily-summary-input.json");

const participantsPath = new URL("../data/participants.json", import.meta.url);
const teamsPath = new URL("../data/teams.json", import.meta.url);
const resultsPath = new URL("../data/team-results.json", import.meta.url);
const matchesPath = new URL("../data/matches.json", import.meta.url);
const scoringPath = new URL("../data/scoring-config.json", import.meta.url);

const advancementKeys = [
    ["reachedRoundOf32", "roundOf32"],
    ["reachedRoundOf16", "roundOf16"],
    ["reachedQuarterfinal", "quarterfinal"],
    ["reachedSemifinal", "semifinal"],
    ["reachedFinal", "final"],
    ["wonWorldCup", "worldCupWinner"]
];

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getEasternDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: easternTimeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date).reduce((all, part) => {
        all[part.type] = part.value;
        return all;
    }, {});

    return `${parts.year}-${parts.month}-${parts.day}`;
}

function calculateTeamScore(result, config) {
    let total = 0;
    total += toNumber(result.groupWins) * toNumber(config.groupWin);
    total += toNumber(result.groupDraws) * toNumber(config.groupDraw);
    total += toNumber(result.goalsFor) * toNumber(config.goal);

    advancementKeys.forEach(([resultKey, configKey]) => {
        if (result[resultKey]) {
            total += toNumber(config[configKey]);
        }
    });

    return total;
}

function calculateLeaderboard(participants, teams, results, config) {
    const teamMap = new Map(teams.map((team) => [team.id, team]));
    const resultMap = new Map(results.map((result) => [result.teamId, result]));

    const entries = participants.map((participant, originalIndex) => {
        const picks = (participant.picks || []).map((teamId) => {
            const team = teamMap.get(teamId);
            const result = resultMap.get(teamId) || {};

            return {
                teamId,
                teamName: team?.name || teamId,
                points: calculateTeamScore(result, config),
                goals: toNumber(result.goalsFor),
                eliminated: Boolean(result.eliminated)
            };
        });

        return {
            originalIndex,
            teamName: participant.teamName,
            owners: participant.owners || [],
            score: picks.reduce((total, pick) => total + pick.points, 0),
            tiebreaker: picks.reduce((highest, pick) => Math.max(highest, pick.goals), 0),
            remainingTeams: picks.filter((pick) => !pick.eliminated).length,
            picks
        };
    }).sort((a, b) => (
        b.score - a.score
        || b.tiebreaker - a.tiebreaker
        || a.originalIndex - b.originalIndex
    ));

    let rank = 0;
    let previousScore = null;
    let previousTiebreaker = null;

    return entries.map((entry, index) => {
        if (entry.score !== previousScore || entry.tiebreaker !== previousTiebreaker) {
            rank = index + 1;
            previousScore = entry.score;
            previousTiebreaker = entry.tiebreaker;
        }

        return {
            rank,
            teamName: entry.teamName,
            owners: entry.owners,
            score: entry.score,
            tiebreaker: entry.tiebreaker,
            remainingTeams: entry.remainingTeams,
            picks: entry.picks
        };
    });
}

async function main() {
    const [participants, teams, resultsFile, matchesFile, scoringConfig] = await Promise.all([
        readFile(participantsPath, "utf8").then(JSON.parse),
        readFile(teamsPath, "utf8").then(JSON.parse),
        readFile(resultsPath, "utf8").then(JSON.parse),
        readFile(matchesPath, "utf8").then(JSON.parse),
        readFile(scoringPath, "utf8").then(JSON.parse)
    ]);

    const now = process.env.SUMMARY_NOW ? new Date(process.env.SUMMARY_NOW) : new Date();
    const summaryDate = getEasternDateKey(now);
    const recapDate = getEasternDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const leaderboard = calculateLeaderboard(
        participants,
        teams,
        resultsFile.results || [],
        scoringConfig
    );
    const pickedBy = new Map();

    leaderboard.forEach((entry) => {
        entry.picks.forEach((pick) => {
            const owners = pickedBy.get(pick.teamId) || [];
            owners.push(entry.teamName);
            pickedBy.set(pick.teamId, owners);
        });
    });

    const previousDayMatches = (matchesFile.matches || [])
        .filter((match) => match.completed && getEasternDateKey(match.date) === recapDate)
        .map((match) => ({
            stage: match.stageLabel,
            teamOne: match.awayTeamName,
            teamOneScore: toNumber(match.awayScore),
            teamTwo: match.homeTeamName,
            teamTwoScore: toNumber(match.homeScore),
            pickedByTeamOne: pickedBy.get(match.awayTeamId) || [],
            pickedByTeamTwo: pickedBy.get(match.homeTeamId) || []
        }));

    const output = {
        summaryDate,
        recapDate,
        dataLastUpdated: resultsFile.lastUpdated || "",
        scoringRules: scoringConfig,
        previousDayMatches,
        leaderboard
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Wrote daily summary input to ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
