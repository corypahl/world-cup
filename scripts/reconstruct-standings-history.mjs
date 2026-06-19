import { readFile, writeFile } from "node:fs/promises";

const easternTimeZone = "America/New_York";
const tournamentStart = process.argv[2] || "2026-06-11";
const historyPath = new URL("../data/standings-history.json", import.meta.url);
const matchesPath = new URL("../data/matches.json", import.meta.url);
const participantsPath = new URL("../data/participants.json", import.meta.url);
const teamsPath = new URL("../data/teams.json", import.meta.url);
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

function addDays(dateKey, count) {
    const date = new Date(`${dateKey}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
}

function emptyTeamState(teamId) {
    return {
        teamId,
        groupWins: 0,
        groupDraws: 0,
        goalsFor: 0
    };
}

function applyGroupMatch(teamState, goals, opponentGoals) {
    teamState.goalsFor += goals;

    if (goals > opponentGoals) {
        teamState.groupWins += 1;
    } else if (goals === opponentGoals) {
        teamState.groupDraws += 1;
    }
}

function calculateTeamPoints(result, config) {
    return (
        result.groupWins * Number(config.groupWin)
        + result.groupDraws * Number(config.groupDraw)
        + result.goalsFor * Number(config.goal)
    );
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

function buildSnapshot(date, participants, teamMap, teamStates, config, participantOrder, includedMatches) {
    const standings = participants.map((participant) => {
        const picks = (participant.picks || []).map((teamId) => {
            const result = teamStates.get(teamId) || emptyTeamState(teamId);

            return {
                teamId,
                teamName: teamMap.get(teamId)?.name || teamId,
                points: calculateTeamPoints(result, config)
            };
        });

        return {
            participantId: participant.id,
            teamName: participant.teamName,
            rank: 0,
            score: picks.reduce((total, pick) => total + pick.points, 0),
            tiebreaker: Math.max(0, ...(participant.picks || []).map((teamId) => (
                teamStates.get(teamId)?.goalsFor || 0
            ))),
            remainingTeams: picks.length,
            picks
        };
    });

    calculateRanks(standings, participantOrder);

    return {
        date,
        capturedAt: new Date().toISOString(),
        reconstructedHistory: true,
        throughDate: addDays(date, -1),
        includedMatches: [...includedMatches],
        standings
    };
}

async function main() {
    const [matchesFile, participants, teams, config] = await Promise.all([
        readFile(matchesPath, "utf8").then(JSON.parse),
        readFile(participantsPath, "utf8").then(JSON.parse),
        readFile(teamsPath, "utf8").then(JSON.parse),
        readFile(scoringPath, "utf8").then(JSON.parse)
    ]);
    const groupMatches = (matchesFile.matches || [])
        .filter((match) => match.stage === "group-stage");
    const matchesByDate = new Map();

    groupMatches.forEach((match) => {
        const date = getEasternDateKey(match.date);
        const matches = matchesByDate.get(date) || [];
        matches.push(match);
        matchesByDate.set(date, matches);
    });

    const matchDates = [...matchesByDate.keys()].sort();
    let latestCompleteDate = "";

    for (const date of matchDates) {
        if (date < tournamentStart) {
            continue;
        }

        const matches = matchesByDate.get(date);
        if (!matches.length || matches.some((match) => !match.completed)) {
            break;
        }

        latestCompleteDate = date;
    }

    if (!latestCompleteDate) {
        throw new Error("No fully completed group-stage matchday is available for reconstruction.");
    }

    const completedGroupMatches = groupMatches
        .filter((match) => match.completed && getEasternDateKey(match.date) <= latestCompleteDate)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    const finalSnapshotDate = addDays(latestCompleteDate, 1);
    const teamMap = new Map(teams.map((team) => [team.id, team]));
    const teamStates = new Map(teams.map((team) => [team.id, emptyTeamState(team.id)]));
    const participantOrder = new Map(participants.map((participant, index) => [participant.id, index]));
    const includedMatches = [];
    const snapshots = [];
    let matchIndex = 0;

    for (let date = tournamentStart; date <= finalSnapshotDate; date = addDays(date, 1)) {
        while (
            matchIndex < completedGroupMatches.length
            && getEasternDateKey(completedGroupMatches[matchIndex].date) < date
        ) {
            const match = completedGroupMatches[matchIndex];
            const homeGoals = Number(match.homeScore);
            const awayGoals = Number(match.awayScore);

            applyGroupMatch(teamStates.get(match.homeTeamId), homeGoals, awayGoals);
            applyGroupMatch(teamStates.get(match.awayTeamId), awayGoals, homeGoals);
            includedMatches.push(match.id);
            matchIndex += 1;
        }

        snapshots.push(buildSnapshot(
            date,
            participants,
            teamMap,
            teamStates,
            config,
            participantOrder,
            includedMatches
        ));
    }

    await writeFile(historyPath, `${JSON.stringify({ snapshots }, null, 2)}\n`);
    console.log(`Reconstructed ${snapshots.length} daily snapshots from ${tournamentStart} through ${finalSnapshotDate}.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
