/* =====================================================
   CHAOS ARENA
   First-person 3D multiplayer browser prototype
   Three.js + PeerJS
   ===================================================== */

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const home = $("home");
  const loading = $("loading");
  const hud = $("hud");
  const crosshair = $("crosshair");
  const mobileControls = $("mobileControls");
  const roomPanel = $("roomPanel");
  const messageOverlay = $("messageOverlay");

  const COLORS = [
    0xff5d9e, 0x56e8ff, 0xffdf70, 0x9b82ff,
    0x65f0b1, 0xff945e, 0xf6f7ff, 0x83a6ff
  ];

  const keys = {};
  const touchMoves = {};
  const platforms = [];
  const remoteModels = new Map();

  let renderer, scene, camera, clock;
  let arenaBuilt = false;
  let animationStarted = false;

  let mode = "practice";
  let peer = null;
  let hostConn = null;
  let meId = "local";
  let myName = "Player";
  let connections = new Map();
  let players = {};
  let me = null;

  let roundActive = false;
  let roundWinner = "";
  let roomHost = false;
  let roundStartedAt = 0;
  let networkTimer = 0;
  let roundEndShown = false;

  let yaw = 0;
  let pitch = 0;
  let jumpQueued = false;
  let lastMouseX = null;
  let lastMouseY = null;

  const velocity = { x: 0, y: 0, z: 0 };

  const WORLD = {
    gravity: 22,
    walkSpeed: 8.5,
    jumpSpeed: 9.2,
    eyeHeight: 1.65
  };

  const randomName = () =>
    "Player" + Math.floor(100 + Math.random() * 900);

  function setStatus(text) {
    $("homeStatus").textContent = text;
  }

  function setConnectionStatus(text) {
    $("connectionStatus").textContent = text;
  }

  function setRoomStatus(text) {
    $("roomStatus").textContent = text;
  }

  function showRoomPanel(show) {
    roomPanel.classList.toggle("hidden", !show);
  }

  function showGameUI() {
    home.classList.add("hidden");
    hud.classList.remove("hidden");
    crosshair.classList.remove("hidden");

    if (window.matchMedia("(pointer: coarse)").matches) {
      mobileControls.classList.remove("hidden");
    }

    showRoomPanel(mode === "host" || mode === "client");
    updateHUD();
  }

  function showHome() {
    home.classList.remove("hidden");
    hud.classList.add("hidden");
    crosshair.classList.add("hidden");
    mobileControls.classList.add("hidden");
    showRoomPanel(false);
    messageOverlay.classList.add("hidden");
    document.exitPointerLock?.();
  }

  function setRoundMessage(text) {
    $("roundMessage").textContent = text;
  }

  function makePlayer(id, name, color) {
    return {
      id,
      name,
      color: color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
      x: 0,
      y: WORLD.eyeHeight,
      z: 0,
      yaw: 0,
      alive: true
    };
  }

  function resetPosition(player, index = 0) {
    const angle = index * 2.399;
    const radius = 2.5 + (index % 3) * 1.2;

    player.x = Math.cos(angle) * radius;
    player.y = WORLD.eyeHeight;
    player.z = Math.sin(angle) * radius;
    player.yaw = angle + Math.PI;
    player.alive = true;

    if (player.id === meId) {
      camera.position.set(player.x, player.y, player.z);
      yaw = player.yaw;
      pitch = 0;
      velocity.x = 0;
      velocity.y = 0;
      velocity.z = 0;
    }
  }

  /* ---------------- 3D WORLD ---------------- */

  function addPlatform(x, z, width, depth, color, top = 0) {
    const height = 0.8;

    const geometry = new THREE.BoxGeometry(
      width, height, depth
    );

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: 0.05
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, top - height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35
      })
    );

    edge.position.copy(mesh.position);
    scene.add(edge);

    platforms.push({
      x, z, width, depth, top, mesh, edge
    });

    return mesh;
  }

  function addCloud(x, y, z, scale) {
    const cloud = new THREE.Group();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1
    });

    for (let i = 0; i < 5; i++) {
      const size = 1.8 + Math.random() * 2.1;

      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(size, 12, 10),
        material
      );

      puff.position.set(
        (i - 2) * 2.3,
        Math.random() * 1.2,
        Math.random() * 2
      );

      cloud.add(puff);
    }

    cloud.position.set(x, y, z);
    cloud.scale.setScalar(scale);
    scene.add(cloud);
  }

  const obstacles = [];

  function addSpinner(x, z, length, speed, color) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.1, z);

    const geometry = new THREE.BoxGeometry(length, 0.45, 0.8);

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.12,
      emissive: color,
      emissiveIntensity: 0.12
    });

    const bar = new THREE.Mesh(geometry, material);
    bar.castShadow = true;
    pivot.add(bar);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 0.8, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.3
      })
    );

    hub.rotation.x = Math.PI / 2;
    pivot.add(hub);

    scene.add(pivot);
    obstacles.push({
      pivot, x, z, length, speed, angle: Math.random() * Math.PI * 2
    });
  }

  function buildWorld() {
    if (arenaBuilt) return;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x78baff);
    scene.fog = new THREE.Fog(0x78baff, 65, 155);

    camera = new THREE.PerspectiveCamera(
      78,
      window.innerWidth / window.innerHeight,
      0.1,
      300
    );

    camera.rotation.order = "YXZ";
    camera.position.set(0, WORLD.eyeHeight, 0);

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 1.6)
    );

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // Keep the first version reasonably light for phones.
    renderer.shadowMap.enabled = false;

    $("scene").appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(
      0xe9f8ff, 0x6870b0, 2.1
    );
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(-20, 35, 12);
    scene.add(sun);

    // Main island and side platforms.
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

    // Colorful decorations around the main arena.
    const pillarColors = [
      0xff65b9, 0x5df3f0, 0xffdf72, 0xa38bff
    ];

    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const r = 12.8;

      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.65, 2.6, 8),
        new THREE.MeshStandardMaterial({
          color: pillarColors[i % pillarColors.length],
          roughness: 0.45
        })
      );

      pillar.position.set(
        Math.cos(a) * r,
        1.2,
        Math.sin(a) * r
      );

      pillar.castShadow = true;
      scene.add(pillar);
    }

    // Spinning sweep bars.
    addSpinner(0, 0, 12, 1.3, 0xff62bd);
    addSpinner(0, 0, 8, -1.8, 0x55f1f3);

    // Floating clouds create depth.
    for (let i = 0; i < 17; i++) {
      addCloud(
        (Math.random() - 0.5) * 170,
        8 + Math.random() * 22,
        (Math.random() - 0.5) * 170,
        0.65 + Math.random() * 1.1
      );
    }

    // Small glowing-looking gems on the outer platforms.
    for (const p of platforms.slice(1)) {
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.65),
        new THREE.MeshStandardMaterial({
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          roughness: 0.25,
          metalness: 0.1
        })
      );

      gem.position.set(p.x, p.top + 1.3, p.z);
      scene.add(gem);
    }

    clock = new THREE.Clock();
    arenaBuilt = true;
  }

  /* ---------------- PLAYER AVATARS ---------------- */

  function makeAvatar(player) {
    const group = new THREE.Group();

    const color = new THREE.Color(player.color);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.48, 0.85, 4, 8),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.48
      })
    );

    body.position.y = 0.9;
    group.add(body);

    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 14, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffdfbd,
        roughness: 0.75
      })
    );

    face.position.y = 1.85;
    group.add(face);

    const eyeMaterial = new THREE.MeshBasicMaterial({
      color: 0x182039
    });

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 8),
        eyeMaterial
      );

      eye.position.set(side * 0.13, 1.9, -0.33);
      group.add(eye);
    }

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.045, 6, 20),
      new THREE.MeshBasicMaterial({
        color: player.color
      })
    );

    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    group.add(ring);

    group.userData = { body, face, ring };
    scene.add(group);

    return group;
  }

  function updateRemoteModels() {
    if (!scene) return;

    const list = Object.values(players);

    for (const player of list) {
      if (!player || player.id === meId) continue;

      if (!remoteModels.has(player.id)) {
        remoteModels.set(player.id, makeAvatar(player));
      }

      const model = remoteModels.get(player.id);
      model.visible = player.alive !== false;

      // Smooth remote motion.
      const target = new THREE.Vector3(
        Number(player.x) || 0,
        (Number(player.y) || WORLD.eyeHeight) - WORLD.eyeHeight,
        Number(player.z) || 0
      );

      model.position.lerp(target, 0.35);
      model.rotation.y = Number(player.yaw) || 0;

      model.userData.ring.rotation.z += 0.025;
    }

    for (const [id, model] of remoteModels) {
      if (!players[id] || id === meId) {
        scene.remove(model);
        remoteModels.delete(id);
      }
    }
  }

  /* ---------------- GAMEPLAY ---------------- */

  function platformUnderPlayer(x, z) {
    for (const p of platforms) {
      if (
        Math.abs(x - p.x) <= p.width / 2 - 0.25 &&
        Math.abs(z - p.z) <= p.depth / 2 - 0.25
      ) {
        return p.top;
      }
    }

    return null;
  }

  function distanceToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;

    let t = lengthSq
      ? ((px - ax) * dx + (pz - az) * dz) / lengthSq
      : 0;

    t = Math.max(0, Math.min(1, t));

    const cx = ax + t * dx;
    const cz = az + t * dz;

    return Math.hypot(px - cx, pz - cz);
  }

  function collideWithSpinners() {
    if (!me || !me.alive) return;

    for (const obstacle of obstacles) {
      const a = obstacle.angle;
      const half = obstacle.length / 2;

      const ax = obstacle.x - Math.cos(a) * half;
      const az = obstacle.z - Math.sin(a) * half;
      const bx = obstacle.x + Math.cos(a) * half;
      const bz = obstacle.z + Math.sin(a) * half;

      const feet = camera.position.y - WORLD.eyeHeight;

      if (feet < -0.1 || feet > 1.8) continue;

      const distance = distanceToSegment(
        camera.position.x,
        camera.position.z,
        ax, az, bx, bz
      );

      if (distance < 1.0) {
        const dx = camera.position.x - obstacle.x;
        const dz = camera.position.z - obstacle.z;
        const length = Math.hypot(dx, dz) || 1;

        velocity.x += (dx / length) * 8;
        velocity.z += (dz / length) * 8;
        velocity.y = Math.max(velocity.y, 3.2);
      }
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

    let mx = 0;
    let mz = 0;

    if (forward || right) {
      const length = Math.hypot(forward, right) || 1;
      const f = forward / length;
      const r = right / length;

      mx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
      mz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    }

    const targetX = mx * WORLD.walkSpeed;
    const targetZ = mz * WORLD.walkSpeed;

    const acceleration = Math.min(1, dt * 10);

    velocity.x += (targetX - velocity.x) * acceleration;
    velocity.z += (targetZ - velocity.z) * acceleration;

    if (jumpQueued) {
      const feet = camera.position.y - WORLD.eyeHeight;
      const ground = platformUnderPlayer(
        camera.position.x,
        camera.position.z
      );

      if (
        ground !== null &&
        Math.abs(feet - ground) < 0.16
      ) {
        velocity.y = WORLD.jumpSpeed;
      }

      jumpQueued = false;
    }

    const previousFeet = camera.position.y - WORLD.eyeHeight;

    camera.position.x += velocity.x * dt;
    camera.position.z += velocity.z * dt;

    velocity.y -= WORLD.gravity * dt;
    camera.position.y += velocity.y * dt;

    const feet = camera.position.y - WORLD.eyeHeight;
    const ground = platformUnderPlayer(
      camera.position.x,
      camera.position.z
    );

    if (
      ground !== null &&
      previousFeet >= ground - 0.12 &&
      feet <= ground &&
      velocity.y <= 0
    ) {
      camera.position.y = ground + WORLD.eyeHeight;
      velocity.y = 0;
    }

    collideWithSpinners();

    // Falling off the island.
    if (camera.position.y < -12) {
      if (roundActive && mode !== "practice") {
        me.alive = false;
        velocity.x = 0;
        velocity.y = 0;
        velocity.z = 0;

        camera.position.set(
          me.x,
          7,
          me.z
        );

        $("playerStatus").textContent = "ELIMINATED";
        setRoundMessage("YOU FELL! WAIT FOR THE WINNER");
        checkWinner();
      } else {
        resetPosition(me, 0);
      }
    }

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    me.x = camera.position.x;
    me.y = camera.position.y;
    me.z = camera.position.z;
    me.yaw = yaw;

    if (me.alive) {
      $("playerStatus").textContent = roundActive
        ? "IN THE ROUND"
        : "PRACTICE";
    }
  }

  function updateWorld(dt) {
    for (const obstacle of obstacles) {
      obstacle.angle += obstacle.speed * dt;
      obstacle.pivot.rotation.y = obstacle.angle;
    }

    updateRemoteModels();
  }

  /* ---------------- ROUND SYSTEM ---------------- */

  function startNewRound() {
    if (!roomHost && mode !== "practice") {
      setRoomStatus("Only the room host can start a round.");
      return;
    }

    roundActive = mode !== "practice";
    roundWinner = "";
    roundEndShown = false;
    messageOverlay.classList.add("hidden");

    const list = Object.values(players);

    list.forEach((p, i) => resetPosition(p, i));

    if (me) {
      me.alive = true;
      resetPosition(me, list.findIndex(p => p.id === meId));
    }

    if (mode === "host") {
      players[meId] = me;

      for (const conn of connections.values()) {
        try {
          conn.send({
            type: "roundStart",
            players,
            roundActive: true
          });
        } catch (e) {}
      }

      broadcastPlayers();
    }

    setRoundMessage(
      mode === "practice"
        ? "PRACTICE MODE — EXPLORE THE ARENA"
        : "ROUND STARTED — DON'T FALL!"
    );

    updateHUD();
  }

  function checkWinner() {
    if (mode !== "host" || !roundActive || roundEndShown) return;

    const list = Object.values(players);
    if (list.length < 2) return;

    const alive = list.filter(p => p && p.alive !== false);

    if (alive.length <= 1) {
      roundActive = false;
      roundWinner = alive[0]?.name || "Nobody";
      roundEndShown = true;

      for (const conn of connections.values()) {
        try {
          conn.send({
            type: "roundEnd",
            winner: roundWinner
          });
        } catch (e) {}
      }

      showRoundResult(roundWinner);
      broadcastPlayers();
    }
  }

  function showRoundResult(winner) {
    $("resultTitle").textContent =
      winner === myName ? "YOU WON!" : winner + " WINS!";

    $("resultText").textContent =
      winner === "Nobody"
        ? "Everyone fell. Nobody survives the chaos!"
        : winner + " survived the arena. Ready for revenge?";

    $("resultBtn").textContent =
      roomHost ? "PLAY AGAIN →" : "BACK TO ARENA →";

    messageOverlay.classList.remove("hidden");
  }

  function updateHUD() {
    const list = Object.values(players);
    const alive = list.filter(p => p && p.alive !== false).length;

    $("aliveCount").textContent = alive;
    $("playerCount").textContent =
      "Players: " + list.length + " / 8";

    $("startRoundBtn").classList.toggle(
      "hidden",
      !roomHost || list.length < 2 || roundActive
    );

    if (roomHost && list.length < 2) {
      setRoomStatus("Share your code. Waiting for friends...");
    } else if (roomHost && !roundActive) {
      setRoomStatus("Everyone ready? Start the round!");
    }
  }

  /* ---------------- MULTIPLAYER ---------------- */

  function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "CHAOS";

    for (let i = 0; i < 6; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }

    return result;
  }

  function broadcastPlayers() {
    if (mode !== "host") return;

    if (me) players[meId] = me;

    const packet = {
      type: "players",
      players,
      roundActive,
      winner: roundWinner
    };

    for (const [id, conn] of connections) {
      if (!conn || !conn.open) continue;

      try {
        conn.send(packet);
      } catch (e) {
        console.warn("Send failed:", id);
      }
    }

    updateHUD();
  }

  function handleHostData(conn, data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "join") {
      if (
        Object.keys(players).length >= 8 &&
        !players[conn.peer]
      ) {
        conn.send({
          type: "error",
          message: "This room is full."
        });
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
      p.y = Number(data.y) || WORLD.eyeHeight;
      p.z = Number(data.z) || 0;
      p.yaw = Number(data.yaw) || 0;
      p.alive = data.alive !== false;

      checkWinner();
    }
  }

  function handleClientData(data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "error") {
      setRoomStatus(data.message || "Connection error.");
      setStatus(data.message || "Connection error.");
      return;
    }

    if (data.type === "welcome") {
      meId = peer.id;
      me.id = meId;

      players = data.players || {};
      players[meId] = me;

      roundActive = !!data.roundActive;

      $("roomCode").textContent = hostConn.peer;
      setRoomStatus("Connected! Share your room code with friends.");
      setConnectionStatus("ONLINE");

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
        showRoundResult(roundWinner);
      }

      updateHUD();
      return;
    }

    if (data.type === "roundStart") {
      players = data.players || {};
      roundActive = true;
      roundWinner = "";
      roundEndShown = false;

      if (me) {
        me.alive = true;
        resetPosition(me, Object.keys(players).length - 1);
        players[meId] = me;
      }

      messageOverlay.classList.add("hidden");
      setRoundMessage("ROUND STARTED — DON'T FALL!");
      updateHUD();
      return;
    }

    if (data.type === "roundEnd") {
      roundActive = false;
      roundWinner = data.winner || "Nobody";
      roundEndShown = true;
      showRoundResult(roundWinner);
    }
  }

  async function createRoom() {
    if (!window.Peer) {
      setStatus("PeerJS didn't load. Check your internet and reload.");
      return;
    }

    cleanupNetwork();

    mode = "host";
    roomHost = true;
    myName = randomName();

    setStatus("Creating your room...");
    setConnectionStatus("CONNECTING");

    peer = new Peer(makeRoomCode());

    peer.on("open", id => {
      meId = id;
      me = makePlayer(id, myName, COLORS[0]);
      players = {};
      players[id] = me;

      $("roomCode").textContent = id;
      setRoomStatus("Room ready. Copy the code and invite friends.");
      setConnectionStatus("ROOM READY");

      showGameUI();
      startGameLoop();
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

      conn.on("error", err => {
        console.warn("Connection error:", err);
      });
    });

    peer.on("error", err => {
      console.error(err);
      setStatus(
        "Couldn't create the room (" + err.type +
        "). Try again or reload the page."
      );
      setRoomStatus("Room connection failed.");
      setConnectionStatus("ERROR");
    });

    showRoomPanel(true);
  }

  async function joinRoom() {
    if (!window.Peer) {
      setStatus("PeerJS didn't load. Check your internet and reload.");
      return;
    }

    const code = $("roomInput").value.trim().toUpperCase();

    if (!code) {
      setStatus("Enter your friend's room code first.");
      return;
    }

    cleanupNetwork();

    mode = "client";
    roomHost = false;
    myName = randomName();

    setStatus("Connecting to " + code + "...");
    setConnectionStatus("CONNECTING");

    peer = new Peer();

    peer.on("open", id => {
      meId = id;
      me = makePlayer(id, myName, COLORS[1]);

      hostConn = peer.connect(code, { reliable: true });

      hostConn.on("open", () => {
        hostConn.send({
          type: "join",
          name: myName
        });

        setRoomStatus("Connected to room. Loading arena...");
      });

      hostConn.on("data", handleClientData);

      hostConn.on("close", () => {
        setRoomStatus("Connection lost. Return to the menu and rejoin.");
        setConnectionStatus("DISCONNECTED");
      });

      hostConn.on("error", err => {
        console.error(err);
        setRoomStatus("Couldn't connect. Check the code and try again.");
      });
    });

    peer.on("error", err => {
      console.error(err);
      setStatus(
        "Connection failed (" + err.type +
        "). Check the code and your internet."
      );
      setConnectionStatus("ERROR");
    });

    showRoomPanel(true);
  }

  function cleanupNetwork() {
    try {
      if (hostConn) hostConn.close();
      for (const conn of connections.values()) conn.close();
      if (peer) peer.destroy();
    } catch (e) {}

    hostConn = null;
    peer = null;
    connections = new Map();
    players = {};
    roundActive = false;
    roundWinner = "";
    roundEndShown = false;
  }

  function leaveRoom() {
    cleanupNetwork();

    mode = "practice";
    roomHost = false;
    meId = "local";
    myName = randomName();
    me = makePlayer(meId, myName, COLORS[0]);
    players = { local: me };

    resetPosition(me, 0);
    showHome();
    setConnectionStatus("OFFLINE");
    setStatus("You left the room. Practice whenever you're ready.");
  }

  /* ---------------- CONTROLS ---------------- */

  function bindControls() {
    document.addEventListener("keydown", event => {
      keys[event.code] = true;

      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]
          .includes(event.code)
      ) {
        event.preventDefault();
      }

      if (event.code === "Space" && !event.repeat) {
        jumpQueued = true;
      }
    });

    document.addEventListener("keyup", event => {
      keys[event.code] = false;
    });

    renderer.domElement.addEventListener("click", () => {
      if (!window.matchMedia("(pointer: coarse)").matches) {
        renderer.domElement.requestPointerLock?.();
      }
    });

    document.addEventListener("mousemove", event => {
      if (document.pointerLockElement !== renderer.domElement) return;

      yaw -= event.movementX * 0.0023;
      pitch -= event.movementY * 0.0023;

      pitch = Math.max(-1.35, Math.min(1.35, pitch));
    });

    const lookZone = $("lookZone");

    lookZone.addEventListener("pointerdown", event => {
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;

      try {
        lookZone.setPointerCapture(event.pointerId);
      } catch (e) {}
    });

    lookZone.addEventListener("pointermove", event => {
      if (lastMouseX === null || lastMouseY === null) return;

      const dx = event.clientX - lastMouseX;
      const dy = event.clientY - lastMouseY;

      yaw -= dx * 0.008;
      pitch -= dy * 0.008;

      pitch = Math.max(-1.35, Math.min(1.35, pitch));

      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
    });

    function stopLook() {
      lastMouseX = null;
      lastMouseY = null;
    }

    lookZone.addEventListener("pointerup", stopLook);
    lookZone.addEventListener("pointercancel", stopLook);

    document.querySelectorAll("[data-move]").forEach(button => {
      const direction = button.dataset.move;

      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        touchMoves[direction] = true;
        try {
          button.setPointerCapture(event.pointerId);
        } catch (e) {}
      });

      const stop = event => {
        event.preventDefault();
        touchMoves[direction] = false;
      };

      button.addEventListener("pointerup", stop);
      button.addEventListener("pointercancel", stop);
      button.addEventListener("lostpointercapture", () => {
        touchMoves[direction] = false;
      });
    });

    $("jumpBtn").addEventListener("pointerdown", event => {
      event.preventDefault();
      jumpQueued = true;
    });

    window.addEventListener("blur", () => {
      for (const key in keys) keys[key] = false;
      for (const key in touchMoves) touchMoves[key] = false;
    });

    window.addEventListener("resize", () => {
      if (!renderer || !camera) return;

      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, 1.6)
      );
    });
  }

  /* ---------------- MAIN LOOP ---------------- */

  function startGameLoop() {
    if (!arenaBuilt) buildWorld();

    if (!animationStarted) {
      animationStarted = true;
      animate();
    }
  }

  function animate() {
    requestAnimationFrame(animate);

    if (!renderer || !scene || !camera) return;

    const dt = Math.min(clock.getDelta(), 0.035);

    if (mode === "practice" || mode === "host" || mode === "client") {
      updateMovement(dt);
    }

    updateWorld(dt);

    if (mode === "host") {
      players[meId] = me;

      networkTimer += dt;

      if (networkTimer >= 0.12) {
        networkTimer = 0;
        broadcastPlayers();
      }
    }

    if (mode === "client" && hostConn && hostConn.open && me) {
      networkTimer += dt;

      if (networkTimer >= 0.12) {
        networkTimer = 0;

        try {
          hostConn.send({
            type: "state",
            x: me.x,
            y: me.y,
            z: me.z,
            yaw: me.yaw,
            alive: me.alive
          });
        } catch (e) {}
      }
    }

    if (mode === "practice" && me) {
      players.local = me;
      updateHUD();
    }

    renderer.render(scene, camera);
  }

  /* ---------------- BUTTONS / STARTUP ---------------- */

  function startPractice() {
    cleanupNetwork();

    mode = "practice";
    roomHost = false;
    meId = "local";
    myName = randomName();
    me = makePlayer(meId, myName, COLORS[0]);
    players = { local: me };

    roundActive = false;
    roundWinner = "";

    buildWorld();
    resetPosition(me, 0);
    startGameLoop();
    showGameUI();

    setConnectionStatus("PRACTICE");
    setRoundMessage("PRACTICE MODE — EXPLORE THE ARENA");
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
      $("copyBtn").textContent = "COPIED!";
    } catch (e) {
      window.prompt("Copy this room code:", code);
    }

    setTimeout(() => {
      $("copyBtn").textContent = "COPY CODE";
    }, 1600);
  });

  $("resultBtn").addEventListener("click", () => {
    messageOverlay.classList.add("hidden");

    if (roomHost) {
      startNewRound();
    } else if (mode === "practice") {
      startPractice();
    } else {
      setRoundMessage("WAITING FOR THE HOST TO START AGAIN");
    }
  });

  async function boot() {
    try {
      if (!window.THREE) {
        throw new Error("Three.js failed to load.");
      }

      buildWorld();
      startGameLoop();

      // Let the first 3D frame render before showing the menu.
      renderer.render(scene, camera);

      loading.classList.add("hidden");
      setConnectionStatus("READY");
      bindControls();
    } catch (error) {
      console.error(error);
      loading.innerHTML =
        "<strong>COULDN'T LOAD THE GAME</strong>" +
        "<small>Check your internet connection and reload.</small>";
    }
  }

  boot();
})();
