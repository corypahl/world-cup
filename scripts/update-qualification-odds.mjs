import { readFile, writeFile } from "node:fs/promises";

const kalshiUrl = "https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXWCGROUPQUAL&limit=1000";
const teamsPath = new URL("../data/teams.json", import.meta.url);
const outputPath = new URL("../data/qualification-odds.json", import.meta.url);

const teamAliases = new Map([
    ["DZA", "ALG"],
    ["HTI", "HAI"],
    ["IRI", "IRN"]
]);

function getTeamId(ticker) {
    const marketCode = ticker.split("-").at(-1);
    return teamAliases.get(marketCode) || marketCode;
}

async function main() {
    const [teams, response] = await Promise.all([
        readFile(teamsPath, "utf8").then(JSON.parse),
        fetch(kalshiUrl)
    ]);

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Kalshi markets request failed: ${response.status} ${response.statusText}\n${body}`);
    }

    const payload = await response.json();
    const validTeamIds = new Set(teams.map((team) => team.id));
    const odds = (payload.markets || []).map((market) => {
        const teamId = getTeamId(market.ticker);
        const yesBid = market.yes_bid_dollars === "" || market.yes_bid_dollars === undefined
            ? null
            : Number(market.yes_bid_dollars);

        if (!validTeamIds.has(teamId)) {
            return null;
        }

        return {
            teamId,
            yesBidPercent: Number.isFinite(yesBid) ? Math.round(yesBid * 100) : null,
            ticker: market.ticker
        };
    }).filter(Boolean)
        .sort((a, b) => a.teamId.localeCompare(b.teamId));

    if (odds.length !== teams.length) {
        const found = new Set(odds.map((entry) => entry.teamId));
        const missing = teams.filter((team) => !found.has(team.id)).map((team) => team.id);
        throw new Error(`Expected ${teams.length} Kalshi qualification markets, found ${odds.length}. Missing: ${missing.join(", ")}`);
    }

    await writeFile(outputPath, `${JSON.stringify({
        lastUpdated: new Date().toISOString(),
        source: "Kalshi Yes bid",
        odds
    }, null, 2)}\n`);
    console.log(`Updated Round of 32 qualification odds for ${odds.length} teams.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
