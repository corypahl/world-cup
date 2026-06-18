import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = resolve(process.argv[2] || ".tmp/daily-summary-input.json");
const historyPath = new URL("../data/standings-history.json", import.meta.url);

async function main() {
    const [input, history] = await Promise.all([
        readFile(inputPath, "utf8").then(JSON.parse),
        readFile(historyPath, "utf8").then(JSON.parse)
    ]);
    const snapshot = {
        date: input.summaryDate,
        capturedAt: new Date().toISOString(),
        standings: input.leaderboard.map((entry) => ({
            participantId: entry.participantId,
            teamName: entry.teamName,
            rank: entry.rank,
            score: entry.score,
            tiebreaker: entry.tiebreaker,
            remainingTeams: entry.remainingTeams,
            picks: entry.picks.map((pick) => ({
                teamId: pick.teamId,
                teamName: pick.teamName,
                points: pick.points
            }))
        }))
    };
    const existingSnapshot = (history.snapshots || []).find((item) => item.date === snapshot.date);

    if (existingSnapshot) {
        console.log(`Standings snapshot for ${snapshot.date} already exists; preserving the original baseline.`);
        return;
    }

    const snapshots = [...(history.snapshots || [])];
    snapshots.push(snapshot);
    snapshots.sort((a, b) => a.date.localeCompare(b.date));

    await writeFile(historyPath, `${JSON.stringify({ snapshots }, null, 2)}\n`);
    console.log(`Saved standings snapshot for ${snapshot.date}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
