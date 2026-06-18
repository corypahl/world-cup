import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const responsePath = resolve(process.argv[2] || "");
const inputPath = resolve(process.argv[3] || ".tmp/daily-summary-input.json");
const outputPath = process.argv[4]
    ? resolve(process.argv[4])
    : new URL("../data/daily-summary.json", import.meta.url);

function parseResponse(raw) {
    const trimmed = raw.trim();
    const unfenced = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

    return JSON.parse(unfenced);
}

function validateSummary(summary) {
    const requiredLists = ["previousDayImpact", "leaderboardSummary", "leverageWatch"];

    requiredLists.forEach((key) => {
        if (!Array.isArray(summary[key])
            || !summary[key].length
            || summary[key].some((item) => typeof item !== "string" || !item.trim())) {
            throw new Error(`AI response is missing a non-empty ${key} bullet list.`);
        }
    });
}

async function main() {
    if (!process.argv[2]) {
        throw new Error("Usage: node scripts/save-daily-summary.mjs <response-file> [input-file]");
    }

    const [rawResponse, input] = await Promise.all([
        readFile(responsePath, "utf8"),
        readFile(inputPath, "utf8").then(JSON.parse)
    ]);
    const summary = parseResponse(rawResponse);

    validateSummary(summary);

    const output = {
        generatedAt: new Date().toISOString(),
        summaryDate: input.summaryDate,
        recapDate: input.recapDate,
        previousDayImpact: summary.previousDayImpact.map((item) => item.trim()),
        leaderboardSummary: summary.leaderboardSummary.map((item) => item.trim()),
        leverageWatch: summary.leverageWatch.map((item) => item.trim())
    };

    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Wrote daily AI summary to ${outputPath.pathname || outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
