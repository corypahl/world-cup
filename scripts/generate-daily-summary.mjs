import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const inputPath = resolve(process.argv[2] || ".tmp/daily-summary-input.json");
const outputPath = resolve(process.argv[3] || ".tmp/gemini-summary-response.json");
const apiKey = process.env.GEMINI_API_KEY;

const responseSchema = {
    type: "object",
    properties: {
        previousDayImpact: {
            type: "string",
            description: "Two or three sentences explaining the previous day's most meaningful fantasy-contest leverage, not a score recap."
        },
        leaderboardSummary: {
            type: "string",
            description: "Two or three sentences explaining the most meaningful standings movement using supplied point and rank changes."
        },
        leverageWatch: {
            type: "string",
            description: "Two or three sentences identifying today's best opportunities for entries to gain separation through unique, opposing, or concentrated picks."
        }
    },
    required: ["previousDayImpact", "leaderboardSummary", "leverageWatch"]
};

const systemInstruction = [
    "You write concise daily recaps for a private fantasy football draft-order contest based on the 2026 World Cup.",
    "Use only facts in the supplied contest data.",
    "Never invent scores, standings, movement, injuries, odds, or match details.",
    "Use standingsChanges and leaderChange for all claims about movement.",
    "Keep the tone lively but factual, like a short sports desk update for friends.",
    "Refer to contest entries by teamName. Mention owners only when it improves clarity.",
    "The previous-day impact section covers recapDate.",
    "A positive rankChange means the participant climbed that many places; a negative value means they fell.",
    "pointsGained is the exact score change since previousStandingsDate.",
    "The leaderboard summary should explain what changed since previousStandingsDate, not merely repeat the visible top three.",
    "Use todaysMatches and each team's pickedBy list for the leverage-watch section.",
    "Prioritize unique picks, opposing picks in the same match, and results that affect highly ranked entries.",
    "Shared picks usually create less separation; unpicked matches have no direct contest impact."
].join(" ");

function buildPrompt(input) {
    return [
        "Write today's contest recap from the JSON below.",
        "",
        "Requirements:",
        "- Previous-day impact: 2-3 sentences identifying the results that created the most separation between entries.",
        "- Use each team's pickedBy list and pointsGained values to explain why a result mattered.",
        "- Contrast unique or lightly owned scoring teams with heavily shared picks that benefited several entries equally.",
        "- Ignore unpicked matches unless noting briefly that much of the slate had no contest impact.",
        "- Do not provide a match-by-match score recap; mention a score only when it explains an unusual point swing.",
        "- If no selected team played, say the slate had no direct contest impact.",
        "- Leaderboard summary: 2-3 sentences focused on the biggest point gain, largest rank climb, a lead change, or teams lost.",
        "- When standingsChanges is empty, say that movement cannot be calculated yet and briefly state the current leader.",
        "- Do not merely list the top three unless their positions changed.",
        "- Attribute point gains to scoringPicks when those details are supplied.",
        "- Leverage watch: 2-3 sentences identifying unique picks, opposing entry interests within one match, or consensus picks that offer limited separation.",
        "- Do not restate the full schedule; select only the strongest one or two contest angles.",
        "- If none of today's teams were selected, say the slate has no direct contest implications.",
        "- Do not predict match winners or invent odds.",
        "- Return only JSON matching the response schema.",
        "",
        JSON.stringify(input)
    ].join("\n");
}

function extractResponseText(response) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const text = parts.map((part) => part.text || "").join("").trim();

    if (!text) {
        const reason = response.promptFeedback?.blockReason || response.candidates?.[0]?.finishReason || "unknown";
        throw new Error(`Gemini returned no summary text. Reason: ${reason}`);
    }

    return text;
}

async function main() {
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is required. Add it as a GitHub Actions repository secret.");
    }

    const input = await readFile(inputPath, "utf8").then(JSON.parse);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [{
                role: "user",
                parts: [{ text: buildPrompt(input) }]
            }],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 700,
                responseMimeType: "application/json",
                responseSchema
            }
        })
    });

    const body = await response.json();

    if (!response.ok) {
        throw new Error(`Gemini request failed: ${response.status} ${JSON.stringify(body)}`);
    }

    await writeFile(outputPath, `${extractResponseText(body)}\n`);
    console.log(`Wrote Gemini response using ${model} to ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
