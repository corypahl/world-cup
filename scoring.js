(function () {
    const REQUIRED_PICKS = 5;
    const MAX_BUDGET = 100;

    const ADVANCEMENT_STEPS = [
        { resultKey: "reachedRoundOf32", configKey: "roundOf32", label: "Round of 32" },
        { resultKey: "reachedRoundOf16", configKey: "roundOf16", label: "Round of 16" },
        { resultKey: "reachedQuarterfinal", configKey: "quarterfinal", label: "Quarterfinal" },
        { resultKey: "reachedSemifinal", configKey: "semifinal", label: "Semifinal" },
        { resultKey: "reachedFinal", configKey: "final", label: "Final" },
        { resultKey: "wonWorldCup", configKey: "worldCupWinner", label: "Winner" }
    ];

    function toNumber(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    function buildLookup(items, key) {
        if (items instanceof Map) {
            return items;
        }

        return new Map((items || []).map((item) => [item[key], item]));
    }

    function emptyTeamResult(teamId) {
        return {
            teamId,
            groupWins: 0,
            groupDraws: 0,
            goalsFor: 0,
            reachedRoundOf32: false,
            reachedRoundOf16: false,
            reachedQuarterfinal: false,
            reachedSemifinal: false,
            reachedFinal: false,
            wonWorldCup: false,
            eliminated: false,
            notes: ""
        };
    }

    function calculateTeamScore(teamResult, scoringConfig) {
        const result = teamResult || {};
        const config = scoringConfig || {};

        let total = 0;
        total += toNumber(result.groupWins) * toNumber(config.groupWin);
        total += toNumber(result.groupDraws) * toNumber(config.groupDraw);
        total += toNumber(result.goalsFor) * toNumber(config.goal);

        ADVANCEMENT_STEPS.forEach((step) => {
            if (result[step.resultKey]) {
                total += toNumber(config[step.configKey]);
            }
        });

        return total;
    }

    function getRoundReached(teamResult) {
        const result = teamResult || {};

        for (let index = ADVANCEMENT_STEPS.length - 1; index >= 0; index -= 1) {
            const step = ADVANCEMENT_STEPS[index];
            if (result[step.resultKey]) {
                return step.label;
            }
        }

        return "Group stage";
    }

    function validateLineup(participant, teams) {
        const teamMap = buildLookup(teams, "id");
        const picks = Array.isArray(participant.picks) ? participant.picks : [];
        const errors = [];
        const warnings = [];
        const seen = new Set();
        let budgetUsed = 0;

        if (picks.length === 0) {
            return {
                valid: false,
                submitted: false,
                status: "pending",
                errors: [],
                warnings: [],
                budgetUsed: 0,
                remainingBudget: MAX_BUDGET,
                pickCount: 0
            };
        }

        if (picks.length !== REQUIRED_PICKS) {
            errors.push(`Lineup has ${picks.length} picks; exactly ${REQUIRED_PICKS} are required.`);
        }

        picks.forEach((teamId) => {
            const team = teamMap.get(teamId);

            if (!team) {
                errors.push(`${teamId} is not in teams.json.`);
                return;
            }

            budgetUsed += toNumber(team.cost);

            if (seen.has(teamId)) {
                errors.push(`${team.name} appears more than once.`);
            }

            seen.add(teamId);
        });

        if (budgetUsed > MAX_BUDGET) {
            errors.push(`Lineup costs $${budgetUsed}; max budget is $${MAX_BUDGET}.`);
        }

        if (picks.length < REQUIRED_PICKS) {
            warnings.push(`${REQUIRED_PICKS - picks.length} pick(s) still needed.`);
        }

        return {
            valid: errors.length === 0,
            submitted: true,
            status: errors.length === 0 ? "valid" : "invalid",
            errors,
            warnings,
            budgetUsed,
            remainingBudget: MAX_BUDGET - budgetUsed,
            pickCount: picks.length
        };
    }

    function calculateParticipantScore(participant, teams, teamResults, scoringConfig) {
        const teamMap = buildLookup(teams, "id");
        const resultMap = buildLookup(teamResults, "teamId");
        const picks = Array.isArray(participant.picks) ? participant.picks : [];
        const validation = validateLineup(participant, teamMap);

        const pickDetails = picks.map((teamId) => {
            const team = teamMap.get(teamId);
            const result = resultMap.get(teamId) || emptyTeamResult(teamId);
            const score = team ? calculateTeamScore(result, scoringConfig) : 0;

            return {
                teamId,
                team,
                result,
                score,
                goals: toNumber(result.goalsFor),
                roundReached: getRoundReached(result),
                eliminated: Boolean(result.eliminated)
            };
        });

        const totalPoints = pickDetails.reduce((total, pick) => total + pick.score, 0);
        const tiebreaker = pickDetails.reduce((highest, pick) => Math.max(highest, pick.goals), 0);

        return {
            participant,
            originalIndex: participant.originalIndex || 0,
            validation,
            pickDetails,
            totalPoints,
            tiebreaker,
            budgetUsed: validation.budgetUsed,
            remainingBudget: validation.remainingBudget
        };
    }

    function sortLeaderboard(entries) {
        return [...entries].sort((a, b) => {
            if (b.totalPoints !== a.totalPoints) {
                return b.totalPoints - a.totalPoints;
            }

            if (b.tiebreaker !== a.tiebreaker) {
                return b.tiebreaker - a.tiebreaker;
            }

            return a.originalIndex - b.originalIndex;
        });
    }

    function calculateRanks(entries) {
        let currentRank = 0;
        let previousScore = null;
        let previousTiebreaker = null;

        return entries.map((entry, index) => {
            const scoreChanged = entry.totalPoints !== previousScore;
            const tiebreakerChanged = entry.tiebreaker !== previousTiebreaker;

            if (scoreChanged || tiebreakerChanged) {
                currentRank = index + 1;
                previousScore = entry.totalPoints;
                previousTiebreaker = entry.tiebreaker;
            }

            return currentRank;
        });
    }

    window.WorldCupScoring = {
        ADVANCEMENT_STEPS,
        MAX_BUDGET,
        REQUIRED_PICKS,
        buildLookup,
        calculateTeamScore,
        calculateParticipantScore,
        calculateRanks,
        emptyTeamResult,
        getRoundReached,
        sortLeaderboard,
        validateLineup
    };
})();
