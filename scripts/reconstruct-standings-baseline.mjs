import { readFile, writeFile } from "node:fs/promises";

const easternTimeZone = "America/New_York";
const baselineDate = process.argv[2];

const historyPath = new URL("../data/standings-history.json", import.meta.url);
const matchesPath = new URL("../data/matches.json", import.meta.url);
const participantsPath = new URL("../data/participants.json", import.meta.url);
const scoringPath = new URL("../data/scoring-config.json", import.meta.url);

function getEasternDateKey(value) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: easternTimeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date(value)).reduce((all, part) => {
        all[part.type] = part.value;
        return all;
    }, {});

    return `${parts.year}-${parts.month}-${parts.day}`;
}

function addTeamDelta(deltas, teamId, goals, opponentGoals, config) {
    const current = deltas.get(teamId) || { points: 0, goals: 0 };
    current.goals += goals;
    current.points += goals;

    if (goals > opponentGoals) {
        current.points += Number(config.groupWin);
    } else if (goals === opponentGoals) {
        current.points += Number(config.groupDraw);
    }

    deltas.set(teamId, current);
}

function calculateRanks(standings, participantOrder) {
    standings.sort((a, b) => (
        b.score - a.score
        || b.tiebreaker - a.tiebreaker
        || participantOrder.get(a.participantId) - participantOrder.get(b.participantId)
    ));

    let rank = 0;
    let previousScore = null;
    let previousTiebreaker = null;

    standings.forEach((entry, index) => {
        if (entry.score !== previousScore || entry.tiebreaker !== previousTiebreaker) {
            rank = index + 1;
            previousScore = entry.score;
            previousTiebreaker = entry.tiebreaker;
        }

        entry.rank = rank;
    });
}

async function main() {
    if (!baselineDate) {
        throw new Error("Usage: node scripts/reconstruct-standings-baseline.mjs <date>");
    }

    const [history, matchesFile, participants, config] = await Promise.all([
        readFile(historyPath, "utf8").then(JSON.parse),
        readFile(matchesPath, "utf8").then(JSON.parse),
        readFile(participantsPath, "utf8").then(JSON.parse),
        readFile(scoringPath, "utf8").then(JSON.parse)
    ]);
    const sourceSnapshot = (history.snapshots || []).find((snapshot) => snapshot.date === baselineDate);

    if (!sourceSnapshot) {
        throw new Error(`No standings snapshot exists for ${baselineDate}.`);
    }

    const reversedMatches = (matchesFile.matches || []).filter((match) => (
        match.completed && getEasternDateKey(match.date) === baselineDate
    ));
    const teamDeltas = new Map();

    reversedMatches.forEach((match) => {
        if (match.stage !== "group-stage") {
            throw new Error(`Baseline reconstruction currently supports group-stage matches only: ${match.id}`);
        }

        const homeGoals = Number(match.homeScore);
        const awayGoals = Number(match.awayScore);
        addTeamDelta(teamDeltas, match.homeTeamId, homeGoals, awayGoals, config);
        addTeamDelta(teamDeltas, match.awayTeamId, awayGoals, homeGoals, config);
    });

    const goalsBeforeDate = new Map();
    (matchesFile.matches || []).filter((match) => (
        match.completed && getEasternDateKey(match.date) < baselineDate
    )).forEach((match) => {
        goalsBeforeDate.set(
            match.homeTeamId,
            (goalsBeforeDate.get(match.homeTeamId) || 0) + Number(match.homeScore)
        );
        goalsBeforeDate.set(
            match.awayTeamId,
            (goalsBeforeDate.get(match.awayTeamId) || 0) + Number(match.awayScore)
        );
    });

    const standings = sourceSnapshot.standings.map((entry) => {
        const picks = entry.picks.map((pick) => ({
            ...pick,
            points: Math.max(0, pick.points - (teamDeltas.get(pick.teamId)?.points || 0))
        }));

        return {
            ...entry,
            score: picks.reduce((total, pick) => total + pick.points, 0),
            tiebreaker: Math.max(...picks.map((pick) => goalsBeforeDate.get(pick.teamId) || 0)),
            picks
        };
    });
    const participantOrder = new Map(participants.map((participant, index) => [participant.id, index]));
    calculateRanks(standings, participantOrder);

    const snapshot = {
        date: baselineDate,
        capturedAt: new Date().toISOString(),
        reconstructedBaseline: true,
        reversedMatches: reversedMatches.map((match) => match.id),
        standings
    };
    const snapshots = (history.snapshots || [])
        .filter((item) => item.date !== baselineDate && item.reconstructedFrom !== baselineDate);
    snapshots.push(snapshot);
    snapshots.sort((a, b) => a.date.localeCompare(b.date));

    await writeFile(historyPath, `${JSON.stringify({ snapshots }, null, 2)}\n`);
    console.log(`Reconstructed the ${baselineDate} morning baseline by reversing ${reversedMatches.length} match(es).`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
