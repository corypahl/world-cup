import { readFile, writeFile } from "node:fs/promises";

const dateRange = process.env.ESPN_DATE_RANGE || "20260611-20260719";
const scoreboardUrl = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const standingsUrl = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026";

const teamsPath = new URL("../data/teams.json", import.meta.url);
const resultsPath = new URL("../data/team-results.json", import.meta.url);
const matchesPath = new URL("../data/matches.json", import.meta.url);

const completedStates = new Set(["post"]);
const completedStatusNames = new Set(["STATUS_FULL_TIME", "STATUS_FINAL", "STATUS_FINAL_PEN"]);

const stageMap = new Map(Object.entries({
    "group-stage": null,
    "round-of-32": "reachedRoundOf32",
    "rd-of-16": "reachedRoundOf16",
    "round-of-16": "reachedRoundOf16",
    "quarterfinals": "reachedQuarterfinal",
    "semifinals": "reachedSemifinal",
    "3rd-place-match": null,
    "final": "reachedFinal"
}));

const stageLabelMap = new Map(Object.entries({
    "group-stage": "Group Stage",
    "round-of-32": "Round of 32",
    "rd-of-16": "Round of 16",
    "round-of-16": "Round of 16",
    "quarterfinals": "Quarterfinal",
    "semifinals": "Semifinal",
    "3rd-place-match": "Third Place",
    "final": "Final"
}));

const stageOrder = [
    "reachedRoundOf32",
    "reachedRoundOf16",
    "reachedQuarterfinal",
    "reachedSemifinal",
    "reachedFinal"
];

const teamAliases = new Map(Object.entries({
    "bosnia-herzegovina": "BIH",
    "bosnia & herzegovina": "BIH",
    "bosnia and herzegovina": "BIH",
    "congo dr": "COD",
    "curacao": "CUW",
    "curaçao": "CUW",
    "dr congo": "COD",
    "iran": "IRN",
    "ivory coast": "CIV",
    "korea republic": "KOR",
    "round of 16 1 winner": null,
    "round of 16 2 winner": null,
    "round of 16 3 winner": null,
    "round of 16 4 winner": null,
    "round of 16 5 winner": null,
    "round of 16 6 winner": null,
    "round of 16 7 winner": null,
    "round of 16 8 winner": null,
    "quarterfinal 1 winner": null,
    "quarterfinal 2 winner": null,
    "quarterfinal 3 winner": null,
    "quarterfinal 4 winner": null,
    "semifinal 1 loser": null,
    "semifinal 1 winner": null,
    "semifinal 2 loser": null,
    "semifinal 2 winner": null,
    "south africa": "RSA",
    "south korea": "KOR",
    "turkiye": "TUR",
    "turkey": "TUR",
    "türkiye": "TUR",
    "united states": "USA"
}));

