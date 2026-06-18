import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const easternTimeZone = "America/New_York";
const outputPath = resolve(process.argv[2] || ".tmp/daily-summary-input.json");

const participantsPath = new URL("../data/participants.json", import.meta.url);
const teamsPath = new URL("../data/teams.json", import.meta.url);
const resultsPath = new URL("../data/team-results.json", import.meta.url);
const matchesPath = new URL("../data/matches.json", import.meta.url);
const scoringPath = new URL("../data/scoring-config.json", import.meta.url);
const historyPath = process.env.STANDINGS_HISTORY_PATH
    ? resolve(process.env.STANDINGS_HISTORY_PATH)
    : new URL("../data/standings-history.json", import.meta.url);

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
            participantId: participant.id,
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
            participantId: entry.participantId,
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

function buildStandingsChanges(leaderboard, history, summaryDate) {
    const previousSnapshot = [...(history.snapshots || [])]
        .filter((snapshot) => snapshot.date < summaryDate)
        .sort((a, b) => b.date.localeCompare(a.date))[0];

    if (!previousSnapshot) {
        return {
            previousStandingsDate: "",
            standingsChanges: [],
            leaderChange: null
        };
    }

    const previousById = new Map(previousSnapshot.standings.map((entry) => [entry.participantId, entry]));
    const standingsChanges = leaderboard.map((entry) => {
        const previous = previousById.get(entry.participantId);

        if (!previous) {
            return {
                participantId: entry.participantId,
                teamName: entry.teamName,
                previousRank: null,
                currentRank: entry.rank,
                rankChange: 0,
                previousScore: null,
                currentScore: entry.score,
                pointsGained: 0,
                previousRemainingTeams: null,
                currentRemainingTeams: entry.remainingTeams,
                scoringPicks: []
            };
        }

        const previousPicks = new Map((previous.picks || []).map((pick) => [pick.teamId, pick]));
        const scoringPicks = entry.picks.map((pick) => {
            const priorPoints = toNumber(previousPicks.get(pick.teamId)?.points);
            const pointsGained = pick.points - priorPoints;

            return {
                teamId: pick.teamId,
                teamName: pick.teamName,
                pointsGained
            };
        }).filter((pick) => pick.pointsGained > 0)
            .sort((a, b) => b.pointsGained - a.pointsGained || a.teamName.localeCompare(b.teamName));

        return {
            participantId: entry.participantId,
            teamName: entry.teamName,
            previousRank: previous.rank,
            currentRank: entry.rank,
            rankChange: previous.rank - entry.rank,
            previousScore: previous.score,
            currentScore: entry.score,
            pointsGained: entry.score - previous.score,
            previousRemainingTeams: previous.remainingTeams,
            currentRemainingTeams: entry.remainingTeams,
            scoringPicks
        };
    }).sort((a, b) => (
        b.pointsGained - a.pointsGained
        || b.rankChange - a.rankChange
        || a.currentRank - b.currentRank
    ));

    const currentLeader = leaderboard.find((entry) => entry.rank === 1);
    const previousLeader = previousSnapshot.standings.find((entry) => entry.rank === 1);
    const leaderChange = currentLeader && previousLeader && currentLeader.participantId !== previousLeader.participantId
        ? {
            previousLeader: previousLeader.teamName,
            currentLeader: currentLeader.teamName
        }
        : null;

    return {
        previousStandingsDate: previousSnapshot.date,
        standingsChanges,
        leaderChange
    };
}

async function main() {
    const [participants, teams, resultsFile, matchesFile, scoringConfig, history] = await Promise.all([
        readFile(participantsPath, "utf8").then(JSON.parse),
        readFile(teamsPath, "utf8").then(JSON.parse),
        readFile(resultsPath, "utf8").then(JSON.parse),
        readFile(matchesPath, "utf8").then(JSON.parse),
        readFile(scoringPath, "utf8").then(JSON.parse),
        readFile(historyPath, "utf8").then(JSON.parse)
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
    const movement = buildStandingsChanges(leaderboard, history, summaryDate);

    const output = {
        summaryDate,
        recapDate,
        previousStandingsDate: movement.previousStandingsDate,
        dataLastUpdated: resultsFile.lastUpdated || "",
        scoringRules: scoringConfig,
        previousDayMatches,
        leaderChange: movement.leaderChange,
        standingsChanges: movement.standingsChanges,
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
