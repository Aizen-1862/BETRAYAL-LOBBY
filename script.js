
/* ==========================================================
   BETRAYAL LOBBY — GAME ENGINE
   Local pass-and-play + Firebase online multiplayer
   ========================================================== */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const homeScreen = $("homeScreen");
  const lobbyScreen = $("lobbyScreen");
  const notice = $("notice");
  const actionArea = $("actionArea");
  const playerList = $("playerList");
  const roleBox = $("roleBox");

  const firebaseConfig = {
    apiKey: "PASTE_YOUR_FIREBASE_API_KEY",
    authDomain: "PASTE_YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "PASTE_YOUR_DATABASE_URL",
    projectId: "PASTE_YOUR_PROJECT_ID",
    appId: "PASTE_YOUR_FIREBASE_APP_ID"
  };

  const configReady =
    firebaseConfig.apiKey !== "PASTE_YOUR_FIREBASE_API_KEY" &&
    firebaseConfig.projectId !== "PASTE_YOUR_PROJECT_ID" &&
    firebaseConfig.databaseURL !== "PASTE_YOUR_DATABASE_URL" &&
    firebaseConfig.appId !== "PASTE_YOUR_FIREBASE_APP_ID";

  let auth = null;
  let db = null;
  let currentUser = null;
  let mode = "none";
  let roomCode = "";
  let roomRef = null;
  let subscriptions = [];
  let publicState = null;
  let onlinePlayers = {};
  let myRole = null;
  let myVote = "";
  let hostRoleMap = {};
  let working = false;

  let localGame = null;
  let localRevealed = false;
  let localVoteIndex = 0;
  let localVoteChoice = "";
  let localResult = null;

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function showNotice(message, isError = false) {
    notice.textContent = message;
    notice.classList.remove("hidden", "error");
    if (isError) notice.classList.add("error");
  }

  function hideNotice() {
    notice.classList.add("hidden");
  }

  function setBusy(busy) {
    working = busy;
    [
      "localButton",
      "createButton",
      "joinButton",
      "startButton",
      "leaveButton"
    ].forEach((id) => {
      const element = $(id);
      if (element) element.disabled = busy;
    });
  }

  function playerName() {
    const name = $("playerName").value.trim().slice(0, 18);
    return name || "Operative";
  }

  function setScreen(screen) {
    homeScreen.classList.toggle("hidden", screen !== "home");
    lobbyScreen.classList.toggle("hidden", screen !== "lobby");
  }

  function setConnection(text, online = false) {
    $("connectionStatus").textContent = text;
    const dot = document.querySelector(".connection-dot");
    dot.style.background = online ? "#69efb0" : "#a58bff";
    dot.style.boxShadow = online
      ? "0 0 9px #69efb0"
      : "0 0 9px #a58bff";
  }

  function showRole(role) {
    myRole = role;
    if (!role) {
      roleBox.classList.add("hidden");
      return;
    }

    roleBox.classList.remove("hidden");

    const isTraitor = role === "saboteur";
    $("roleTitle").textContent = isTraitor ? "SABOTEUR" : "CREW MEMBER";
    $("roleTitle").style.color = isTraitor ? "#ff6585" : "#5cf2e8";
    $("roleDescription").textContent = isTraitor
      ? "Your objective: survive the vote. Blend in, cast suspicion elsewhere, and avoid being eliminated."
      : "Your objective: identify the saboteur. Watch the discussion, compare suspicions, and vote carefully.";
  }

  function renderPlayers(players, hostUid) {
    const entries = Object.entries(players || {});
    $("playerCount").textContent =
      entries.length + (entries.length === 1 ? " PLAYER" : " PLAYERS");

    if (!entries.length) {
      playerList.innerHTML =
        '<p class="lobby-hint">No players have joined yet.</p>';
      return;
    }

    playerList.innerHTML = entries.map(([uid, player], index) => {
      const isHost = uid === hostUid;
      const isOut = player.alive === false;

      return `
        <div class="player-row">
          <div class="player-info">
            <div class="player-avatar">${escapeHTML(
              (player.name || "?").slice(0, 1).toUpperCase()
            )}</div>
            <div>
              <div class="player-name">${escapeHTML(player.name || "Operative")}</div>
              <div class="player-meta">${isOut ? "ELIMINATED" : "OPERATIVE " + String(index + 1).padStart(2, "0")}</div>
            </div>
          </div>
          ${isHost ? '<span class="host-tag">HOST</span>' : ""}
        </div>`;
    }).join("");
  }

  function clearSubscriptions() {
    subscriptions.forEach((unsubscribe) => {
      try { unsubscribe(); } catch (_) {}
    });
    subscriptions = [];

    if (roomRef) {
      roomRef.off();
    }

    roomRef = null;
  }

  function generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";

    for (let i = 0; i < 6; i++) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    return result;
  }

  function requireFirebase() {
    if (!configReady || !window.firebase) {
      showNotice(
        "Online mode is not configured yet. Complete the Firebase setup first. Local mode works without it.",
        true
      );
      return false;
    }

    return true;
  }

  async function initializeFirebase() {
    if (!requireFirebase()) return false;

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      auth = firebase.auth();
      db = firebase.database();

      if (!currentUser) {
        const credential = await auth.signInAnonymously();
        currentUser = credential.user;
      }

      setConnection("ONLINE READY", true);
      return true;
    } catch (error) {
      console.error(error);
      showNotice(
        "Firebase connection failed. Check your project settings, anonymous sign-in, and database rules.",
        true
      );
      return false;
    }
  }

  async function createOnlineRoom() {
    if (working) return;
    setBusy(true);

    try {
      if (!(await initializeFirebase())) return;

      mode = "online";
      const uid = currentUser.uid;
      roomCode = generateRoomCode();
      roomRef = db.ref("rooms/" + roomCode);

      const initialData = {
        public: {
          hostUid: uid,
          phase: "lobby",
          createdAt: Date.now(),
          message: "Waiting for players"
        },
        players: {
          [uid]: {
            name: playerName(),
            alive: true,
            joinedAt: Date.now()
          }
        }
      };

      await roomRef.set(initialData);
      attachRoomListeners();

      $("roomCodeDisplay").textContent = roomCode;
      setScreen("lobby");
      showNotice("Room created! Share the code with your friends.");
      renderOnline();
    } catch (error) {
      console.error(error);
      showNotice("Could not create the room. Check your database rules and try again.", true);
      clearSubscriptions();
    } finally {
      setBusy(false);
    }
  }

  async function joinOnlineRoom() {
    if (working) return;
    setBusy(true);

    try {
      if (!(await initializeFirebase())) return;

      const requestedCode = $("roomCode").value.trim().toUpperCase();

      if (!/^[A-Z0-9]{6}$/.test(requestedCode)) {
        showNotice("Enter a valid six-character room code.", true);
        return;
      }

      const ref = db.ref("rooms/" + requestedCode);
      const snapshot = await ref.child("public").get();

      if (!snapshot.exists()) {
        showNotice("That room doesn't exist. Check the code and try again.", true);
        return;
      }

      const publicData = snapshot.val();

      if (publicData.phase !== "lobby") {
        showNotice("That game has already started. Join a room waiting for players.", true);
        return;
      }

      const playersSnapshot = await ref.child("players").get();
      const players = playersSnapshot.val() || {};

      if (Object.keys(players).length >= 10) {
        showNotice("This room is full. The maximum is 10 players.", true);
        return;
      }

      mode = "online";
      roomCode = requestedCode;
      roomRef = ref;

      await ref.child("players/" + currentUser.uid).set({
        name: playerName(),
        alive: true,
        joinedAt: Date.now()
      });

      attachRoomListeners();
      $("roomCodeDisplay").textContent = roomCode;
      setScreen("lobby");
      showNotice("Joined room " + roomCode + ".");
      renderOnline();
    } catch (error) {
      console.error(error);
      showNotice("Couldn't join. Check your connection and database rules.", true);
      clearSubscriptions();
    } finally {
      setBusy(false);
    }
  }

  function attachRoomListeners() {
    clearSubscriptions();

    roomRef = db.ref("rooms/" + roomCode);

    const publicRef = roomRef.child("public");
    const playersRef = roomRef.child("players");
    const roleRef = roomRef.child("roles/" + currentUser.uid);
    const voteRef = roomRef.child("votes/" + currentUser.uid);

    const publicCallback = publicRef.on("value", (snapshot) => {
      publicState = snapshot.val();
      if (!publicState) return;
      renderOnline();
    });

    const playersCallback = playersRef.on("value", (snapshot) => {
      onlinePlayers = snapshot.val() || {};
      renderOnline();
    });

    const roleCallback = roleRef.on("value", (snapshot) => {
      myRole = snapshot.val() || null;
      renderOnline();
    });

    const voteCallback = voteRef.on("value", (snapshot) => {
      myVote = snapshot.val() || "";
      renderOnline();
    });

    subscriptions.push(() => publicRef.off("value", publicCallback));
    subscriptions.push(() => playersRef.off("value", playersCallback));
    subscriptions.push(() => roleRef.off("value", roleCallback));
    subscriptions.push(() => voteRef.off("value", voteCallback));

    setConnection("CONNECTED · " + roomCode, true);
  }

  function isHost() {
    return Boolean(
      mode === "online" &&
      currentUser &&
      publicState &&
      publicState.hostUid === currentUser.uid
    );
  }

  function alivePlayers() {
    return Object.entries(onlinePlayers).filter(([, player]) => player.alive !== false);
  }

  function onlineActionButton(label, action, primary = true) {
    return `<button type="button" class="button ${primary ? "button-primary" : "button-secondary"}" data-action="${action}">${label}</button>`;
  }

  function renderOnline() {
    if (mode !== "online" || !publicState) return;

    $("roomCodeDisplay").textContent = roomCode;
    $("phaseBadge").textContent = String(publicState.phase || "lobby").toUpperCase();
    $("lobbyTitle").textContent =
      publicState.phase === "lobby" ? "Waiting for players" : "The game is on";

    renderPlayers(onlinePlayers, publicState.hostUid);
    showRole(myRole);

    const host = isHost();
    const phase = publicState.phase;
    const me = onlinePlayers[currentUser.uid];

    if (!me) {
      actionArea.innerHTML = "";
      $("lobbyHint").textContent = "Your player entry is missing. Leave and rejoin.";
      return;
    }

    if (me.alive === false) {
      actionArea.innerHTML = "";
      $("lobbyHint").textContent = "You've been eliminated. You can watch the rest of this game.";
      return;
    }

    if (phase === "lobby") {
      roleBox.classList.add("hidden");
      actionArea.innerHTML = host
        ? onlineActionButton("START GAME", "start-online") +
          '<p class="action-title">At least 3 players are required.</p>'
        : "";
      $("lobbyHint").textContent = host
        ? "Share the room code. Start when everyone has joined."
        : "Waiting for the host to start the game.";
    } else if (phase === "discussion") {
      actionArea.innerHTML = host
        ? onlineActionButton("START VOTING", "vote-phase")
        : "";
      $("lobbyHint").textContent = "Discuss who seems suspicious. The host starts the vote when ready.";
    } else if (phase === "voting") {
      actionArea.innerHTML = renderVoteOptions(alivePlayers(), currentUser.uid, myVote);
      $("lobbyHint").textContent = myVote
        ? "Your vote is submitted. You cannot change it."
        : "Choose one living player to vote for.";
      if (host) {
        actionArea.innerHTML += onlineActionButton("RESOLVE VOTES", "resolve-votes", false);
      }
    } else if (phase === "results") {
      actionArea.innerHTML = host
        ? onlineActionButton("NEXT VOTE", "next-vote") +
          onlineActionButton("END GAME", "end-game", false)
        : "";
      $("lobbyHint").textContent = publicState.message || "Vote resolved.";
    } else if (phase === "finished") {
      actionArea.innerHTML = host
        ? onlineActionButton("RETURN TO LOBBY", "reset-game")
        : "";
      $("lobbyHint").textContent = publicState.message || "Game over.";
    }
  }

  function renderVoteOptions(players, ownUid, selectedVote) {
    const targets = players.filter(([uid]) => uid !== ownUid);

    if (!targets.length) {
      return '<p class="action-title">No other living players to vote for.</p>';
    }

    return `
      <p class="action-title">Who do you suspect?</p>
      <div class="vote-list">
        ${targets.map(([uid, player]) => `
          <button type="button" class="vote-option ${selectedVote === uid ? "selected" : ""}"
            data-vote-target="${escapeHTML(uid)}" ${selectedVote ? "disabled" : ""}>
            <strong>${escapeHTML(player.name)}</strong>
            <span class="vote-label">${selectedVote === uid ? "VOTE SUBMITTED" : "SELECT"}</span>
          </button>
        `).join("")}
      </div>`;
  }

  async function startOnlineGame() {
    if (!isHost()) return;

    const entries = alivePlayers();

    if (entries.length < 3) {
      showNotice("You need at least 3 players to start.", true);
      return;
    }

    try {
      const roleMap = {};
      const shuffled = entries.map(([uid]) => uid).sort(() => Math.random() - 0.5);

      shuffled.forEach((uid, index) => {
        roleMap[uid] = index === 0 ? "saboteur" : "crew";
      });

      hostRoleMap = roleMap;

      const updates = {};
      for (const [uid, role] of Object.entries(roleMap)) {
        updates["roles/" + uid] = role;
      }

      updates["votes"] = null;
      updates["public/phase"] = "discussion";
      updates["public/message"] = "Find the saboteur.";

      await roomRef.update(updates);
      showNotice("Roles assigned. Check your secret role!");
    } catch (error) {
      console.error(error);
      showNotice("Couldn't start the game. Check your database rules.", true);
    }
  }

  async function startVoting() {
    if (!isHost()) return;

    try {
      await roomRef.child("votes").remove();
      await roomRef.child("public").update({
        phase: "voting",
        message: "Voting is open."
      });
    } catch (error) {
      console.error(error);
      showNotice("Couldn't open voting.", true);
    }
  }

  async function castVote(targetUid) {
    if (mode !== "online" || !currentUser || !publicState) return;
    if (publicState.phase !== "voting" || myVote) return;

    const me = onlinePlayers[currentUser.uid];
    const target = onlinePlayers[targetUid];

    if (!me || me.alive === false || !target || target.alive === false) {
      showNotice("That vote is no longer valid.", true);
      return;
    }

    try {
      await roomRef.child("votes/" + currentUser.uid).set(targetUid);
      showNotice("Vote submitted.");
    } catch (error) {
      console.error(error);
      showNotice("Vote failed. Check your connection.", true);
    }
  }

  async function resolveVotes() {
    if (!isHost()) return;

    try {
      const votesSnapshot = await roomRef.child("votes").get();
      const votes = votesSnapshot.val() || {};
      const voters = alivePlayers().map(([uid]) => uid);
      const validVotes = Object.entries(votes).filter(([voter, target]) =>
        voters.includes(voter) &&
        voters.includes(target) &&
        voter !== target
      );

      if (validVotes.length < voters.length) {
        showNotice("Not everyone has voted yet. You can resolve the vote anyway.", true);
      }

      const tally = {};
      validVotes.forEach(([, target]) => {
        tally[target] = (tally[target] || 0) + 1;
      });

      const maxVotes = Math.max(0, ...Object.values(tally));
      const leaders = Object.keys(tally).filter((uid) => tally[uid] === maxVotes);
      const eliminatedUid = maxVotes > 0 && leaders.length === 1 ? leaders[0] : null;

      let message = "It's a tie. Nobody was eliminated.";
      if (eliminatedUid) {
        const eliminatedName = onlinePlayers[eliminatedUid]?.name || "A player";
        message = eliminatedName + " was eliminated.";
        await roomRef.child("players/" + eliminatedUid + "/alive").set(false);
      }

      // Host reads role data to determine the outcome.
      const rolesSnapshot = await roomRef.child("roles").get();
      const roles = rolesSnapshot.val() || {};
      const survivors = alivePlayers().filter(([uid]) => uid !== eliminatedUid);
      const saboteurs = survivors.filter(([uid]) => roles[uid] === "saboteur").length;
      const crew = survivors.length - saboteurs;

      let phase = "results";
      if (eliminatedUid && roles[eliminatedUid] === "saboteur") {
        phase = "finished";
        message += " The saboteur was caught. CREW WINS!";
      } else if (saboteurs > 0 && saboteurs >= crew) {
        phase = "finished";
        message += " The saboteur has taken control. SABOTEUR WINS!";
      }

      await roomRef.child("public").update({
        phase,
        message,
        lastEliminated: eliminatedUid || ""
      });

      showNotice(message);
    } catch (error) {
      console.error(error);
      showNotice("Couldn't resolve votes. Check the database rules.", true);
    }
  }

  async function nextVote() {
    if (!isHost()) return;

    try {
      await roomRef.child("votes").remove();
      await roomRef.child("public").update({
        phase: "discussion",
        message: "Discuss again, then vote."
      });
    } catch (error) {
      console.error(error);
      showNotice("Couldn't start the next round.", true);
    }
  }

  async function endOnlineGame() {
    if (!isHost()) return;
    await roomRef.child("public").update({
      phase: "finished",
      message: "The host ended the game."
    });
  }

  async function resetOnlineGame() {
    if (!isHost()) return;

    try {
      const players = onlinePlayers;
      const updates = {
        "public/phase": "lobby",
        "public/message": "Waiting for players",
        "votes": null,
        "roles": null
      };

      Object.keys(players).forEach((uid) => {
        updates["players/" + uid + "/alive"] = true;
      });

      await roomRef.update(updates);
      hostRoleMap = {};
      myRole = null;
      myVote = "";
      showRole(null);
      showNotice("Room reset. Invite your friends for another game.");
    } catch (error) {
      console.error(error);
      showNotice("Couldn't reset the room.", true);
    }
  }

  // ---------------- LOCAL PASS-AND-PLAY ----------------

  function startLocalGame() {
    const namesInput = prompt(
      "Enter at least 3 player names separated by commas.\nExample: Alex, Sam, Jordan"
    );

    if (!namesInput) return;

    const names = namesInput.split(",")
      .map((name) => name.trim().slice(0, 18))
      .filter(Boolean)
      .slice(0, 10);

    if (names.length < 3) {
      showNotice("Local games need at least 3 players.", true);
      return;
    }

    const shuffled = names.map((name, index) => ({
      uid: "local-" + index,
      name,
      alive: true,
      role: "crew"
    })).sort(() => Math.random() - 0.5);

    shuffled[0].role = "saboteur";

    localGame = {
      players: shuffled,
      phase: "reveal",
      revealIndex: 0,
      voteIndex: 0,
      votes: {},
      result: "",
      code: "LOCAL"
    };

    localRevealed = false;
    localVoteIndex = 0;
    localVoteChoice = "";
    localResult = null;
    mode = "local";

    clearSubscriptions();
    setConnection("LOCAL PASS-AND-PLAY", false);
    $("roomCodeDisplay").textContent = "LOCAL";
    $("phaseBadge").textContent = "ROLE REVEAL";
    $("lobbyTitle").textContent = "Pass the device";
    setScreen("lobby");
    hideNotice();
    renderLocal();
  }

  function renderLocal() {
    if (mode !== "local" || !localGame) return;

    renderPlayers(
      Object.fromEntries(localGame.players.map((p) => [p.uid, p])),
      null
    );

    roleBox.classList.add("hidden");

    const alive = localGame.players.filter((p) => p.alive);

    if (localGame.phase === "reveal") {
      const player = localGame.players[localGame.revealIndex];
      $("phaseBadge").textContent = "ROLE REVEAL";
      $("lobbyTitle").textContent = "Pass the device";

      if (!player) {
        localGame.phase = "discussion";
        renderLocal();
        return;
      }

      if (!localRevealed) {
        actionArea.innerHTML = `
          <p class="action-title">Pass the device to <strong>${escapeHTML(player.name)}</strong>. Make sure nobody else is looking, then reveal the role.</p>
          <button type="button" class="button button-primary" data-action="local-reveal">REVEAL MY ROLE</button>`;
        showRole(null);
      } else {
        showRole(player.role);
        actionArea.innerHTML = `
          <p class="action-title">Remember your role. Hide the screen before passing the device.</p>
          <button type="button" class="button button-primary" data-action="local-next-role">HIDE ROLE & NEXT PLAYER</button>`;
      }

      $("lobbyHint").textContent =
        "Keep your role secret. The next player should not look at your screen.";
    } else if (localGame.phase === "discussion") {
      $("phaseBadge").textContent = "DISCUSSION";
      $("lobbyTitle").textContent = "Who can you trust?";
      showRole(null);

      actionArea.innerHTML = `
        <p class="action-title">Talk in person. Discuss suspicious behavior, then pass the device to start private voting.</p>
        <button type="button" class="button button-primary" data-action="local-voting">START VOTING</button>`;
      $("lobbyHint").textContent = "The saboteur must blend in. The crew must identify them.";
    } else if (localGame.phase === "voting") {
      const voter = alive[localVoteIndex];

      $("phaseBadge").textContent = "VOTING";
      $("lobbyTitle").textContent = "Cast your vote";
      showRole(null);

      if (!voter) {
        resolveLocalVotes();
        return;
      }

      const alreadyVoted = Boolean(localGame.votes[voter.uid]);

      actionArea.innerHTML = `
        <p class="action-title">Pass the device to <strong>${escapeHTML(voter.name)}</strong>. Choose privately.</p>
        <div class="vote-list">
          ${alive.filter((p) => p.uid !== voter.uid).map((p) => `
            <button type="button" class="vote-option ${localVoteChoice === p.uid ? "selected" : ""}"
              data-local-vote="${escapeHTML(p.uid)}">
              <strong>${escapeHTML(p.name)}</strong>
              <span class="vote-label">${localVoteChoice === p.uid ? "SELECTED" : "VOTE"}</span>
            </button>`).join("")}
        </div>
        <button type="button" class="button button-primary" data-action="local-submit-vote"
          ${!localVoteChoice || alreadyVoted ? "disabled" : ""}>CONFIRM PRIVATE VOTE</button>`;

      $("lobbyHint").textContent =
        "Votes are private on the device, but players must avoid looking at each other's choices.";
    } else if (localGame.phase === "results") {
      $("phaseBadge").textContent = "RESULTS";
      $("lobbyTitle").textContent = "The verdict";
      showRole(null);

      actionArea.innerHTML = `
        <p class="action-title">${escapeHTML(localGame.result)}</p>
        <button type="button" class="button button-primary" data-action="local-new-game">PLAY AGAIN</button>`;
      $("lobbyHint").textContent = "Start another round to reshuffle roles.";
    }
  }

  function resolveLocalVotes() {
    const tally = {};

    Object.values(localGame.votes).forEach((targetUid) => {
      tally[targetUid] = (tally[targetUid] || 0) + 1;
    });

    const maxVotes = Math.max(0, ...Object.values(tally));
    const leaders = Object.keys(tally).filter((uid) => tally[uid] === maxVotes);
    const eliminatedUid = maxVotes > 0 && leaders.length === 1 ? leaders[0] : null;
    let message = "It's a tie. Nobody was eliminated.";

    if (eliminatedUid) {
      const eliminated = localGame.players.find((p) => p.uid === eliminatedUid);
      eliminated.alive = false;
      message = eliminated.name + " was eliminated.";

      if (eliminated.role === "saboteur") {
        message += " The saboteur was caught. CREW WINS!";
        localGame.phase = "results";
        localGame.result = message;
        renderLocal();
        return;
      }
    }

    const survivors = localGame.players.filter((p) => p.alive);
    const saboteurAlive = survivors.some((p) => p.role === "saboteur");
    const crewAlive = survivors.filter((p) => p.role === "crew").length;

    if (saboteurAlive && survivors.length <= 2 && crewAlive <= 1) {
      message += " The saboteur has taken control. SABOTEUR WINS!";
      localGame.phase = "results";
      localGame.result = message;
    } else if (saboteurAlive) {
      message += " The saboteur is still out there.";
      localGame.phase = "results";
      localGame.result = message;
    } else {
      localGame.phase = "results";
      localGame.result = message + " Crew wins!";
    }

    renderLocal();
  }

  // ---------------- BUTTON EVENTS ----------------

  $("localButton").addEventListener("click", startLocalGame);
  $("createButton").addEventListener("click", createOnlineRoom);
  $("joinButton").addEventListener("click", joinOnlineRoom);

  $("roomCode").addEventListener("input", () => {
    $("roomCode").value = $("roomCode").value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  $("copyRoomButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      showNotice("Room code copied: " + roomCode);
    } catch (_) {
      showNotice("Your room code is " + roomCode + ". Copy it manually.");
    }
  });

  $("leaveButton").addEventListener("click", async () => {
    if (mode === "online" && roomRef && currentUser) {
      try {
        const wasHost = isHost();
        await roomRef.child("players/" + currentUser.uid).remove();

        if (wasHost) {
          await roomRef.child("public").update({
            message: "The host left the room."
          });
        }
      } catch (error) {
        console.warn("Could not remove player from room:", error);
      }
    }

    clearSubscriptions();
    mode = "none";
    roomCode = "";
    publicState = null;
    onlinePlayers = {};
    myRole = null;
    myVote = "";
    hostRoleMap = {};
    localGame = null;
    showRole(null);
    setScreen("home");
    setConnection(configReady ? "READY TO CONNECT" : "LOCAL MODE READY", false);
    hideNotice();
  });

  actionArea.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;

    const action = button.dataset.action;

    try {
      if (mode === "online") {
        if (action === "start-online") await startOnlineGame();
        if (action === "vote-phase") await startVoting();
        if (action === "resolve-votes") await resolveVotes();
        if (action === "next-vote") await nextVote();
        if (action === "end-game") await endOnlineGame();
        if (action === "reset-game") await resetOnlineGame();
      } else if (mode === "local" && localGame) {
        if (action === "local-reveal") {
          localRevealed = true;
          renderLocal();
        }

        if (action === "local-next-role") {
          localRevealed = false;
          localGame.revealIndex++;

          if (localGame.revealIndex >= localGame.players.length) {
            localGame.phase = "discussion";
          }

          renderLocal();
        }

        if (action === "local-voting") {
          localGame.phase = "voting";
          localVoteIndex = 0;
          localVoteChoice = "";
          renderLocal();
        }

        if (action === "local-submit-vote") {
          const voter = localGame.players.filter((p) => p.alive)[localVoteIndex];
          if (voter && localVoteChoice) {
            localGame.votes[voter.uid] = localVoteChoice;
            localVoteIndex++;
            localVoteChoice = "";
            renderLocal();
          }
        }

        if (action === "local-new-game") {
          localGame = null;
          startLocalGame();
        }
      }
    } catch (error) {
      console.error(error);
      showNotice("That action failed. Check the connection and try again.", true);
    }
  });

  actionArea.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vote-target]");
    if (button && mode === "online") {
      castVote(button.dataset.voteTarget);
    }

    const localButton = event.target.closest("[data-local-vote]");
    if (localButton && mode === "local") {
      localVoteChoice = localButton.dataset.localVote;
      renderLocal();
    }
  });

  // Initial state
  setScreen("home");
  setConnection(configReady ? "READY TO CONNECT" : "LOCAL MODE READY", false);
})();
