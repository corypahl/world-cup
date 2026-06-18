import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const inputPath = resolve(process.argv[2] || ".tmp/daily-summary-input.json");
const outputPath = resolve(process.argv[3] || ".tmp/gemini-summary-response.json");
const apiKey = process.env.GEMINI_API_KEY;

const responseSchema = {
    type: "object",
    properties: {
        headline: {
            type: "string",
            description: "A factual sports-style headline with no more than 10 words."
        },
        overview: {
            type: "string",
            description: "One or two sentences connecting the previous day's matches to the contest."
        },
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
            description: "One or two sentences naming the current leader and closest challengers using supplied ranks and scores."
        }
    },
    required: ["headline", "overview", "matchRecap", "leaderboardSummary"]
};

const systemInstruction = [
    "You write concise daily recaps for a private fantasy football draft-order contest based on the 2026 World Cup.",
    "Use only facts in the supplied contest data.",
    "Never invent scores, standings, movement, injuries, odds, or match details.",
    "Do not claim a participant moved up or down because historical rankings are not provided.",
    "Keep the tone lively but factual, like a short sports desk update for friends.",
    "Refer to contest entries by teamName. Mention owners only when it improves clarity.",
    "The match recap covers recapDate. The leaderboard summary describes the current leaderboard."
].join(" ");

function buildPrompt(input) {
    return [
        "Write today's contest recap from the JSON below.",
        "",
        "Requirements:",
        "- Headline: no more than 10 words.",
        "- Overview: 1-2 sentences connecting yesterday's matches to the contest.",
        "- Match recap: zero to four concise strings. If no matches were played, return one string saying there were no completed matches.",
        "- Leaderboard summary: 1-2 sentences naming the leader and closest challengers using the supplied ranks and scores.",
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
