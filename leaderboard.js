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
        renderChalkMeter();
        renderParticipantCards(state.entries);
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

            if (entry.rowIndex < 4) {
                rowClasses.push("leaderboard-row--top-four");
            }

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
                        ${entry.rowIndex < 4 ? `<span class="zone-pill">Draft Advantage Zone</span>` : ""}
                        ${statusBadge}
                    </td>
                    <td>${escapeHtml((participant.owners || []).join(", "))}</td>
                    <td class="numeric strong">${entry.totalPoints}</td>
                    <td class="numeric">${entry.tiebreaker}</td>
                    <td>${formatBudget(entry.budgetUsed, entry.remainingBudget)}</td>
                    <td><div class="pick-strip">${picks}</div></td>
                </tr>
            `;
        }).join("");
    }

    function renderChalkMeter() {
        const container = document.getElementById("chalkMeter");
        if (!container) {
            return;
        }

        const submittedCount = state.data.participants.filter((participant) => (
            Array.isArray(participant.picks) && participant.picks.length > 0
        )).length;

        const pickedTeams = state.teamScores
            .filter((teamScore) => teamScore.pickedBy.length > 0)
            .sort((a, b) => {
                if (b.pickedBy.length !== a.pickedBy.length) {
                    return b.pickedBy.length - a.pickedBy.length;
                }

                return a.team.name.localeCompare(b.team.name);
            });

        if (!pickedTeams.length) {
            container.innerHTML = `<p class="placeholder">Submitted picks will appear here.</p>`;
            return;
        }

        container.innerHTML = pickedTeams.map((teamScore) => {
            const percentage = submittedCount ? Math.round((teamScore.pickedBy.length / submittedCount) * 100) : 0;
            const ownerNames = teamScore.pickedBy.map((pick) => pick.teamName).join(", ");

            return `
                <article class="chalk-item">
                    <div>
                        <strong>${escapeHtml(teamScore.team.name)}</strong>
                        <span>${teamScore.pickedBy.length} roster${teamScore.pickedBy.length === 1 ? "" : "s"} - ${percentage}%</span>
                    </div>
                    <div class="meter" aria-label="${percentage}% ownership">
                        <span style="width: ${percentage}%"></span>
                    </div>
                    <p>${escapeHtml(ownerNames)}</p>
                </article>
            `;
        }).join("");
    }

    function renderParticipantCards(entries) {
        const container = document.getElementById("participantCards");
        if (!container) {
            return;
        }

        container.innerHTML = entries.map((entry) => {
            const participant = entry.participant;
            const cardClasses = ["participant-card", `participant-card--${entry.validation.status}`];

            if (participant.id === "cory-pahl") {
                cardClasses.push("participant-card--current");
            }

            const pickMarkup = entry.pickDetails.length
                ? entry.pickDetails.map(renderPickCard).join("")
                : `<div class="pick-placeholder">No lineup submitted yet.</div>`;

            return `
                <article class="${cardClasses.join(" ")}">
                    <header class="participant-card__header">
                        <div>
                            <h3>${escapeHtml(participant.teamName)}</h3>
                            <p>${escapeHtml((participant.owners || []).join(", "))}</p>
                        </div>
                        ${renderStatusBadge(entry.validation)}
                    </header>

                    <div class="metrics">
                        <div>
                            <span>Total</span>
                            <strong>${entry.totalPoints}</strong>
                        </div>
                        <div>
                            <span>Budget</span>
                            <strong>$${entry.budgetUsed}</strong>
                        </div>
                        <div>
                            <span>Remaining</span>
                            <strong>${entry.remainingBudget >= 0 ? `$${entry.remainingBudget}` : `-$${Math.abs(entry.remainingBudget)}`}</strong>
                        </div>
                        <div>
                            <span>Tiebreaker</span>
                            <strong>${entry.tiebreaker}</strong>
                        </div>
                    </div>

                    ${renderValidationMessages(entry.validation)}

                    <div class="pick-grid">
                        ${pickMarkup}
                    </div>
                </article>
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

    function renderPickCard(pick) {
        if (!pick.team) {
            return `
                <div class="pick-card pick-card--invalid">
                    <strong>${escapeHtml(pick.teamId)}</strong>
                    <span>Unknown team ID</span>
                </div>
            `;
        }

        return `
            <div class="pick-card ${pick.eliminated ? "pick-card--eliminated" : ""}">
                <div>
                    <strong>${escapeHtml(pick.team.name)}</strong>
                    <span>${escapeHtml(pick.team.id)} - $${Number(pick.team.cost)}</span>
                </div>
                <dl>
                    <div>
                        <dt>Score</dt>
                        <dd>${pick.score}</dd>
                    </div>
                    <div>
                        <dt>Goals</dt>
                        <dd>${pick.goals}</dd>
                    </div>
                    <div>
                        <dt>Round</dt>
                        <dd>${escapeHtml(pick.roundReached)}</dd>
                    </div>
                    <div>
                        <dt>Status</dt>
                        <dd>${pick.eliminated ? "Eliminated" : "Alive"}</dd>
                    </div>
                </dl>
            </div>
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

    function renderValidationMessages(validation) {
        if (!validation.errors.length && !validation.warnings.length) {
            return "";
        }

        const messages = [...validation.errors, ...validation.warnings]
            .map((message) => `<li>${escapeHtml(message)}</li>`)
            .join("");

        return `<ul class="validation-list">${messages}</ul>`;
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
