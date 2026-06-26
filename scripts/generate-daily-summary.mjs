import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const inputPath = resolve(process.argv[2] || ".tmp/daily-summary-input.json");
const outputPath = resolve(process.argv[3] || ".tmp/gemini-summary-response.json");
const apiKey = process.env.GEMINI_API_KEY;
const retryableStatuses = new Set([429, 500, 502, 503, 504]);

function readPositiveIntegerEnv(name, defaultValue) {
    const value = Number.parseInt(process.env[name] || `${defaultValue}`, 10);
    return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

const maxAttempts = readPositiveIntegerEnv("GEMINI_MAX_ATTEMPTS", 5);
const initialRetryDelayMs = readPositiveIntegerEnv("GEMINI_INITIAL_RETRY_DELAY_MS", 15000);
const maxRetryDelayMs = readPositiveIntegerEnv("GEMINI_MAX_RETRY_DELAY_MS", 120000);

const responseSchema = {
    type: "object",
    properties: {
        previousDayImpact: {
            type: "array",
            description: "Two or three concise bullet points explaining the previous day's most meaningful fantasy-contest leverage, not a score recap.",
            items: { type: "string" },
            minItems: 1,
            maxItems: 3
        },
        leaderboardSummary: {
            type: "array",
            description: "Two or three concise bullet points explaining the most meaningful standings movement using supplied point and rank changes.",
            items: { type: "string" },
            minItems: 1,
            maxItems: 3
        },
        leverageWatch: {
            type: "array",
            description: "Two or three concise bullet points identifying today's best opportunities for entries to gain separation through unique, opposing, or concentrated picks.",
            items: { type: "string" },
            minItems: 1,
            maxItems: 3
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
    "Use the exact supplied national-team names and contest-entry teamName values so the interface can identify and style them.",
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
        "- Previous-day impact: return 1-3 concise bullet strings identifying the results that created the most separation between entries.",
        "- Use each team's pickedBy list and pointsGained values to explain why a result mattered.",
        "- Contrast unique or lightly owned scoring teams with heavily shared picks that benefited several entries equally.",
        "- Ignore unpicked matches unless noting briefly that much of the slate had no contest impact.",
        "- Do not provide a match-by-match score recap; mention a score only when it explains an unusual point swing.",
        "- If no selected team played, say the slate had no direct contest impact.",
        "- Leaderboard summary: return 1-3 concise bullet strings focused on the biggest point gain, largest rank climb, a lead change, or teams lost.",
        "- When standingsChanges is empty, say that movement cannot be calculated yet and briefly state the current leader.",
        "- Do not merely list the top three unless their positions changed.",
        "- Attribute point gains to scoringPicks when those details are supplied.",
        "- Leverage watch: return 1-3 concise bullet strings identifying unique picks, opposing entry interests within one match, or consensus picks that offer limited separation.",
        "- Each bullet must express one main insight and should usually be one sentence.",
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

function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function retryDelayMs(attempt) {
    const exponentialDelay = Math.min(maxRetryDelayMs, initialRetryDelayMs * (2 ** (attempt - 1)));
    const jitter = Math.floor(Math.random() * 5000);
    return exponentialDelay + jitter;
}

async function parseResponseBody(response) {
    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function generateContent(endpoint, requestBody) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: JSON.stringify(requestBody)
        });

        const body = await parseResponseBody(response);

        if (response.ok) {
            return body;
        }

        lastError = new Error(`Gemini request failed: ${response.status} ${JSON.stringify(body)}`);

        if (!retryableStatuses.has(response.status) || attempt === maxAttempts) {
            throw lastError;
        }

        const delayMs = retryDelayMs(attempt);
        console.warn(`Gemini request attempt ${attempt}/${maxAttempts} failed with ${response.status}. Retrying in ${Math.round(delayMs / 1000)}s.`);
        await sleep(delayMs);
    }

    throw lastError;
}

async function main() {
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is required. Add it as a GitHub Actions repository secret.");
    }

    const input = await readFile(inputPath, "utf8").then(JSON.parse);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const body = await generateContent(endpoint, {
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
    });

    await writeFile(outputPath, `${extractResponseText(body)}\n`);
    console.log(`Wrote Gemini response using ${model} to ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
