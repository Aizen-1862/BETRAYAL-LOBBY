
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const COLORS = [0xff5d9e, 0x56e8ff, 0xffdf70, 0x9b82ff, 0x65f0b1, 0xff945e, 0xf6f7ff, 0x83a6ff];
  const EYE = 1.65;
  const SPEED = 8.5;
  const GRAVITY = 22;
  const JUMP = 9.2;
  const MAX_PLAYERS = 8;

  let renderer, scene, camera, clock;
  let built = false, loopStarted = false;
  let mode = "menu", peer = null, hostConn = null;
  let meId = "", me = null, myName = "Player";
  let roomHost = false, roundActive = false, roundWinner = "";
  let roundEndShown = false, networkTimer = 0, yaw = 0, pitch = 0;
  let jumpQueued = false, lastLookX = null, lastLookY = null;
  let players = {}, connections = new Map(), remoteModels = new Map();
  let platforms = [], obstacles = [], keys = {}, touchMoves = {};
  const velocity = { x: 0, y: 0, z: 0 };

  function setText(id, value) {
    $(id).textContent = value;
  }

  function status(value) {
    setText("homeStatus", value);
  }

  function connectionStatus(value) {
    setText("connectionStatus", value);
  }

  function randomName() {
    return "Player" + Math.floor(100 + Math.random() * 900);
  }

  function makePlayer(id, name, color) {
    return {
      id,
      name,
      color: color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
      x: 0, y: EYE, z: 0, yaw: 0, alive: true
    };
  }

  function resetPosition(p, index = 0) {
    const angle = index * 2.399;
    const radius = 2 + (index % 3) * 1.2;

    p.x = Math.cos(angle) * radius;
    p.y = EYE;
    p.z = Math.sin(angle) * radius;
    p.yaw = angle + Math.PI;
    p.alive = true;

    if (p.id === meId) {
      camera.position.set(p.x, p.y, p.z);
      yaw = p.yaw;
      pitch = 0;
      velocity.x = velocity.y = velocity.z = 0;
    }
  }

  /* ---------- WORLD ---------- */

  function addPlatform(x, z, width, depth, color, top = 0) {
    const geometry = new THREE.BoxGeometry(width, 0.8, depth);
    const material = new THREE.MeshStandardMaterial({
      color, roughness: 0.72, metalness: 0.04
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, top - 0.4, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.42
      })
    );
    edge.position.copy(mesh.position);
    scene.add(edge);

    platforms.push({ x, z, width, depth, top, mesh, edge });
  }

  function addCloud(x, y, z, scale) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });

    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1.7 + Math.random() * 1.7, 10, 8),
        material
      );
      puff.position.set((i - 2) * 2.1, Math.random(), Math.random() * 2);
      group.add(puff);
    }

    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    scene.add(group);
  }

  function addSpinner(length, speed, color, height) {
    const pivot = new THREE.Group();
    pivot.position.set(0, height, 0);

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.45, 0.8),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        emissive: color,
        emissiveIntensity: 0.12
      })
    );
    bar.castShadow = true;
    pivot.add(bar);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 0.9, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    hub.rotation.x = Math.PI / 2;
    pivot.add(hub);

    scene.add(pivot);
    obstacles.push({
      pivot, length, speed, angle: Math.random() * Math.PI * 2,
      height
    });
  }

  function buildWorld() {
    if (built) return;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x78baff);
    scene.fog = new THREE.Fog(0x78baff, 70, 165);

    camera = new THREE.PerspectiveCamera(
      78, innerWidth / innerHeight, 0.1, 300
    );
    camera.rotation.order = "YXZ";
    camera.position.set(0, EYE, 0);

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = false;
    $("scene").appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe9f8ff, 0x6870b0, 2.1));

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-20, 35, 12);
    scene.add(sun);

    // Main arena and connected islands.
    addPlatform(0, 0, 22, 22, 0x7763ef);
    addPlatform(0, -17, 8, 8, 0x49dbe0);
    addPlatform(0, -28, 8, 8, 0xff77b7);
    addPlatform(0, -39, 10, 10, 0xffd56a);
    addPlatform(0, 17, 8, 8, 0xffd56a);
    addPlatform(0, 28, 8, 8, 0x67e6aa);
    addPlatform(0, 39, 10, 10, 0x6d9cff);
    addPlatform(-17, 0, 8, 8, 0x67e6aa);
    addPlatform(-28, 0, 8, 8, 0xffd56a);
    addPlatform(-39, 0, 10, 10, 0xff77b7);
    addPlatform(17, 0, 8, 8, 0xff77b7);
    addPlatform(28, 0, 8, 8, 0x49dbe0);
    addPlatform(39, 0, 10, 10, 0xffd56a);

    const pillarColors = [0xff65b9, 0x5df3f0, 0xffdf72, 0xa38bff];

    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.65, 2.6, 8),
        new THREE.MeshStandardMaterial({
          color: pillarColors[i % pillarColors.length]
        })
      );
      pillar.position.set(Math.cos(a) * 12.8, 1.2, Math.sin(a) * 12.8);
      scene.add(pillar);
    }

    addSpinner(12, 1.3, 0xff62bd, 1.1);
    addSpinner(8, -1.8, 0x55f1f3, 2.1);

    for (let i = 0; i < 16; i++) {
      addCloud(
        (Math.random() - 0.5) * 170,
        8 + Math.random() * 22,
        (Math.random() - 0.5) * 170,
        0.7 + Math.random()
      );
    }

    for (const p of platforms.slice(1)) {
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.6),
        new THREE.MeshStandardMaterial({
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          roughness: 0.25,
          metalness: 0.1
        })
      );
      gem.position.set(p.x, p.top + 1.2, p.z);
      scene.add(gem);
    }

    clock = new THREE.Clock();
    built = true;
  }

  /* ---------- AVATARS ---------- */

  function makeAvatar(p) {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 1.1, 12),
      new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.48 })
    );
    body.position.y = 0.9;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xffdfbd })
    );
    head.position.y = 1.72;
    group.add(head);

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x182039 });

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 8), eyeMaterial
      );
      eye.position.set(side * 0.13, 1.78, -0.34);
      group.add(eye);
    }

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.045, 6, 20),
      new THREE.MeshBasicMaterial({ color: p.color })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    group.add(ring);

    group.userData.ring = ring;
    scene.add(group);
    return group;
  }

  function updateRemoteModels() {
    for (const p of Object.values(players)) {
      if (!p || p.id === meId) continue;

      if (!remoteModels.has(p.id)) {
        remoteModels.set(p.id, makeAvatar(p));
      }

      const model = remoteModels.get(p.id);
      model.visible = p.alive !== false;
      model.position.lerp(
        new THREE.Vector3(p.x || 0, (p.y || EYE) - EYE, p.z || 0),
        0.4
      );
      model.rotation.y = p.yaw || 0;
      model.userData.ring.rotation.z += 0.02;
    }

    for (const [id, model] of remoteModels) {
      if (!players[id] || id === meId) {
        scene.remove(model);
        remoteModels.delete(id);
      }
    }
  }

  /* ---------- MOVEMENT AND COLLISIONS ---------- */

  function platformUnder(x, z) {
    for (const p of platforms) {
      if (
        Math.abs(x - p.x) <= p.width / 2 - 0.15 &&
        Math.abs(z - p.z) <= p.depth / 2 - 0.15
      ) return p.top;
    }
    return null;
  }

  function distanceToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = dx * dx + dz * dz;
    let t = len ? ((px - ax) * dx + (pz - az) * dz) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  }

  function hitSpinner() {
    if (!me || !me.alive) return;

    for (const o of obstacles) {
      const a = o.angle;
      const half = o.length / 2;
      const ax = -Math.cos(a) * half;
      const az = -Math.sin(a) * half;
      const bx = Math.cos(a) * half;
      const bz = Math.sin(a) * half;

      const feet = camera.position.y - EYE;
      if (feet < -0.1 || feet > 1.8) continue;

      if (distanceToSegment(
        camera.position.x, camera.position.z, ax, az, bx, bz
      ) < 1.05) {
        const dx = camera.position.x;
        const dz = camera.position.z;
        const len = Math.hypot(dx, dz) || 1;
        velocity.x += dx / len * 7;
        velocity.z += dz / len * 7;
        velocity.y = Math.max(velocity.y, 3);
      }
    }
  }

  function eliminate() {
    if (!me || !me.alive) return;

    me.alive = false;
    velocity.x = velocity.y = velocity.z = 0;
    $("playerStatus").textContent = "ELIMINATED";
    setText("roundMessage", "YOU FELL! WAIT FOR THE WINNER");

    // Put the eliminated camera in a safe spectator position.
    camera.position.set(me.x, 8, me.z);

    if (mode === "host") {
      players[meId] = me;
      checkWinner();
      broadcastPlayers();
    }
  }

  function updateMovement(dt) {
    if (!me || me.alive === false) return;

    const forward =
      (keys.KeyW || keys.ArrowUp || touchMoves.forward ? 1 : 0) -
      (keys.KeyS || keys.ArrowDown || touchMoves.back ? 1 : 0);

    const right =
      (keys.KeyD || keys.ArrowRight || touchMoves.right ? 1 : 0) -
      (keys.KeyA || keys.ArrowLeft || touchMoves.left ? 1 : 0);

    let mx = 0, mz = 0;

    if (forward || right) {
      const length = Math.hypot(forward, right) || 1;
      const f = forward / length, r = right / length;
      mx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
      mz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    }

    const blend = Math.min(1, dt * 10);
    velocity.x += (mx * SPEED - velocity.x) * blend;
    velocity.z += (mz * SPEED - velocity.z) * blend;

    if (jumpQueued) {
      const feet = camera.position.y - EYE;
      const ground = platformUnder(camera.position.x, camera.position.z);

      if (ground !== null && Math.abs(feet - ground) < 0.17) {
        velocity.y = JUMP;
      }
      jumpQueued = false;
    }

    const previousFeet = camera.position.y - EYE;

    camera.position.x += velocity.x * dt;
    camera.position.z += velocity.z * dt;
    velocity.y -= GRAVITY * dt;
    camera.position.y += velocity.y * dt;

    const feet = camera.position.y - EYE;
    const ground = platformUnder(camera.position.x, camera.position.z);

    if (ground !== null && previousFeet >= ground - 0.15 &&
        feet <= ground && velocity.y <= 0) {
      camera.position.y = ground + EYE;
      velocity.y = 0;
    }

    hitSpinner();

    if (camera.position.y < -10) {
      if (roundActive && mode !== "practice") eliminate();
      else resetPosition(me, 0);
    }

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    me.x = camera.position.x;
    me.y = camera.position.y;
    me.z = camera.position.z;
    me.yaw = yaw;

    if (me.alive) {
      setText("playerStatus", roundActive ? "IN THE ROUND" : "PRACTICE");
    }
  }

  function updateWorld(dt) {
    for (const o of obstacles) {
      o.angle += o.speed * dt;
      o.pivot.rotation.y = o.angle;
    }
    updateRemoteModels();
  }

  /* ---------- ROUNDS ---------- */

  function updateHUD() {
    const list = Object.values(players).filter(Boolean);
    const alive = list.filter(p => p.alive !== false).length;

    setText("aliveCount", String(alive));
    setText("playerCount", "Players: " + list.length + " / " + MAX_PLAYERS);

    $("startRoundBtn").classList.toggle(
      "hidden", !roomHost || list.length < 2 || roundActive
    );

    if (roomHost && list.length < 2) {
      setText("roomStatus", "Share your code and wait for friends.");
    } else if (roomHost && !roundActive) {
      setText("roomStatus", "Everyone ready? Start the round!");
    }
  }

  function startNewRound() {
    if (mode === "practice") {
      roundActive = false;
      roundEndShown = false;
      resetPosition(me, 0);
      $("messageOverlay").classList.add("hidden");
      setText("roundMessage", "PRACTICE MODE — EXPLORE THE ARENA");
      return;
    }

    if (!roomHost) {
      setText("roomStatus", "Only the host can start the round.");
      return;
    }

    roundActive = true;
    roundWinner = "";
    roundEndShown = false;
    $("messageOverlay").classList.add("hidden");

    const list = Object.values(players);
    list.forEach((p, i) => resetPosition(p, i));
    players[meId] = me;

    for (const conn of connections.values()) {
      if (conn.open) {
        conn.send({ type: "roundStart", players, roundActive: true });
      }
    }

    setText("roundMessage", "ROUND STARTED — DON'T FALL!");
    broadcastPlayers();
    updateHUD();
  }

  function checkWinner() {
    if (mode !== "host" || !roundActive || roundEndShown) return;

    const list = Object.values(players).filter(Boolean);
    if (list.length < 2) return;

    const alive = list.filter(p => p.alive !== false);

    if (alive.length <= 1) {
      roundActive = false;
      roundWinner = alive[0]?.name || "Nobody";
      roundEndShown = true;

      for (const conn of connections.values()) {
        if (conn.open) conn.send({ type: "roundEnd", winner: roundWinner });
      }

      showResult(roundWinner);
      broadcastPlayers();
    }
  }

  function showResult(winner) {
    setText("resultTitle", winner === myName ? "YOU WON!" : winner + " WINS!");
    setText(
      "resultText",
      winner === "Nobody"
        ? "Everyone fell. Nobody survived the chaos!"
        : winner + " survived the arena. Ready for another round?"
    );
    setText("resultBtn", roomHost ? "PLAY AGAIN →" : "BACK TO ARENA →");
    $("messageOverlay").classList.remove("hidden");
  }

  /* ---------- NETWORKING ---------- */

  function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "CA";
    for (let i = 0; i < 7; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  function broadcastPlayers() {
    if (mode !== "host") return;

    players[meId] = me;
    const packet = { type: "players", players, roundActive, winner: roundWinner };

    for (const conn of connections.values()) {
      if (!conn.open) continue;
      try { conn.send(packet); } catch (error) {}
    }
    updateHUD();
  }

  function handleHostData(conn, data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "join") {
      if (!players[conn.peer] && Object.keys(players).length >= MAX_PLAYERS) {
        conn.send({ type: "error", message: "This room is full." });
        conn.close();
        return;
      }

      if (!players[conn.peer]) {
        const p = makePlayer(
          conn.peer,
          String(data.name || "Player").slice(0, 16),
          COLORS[Object.keys(players).length % COLORS.length]
        );
        resetPosition(p, Object.keys(players).length);
        players[conn.peer] = p;
      }

      conn.send({
        type: "welcome",
        id: conn.peer,
        players,
        roundActive
      });
      broadcastPlayers();
      return;
    }

    if (data.type === "state" && players[conn.peer]) {
      const p = players[conn.peer];
      p.x = Number(data.x) || 0;
      p.y = Number(data.y) || EYE;
      p.z = Number(data.z) || 0;
      p.yaw = Number(data.yaw) || 0;
      p.alive = data.alive !== false;
      checkWinner();
    }
  }

  function handleClientData(data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "error") {
      setText("roomStatus", data.message || "Connection error.");
      status(data.message || "Connection error.");
      return;
    }

    if (data.type === "welcome") {
      meId = peer.id;
      me.id = meId;
      players = data.players || {};
      players[meId] = me;
      roundActive = !!data.roundActive;

      setText("roomCode", hostConn.peer);
      setText("roomStatus", "Connected! Invite friends with this code.");
      connectionStatus("ONLINE");
      showGameUI();
      updateHUD();
      return;
    }

    if (data.type === "players") {
      players = data.players || {};
      players[meId] = me;
      roundActive = !!data.roundActive;
      roundWinner = data.winner || "";

      if (roundWinner && !roundEndShown) {
        roundEndShown = true;
        showResult(roundWinner);
      }

      updateHUD();
      return;
    }

    if (data.type === "roundStart") {
      players = data.players || {};
      roundActive = true;
      roundWinner = "";
      roundEndShown = false;
      me.alive = true;
      resetPosition(me, Object.keys(players).length - 1);
      players[meId] = me;
      $("messageOverlay").classList.add("hidden");
      setText("roundMessage", "ROUND STARTED — DON'T FALL!");
      updateHUD();
      return;
    }

    if (data.type === "roundEnd") {
      roundActive = false;
      roundWinner = data.winner || "Nobody";
      roundEndShown = true;
      showResult(roundWinner);
    }
  }

  function cleanupNetwork() {
    try {
      if (hostConn) hostConn.close();
      for (const conn of connections.values()) conn.close();
      if (peer) peer.destroy();
    } catch (error) {}

    hostConn = null;
    peer = null;
    connections = new Map();
    players = {};
    roundActive = false;
    roundWinner = "";
    roundEndShown = false;
  }

  function createRoom() {
    if (!window.Peer) {
      status("PeerJS didn't load. Check your internet and reload.");
      return;
    }

    cleanupNetwork();
    mode = "host";
    roomHost = true;
    myName = randomName();
    status("Creating your room...");
    connectionStatus("CONNECTING");
    $("roomPanel").classList.remove("hidden");

    peer = new Peer(makeRoomCode());

    peer.on("open", id => {
      meId = id;
      me = makePlayer(id, myName, COLORS[0]);
      players = { [id]: me };
      resetPosition(me, 0);
      setText("roomCode", id);
      setText("roomStatus", "Room ready. Copy the code and invite friends.");
      connectionStatus("ROOM READY");
      showGameUI();
      updateHUD();
    });

    peer.on("connection", conn => {
      connections.set(conn.peer, conn);
      conn.on("data", data => handleHostData(conn, data));

      conn.on("close", () => {
        connections.delete(conn.peer);
        delete players[conn.peer];
        broadcastPlayers();
      });

      conn.on("error", error => console.warn("Peer connection:", error));
    });

    peer.on("error", error => {
      console.error(error);
      status("Room error: " + error.type + ". Try another room.");
      setText("roomStatus", "Couldn't create the room. Try again.");
      connectionStatus("ERROR");
    });
  }

  function joinRoom() {
    if (!window.Peer) {
      status("PeerJS didn't load. Check your internet and reload.");
      return;
    }

    const code = $("roomInput").value.trim().toUpperCase();
    if (!code) {
      status("Enter your friend's room code first.");
      return;
    }

    cleanupNetwork();
    mode = "client";
    roomHost = false;
    myName = randomName();
    status("Connecting to " + code + "...");
    connectionStatus("CONNECTING");
    $("roomPanel").classList.remove("hidden");
    setText("roomCode", code);

    peer = new Peer();

    peer.on("open", id => {
      meId = id;
      me = makePlayer(id, myName, COLORS[1]);

      hostConn = peer.connect(code, { reliable: true });

      hostConn.on("open", () => {
        hostConn.send({ type: "join", name: myName });
        setText("roomStatus", "Connected. Waiting for room information...");
      });

      hostConn.on("data", handleClientData);

      hostConn.on("close", () => {
        setText("roomStatus", "Connection lost. Leave and rejoin.");
        connectionStatus("DISCONNECTED");
      });

      hostConn.on("error", error => {
        console.warn(error);
        setText("roomStatus", "Couldn't connect. Check the code.");
      });
    });

    peer.on("error", error => {
      console.error(error);
      status("Connection failed: " + error.type + ". Check the code.");
      connectionStatus("ERROR");
    });
  }

  function leaveRoom() {
    cleanupNetwork();
    mode = "menu";
    roomHost = false;
    me = null;
    showHome();
    connectionStatus("OFFLINE");
    status("You left the room. You can practice or join another room.");
  }

  /* ---------- CONTROLS ---------- */

  function bindControls() {
    document.addEventListener("keydown", event => {
      keys[event.code] = true;

      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
      }

      if (event.code === "Space" && !event.repeat) jumpQueued = true;
    });

    document.addEventListener("keyup", event => {
      keys[event.code] = false;
    });

    renderer.domElement.addEventListener("click", () => {
      if (!matchMedia("(pointer: coarse)").matches) {
        renderer.domElement.requestPointerLock?.();
      }
    });

    document.addEventListener("mousemove", event => {
      if (document.pointerLockElement !== renderer.domElement) return;
      yaw -= event.movementX * 0.0023;
      pitch = Math.max(-1.35, Math.min(1.35, pitch - event.movementY * 0.0023));
    });

    const lookZone = $("lookZone");

    lookZone.addEventListener("pointerdown", event => {
      lastLookX = event.clientX;
      lastLookY = event.clientY;
      try { lookZone.setPointerCapture(event.pointerId); } catch (error) {}
    });

    lookZone.addEventListener("pointermove", event => {
      if (lastLookX === null) return;

      yaw -= (event.clientX - lastLookX) * 0.008;
      pitch = Math.max(
        -1.35,
        Math.min(1.35, pitch - (event.clientY - lastLookY) * 0.008)
      );

      lastLookX = event.clientX;
      lastLookY = event.clientY;
    });

    const stopLook = () => { lastLookX = lastLookY = null; };
    lookZone.addEventListener("pointerup", stopLook);
    lookZone.addEventListener("pointercancel", stopLook);

    document.querySelectorAll("[data-move]").forEach(button => {
      const dir = button.dataset.move;

      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        touchMoves[dir] = true;
        try { button.setPointerCapture(event.pointerId); } catch (error) {}
      });

      const stop = event => {
        event.preventDefault();
        touchMoves[dir] = false;
      };

      button.addEventListener("pointerup", stop);
      button.addEventListener("pointercancel", stop);
      button.addEventListener("lostpointercapture", () => {
        touchMoves[dir] = false;
      });
    });

    $("jumpBtn").addEventListener("pointerdown", event => {
      event.preventDefault();
      jumpQueued = true;
    });

    window.addEventListener("blur", () => {
      Object.keys(keys).forEach(k => keys[k] = false);
      Object.keys(touchMoves).forEach(k => touchMoves[k] = false);
    });

    window.addEventListener("resize", () => {
      if (!renderer || !camera) return;
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    });
  }

  /* ---------- UI / GAME LOOP ---------- */

  function showGameUI() {
    $("home").classList.add("hidden");
    $("hud").classList.remove("hidden");
    $("crosshair").classList.remove("hidden");

    if (matchMedia("(pointer: coarse)").matches) {
      $("mobileControls").classList.remove("hidden");
    }

    $("roomPanel").classList.toggle(
      "hidden", mode !== "host" && mode !== "client"
    );
    updateHUD();
  }

  function showHome() {
    $("home").classList.remove("hidden");
    $("hud").classList.add("hidden");
    $("crosshair").classList.add("hidden");
    $("mobileControls").classList.add("hidden");
    $("roomPanel").classList.add("hidden");
    $("messageOverlay").classList.add("hidden");

    if (document.pointerLockElement) document.exitPointerLock();
  }

  function startPractice() {
    cleanupNetwork();
    mode = "practice";
    roomHost = false;
    meId = "local";
    myName = randomName();
    me = makePlayer(meId, myName, COLORS[0]);
    players = { local: me };

    buildWorld();
    resetPosition(me, 0);
    showGameUI();
    connectionStatus("PRACTICE");
    setText("roundMessage", "PRACTICE MODE — EXPLORE THE ARENA");
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;

    const dt = Math.min(clock.getDelta(), 0.035);

    if (mode === "practice" || mode === "host" || mode === "client") {
      updateMovement(dt);
    }

    updateWorld(dt);

    networkTimer += dt;

    if (networkTimer >= 0.12) {
      networkTimer = 0;

      if (mode === "host") {
        players[meId] = me;
        broadcastPlayers();
      } else if (mode === "client" && hostConn?.open && me) {
        try {
          hostConn.send({
            type: "state",
            x: me.x, y: me.y, z: me.z, yaw: me.yaw,
            alive: me.alive
          });
        } catch (error) {}
      }
    }

    renderer.render(scene, camera);
  }

  $("practiceBtn").addEventListener("click", startPractice);
  $("createBtn").addEventListener("click", createRoom);
  $("joinBtn").addEventListener("click", joinRoom);
  $("leaveBtn").addEventListener("click", leaveRoom);
  $("exitBtn").addEventListener("click", leaveRoom);
  $("startRoundBtn").addEventListener("click", startNewRound);

  $("copyBtn").addEventListener("click", async () => {
    const code = $("roomCode").textContent;

    try {
      await navigator.clipboard.writeText(code);
      setText("copyBtn", "COPIED!");
    } catch (error) {
      window.prompt("Copy this room code:", code);
    }

    setTimeout(() => setText("copyBtn", "COPY CODE"), 1500);
  });

  $("resultBtn").addEventListener("click", () => {
    $("messageOverlay").classList.add("hidden");

    if (roomHost) {
      startNewRound();
    } else if (mode === "practice") {
      startPractice();
    } else {
      setText("roundMessage", "WAITING FOR THE HOST TO START AGAIN");
    }
  });

  function boot() {
    try {
      if (!window.THREE) throw new Error("Three.js failed to load.");

      buildWorld();

      if (!loopStarted) {
        loopStarted = true;
        animate();
      }

      bindControls();
      renderer.render(scene, camera);
      $("loading").classList.add("hidden");
      connectionStatus("READY");
    } catch (error) {
      console.error(error);
      $("loading").innerHTML =
        "<strong>COULDN'T LOAD THE GAME</strong>" +
        "<small>Check your connection and reload.</small>";
    }
  }

  boot();
})();
