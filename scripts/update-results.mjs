import { readFile, writeFile } from "node:fs/promises";

const competitionCode = process.env.FOOTBALL_DATA_COMPETITION || "WC";
const season = process.env.FOOTBALL_DATA_SEASON || "2026";
const token = process.env.FOOTBALL_DATA_API_TOKEN;

const teamsPath = new URL("../data/teams.json", import.meta.url);
const resultsPath = new URL("../data/team-results.json", import.meta.url);

const finishedStatuses = new Set(["FINISHED", "AWARDED"]);
const stageOrder = [
    ["LAST_32", "reachedRoundOf32"],
    ["LAST_16", "reachedRoundOf16"],
    ["QUARTER_FINALS", "reachedQuarterfinal"],
    ["SEMI_FINALS", "reachedSemifinal"],
    ["FINAL", "reachedFinal"]
];

const teamAliases = new Map(Object.entries({
    "bosnia & herzegovina": "BIH",
    "bosnia and herzegovina": "BIH",
    "cabo verde": "CPV",
    "cape verde": "CPV",
    "congo dr": "COD",
    "curacao": "CUW",
    "curaçao": "CUW",
    "czech republic": "CZE",
    "czechia": "CZE",
    "côte d'ivoire": "CIV",
    "côte d’ivoire": "CIV",
    "dr congo": "COD",
    "iran": "IRN",
    "ivory coast": "CIV",
    "korea republic": "KOR",
    "saudi arabia": "KSA",
    "south africa": "RSA",
    "south korea": "KOR",
    "turkey": "TUR",
    "türkiye": "TUR",
    "turkiye": "TUR",
    "united states": "USA",
    "usa": "USA"
}));

const tlaAliases = new Map(Object.entries({
    CUR: "CUW",
    KSA: "KSA",
    SAU: "KSA",
    ZAF: "RSA"
}));

function emptyResult(teamId, notes = "") {
    return {
        teamId,
        groupWins: 0,
        groupDraws: 0,
        goalsFor: 0,
        reachedRoundOf32: false,
        reachedRoundOf16: false,
        reachedQuarterfinal: false,
        reachedSemifinal: false,
        reachedFinal: false,
        wonWorldCup: false,
        eliminated: false,
        notes
    };
}

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isFinished(match) {
    return finishedStatuses.has(match.status);
}

function getFullTimeScore(match) {
    const fullTime = match.score?.fullTime || {};
    const home = fullTime.home;
    const away = fullTime.away;

    if (home === null || away === null || home === undefined || away === undefined) {
        return null;
    }

    return {
        home: numeric(home),
        away: numeric(away)
    };
}

function buildTeamResolver(teams) {
    const ids = new Set(teams.map((team) => team.id));
    const names = new Map();

    teams.forEach((team) => {
        names.set(normalize(team.name), team.id);
    });

    return function resolveTeam(providerTeam) {
        if (!providerTeam || providerTeam.name === "TBD") {
            return null;
        }

        const tla = String(providerTeam.tla || "").toUpperCase();
        if (ids.has(tla)) {
            return tla;
        }

        const aliasedTla = tlaAliases.get(tla);
        if (aliasedTla && ids.has(aliasedTla)) {
            return aliasedTla;
        }

        const candidates = [
            providerTeam.name,
            providerTeam.shortName
        ].map(normalize).filter(Boolean);

        for (const candidate of candidates) {
            const aliasedName = teamAliases.get(candidate);
            if (aliasedName && ids.has(aliasedName)) {
                return aliasedName;
            }

            const directName = names.get(candidate);
            if (directName) {
                return directName;
            }
        }

        throw new Error(`No team mapping found for provider team: ${JSON.stringify(providerTeam)}`);
    };
}

function ensureGroupTable(tables, group, teamIds) {
    if (!group) {
        return null;
    }

    if (!tables.has(group)) {
        tables.set(group, new Map());
    }

    const table = tables.get(group);
    teamIds.forEach((teamId) => {
        if (!teamId) {
            return;
        }

        if (!table.has(teamId)) {
            table.set(teamId, {
                teamId,
                played: 0,
                points: 0,
                wins: 0,
                draws: 0,
                goalsFor: 0,
                goalsAgainst: 0
            });
        }
    });

    return table;
}

function updateGroupTable(table, homeId, awayId, score) {
    const home = table.get(homeId);
    const away = table.get(awayId);
    home.played += 1;
    away.played += 1;
    home.goalsFor += score.home;
    home.goalsAgainst += score.away;
    away.goalsFor += score.away;
    away.goalsAgainst += score.home;

    if (score.home > score.away) {
        home.wins += 1;
        home.points += 3;
    } else if (score.away > score.home) {
        away.wins += 1;
        away.points += 3;
    } else {
        home.draws += 1;
        away.draws += 1;
        home.points += 1;
        away.points += 1;
    }
}

