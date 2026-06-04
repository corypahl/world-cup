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
        refreshData(false);
    });

    function bindControls() {
        const refreshButton = document.getElementById("refreshDataButton");
        const teamSearch = document.getElementById("teamSearch");

        if (refreshButton) {
            refreshButton.addEventListener("click", () => refreshData(true));
        }

        if (teamSearch) {
            teamSearch.addEventListener("input", (event) => {
                state.teamSearch = event.target.value.trim().toLowerCase();
                renderTeamScores(state.teamScores);
            });
        }
    }

    async function refreshData(cacheBust) {
        const refreshButton = document.getElementById("refreshDataButton");

        if (refreshButton) {
            refreshButton.disabled = true;
            refreshButton.textContent = cacheBust ? "Refreshing..." : "Loading...";
        }

        try {
            const data = await window.WorldCupDataLoader.loadContestData({ cacheBust });
            state.data = data;
            buildContestState(data);
            renderAll();
        } catch (error) {
            renderFatalError(error);
        } finally {
            if (refreshButton) {
                refreshButton.disabled = false;
                refreshButton.textContent = "Refresh Data";
            }
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
        renderDataStatus();
        renderLeaderboard(state.entries);
        renderMaxPossible(state.entries);
        renderTeamScores(state.teamScores);
        renderScoringRules(state.data.scoringConfig);
    }

    function renderDataStatus() {
        const lastUpdated = document.getElementById("lastUpdated");
        if (!lastUpdated) {
            return;
        }

        const rawTimestamp = state.data.teamResultsMeta.lastUpdated;
        const formatted = rawTimestamp ? formatDate(rawTimestamp) : "Last updated timestamp not set.";
        lastUpdated.textContent = `Last updated: ${formatted}`;
    }

    function renderLeaderboard(entries) {
        const tbody = document.getElementById("leaderboardBody");
        if (!tbody) {
            return;
        }

        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No participants found.</td></tr>`;
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
                    <td><span class="rank-badge">${entry.rank}</span></td>
                    <td>
                        <strong>${escapeHtml(participant.teamName)}</strong>
                        <span class="budget-note">${escapeHtml((participant.owners || []).join(", "))}</span>
                        ${statusBadge}
                    </td>
                    <td class="numeric strong">${entry.totalPoints}</td>
                    <td class="numeric">${entry.tiebreaker}</td>
                    <td>${formatBudget(entry.budgetUsed, entry.remainingBudget)}</td>
                    <td><div class="pick-strip">${picks}</div></td>
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
                    <td>
                        <strong>${escapeHtml(teamScore.team.name)}</strong>
                        <span class="team-code">${escapeHtml(teamScore.team.id)}</span>
                        ${pickedByLabel}
                    </td>
                    <td class="numeric">$${Number(teamScore.team.cost)}</td>
                    <td class="numeric">${Number(result.groupWins) || 0}</td>
                    <td class="numeric">${Number(result.groupDraws) || 0}</td>
                    <td class="numeric">${Number(result.goalsFor) || 0}</td>
                    <td>${escapeHtml(teamScore.roundReached)}</td>
                    <td class="numeric strong">${teamScore.points}</td>
                    <td>${renderTeamStatus(result)}</td>
                </tr>
            `;
        }).join("");
    }

    function renderMaxPossible(entries) {
        const tbody = document.getElementById("maxPossibleBody");
        if (!tbody) {
            return;
        }

        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No participants found.</td></tr>`;
            return;
        }

        const maxEntries = [...entries].sort((a, b) => {
            if (b.maxPossiblePoints !== a.maxPossiblePoints) {
                return b.maxPossiblePoints - a.maxPossiblePoints;
            }

            if (b.totalPoints !== a.totalPoints) {
                return b.totalPoints - a.totalPoints;
            }

            return a.originalIndex - b.originalIndex;
        });

        tbody.innerHTML = maxEntries.map((entry) => {
            const participant = entry.participant;
            const rowClasses = ["max-row"];

            if (participant.id === "cory-pahl") {
                rowClasses.push("max-row--current");
            }

            return `
                <tr class="${rowClasses.join(" ")}">
                    <td>
                        <strong>${escapeHtml(participant.teamName)}</strong>
                        <span class="budget-note">${escapeHtml((participant.owners || []).join(", "))}</span>
                        ${renderStatusBadge(entry.validation)}
                    </td>
                    <td class="numeric strong">${entry.totalPoints}</td>
                    <td class="numeric strong">${entry.maxPossiblePoints}</td>
                    <td class="numeric">${entry.upside}</td>
                    <td>${renderRootingGuide(entry)}</td>
                </tr>
            `;
        }).join("");
    }

    function renderRootingGuide(entry) {
        if (entry.validation.status === "pending") {
            return `<span class="muted">Awaiting picks.</span>`;
        }

        if (entry.validation.status === "invalid") {
            return `<span class="muted">Lineup needs attention before a rooting guide is available.</span>`;
        }

        const validPicks = entry.pickDetails.filter((pick) => pick.team);
        const alivePicks = validPicks
            .filter((pick) => !pick.eliminated)
            .sort((a, b) => {
                if (b.upside !== a.upside) {
                    return b.upside - a.upside;
                }

                return a.team.name.localeCompare(b.team.name);
            });
        const eliminatedPicks = validPicks.filter((pick) => pick.eliminated);

        if (!alivePicks.length) {
            return `<span class="muted">No alive teams remaining.${eliminatedPicks.length ? ` Eliminated: ${escapeHtml(eliminatedPicks.map((pick) => pick.team.id).join(", "))}.` : ""}</span>`;
        }

        const biggestUpside = alivePicks[0];
        const soloPicks = alivePicks.filter((pick) => (state.ownership.get(pick.team.id) || []).length === 1);
        const sharedPicks = alivePicks.filter((pick) => (state.ownership.get(pick.team.id) || []).length > 1);

        return `
            <div class="rooting-guide">
                <div class="rooting-chips">
                    ${alivePicks.map((pick) => `
                        <span class="root-chip">
                            ${escapeHtml(pick.team.id)}
                            <strong>+${pick.upside}</strong>
                        </span>
                    `).join("")}
                </div>
                <p>Root for ${escapeHtml(alivePicks.map((pick) => pick.team.name).join(", "))}.</p>
                <p>Biggest upside: ${escapeHtml(biggestUpside.team.name)} (+${biggestUpside.upside}).</p>
                ${soloPicks.length ? `<p>Solo leverage: ${escapeHtml(soloPicks.map((pick) => pick.team.id).join(", "))}.</p>` : ""}
                ${!soloPicks.length && sharedPicks.length ? `<p>All alive picks are shared with at least one other roster.</p>` : ""}
                ${eliminatedPicks.length ? `<p>Eliminated: ${escapeHtml(eliminatedPicks.map((pick) => pick.team.id).join(", "))}.</p>` : ""}
            </div>
        `;
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

    function formatDate(value) {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(date);
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