function emptyResult(teamId, notes = "") {
    return {
        teamId,
        groupWins: 0,
        groupLosses: 0,
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

function isCompleted(competition) {
    const status = competition.status?.type || {};
    return Boolean(status.completed)
        || completedStates.has(status.state)
        || completedStatusNames.has(status.name);
}

function getCompetitors(competition) {
    const competitors = competition.competitors || [];
    const home = competitors.find((competitor) => competitor.homeAway === "home") || competitors[0];
    const away = competitors.find((competitor) => competitor.homeAway === "away") || competitors[1];

    if (!home || !away) {
        return null;
    }

    return { home, away };
}

function getScore(competitor) {
    return numeric(competitor.score);
}

function getDisplayScore(competitor, competition) {
    const state = competition.status?.type?.state;
    return state === "pre" ? null : getScore(competitor);
}

function buildTeamResolver(teams) {
    const ids = new Set(teams.map((team) => team.id));
    const names = new Map();

    teams.forEach((team) => {
        names.set(normalize(team.name), team.id);
    });

    return function resolveTeam(competitor) {
        const providerTeam = competitor?.team;

        if (!providerTeam) {
            return null;
        }

        const abbreviation = String(providerTeam.abbreviation || "").toUpperCase();
        if (ids.has(abbreviation)) {
            return abbreviation;
        }

        if (providerTeam.isActive === false) {
            return null;
        }

        const candidates = [
            providerTeam.displayName,
            providerTeam.shortDisplayName,
            providerTeam.name,
            providerTeam.location
        ].map(normalize).filter(Boolean);

        for (const candidate of candidates) {
            if (teamAliases.has(candidate)) {
                return teamAliases.get(candidate);
            }

            if (names.has(candidate)) {
                return names.get(candidate);
            }
        }

        throw new Error(`No team mapping found for ESPN team: ${JSON.stringify(providerTeam)}`);
    };
}

function markReached(result, stageKey) {
    const stageIndex = stageOrder.indexOf(stageKey);

    if (stageIndex === -1) {
        return;
    }

    for (let index = 0; index <= stageIndex; index += 1) {
        result[stageOrder[index]] = true;
    }
}

function getStageKey(event) {
    return stageMap.get(event.season?.slug || "") || null;
}

function getStageLabel(event) {
    const slug = event.season?.slug || "";
    return stageLabelMap.get(slug) || event.season?.slug || "";
}

function getStatusLabel(competition) {
    const status = competition.status?.type || {};
    return status.shortDetail || status.description || status.detail || "";
}

function getVenueName(event, competition) {
    return competition.venue?.fullName || event.venue?.displayName || competition.venue?.displayName || "";
}

function buildMatch(event, competition, competitors, homeId, awayId, teamNames, completed) {
    return {
        id: event.id || competition.id,
        date: competition.date || event.date,
        stage: event.season?.slug || "",
        stageLabel: getStageLabel(event),
        status: competition.status?.type?.state || "",
        statusLabel: getStatusLabel(competition),
        completed,
        homeTeamId: homeId,
        homeTeamName: teamNames.get(homeId) || homeId,
        homeScore: getDisplayScore(competitors.home, competition),
        awayTeamId: awayId,
        awayTeamName: teamNames.get(awayId) || awayId,
        awayScore: getDisplayScore(competitors.away, competition),
        venue: getVenueName(event, competition)
    };
}

function getWinnerId(homeId, awayId, home, away, score) {
    if (home.winner) {
        return homeId;
    }

    if (away.winner) {
        return awayId;
    }

    if (score.home > score.away) {
        return homeId;
    }

    if (score.away > score.home) {
        return awayId;
    }

    return null;
}

function applyGroupRecord(result, scored, conceded) {
    result.goalsFor += scored;

    if (scored > conceded) {
        result.groupWins += 1;
    } else if (scored === conceded) {
        result.groupDraws += 1;
    } else {
        result.groupLosses += 1;
    }
}

function applyKnockoutElimination(resultMap, winnerId, homeId, awayId) {
    const loserId = winnerId === homeId ? awayId : winnerId === awayId ? homeId : null;

    if (loserId) {
        resultMap.get(loserId).eliminated = true;
    }
}

function stringifyResultsFile(file) {
    const rows = file.results.map((result) => `    ${stringifyResult(result)}`);
    return `{\n  "lastUpdated": ${JSON.stringify(file.lastUpdated)},\n  "results": [\n${rows.join(",\n")}\n  ]\n}\n`;
}

function stringifyMatchesFile(file) {
    return `${JSON.stringify(file, null, 2)}\n`;
}

function stringifyResult(result) {
    return `{ "teamId": ${JSON.stringify(result.teamId)}, "groupWins": ${result.groupWins}, "groupLosses": ${result.groupLosses}, "groupDraws": ${result.groupDraws}, "goalsFor": ${result.goalsFor}, "reachedRoundOf32": ${result.reachedRoundOf32}, "reachedRoundOf16": ${result.reachedRoundOf16}, "reachedQuarterfinal": ${result.reachedQuarterfinal}, "reachedSemifinal": ${result.reachedSemifinal}, "reachedFinal": ${result.reachedFinal}, "wonWorldCup": ${result.wonWorldCup}, "eliminated": ${result.eliminated}, "notes": ${JSON.stringify(result.notes)} }`;
}

async function loadScoreboard() {
    const url = new URL(scoreboardUrl);
    url.searchParams.set("dates", dateRange);
    url.searchParams.set("limit", "200");

    const response = await fetch(url);

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`ESPN scoreboard request failed: ${response.status} ${response.statusText}\n${body}`);
    }

    return response.json();
}

