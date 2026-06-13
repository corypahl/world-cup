(function () {
    const state = {
        data: null,
        entries: [],
        teamScores: [],
        ownership: new Map(),
        expandedParticipantId: null,
        expandedTeamId: null,
        teamSearch: ""
    };

    document.addEventListener("DOMContentLoaded", () => {
        bindControls();
        refreshData();
    });

    function bindControls() {
        const leaderboardBody = document.getElementById("leaderboardBody");
        const teamScoresBody = document.getElementById("teamScoresBody");
        const teamSearch = document.getElementById("teamSearch");

        if (leaderboardBody) {
            leaderboardBody.addEventListener("click", (event) => {
                const row = event.target.closest(".leaderboard-row");
                if (!row) {
                    return;
                }

                toggleLeaderboardRow(row.dataset.participantId);
            });

            leaderboardBody.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }

                const row = event.target.closest(".leaderboard-row");
                if (!row) {
                    return;
                }

                event.preventDefault();
                toggleLeaderboardRow(row.dataset.participantId);
            });
        }

        if (teamScoresBody) {
            teamScoresBody.addEventListener("click", (event) => {
                const row = event.target.closest(".team-row");
                if (!row) {
                    return;
                }

                toggleTeamRow(row.dataset.teamId);
            });

            teamScoresBody.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }

                const row = event.target.closest(".team-row");
                if (!row) {
                    return;
                }

                event.preventDefault();
                toggleTeamRow(row.dataset.teamId);
            });
        }

        if (teamSearch) {
            teamSearch.addEventListener("input", (event) => {
                state.teamSearch = event.target.value.trim().toLowerCase();
                renderTeamScores(state.teamScores);
            });
        }
    }

    function toggleLeaderboardRow(participantId) {
        state.expandedParticipantId = state.expandedParticipantId === participantId ? null : participantId;
        renderLeaderboard(state.entries);
    }

    function toggleTeamRow(teamId) {
        state.expandedTeamId = state.expandedTeamId === teamId ? null : teamId;
        renderTeamScores(state.teamScores);
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

            if (b.pickedBy.length !== a.pickedBy.length) {
                return b.pickedBy.length - a.pickedBy.length;
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
        renderTeamScores(state.teamScores);
        renderScoringRules(state.data.scoringConfig);
    }

    function renderDataStatus() {
        const lastUpdated = document.getElementById("lastUpdated");
        if (!lastUpdated) {
            return;
        }

        const rawTimestamp = state.data.teamResultsMeta.lastUpdated;
        const formatted = rawTimestamp ? formatDate(rawTimestamp) : "Not updated yet";
        lastUpdated.textContent = `Last updated at: ${formatted}`;
    }

    function renderLeaderboard(entries) {
        const tbody = document.getElementById("leaderboardBody");
        if (!tbody) {
            return;
        }

        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No participants found.</td></tr>`;
            return;
        }

        tbody.innerHTML = entries.map((entry) => {
            const participant = entry.participant;
            const isExpanded = state.expandedParticipantId === participant.id;
            const rowClasses = ["leaderboard-row"];

            if (entry.validation.status === "invalid") {
                rowClasses.push("leaderboard-row--invalid");
            }

            if (isExpanded) {
                rowClasses.push("leaderboard-row--expanded");
            }

            return `
                <tr class="${rowClasses.join(" ")}" data-participant-id="${escapeHtml(participant.id)}" tabindex="0" role="button" aria-expanded="${isExpanded}" aria-controls="details-${escapeHtml(participant.id)}">
                    <td data-label="Rank"><span class="rank-badge">${entry.rank}</span></td>
                    <td data-label="Names">
                        <strong>${escapeHtml(participant.teamName)}</strong>
                        <span class="budget-note">${escapeHtml((participant.owners || []).join(", "))}</span>
                    </td>
                    <td data-label="Score" class="numeric strong leaderboard-score">
                        ${entry.totalPoints}
                        <span class="row-cue" aria-hidden="true">${isExpanded ? "Close" : "View"}</span>
                    </td>
                    <td data-label="Remaining" class="numeric strong">${entry.remainingTeams}</td>
                </tr>
                ${isExpanded ? renderLeaderboardDetails(entry) : ""}
            `;
        }).join("");
    }

    function renderLeaderboardDetails(entry) {
        const picks = entry.pickDetails.length
            ? entry.pickDetails.map(renderDetailedPick).join("")
            : `<span class="muted">Awaiting picks</span>`;

        return `
            <tr class="detail-row" id="details-${escapeHtml(entry.participant.id)}">
                <td colspan="4" class="detail-cell">
                    <div class="expanded-details">
                        <div class="detail-group detail-group--picks">
                            <span class="detail-label">Teams</span>
                            <div class="pick-strip">${picks}</div>
                        </div>
                        <div class="detail-stat">
                            <span class="detail-label">Tiebreaker</span>
                            <strong>${entry.tiebreaker}</strong>
                        </div>
                    </div>
                </td>
            </tr>
        `;
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
                teamScore.pickedBy.map((pick) => `${pick.teamName} ${(pick.owners || []).join(" ")}`).join(" ")
            ].join(" ").toLowerCase();

            return haystack.includes(state.teamSearch);
        });

        if (!filteredScores.length) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">No teams match that search.</td></tr>`;
            return;
        }

        tbody.innerHTML = filteredScores.map((teamScore) => {
            const result = teamScore.result;
            const isExpanded = state.expandedTeamId === teamScore.team.id;
            const rowClasses = ["team-row"];

            if (isExpanded) {
                rowClasses.push("team-row--expanded");
            }

            return `
                <tr class="${rowClasses.join(" ")}" data-team-id="${escapeHtml(teamScore.team.id)}" tabindex="0" role="button" aria-expanded="${isExpanded}" aria-controls="team-details-${escapeHtml(teamScore.team.id)}">
                    <td data-label="Team">
                        <span class="team-code ${result.eliminated ? "team-code--eliminated" : "team-code--active"}">${escapeHtml(teamScore.team.id)}</span>
                    </td>
                    <td data-label="Points" class="numeric strong">${teamScore.points}</td>
                    <td data-label="Picked By" class="numeric strong">${teamScore.pickedBy.length}</td>
                </tr>
                ${isExpanded ? renderTeamDetails(teamScore) : ""}
            `;
        }).join("");
    }

    function renderTeamDetails(teamScore) {
        const result = teamScore.result;
        const pickedBy = teamScore.pickedBy.length
            ? teamScore.pickedBy.map(renderPickedBy).join("")
            : `<span class="muted">Not picked</span>`;

        return `
            <tr class="detail-row" id="team-details-${escapeHtml(teamScore.team.id)}">
                <td colspan="3" class="detail-cell">
                    <div class="expanded-details team-details">
                        <div class="detail-group detail-group--picks">
                            <span class="detail-label">Team</span>
                            <strong>${escapeHtml(teamScore.team.name)}</strong>
                            ${renderTeamStatus(result)}
                        </div>
                        <div class="detail-stat">
                            <span class="detail-label">Cost</span>
                            <strong>$${Number(teamScore.team.cost)}</strong>
                        </div>
                        <div class="detail-stat">
                            <span class="detail-label">Record</span>
                            <strong>${formatRecord(result)}</strong>
                        </div>
                        <div class="detail-stat">
                            <span class="detail-label">Goals</span>
                            <strong>${Number(result.goalsFor) || 0}</strong>
                        </div>
                        <div class="detail-stat">
                            <span class="detail-label">Round</span>
                            <strong>${escapeHtml(teamScore.roundReached)}</strong>
                        </div>
                        <div class="detail-group detail-group--picks detail-group--picked-by">
                            <span class="detail-label">Picked By</span>
                            <div class="pick-strip">${pickedBy}</div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }

    function renderPickedBy(pick) {
        const owners = pick.owners && pick.owners.length ? ` (${pick.owners.join(", ")})` : "";
        return `<span class="pick-chip">${escapeHtml(pick.teamName)}${escapeHtml(owners)}</span>`;
    }

    function formatRecord(result) {
        return [
            Number(result.groupWins) || 0,
            Number(result.groupLosses) || 0,
            Number(result.groupDraws) || 0
        ].join("-");
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

    function renderDetailedPick(pick) {
        if (!pick.team) {
            return `<span class="pick-chip pick-chip--invalid">${escapeHtml(pick.teamId)}</span>`;
        }

        return `
            <span class="pick-chip ${pick.eliminated ? "pick-chip--eliminated" : ""}">
                ${escapeHtml(pick.team.name)}
                <strong>${pick.score}</strong>
            </span>
        `;
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
