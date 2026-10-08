(() => {
  const listConfig = {
    demons: { type: "Demon List", rows: "playerRows", empty: "noPlayers", accounts: true },
    spam: { type: "Spam Challenge List", rows: "spamPlayerRows", empty: "noSpamPlayers", accounts: false },
    platformer: { type: "Platformer List", rows: "platformerPlayerRows", empty: "noPlatformerPlayers", accounts: true },
  };

  let listPointAdjustments = {};
  let submissionPointAwards = [];
  let profilePlayers = [];
  let boards = { demons: [], spam: [], platformer: [] };

  const normalized = (username) => String(username || "").trim().toLowerCase();
  const adjustmentKey = (listType, username) => `${listType}::${normalized(username)}`;
  const pointAdjustment = (listType, username) => {
    const row = listPointAdjustments[adjustmentKey(listType, username)];
    return Number(row?.points_adjustment ?? row ?? 0) || 0;
  };

  function knownPlayers() {
    const players = new Map();
    const add = (username) => {
      const name = String(username || "").trim();
      const key = normalized(name);
      if (key && key !== "community player" && !players.has(key)) players.set(key, name);
    };

    (accounts || []).forEach((account) => add(account.username));
    profilePlayers.forEach(add);
    Object.values(data).flat().forEach((level) => playerRecords(level).forEach((record) => add(record.player)));
    submissionPointAwards.forEach((award) => add(award.username));
    Object.values(listPointAdjustments).forEach((adjustment) => add(adjustment.username));
    Object.values(boards).flat().forEach((player) => add(player.username));
    return [...players.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }

  function makeBoard(listKey) {
    const config = listConfig[listKey];
    const board = new Map();
    const ensurePlayer = (username) => {
      const name = String(username || "").trim();
      const key = normalized(name);
      if (!key || key === "community player") return null;
      if (!board.has(key)) board.set(key, { username: name, points: 0, earnedPoints: 0, recordPoints: 0, submissionPoints: 0, levels: 0, completed: new Set() });
      return board.get(key);
    };

    if (config.accounts) (accounts || []).forEach((account) => ensurePlayer(account.username));

    for (const level of data[listKey] || []) {
      for (const record of playerRecords(level)) {
        const username = String(record.player || "").trim();
        const score = String(record.score || "").trim();
        const isFullCompletion = isFullCompletionScore(score);
        const isTimedPlatformer = listKey === "platformer" && isValidPlatformerTime(String(record.time || "").trim());
        if (!username || username.toLowerCase() === "community player" || /not\s*verified|unverified|incomplete/i.test(score) || !(isFullCompletion || isTimedPlatformer)) continue;
        const entry = ensurePlayer(username);
        const completionKey = `${level.id}:${normalized(username)}`;
        if (entry.completed.has(completionKey)) continue;
        entry.completed.add(completionKey);
        const points = pointsForRank(level.rank);
        entry.earnedPoints += points;
        entry.recordPoints += points;
        entry.levels++;
      }
    }

    for (const award of submissionPointAwards) {
      if (award.list_type !== config.type) continue;
      const entry = ensurePlayer(award.username);
      if (!entry) continue;
      const points = Number(award.points_awarded) || 0;
      entry.earnedPoints += points;
      entry.submissionPoints += points;
    }

    for (const adjustment of Object.values(listPointAdjustments)) {
      if (adjustment.list_type !== config.type || !Number(adjustment.points_adjustment)) continue;
      ensurePlayer(adjustment.username);
    }

    return [...board.values()].map((entry) => {
      const adjustment = pointAdjustment(config.type, entry.username);
      return { ...entry, points: Math.max(0, entry.earnedPoints + adjustment), adjustment };
    }).sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));
  }

  function fillBoard(config, ordered) {
    document.getElementById(config.rows).innerHTML = ordered.map((player, index) => {
      const identity = typeof profileSettingsAvatarMarkup === "function" ? profileSettingsAvatarMarkup(player.username) : escapeHtml(player.username);
      return `<tr><td class="rank ${index < 3 ? "top" : ""}">#${String(index + 1).padStart(2, "0")}</td><td class="player-name"><span class="leaderboard-player">${identity}</span></td><td class="stat-pill">${player.levels}</td><td class="level-points">${player.points.toFixed(1)}</td></tr>`;
    }).join("");
    document.getElementById(config.empty).style.display = ordered.length ? "none" : "block";
  }

  function selectedListKey() {
    const selector = document.getElementById("pointListSelect");
    return selector && listConfig[selector.value] ? selector.value : "demons";
  }

  function populatePointPlayerSelect() {
    const select = document.getElementById("pointPlayerSelect");
    if (!select) return;
    const previous = select.value;
    const listKey = selectedListKey();
    currentPlayerBoard = boards[listKey] || [];
    select.innerHTML = knownPlayers().map(([key, username]) => `<option value="${escapeHtml(key)}">${escapeHtml(username)}</option>`).join("");
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    else if (select.options.length) select.selectedIndex = 0;
    syncPlayerPointsInput();
  }

  function ensurePointEditor() {
    const form = document.getElementById("playerPointsForm");
    if (!form || document.getElementById("pointListSelect")) return;
    const originalRow = form.querySelector(".form-row");
    const playerField = document.getElementById("pointPlayerSelect")?.closest(".field");
    const totalField = document.getElementById("pointTotalInput")?.closest(".field");
    if (!originalRow || !playerField || !totalField) return;

    const listField = document.createElement("div");
    listField.className = "field";
    const label = document.createElement("label");
    label.htmlFor = "pointListSelect";
    label.textContent = "List";
    const listSelect = document.createElement("select");
    listSelect.id = "pointListSelect";
    listSelect.required = true;
    listSelect.innerHTML = '<option value="demons">Demon List · Top Players</option><option value="spam">Spam Challenge List · Top Spammers</option><option value="platformer">Platformer List · Top Platformer Players</option>';
    listField.append(label, listSelect);

    const listRow = document.createElement("div");
    listRow.className = "form-row";
    listRow.append(listField, playerField);
    const totalRow = document.createElement("div");
    totalRow.className = "form-row";
    totalRow.append(totalField);
    originalRow.replaceWith(listRow, totalRow);

    listSelect.addEventListener("change", populatePointPlayerSelect);
    document.getElementById("pointPlayerSelect")?.addEventListener("change", syncPlayerPointsInput);
    form.addEventListener("submit", saveListSpecificPoints, true);
  }

  function syncPlayerPointsInput() {
    const listKey = selectedListKey();
    const config = listConfig[listKey];
    const selectedUsername = document.getElementById("pointPlayerSelect")?.value || "";
    const player = (boards[listKey] || []).find((entry) => normalized(entry.username) === selectedUsername);
    const username = player?.username || knownPlayers().find(([key]) => key === selectedUsername)?.[1] || "";
    const earned = player?.earnedPoints || 0;
    const total = Math.max(0, earned + pointAdjustment(config.type, username));
    const input = document.getElementById("pointTotalInput");
    if (input) input.value = total.toFixed(1);
    const note = document.getElementById("pointAdjustMessage");
    if (note) note.textContent = username ? `Automatically earned on ${config.type}: ${earned.toFixed(1)} points (${(player?.recordPoints || 0).toFixed(1)} from records, ${(player?.submissionPoints || 0).toFixed(1)} from accepted level submissions).` : "";
  }

  async function saveListSpecificPoints(event) {
    if (!event) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!isOwner() || !blgdSupabase) return;

    const listKey = selectedListKey();
    const config = listConfig[listKey];
    const usernameNormalized = document.getElementById("pointPlayerSelect").value;
    const player = knownPlayers().find(([key]) => key === usernameNormalized);
    const targetPoints = Number(document.getElementById("pointTotalInput").value);
    if (!player || !Number.isFinite(targetPoints) || targetPoints < 0 || targetPoints > 1000000) {
      notify("Choose a player and enter a total from 0 to 1,000,000 points.");
      return;
    }

    const boardPlayer = (boards[listKey] || []).find((entry) => normalized(entry.username) === usernameNormalized);
    const earnedPoints = boardPlayer?.earnedPoints || 0;
    const pointsAdjustment = Math.round((targetPoints - earnedPoints) * 10) / 10;
    const { error } = await blgdSupabase.from("player_list_point_adjustments").upsert({
      list_type: config.type,
      username_normalized: usernameNormalized,
      username: player[1],
      points_adjustment: pointsAdjustment,
    }, { onConflict: "list_type,username_normalized" });
    if (error) {
      console.error(error);
      notify(error.message || "Could not save player points for this list.");
      return;
    }

    listPointAdjustments[adjustmentKey(config.type, usernameNormalized)] = {
      list_type: config.type,
      username_normalized: usernameNormalized,
      username: player[1],
      points_adjustment: pointsAdjustment,
    };
    renderLeaderboard();
    populatePointPlayerSelect();
    notify(`${player[1]} points updated for ${config.type} ✓`);
  }

  async function loadPlayerPointAdjustments() {
    if (!blgdSupabase) return;
    const [adjustmentsResult, awardsResult, profilesResult] = await Promise.all([
      blgdSupabase.from("player_list_point_adjustments").select("list_type,username_normalized,username,points_adjustment"),
      blgdSupabase.from("level_submission_point_awards").select("list_type,username_normalized,username,points_awarded"),
      blgdSupabase.from("profiles").select("username"),
    ]);
    if (adjustmentsResult.error) console.error("Could not load list-specific player points", adjustmentsResult.error);
    if (awardsResult.error) console.error("Could not load level submitter points", awardsResult.error);
    if (profilesResult.error) console.error("Could not load player names", profilesResult.error);

    listPointAdjustments = Object.fromEntries((adjustmentsResult.data || []).map((row) => [adjustmentKey(row.list_type, row.username_normalized), row]));
    submissionPointAwards = awardsResult.data || [];
    profilePlayers = (profilesResult.data || []).map((profile) => profile.username).filter(Boolean);
    renderLeaderboard();
  }

  function renderLeaderboard() {
    boards = {
      demons: makeBoard("demons"),
      spam: makeBoard("spam"),
      platformer: makeBoard("platformer"),
    };
    fillBoard(listConfig.demons, boards.demons);
    fillBoard(listConfig.spam, boards.spam);
    fillBoard(listConfig.platformer, boards.platformer);
    const editor = document.getElementById("ownerPointsEditor");
    if (editor) {
      editor.hidden = !isOwner();
      ensurePointEditor();
      populatePointPlayerSelect();
    }
  }

  window.renderLeaderboard = renderLeaderboard;
  window.syncPlayerPointsInput = syncPlayerPointsInput;
  window.loadPlayerPointAdjustments = loadPlayerPointAdjustments;
  renderLeaderboard();
  loadPlayerPointAdjustments().catch(console.error);
})();
