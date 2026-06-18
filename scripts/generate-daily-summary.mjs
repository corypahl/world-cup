import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const inputPath = resolve(process.argv[2] || ".tmp/daily-summary-input.json");
const outputPath = resolve(process.argv[3] || ".tmp/gemini-summary-response.json");
const apiKey = process.env.GEMINI_API_KEY;

const responseSchema = {
    type: "object",
    properties: {
        matchRecap: {
            type: "array",
            description: "Zero to four concise match recap strings.",
            items: {
                type: "string"
            },
            maxItems: 4
        },
        leaderboardSummary: {
            type: "string",
            description: "Two or three sentences explaining the most meaningful standings movement using supplied point and rank changes."
        },
        lookingAhead: {
            type: "string",
            description: "Two or three sentences identifying the most consequential games today and which contest entries have those teams."
        }
    },
    required: ["matchRecap", "leaderboardSummary", "lookingAhead"]
};

const systemInstruction = [
    "You write concise daily recaps for a private fantasy football draft-order contest based on the 2026 World Cup.",
    "Use only facts in the supplied contest data.",
    "Never invent scores, standings, movement, injuries, odds, or match details.",
    "Use standingsChanges and leaderChange for all claims about movement.",
    "Keep the tone lively but factual, like a short sports desk update for friends.",
    "Refer to contest entries by teamName. Mention owners only when it improves clarity.",
    "The match recap covers recapDate.",
    "A positive rankChange means the participant climbed that many places; a negative value means they fell.",
    "pointsGained is the exact score change since previousStandingsDate.",
    "The leaderboard summary should explain what changed since previousStandingsDate, not merely repeat the visible top three.",
    "Use todaysGames and each team's pickedBy list for the looking-ahead section.",
    "Prioritize games involving highly ranked entries, many contest entries, or teams that could create meaningful separation."
].join(" ");

function buildPrompt(input) {
    return [
        "Write today's contest recap from the JSON below.",
        "",
        "Requirements:",
        "- Match recap: zero to four concise strings. If no matches were played, return one string saying there were no completed matches.",
        "- Leaderboard summary: 2-3 sentences focused on the biggest point gain, largest rank climb, a lead change, or teams lost.",
        "- When standingsChanges is empty, say that movement cannot be calculated yet and briefly state the current leader.",
        "- Do not merely list the top three unless their positions changed.",
        "- Attribute point gains to scoringPicks when those details are supplied.",
        "- Looking ahead: 2-3 sentences about today's most important games and the contest entries invested in those teams.",
        "- If none of today's teams were selected, say so plainly instead of inventing contest implications.",
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
