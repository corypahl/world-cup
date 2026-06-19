(function () {
    const DATA_VERSION = "20260618-kalshi-r32";

    const DATA_FILES = {
        participants: "data/participants.json",
        teams: "data/teams.json",
        teamResults: "data/team-results.json",
        qualificationOdds: "data/qualification-odds.json",
        matches: "data/matches.json",
        dailySummary: "data/daily-summary.json",
        standingsHistory: "data/standings-history.json",
        scoringConfig: "data/scoring-config.json"
    };

    async function fetchJson(path, cacheBust) {
        const suffix = cacheBust ? `?t=${Date.now()}` : `?v=${DATA_VERSION}`;
        const response = await fetch(`${path}${suffix}`, { cache: cacheBust ? "reload" : "default" });

        if (!response.ok) {
            throw new Error(`Could not load ${path}: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    function normalizeTeamResults(teamResultsFile) {
        if (Array.isArray(teamResultsFile)) {
            return {
                lastUpdated: "",
                results: teamResultsFile
            };
        }

        return {
            lastUpdated: teamResultsFile.lastUpdated || "",
            results: Array.isArray(teamResultsFile.results) ? teamResultsFile.results : []
        };
    }

    function normalizeMatches(matchesFile) {
        if (Array.isArray(matchesFile)) {
            return {
                lastUpdated: "",
                matches: matchesFile
            };
        }

        return {
            lastUpdated: matchesFile.lastUpdated || "",
            matches: Array.isArray(matchesFile.matches) ? matchesFile.matches : []
        };
    }

    function normalizeDailySummary(summaryFile) {
        return {
            generatedAt: summaryFile.generatedAt || "",
            summaryDate: summaryFile.summaryDate || "",
            recapDate: summaryFile.recapDate || "",
            previousDayImpact: normalizeSummaryBullets(
                summaryFile.previousDayImpact || buildLegacyRecap(summaryFile.matchRecap)
            ),
            leaderboardSummary: normalizeSummaryBullets(summaryFile.leaderboardSummary),
            leverageWatch: normalizeSummaryBullets(summaryFile.leverageWatch || summaryFile.lookingAhead)
        };
    }

    function normalizeSummaryBullets(value) {
        if (Array.isArray(value)) {
            return value.filter((item) => typeof item === "string" && item.trim());
        }

        return typeof value === "string" && value.trim() ? [value.trim()] : [];
    }

    function buildLegacyRecap(matchRecap) {
        if (!Array.isArray(matchRecap)) {
            return "";
        }

        return matchRecap.map((item) => (
            typeof item === "string" ? item : item.summary || ""
        )).filter(Boolean).join(" ");
    }

    async function loadContestData(options) {
        const cacheBust = Boolean(options && options.cacheBust);
        const [participants, teams, teamResultsFile, qualificationOddsFile, matchesFile, dailySummaryFile, standingsHistoryFile, scoringConfig] = await Promise.all([
            fetchJson(DATA_FILES.participants, cacheBust),
            fetchJson(DATA_FILES.teams, cacheBust),
            fetchJson(DATA_FILES.teamResults, true),
            fetchJson(DATA_FILES.qualificationOdds, true),
            fetchJson(DATA_FILES.matches, true),
            fetchJson(DATA_FILES.dailySummary, true),
            fetchJson(DATA_FILES.standingsHistory, true),
            fetchJson(DATA_FILES.scoringConfig, cacheBust)
        ]);

        const teamResults = normalizeTeamResults(teamResultsFile);
        const matches = normalizeMatches(matchesFile);
        const dailySummary = normalizeDailySummary(dailySummaryFile);

        return {
            participants,
            teams,
            teamResults: teamResults.results,
            qualificationOdds: Array.isArray(qualificationOddsFile.odds) ? qualificationOddsFile.odds : [],
            qualificationOddsMeta: {
                lastUpdated: qualificationOddsFile.lastUpdated || "",
                source: qualificationOddsFile.source || ""
            },
            teamResultsMeta: {
                lastUpdated: teamResults.lastUpdated
            },
            matches: matches.matches,
            matchesMeta: {
                lastUpdated: matches.lastUpdated
            },
            dailySummary,
            standingsHistory: Array.isArray(standingsHistoryFile.snapshots)
                ? standingsHistoryFile.snapshots
                : [],
            scoringConfig
        };
    }

    window.WorldCupDataLoader = {
        loadContestData
    };
})();
