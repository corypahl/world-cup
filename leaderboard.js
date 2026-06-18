(function () {
    const EASTERN_TIME_ZONE = "America/New_York";

    const state = {
        data: null,
        entries: [],
        teamScores: [],
        ownership: new Map(),
        resultMap: new Map(),
        qualificationOdds: new Map(),
        todayMatches: [],
        todayTeamIds: new Set(),
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
        const matches = [...(data.matches || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
        const todayKey = getEasternDateKey(new Date());

        const entries = data.participants.map((participant, originalIndex) => (
            window.WorldCupScoring.calculateParticipantScore(
                { ...participant, originalIndex },
                teamMap,
                resultMap,
                data.scoringConfig
            )
        ));

        state.resultMap = resultMap;
        state.qualificationOdds = window.WorldCupScoring.buildLookup(data.qualificationOdds, "teamId");
        state.entries = window.WorldCupScoring.sortLeaderboard(entries);
        const ranks = window.WorldCupScoring.calculateRanks(state.entries);
        state.entries.forEach((entry, index) => {
            entry.rank = ranks[index];
            entry.rowIndex = index;
        });

        state.ownership = calculateOwnership(data.participants, teamMap);
        state.todayMatches = matches.filter((match) => getEasternDateKey(match.date) === todayKey);
        state.todayTeamIds = new Set(state.todayMatches.flatMap((match) => [match.homeTeamId, match.awayTeamId]));
        state.teamScores = data.teams.map((team) => {
            const result = resultMap.get(team.id) || window.WorldCupScoring.emptyTeamResult(team.id);
            const teamMatches = matches.filter((match) => match.homeTeamId === team.id || match.awayTeamId === team.id);

            return {
                team,
                result,
                points: window.WorldCupScoring.calculateTeamScore(result, data.scoringConfig),
                roundReached: window.WorldCupScoring.getRoundReached(result),
                playsToday: state.todayTeamIds.has(team.id),
                matches: teamMatches,
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
        renderTodayGames();
        renderDailySummary();
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

    function renderTodayGames() {
        const container = document.getElementById("todayGames");
        if (!container) {
            return;
        }

        if (!state.todayMatches.length) {
            container.innerHTML = `<p class="placeholder">No World Cup games today.</p>`;
            return;
        }

        container.innerHTML = state.todayMatches.map((match) => `
            <article class="match-row match-row--today">
                <div class="match-heading">
                    <time class="match-time" datetime="${escapeHtml(match.date)}">${formatMatchTime(match.date)}</time>
                    <span class="match-stage">${escapeHtml(match.stageLabel)}</span>
                </div>
                ${renderTodayMatchTeam(match.awayTeamId)}
                ${renderTodayMatchTeam(match.homeTeamId)}
                ${match.venue ? `<div class="match-meta">${escapeHtml(match.venue)}</div>` : ""}
            </article>
        `).join("");
    }

    function renderTodayMatchTeam(teamId) {
        const pickedBy = state.ownership.get(teamId) || [];
        const participants = pickedBy.length
            ? pickedBy.map(renderMatchParticipant).join("")
            : `<span class="match-picks-empty">Not picked</span>`;

        return `
            <div class="match-team">
                <div class="match-team__identity">
                    <span class="team-code team-code--today">${escapeHtml(teamId)}</span>
                    <span class="qualification-chance">R32 bid ${formatQualificationBid(teamId, state.resultMap.get(teamId))}</span>
                </div>
                <div class="match-picks" aria-label="${escapeHtml(teamId)} picked by">${participants}</div>
            </div>
        `;
    }

    function renderMatchParticipant(pick) {
        const owners = pick.owners && pick.owners.length
            ? ` title="${escapeHtml(pick.owners.join(", "))}"`
            : "";
        return `<span class="participant-chip"${owners}>${escapeHtml(pick.teamName)}</span>`;
    }

    function renderDailySummary() {
        const container = document.getElementById("dailySummary");
        const summary = state.data.dailySummary;

        if (!container) {
            return;
        }

        if (!summary?.generatedAt) {
            container.innerHTML = `<p class="placeholder">The first AI recap will appear after the daily summary workflow runs.</p>`;
            return;
        }

        container.innerHTML = `
            <div class="daily-summary__section daily-summary__impact">
                <h3>Yesterday's Contest Impact</h3>
                <p class="daily-summary__date">Recapping ${formatSummaryDate(summary.recapDate)}</p>
                <p>${escapeHtml(summary.previousDayImpact || "No selected teams created a meaningful contest swing yesterday.")}</p>
            </div>
            <div class="daily-summary__section daily-summary__standings">
                <h3>Leaderboard Movement</h3>
                <p>${escapeHtml(summary.leaderboardSummary)}</p>
            </div>
            <div class="daily-summary__section daily-summary__ahead">
                <h3>Today's Leverage Watch</h3>
                <p>${escapeHtml(summary.leverageWatch || "Today's strongest opportunities for separation will appear after the next recap is generated.")}</p>
            </div>
            <p class="daily-summary__generated">Generated ${formatDate(summary.generatedAt)}</p>
        `;
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
            ? entry.pickDetails.map(renderDetailedPickRow).join("")
            : `<tr><td colspan="4" class="empty-cell">Awaiting picks</td></tr>`;

        return `
            <tr class="detail-row" id="details-${escapeHtml(entry.participant.id)}">
                <td colspan="4" class="detail-cell">
                    <div class="expanded-details">
                        <div class="detail-group detail-group--picks">
                            <table class="participant-team-table">
                                <thead>
                                    <tr>
                                        <th>Team</th>
                                        <th>Points</th>
                                        <th>Record</th>
                                        <th>Goals</th>
                                        <th>R32 Bid</th>
                                    </tr>
                                </thead>
                                <tbody>${picks}</tbody>
                            </table>
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
                teamScore.matches.map((match) => getOpponentName(match, teamScore.team.id)).join(" "),
                teamScore.pickedBy.map((pick) => `${pick.teamName} ${(pick.owners || []).join(" ")}`).join(" ")
            ].join(" ").toLowerCase();

            return haystack.includes(state.teamSearch);
        });

        if (!filteredScores.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No teams match that search.</td></tr>`;
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
                        <span class="${getTeamCodeClasses(result, teamScore.playsToday)}">${escapeHtml(teamScore.team.id)}</span>
                    </td>
                    <td data-label="Points" class="numeric strong">${teamScore.points}</td>
                    <td data-label="R32 Bid" class="numeric strong">${formatQualificationBid(teamScore.team.id, result)}</td>
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
                <td colspan="4" class="detail-cell">
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
                        ${renderTeamSchedule(teamScore)}
                    </div>
                </td>
            </tr>
        `;
    }

    function renderTeamSchedule(teamScore) {
        const previousMatches = teamScore.matches.filter((match) => match.completed);
        const upcomingMatches = teamScore.matches.filter((match) => !match.completed);

        return `
            <div class="detail-group detail-group--schedule">
                <span class="detail-label">Previous Results</span>
                ${renderMatchGroup(previousMatches, teamScore.team.id, "No completed games yet.")}
            </div>
            <div class="detail-group detail-group--schedule">
                <span class="detail-label">Upcoming Schedule</span>
                ${renderMatchGroup(upcomingMatches, teamScore.team.id, "No upcoming games listed.")}
            </div>
        `;
    }

    function renderMatchGroup(matches, teamId, emptyText) {
        if (!matches.length) {
            return `<p class="placeholder">${escapeHtml(emptyText)}</p>`;
        }

        return `
            <div class="team-schedule-list">
                ${matches.map((match) => renderTeamMatch(match, teamId)).join("")}
            </div>
        `;
    }

    function renderTeamMatch(match, teamId) {
        const opponentName = getOpponentName(match, teamId);
        const score = formatMatchScore(match);
        const result = match.completed ? getTeamMatchResult(match, teamId) : formatMatchTime(match.date);

        return `
            <div class="team-schedule-item ${getEasternDateKey(match.date) === getEasternDateKey(new Date()) ? "team-schedule-item--today" : ""}">
                <span class="schedule-date">${formatShortDate(match.date)}</span>
                <span class="schedule-opponent">vs ${escapeHtml(opponentName)}</span>
                <strong>${escapeHtml(match.completed ? result : score || result)}</strong>
            </div>
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

    function renderDetailedPickRow(pick) {
        if (!pick.team) {
            return `
                <tr>
                    <td><span class="pick-chip pick-chip--invalid">${escapeHtml(pick.teamId)}</span></td>
                    <td class="numeric">0</td>
                    <td class="numeric">0-0-0</td>
                    <td class="numeric">0</td>
                </tr>
            `;
        }

        const classes = ["pick-chip"];
        if (state.todayTeamIds.has(pick.team.id)) {
            classes.push("pick-chip--today");
        } else if (pick.eliminated) {
            classes.push("pick-chip--eliminated");
        } else if (pick.result.reachedRoundOf32) {
            classes.push("pick-chip--clinched");
        } else {
            classes.push("pick-chip--group-active");
        }

        return `
            <tr>
                <td><span class="${classes.join(" ")}">${escapeHtml(pick.team.name)}</span></td>
                <td class="numeric strong">${pick.score}</td>
                <td class="numeric">${formatRecord(pick.result)}</td>
                <td class="numeric">${pick.goals}</td>
                <td class="numeric strong">${formatQualificationBid(pick.team.id, pick.result)}</td>
            </tr>
        `;
    }

    function formatQualificationBid(teamId, result) {
        const rawYesBid = state.qualificationOdds.get(teamId)?.yesBidPercent;
        const yesBidPercent = rawYesBid === null || rawYesBid === undefined
            ? null
            : Number(rawYesBid);
        if (Number.isFinite(yesBidPercent)) {
            return `${yesBidPercent}%`;
        }

        if (result?.reachedRoundOf32) {
            return "100%";
        }

        if (result?.eliminated) {
            return "0%";
        }

        return "—";
    }

    function renderTeamStatus(result) {
        if (result.eliminated) {
            return `<span class="status-badge status-badge--eliminated">Eliminated</span>`;
        }

        return `<span class="status-badge status-badge--alive">Alive</span>`;
    }

    function getTeamCodeClasses(result, playsToday) {
        const classes = ["team-code"];

        if (playsToday) {
            classes.push("team-code--today");
        } else if (result.eliminated) {
            classes.push("team-code--eliminated");
        } else if (result.reachedRoundOf32) {
            classes.push("team-code--clinched");
        } else {
            classes.push("team-code--group-active");
        }

        return classes.join(" ");
    }

    function getOpponentName(match, teamId) {
        return match.homeTeamId === teamId ? match.awayTeamName : match.homeTeamName;
    }

    function formatMatchScore(match) {
        if (match.homeScore === null || match.awayScore === null || match.homeScore === undefined || match.awayScore === undefined) {
            return "";
        }

        return `${Number(match.awayScore)}-${Number(match.homeScore)}`;
    }

    function getTeamMatchResult(match, teamId) {
        const teamScore = match.homeTeamId === teamId ? Number(match.homeScore) : Number(match.awayScore);
        const opponentScore = match.homeTeamId === teamId ? Number(match.awayScore) : Number(match.homeScore);

        if (teamScore > opponentScore) {
            return `W ${teamScore}-${opponentScore}`;
        }

        if (teamScore < opponentScore) {
            return `L ${teamScore}-${opponentScore}`;
        }

        return `D ${teamScore}-${opponentScore}`;
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

    function getEasternDateKey(value) {
        const date = value instanceof Date ? value : new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: EASTERN_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(date).reduce((all, part) => {
            all[part.type] = part.value;
            return all;
        }, {});

        return `${parts.year}-${parts.month}-${parts.day}`;
    }

    function formatMatchTime(value) {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat(undefined, {
            timeZone: EASTERN_TIME_ZONE,
            hour: "numeric",
            minute: "2-digit"
        }).format(date);
    }

    function formatShortDate(value) {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat(undefined, {
            timeZone: EASTERN_TIME_ZONE,
            month: "short",
            day: "numeric"
        }).format(date);
    }

    function formatSummaryDate(value) {
        if (!value) {
            return "the previous day";
        }

        const date = new Date(`${value}T12:00:00-04:00`);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat(undefined, {
            timeZone: EASTERN_TIME_ZONE,
            month: "long",
            day: "numeric"
        }).format(date);
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
