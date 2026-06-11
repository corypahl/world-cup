(function () {
    const DATA_VERSION = "20260611-live";

    const DATA_FILES = {
        participants: "data/participants.json",
        teams: "data/teams.json",
        teamResults: "data/team-results.json",
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

    async function loadContestData(options) {
        const cacheBust = Boolean(options && options.cacheBust);
        const [participants, teams, teamResultsFile, scoringConfig] = await Promise.all([
            fetchJson(DATA_FILES.participants, cacheBust),
            fetchJson(DATA_FILES.teams, cacheBust),
            fetchJson(DATA_FILES.teamResults, true),
            fetchJson(DATA_FILES.scoringConfig, cacheBust)
        ]);

        const teamResults = normalizeTeamResults(teamResultsFile);

        return {
            participants,
            teams,
            teamResults: teamResults.results,
            teamResultsMeta: {
                lastUpdated: teamResults.lastUpdated
            },
            scoringConfig
        };
    }

    window.WorldCupDataLoader = {
        loadContestData
    };
})();
