(function () {
    const state = {
        data: null,
        entries: [],
        teamScores: [],
        ownership: new Map(),
        teamSearch: ""
    };

    document.addEventListener("DOMContentLoaded", () => {
        bindControls();
        refreshData();
    });

    function bindControls() {
        const teamSearch = document.getElementById("teamSearch");

        if (teamSearch) {
            teamSearch.addEventListener("input", (event) => {
                state.teamSearch = event.target.value.trim().toLowerCase();
                renderTeamScores(state.teamScores);
            });
        }
    }

    async function refreshData() {
        try {
            const data = await window.WorldCupDataLoader.loadContestData();
            state.data = data;
            buildContestState(data);
            renderAll();
        } catch (error) {
            renderFatalError(error);
        }
    }

    function buildContestState(data) {
        const teamMap = window.WorldCupScoring.buildLookup(data.teams, "id");
        const resultMap = window.WorldCupScoring.buildLookup(data.teamResults, "teamId");

        const entries = data.participants.map((participant, originalIndex) => (
            window.WorldCupScoring.calculateParticipantScore(
                { ...participant, originalIndex },
                teamMap,
                resultMap,
                data.scoringConfig
            )
        ));

        state.entries = window.WorldCupScoring.sortLeaderboard(entries);
        const ranks = window.WorldCupScoring.calculateRanks(state.entries);
        state.entries.forEach((entry, index) => {
            entry.rank = ranks[index];
            entry.rowIndex = index;
        });

        state.ownership = calculateOwnership(data.participants, teamMap);
        state.teamScores = data.teams.map((team) => {
            const result = resultMap.get(team.id) || window.WorldCupScoring.emptyTeamResult(team.id);

            return {
                team,
                result,
                points: window.WorldCupScoring.calculateTeamScore(result, data.scoringConfig),
                roundReached: window.WorldCupScoring.getRoundReached(result),
                pickedBy: state.ownership.get(team.id) || []
            };
        }).sort((a, b) => {
            if (b.points !== a.points) {
                return b.points - a.points;
            }

            if (Number(a.team.cost) !== Number(b.team.cost)) {
                return Number(b.team.cost) - Number(a.team.cost);
            }

            return a.team.name.localeCompare(b.team.name);
        });
    }

    function calculateOwnership(participants, teamMap) {
        const ownership = new Map();

        participants.forEach((participant) => {
            const picks = Array.isArray(participant.picks) ? participant.picks : [];

            picks.forEach((teamId) => {
                if (!teamMap.has(teamId)) {
                    return;
                }

                const current = ownership.get(teamId) || [];
                current.push({
                    participantId: participant.id,
                    teamName: participant.teamName,
                    owners: participant.owners || []
                });
                ownership.set(teamId, current);
            });
        });

        return ownership;
    }

    function renderAll() {
        renderLeaderboard(state.entries);
        renderTeamScores(state.teamScores);
        renderScoringRules(state.data.scoringConfig);
    }

    function renderLeaderboard(entries) {
        const tbody = document.getElementById("leaderboardBody");
        if (!tbody) {
            return;
        }

        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No participants found.</td></tr>`;
            return;
        }

        tbody.innerHTML = entries.map((entry) => {
            const participant = entry.participant;
            const statusBadge = renderStatusBadge(entry.validation);
            const picks = entry.pickDetails.length
                ? entry.pickDetails.map(renderCompactPick).join("")
                : `<span class="muted">Awaiting picks</span>`;
            const rowClasses = ["leaderboard-row"];

            if (participant.id === "cory-pahl") {
                rowClasses.push("leaderboard-row--current");
            }

            if (entry.validation.status === "invalid") {
                rowClasses.push("leaderboard-row--invalid");
            }

            return `
                <tr class="${rowClasses.join(" ")}">
                    <td data-label="Rank"><span class="rank-badge">${entry.rank}</span></td>
                    <td data-label="Fantasy Team">
                        <strong>${escapeHtml(participant.teamName)}</strong>
                        <span class="budget-note">${escapeHtml((participant.owners || []).join(", "))}</span>
                        ${statusBadge}
                    </td>
                    <td data-label="Current Points" class="numeric strong">${entry.totalPoints}</td>
                    <td data-label="Tiebreaker" class="numeric">${entry.tiebreaker}</td>
                    <td data-label="Max Points" class="numeric strong">${entry.maxPossiblePoints}</td>
                    <td data-label="Budget Used">${formatBudget(entry.budgetUsed, entry.remainingBudget)}</td>
                    <td data-label="Picks"><div class="pick-strip">${picks}</div></td>
                </tr>
            `;
        }).join("");
    }

    function renderTeamScores(teamScores) {
        const tbody = document.getElementById("teamScoresBody");
        if (!tbody) {
            return;
        }

        const filteredScores = teamScores.filter((teamScore) => {
            if (!state.teamSearch) {
                return true;
            }

            const haystack = [
                teamScore.team.id,
                teamScore.team.name,
                teamScore.roundReached,
                teamScore.result.notes,
                teamScore.pickedBy.map((pick) => pick.teamName).join(" ")
            ].join(" ").toLowerCase();

            return haystack.includes(state.teamSearch);
        });

        if (!filteredScores.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No teams match that search.</td></tr>`;
            return;
        }

        tbody.innerHTML = filteredScores.map((teamScore) => {
            const result = teamScore.result;
            const pickedByLabel = teamScore.pickedBy.length
                ? `<span class="ownership-note">Picked by ${teamScore.pickedBy.length}</span>`
                : "";

            return `
                <tr>
                    <td data-label="Team">
                        <strong>${escapeHtml(teamScore.team.name)}</strong>
                        <span class="team-code">${escapeHtml(teamScore.team.id)}</span>
                        ${pickedByLabel}
                    </td>
                    <td data-label="Cost" class="numeric">$${Number(teamScore.team.cost)}</td>
                    <td data-label="Wins" class="numeric">${Number(result.groupWins) || 0}</td>
                    <td data-label="Draws" class="numeric">${Number(result.groupDraws) || 0}</td>
                    <td data-label="Goals" class="numeric">${Number(result.goalsFor) || 0}</td>
                    <td data-label="Round Reached">${escapeHtml(teamScore.roundReached)}</td>
                    <td data-label="Points" class="numeric strong">${teamScore.points}</td>
                    <td data-label="Status">${renderTeamStatus(result)}</td>
                </tr>
            `;
        }).join("");
    }

    function renderScoringRules(config) {
        const container = document.getElementById("scoringRules");
        if (!container) {
            return;
        }

        const rows = [
            ["Group stage win", config.groupWin],
            ["Group stage draw", config.groupDraw],
            ["Every goal scored", config.goal],
            ["Reaches Round of 32", config.roundOf32],
            ["Reaches Round of 16", config.roundOf16],
            ["Reaches Quarterfinal", config.quarterfinal],
            ["Reaches Semifinal", config.semifinal],
            ["Reaches Final", config.final],
            ["Wins World Cup", config.worldCupWinner]
        ];

        container.innerHTML = rows.map(([label, points]) => `
            <div>
                <span>${escapeHtml(label)}</span>
                <strong>+${Number(points)}</strong>
            </div>
        `).join("");
    }

    function renderCompactPick(pick) {
        if (!pick.team) {
            return `<span class="pick-chip pick-chip--invalid">${escapeHtml(pick.teamId)}</span>`;
        }

        return `
            <span class="pick-chip ${pick.eliminated ? "pick-chip--eliminated" : ""}">
                ${escapeHtml(pick.team.id)}
                <strong>${pick.score}</strong>
            </span>
        `;
    }

    function renderStatusBadge(validation) {
        if (validation.status === "pending") {
            return `<span class="status-badge status-badge--pending">Awaiting Picks</span>`;
        }

        if (validation.status === "invalid") {
            return `<span class="status-badge status-badge--invalid">Invalid</span>`;
        }

        return `<span class="status-badge status-badge--valid">Valid</span>`;
    }

    function renderTeamStatus(result) {
        if (result.eliminated) {
            return `<span class="status-badge status-badge--eliminated">Eliminated</span>`;
        }

        return `<span class="status-badge status-badge--alive">Alive</span>`;
    }

    function renderFatalError(error) {
        const message = `
            <div class="fatal-error">
                <h2>Could not load contest data</h2>
                <p>${escapeHtml(error.message)}</p>
                <p>Run the site through a local web server, for example: <code>python -m http.server 8000</code>.</p>
            </div>
        `;

        document.querySelector("main").innerHTML = message;
    }

    function formatBudget(used, remaining) {
        const remainingLabel = remaining >= 0 ? `$${remaining} left` : `$${Math.abs(remaining)} over`;
        return `<strong>$${used}</strong><span class="budget-note">${remainingLabel}</span>`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
})();