function sortGroupRows(rows) {
    return [...rows].sort((a, b) => {
        const goalDifferenceA = a.goalsFor - a.goalsAgainst;
        const goalDifferenceB = b.goalsFor - b.goalsAgainst;

        if (b.points !== a.points) {
            return b.points - a.points;
        }

        if (goalDifferenceB !== goalDifferenceA) {
            return goalDifferenceB - goalDifferenceA;
        }

        if (b.goalsFor !== a.goalsFor) {
            return b.goalsFor - a.goalsFor;
        }

        return a.teamId.localeCompare(b.teamId);
    });
}

function markReached(result, stage) {
    const stageIndex = stageOrder.findIndex(([stageName]) => stageName === stage);

    if (stageIndex === -1) {
        return;
    }

    for (let index = 0; index <= stageIndex; index += 1) {
        result[stageOrder[index][1]] = true;
    }
}

function getWinner(match, homeId, awayId, score) {
    const winner = match.score?.winner;

    if (winner === "HOME_TEAM") {
        return homeId;
    }

    if (winner === "AWAY_TEAM") {
        return awayId;
    }

    if (!score) {
        return null;
    }

    if (score.home > score.away) {
        return homeId;
    }

    if (score.away > score.home) {
        return awayId;
    }

    return null;
}

function applyGroupAdvancement(results, groupTables, groupMatchCounts) {
    const groups = [...groupTables.entries()];
    const allGroupsComplete = groups.length === 12 && groups.every(([group, table]) => (
        table.size === 4 && groupMatchCounts.get(group) === 6 && [...table.values()].every((row) => row.played === 3)
    ));

    if (!allGroupsComplete) {
        return;
    }

    const advanced = new Set();
    const thirdPlaceRows = [];

    groups.forEach(([, table]) => {
        const rows = sortGroupRows(table.values());
        rows.slice(0, 2).forEach((row) => advanced.add(row.teamId));

        if (rows[2]) {
            thirdPlaceRows.push(rows[2]);
        }
    });

    sortGroupRows(thirdPlaceRows).slice(0, 8).forEach((row) => advanced.add(row.teamId));

    results.forEach((result) => {
        if (advanced.has(result.teamId)) {
            result.reachedRoundOf32 = true;
        } else {
            result.eliminated = true;
        }
    });
}

async function loadMatches() {
    if (!token) {
        console.log("FOOTBALL_DATA_API_TOKEN is not set. Skipping result update.");
        return null;
    }

    const url = new URL(`https://api.football-data.org/v4/competitions/${competitionCode}/matches`);
    url.searchParams.set("season", season);

    const response = await fetch(url, {
        headers: {
            "X-Auth-Token": token
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`football-data request failed: ${response.status} ${response.statusText}\n${body}`);
    }

    return response.json();
}

async function main() {
    const [teams, currentResultsFile, matchData] = await Promise.all([
        readFile(teamsPath, "utf8").then(JSON.parse),
        readFile(resultsPath, "utf8").then(JSON.parse),
        loadMatches()
    ]);

    if (!matchData) {
        return;
    }

    const currentNotes = new Map((currentResultsFile.results || []).map((result) => [result.teamId, result.notes || ""]));
    const results = teams.map((team) => emptyResult(team.id, currentNotes.get(team.id) || ""));
    const resultMap = new Map(results.map((result) => [result.teamId, result]));
    const resolveTeam = buildTeamResolver(teams);
    const groupTables = new Map();
    const groupMatchCounts = new Map();

    (matchData.matches || []).forEach((match) => {
        const homeId = resolveTeam(match.homeTeam);
        const awayId = resolveTeam(match.awayTeam);

        if (!homeId || !awayId) {
            return;
        }

        const homeResult = resultMap.get(homeId);
        const awayResult = resultMap.get(awayId);

        markReached(homeResult, match.stage);
        markReached(awayResult, match.stage);

        if (!isFinished(match)) {
            return;
        }

        const score = getFullTimeScore(match);
        if (!score) {
            return;
        }

        homeResult.goalsFor += score.home;
        awayResult.goalsFor += score.away;

        if (match.stage === "GROUP_STAGE") {
            const table = ensureGroupTable(groupTables, match.group, [homeId, awayId]);
            if (table) {
                groupMatchCounts.set(match.group, (groupMatchCounts.get(match.group) || 0) + 1);
                updateGroupTable(table, homeId, awayId, score);

                if (score.home > score.away) {
                    homeResult.groupWins += 1;
                } else if (score.away > score.home) {
                    awayResult.groupWins += 1;
                } else {
                    homeResult.groupDraws += 1;
                    awayResult.groupDraws += 1;
                }
            }
        }

        if (match.stage !== "GROUP_STAGE") {
            const winner = getWinner(match, homeId, awayId, score);
            const loser = winner === homeId ? awayId : winner === awayId ? homeId : null;

            if (loser) {
                resultMap.get(loser).eliminated = true;
            }

            if (match.stage === "FINAL" && winner) {
                resultMap.get(winner).wonWorldCup = true;
            }
        }
    });

    applyGroupAdvancement(results, groupTables, groupMatchCounts);

    const output = {
        lastUpdated: new Date().toISOString(),
        results
    };

    await writeFile(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Updated ${resultsPath.pathname} from ${matchData.matches?.length || 0} matches.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