async function loadStandings() {
    const response = await fetch(standingsUrl);

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`ESPN standings request failed: ${response.status} ${response.statusText}\n${body}`);
    }

    return response.json();
}

async function main() {
    const [teams, currentResultsFile, scoreboard, standings] = await Promise.all([
        readFile(teamsPath, "utf8").then(JSON.parse),
        readFile(resultsPath, "utf8").then(JSON.parse),
        loadScoreboard(),
        loadStandings()
    ]);

    const currentNotes = new Map((currentResultsFile.results || []).map((result) => [result.teamId, result.notes || ""]));
    const results = teams.map((team) => emptyResult(team.id, currentNotes.get(team.id) || ""));
    const resultMap = new Map(results.map((result) => [result.teamId, result]));
    const teamNames = new Map(teams.map((team) => [team.id, team.name]));
    const resolveTeam = buildTeamResolver(teams);
    const matches = [];
    let completedMatches = 0;
    let completedGroupMatches = 0;

    (scoreboard.events || []).forEach((event) => {
        const competition = event.competitions?.[0];
        const competitors = competition ? getCompetitors(competition) : null;

        if (!competition || !competitors) {
            return;
        }

        const homeId = resolveTeam(competitors.home);
        const awayId = resolveTeam(competitors.away);

        if (!homeId || !awayId) {
            return;
        }

        const stageKey = getStageKey(event);
        const homeResult = resultMap.get(homeId);
        const awayResult = resultMap.get(awayId);
        const completed = isCompleted(competition);

        matches.push(buildMatch(event, competition, competitors, homeId, awayId, teamNames, completed));

        markReached(homeResult, stageKey);
        markReached(awayResult, stageKey);

        if (!completed) {
            return;
        }

        completedMatches += 1;

        const score = {
            home: getScore(competitors.home),
            away: getScore(competitors.away)
        };

        if (event.season?.slug === "group-stage") {
            completedGroupMatches += 1;
            applyGroupRecord(homeResult, score.home, score.away);
            applyGroupRecord(awayResult, score.away, score.home);
            return;
        }

        homeResult.goalsFor += score.home;
        awayResult.goalsFor += score.away;

        const winnerId = getWinnerId(homeId, awayId, competitors.home, competitors.away, score);
        applyKnockoutElimination(resultMap, winnerId, homeId, awayId);

        if (event.season?.slug === "final" && winnerId) {
            resultMap.get(winnerId).wonWorldCup = true;
        }
    });

    (standings.children || []).forEach((group) => {
        (group.standings?.entries || []).forEach((entry) => {
            const teamId = resolveTeam({ team: entry.team });
            const advanced = (entry.stats || []).find((stat) => stat.name === "advanced");

            if (teamId && Number(advanced?.value) === 1) {
                resultMap.get(teamId).reachedRoundOf32 = true;
            }
        });
    });

    const roundOf32Teams = results.filter((result) => result.reachedRoundOf32).length;
    if (completedGroupMatches >= 72 && roundOf32Teams >= 32) {
        results.forEach((result) => {
            if (!result.reachedRoundOf32) {
                result.eliminated = true;
            }
        });
    }

    const output = {
        lastUpdated: new Date().toISOString(),
        results
    };
    const matchOutput = {
        lastUpdated: output.lastUpdated,
        matches: matches.sort((a, b) => new Date(a.date) - new Date(b.date))
    };

    await Promise.all([
        writeFile(resultsPath, stringifyResultsFile(output)),
        writeFile(matchesPath, stringifyMatchesFile(matchOutput))
    ]);
    console.log(`Updated ${resultsPath.pathname} and ${matchesPath.pathname} from ${completedMatches} completed ESPN matches.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
