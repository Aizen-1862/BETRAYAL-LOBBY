
/* =========================================================
   LAST ISLAND — 3D SURVIVAL
   Three.js + Firebase Realtime Database
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyADO25Q9Ckp5yl3eeyza7vwj2Viqa8EDcI",
  authDomain: "betrayal-lobby-835a7.firebaseapp.com",
  databaseURL: "https://betrayal-lobby-835a7-default-rtdb.firebaseio.com",
  projectId: "betrayal-lobby-835a7",
  appId: "1:79283239265:web:8e186b9f9195502ff5ad20"
};

const $ = id => document.getElementById(id);
const MAX_PLAYERS = 8;
const WORLD_SIZE = 180;
const TILE_SIZE = 9;

let app, auth, db, user;
let roomRef, roomListener;
let roomCode = "";
let room = null;
let mode = "none";
let isHost = false;
let scene, camera, renderer, clock;
let worldGroup, playerGroup, resourceGroup;
let myCharacter, cameraYaw = 0, cameraPitch = 0.25;
let keys = {};
let joystickMove = { x: 0, z: 0 };
let lastMoveSend = 0;
let lastRender = 0;
let animationId = 0;
let localPlayer = null;
let localPlayers = {};
let localChat = [];
let localMap = [];
let stormRadius = 75;
let stormTick = 0;
let touchStart = null;
let pointerDown = false;
let pointerMoved = false;
let lastPointerX = 0;
let lastPointerY = 0;
let worldReady = false;
let busy = false;

function notice(message, error = false) {
  const el = $("notice");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => el.classList.add("hidden"), 6500);
}

function setStatus(message, good = false) {
  $("connectionStatus").textContent = message;
  $("statusDot").style.background = good ? "#70f0bd" : "#ffd27a";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function randomName() {
  return "Survivor" + Math.floor(100 + Math.random() * 900);
}

function nameValue() {
  return ($("playerName").value.trim() || randomName()).slice(0, 18);
}

function me() {
  if (mode === "local") return localPlayer;
  return room?.players?.[user?.uid] || null;
}

function playersList() {
  if (mode === "local") return Object.values(localPlayers);
  return Object.values(room?.players || {});
}

function alivePlayers() {
  return playersList().filter(p => p.alive !== false);
}

function roomPublic() {
  return room?.public || {};
}

function active() {
  if (mode === "local") return !!localPlayer && localPlayer.alive !== false;
  return mode === "online" &&
    roomPublic().phase === "explore" &&
    !!me() && me().alive !== false;
}

function dbReady() {
  return !!db && !!user;
}

async function initFirebase() {
  if (dbReady()) return true;
  if (typeof firebase === "undefined") {
    throw new Error("Firebase failed to load. Check your internet connection.");
  }

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.database();

  if (!auth.currentUser) {
    await auth.signInAnonymously();
  }
  user = auth.currentUser;

  if (!user) throw new Error("Could not authenticate with Firebase.");
  setStatus("FIREBASE CONNECTED", true);
  return true;
}

function detachRoom() {
  if (roomRef && roomListener) {
    roomRef.off("value", roomListener);
  }
  roomRef = null;
  roomListener = null;
}

function showScreen(screen) {
  ["homeScreen", "lobbyScreen"].forEach(id => $(id).classList.add("hidden"));
  $(screen).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setBusy(value) {
  busy = value;
  ["createButton", "joinButton", "localButton"].forEach(id => {
    $(id).disabled = value;
    $(id).style.opacity = value ? ".55" : "1";
  });
}

function makeMap() {
  const map = [];
  for (let x = 0; x < 20; x++) {
    map[x] = [];
    for (let z = 0; z < 20; z++) {
      const edge = Math.min(x, z, 19 - x, 19 - z);
      let type = "grass";
      const r = Math.random();
      if (edge === 0) type = "water";
      else if (edge === 1) type = "sand";
      else if (r < .15) type = "forest";
      else if (r < .22) type = "rock";
      else if (r < .27) type = "crate";
      map[x][z] = type;
    }
  }
  return map;
}

function newPlayer(name, x = 0, z = 0) {
  return {
    name,
    x, z,
    hp: 100,
    hunger: 100,
    wood: 0,
    stone: 0,
    food: 2,
    shield: false,
    alive: true,
    alliance: null,
    allianceRequest: null,
    joinedAt: Date.now()
  };
}

async function createRoom() {
  if (busy) return;
  setBusy(true);
  try {
    await initFirebase();
    let code, ref, created = false;

    for (let i = 0; i < 8; i++) {
      code = randomCode();
      ref = db.ref("rooms/" + code);
      const result = await ref.transaction(old => {
        if (old !== null) return;
        return {
          public: {
            hostUid: user.uid,
            phase: "lobby",
            round: 0,
            stormRadius: 75,
            message: "Waiting for survivors",
            winner: null
          },
          players: {
            [user.uid]: newPlayer(nameValue())
          },
          map: null,
          chat: {
            first: {
              name: "ISLAND",
              text: "Room created. Invite your friends!",
              time: Date.now(),
              system: true
            }
          }
        };
      }, undefined, false);

      if (result.committed) {
        created = true;
        break;
      }
    }

    if (!created) throw new Error("Couldn't create a room. Try again.");

    roomCode = code;
    roomRef = ref;
    mode = "online";
    isHost = true;
    listenRoom();
    notice("Private room created! Share your code with friends.");
  } catch (e) {
    console.error(e);
    notice(e.message || "Couldn't create the room.", true);
  } finally {
    setBusy(false);
  }
}

async function joinRoom() {
  if (busy) return;
  const code = $("roomCode").value.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    notice("Enter a valid six-character room code.", true);
    return;
  }

  setBusy(true);
  try {
    await initFirebase();
    const ref = db.ref("rooms/" + code);
    const snapshot = await ref.once("value");
    const data = snapshot.val();

    if (!data || !data.public) throw new Error("Room not found. Check the code.");
    if (data.public.phase !== "lobby") {
      throw new Error("That expedition has already started.");
    }

    const existing = data.players?.[user.uid];
    const count = Object.keys(data.players || {}).length;

    if (!existing && count >= MAX_PLAYERS) {
      throw new Error("This room is full (8/8).");
    }

    if (!existing) {
      const result = await ref.child("players").transaction(players => {
        players = players || {};
        if (players[user.uid]) return players;
        if (Object.keys(players).length >= MAX_PLAYERS) return;
        players[user.uid] = newPlayer(nameValue());
        return players;
      });

      if (!result.committed) throw new Error("Room is full. Try another room.");
    }

    roomCode = code;
    roomRef = ref;
    mode = "online";
    isHost = data.public.hostUid === user.uid;
    listenRoom();
    await sendChat("joined the island lobby", true);
  } catch (e) {
    console.error(e);
    notice(e.message || "Couldn't join the room.", true);
  } finally {
    setBusy(false);
  }
}

function listenRoom() {
  detachRoom();
  roomRef = db.ref("rooms/" + roomCode);

  roomListener = snapshot => {
    room = snapshot.val();

    if (!room || !room.public) {
      notice("The room no longer exists.", true);
      leaveSession(false);
      return;
    }

    isHost = room.public.hostUid === user.uid;
    renderLobby();

    if (room.public.phase === "explore") {
      if (!worldReady) start3D();
      updateGameUI();
    } else if (worldReady) {
      stop3D();
    }
  };

  roomRef.on("value", roomListener, error => {
    console.error(error);
    notice("Room sync failed: " + error.message, true);
  });

  showScreen("lobbyScreen");
}

function renderLobby() {
  const pub = roomPublic();
  const players = playersList();

  $("lobbyTitle").textContent =
    pub.phase === "explore" ? "Expedition in progress" :
    pub.phase === "ended" ? "Expedition complete" :
    "Waiting for survivors";

  $("phaseBadge").textContent = String(pub.phase || "LOBBY").toUpperCase();
  $("roomCodeDisplay").textContent = roomCode || "LOCAL";
  $("playerCount").textContent = `${players.length} / ${MAX_PLAYERS}`;

  $("playerList").innerHTML = players.map(p => {
    const host = p.uid === pub.hostUid || (mode === "local" && p.uid === "local");
    return `<div class="player">
      <div>
        <div class="pname">${escapeHTML(p.name)}${p.uid === user?.uid ? " (YOU)" : ""}</div>
        <div class="pmeta">${p.alive === false ? "ELIMINATED" : `HP ${p.hp ?? 100} · ${p.hunger ?? 100}% HUNGER`}</div>
      </div>
      ${host ? '<span class="host">HOST</span>' : ""}
    </div>`;
  }).join("") || '<p class="fine">No survivors yet.</p>';

  const actions = $("actionArea");
  actions.innerHTML = "";

  if (pub.phase === "lobby") {
    if (isHost || mode === "local") {
      addAction(actions, "LAUNCH EXPEDITION ↗", "primary", launchGame);
    }
    if (mode === "local") {
      $("lobbyHint").textContent = "Practice mode: explore the island and test the controls.";
    } else {
      $("lobbyHint").textContent = isHost
        ? "Invite your friends, then launch the expedition."
        : "Waiting for the host to launch the expedition.";
    }
  } else if (pub.phase === "ended") {
    addAction(actions, "PLAY AGAIN", "primary", resetGame);
    $("lobbyHint").textContent = pub.winner
      ? `${pub.winner} survived the island.`
      : "This expedition has ended.";
  } else {
    $("lobbyHint").textContent = "The island is live. Explore and survive.";
  }

  $("gameArea").classList.toggle("hidden", pub.phase !== "explore");
}

function addAction(parent, text, cls, callback) {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.onclick = callback;
  parent.appendChild(b);
}

async function launchGame() {
  if (mode === "local") {
    localMap = makeMap();
    localPlayer.x = 90;
    localPlayer.z = 90;
    localPlayer.hp = 100;
    localPlayer.hunger = 100;
    localPlayer.alive = true;
    localPlayer.wood = 0;
    localPlayer.stone = 0;
    localPlayer.food = 2;
    localPlayer.shield = false;
    localPlayers = { local: localPlayer };
    localChat.push({ name: "ISLAND", text: "Welcome to the island. Survive!", system: true });
    start3D();
    renderLobby();
    return;
  }

  if (!isHost) return;
  try {
    const snap = await roomRef.once("value");
    const data = snap.val();
    if (!data || data.public.hostUid !== user.uid) throw new Error("Only the host can launch.");

    const players = data.players || {};
    const ids = Object.keys(players);

    if (ids.length < 2) {
      notice("Invite at least one friend before launching.", true);
      return;
    }

    const updates = {
      "public/phase": "explore",
      "public/round": (data.public.round || 0) + 1,
      "public/stormRadius": 75,
      "public/winner": null,
      "map": makeMap()
    };

    ids.forEach((id, i) => {
      const angle = (i / ids.length) * Math.PI * 2;
      updates[`players/${id}/x`] = 90 + Math.cos(angle) * 28;
      updates[`players/${id}/z`] = 90 + Math.sin(angle) * 28;
      updates[`players/${id}/hp`] = 100;
      updates[`players/${id}/hunger`] = 100;
      updates[`players/${id}/alive`] = true;
      updates[`players/${id}/shield`] = false;
      updates[`players/${id}/alliance`] = null;
      updates[`players/${id}/allianceRequest`] = null;
    });

    await roomRef.update(updates);
    await sendChat("The expedition has begun!", true);
  } catch (e) {
    console.error(e);
    notice(e.message || "Couldn't launch the game.", true);
  }
}

function resetGame() {
  if (mode === "local") {
    stop3D();
    localChat = [];
    localPlayers = {};
    localPlayer = null;
    startPractice();
    return;
  }

  if (!isHost) {
    notice("Only the host can restart the expedition.", true);
    return;
  }

  const updates = {
    "public/phase": "lobby",
    "public/winner": null,
    "public/stormRadius": 75,
    map: null
  };

  Object.keys(room.players || {}).forEach(id => {
    updates[`players/${id}/alive`] = true;
    updates[`players/${id}/hp`] = 100;
    updates[`players/${id}/hunger`] = 100;
    updates[`players/${id}/wood`] = 0;
    updates[`players/${id}/stone`] = 0;
    updates[`players/${id}/food`] = 2;
    updates[`players/${id}/shield`] = false;
    updates[`players/${id}/alliance`] = null;
    updates[`players/${id}/allianceRequest`] = null;
  });

  roomRef.update(updates).catch(e => notice(e.message, true));
}

function startPractice() {
  mode = "local";
  roomCode = "LOCAL";
  isHost = true;
  localPlayer = newPlayer(nameValue(), 90, 90);
  localPlayer.uid = "local";
  localPlayers = { local: localPlayer };
  localMap = makeMap();
  localChat = [{
    name: "ISLAND",
    text: "Practice mode started. Explore the island!",
    system: true
  }];

  room = {
    public: { phase: "lobby", hostUid: "local", stormRadius: 75 },
    players: localPlayers,
    map: localMap,
    chat: {}
  };

  showScreen("lobbyScreen");
  renderLobby();
}

function stop3D() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = 0;
  worldReady = false;

  if (renderer) {
    renderer.dispose();
    if (renderer.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  renderer = null;
  scene = null;
  camera = null;
  myCharacter = null;
}

function start3D() {
  if (worldReady) return;
  if (typeof THREE === "undefined") {
    notice("Three.js didn't load. Check your internet connection.", true);
    return;
  }

  const area = $("gameArea");
  area.classList.remove("hidden");

  area.innerHTML = `
    <div class="game-shell">
      <div class="scene-card">
        <canvas class="island-canvas" id="islandCanvas" tabindex="0"></canvas>
        <div class="scene-hud">
          <div class="hud-pill">🏝️ <b>LAST ISLAND</b></div>
          <div class="hud-pill" id="hudPlayers">SURVIVORS: 1</div>
        </div>
        <div class="crosshair"></div>
        <div class="scene-tip" id="sceneTip">WASD to move · Drag to look · E to gather</div>
        <div class="mobile-controls">
          <button data-key="KeyW">▲</button>
          <button data-key="KeyA">◀</button>
          <button data-key="KeyS">▼</button>
          <button data-key="KeyD">▶</button>
        </div>
      </div>

      <aside class="side">
        <section class="card">
          <h3>YOUR CONDITION</h3>
          <div class="stats">
            <div class="stat"><b id="hpValue">100</b><span>HEALTH</span><div class="bar"><i id="hpBar"></i></div></div>
            <div class="stat"><b id="hungerValue">100</b><span>HUNGER</span><div class="bar hunger"><i id="hungerBar"></i></div></div>
          </div>
          <div class="inventory">
            <div class="item"><b id="woodValue">0</b>🪵 WOOD</div>
            <div class="item"><b id="stoneValue">0</b>🪨 STONE</div>
            <div class="item"><b id="foodValue">2</b>🍎 FOOD</div>
          </div>
          <div class="btnrow">
            <button class="secondary" id="gatherButton">GATHER [E]</button>
            <button class="secondary" id="eatButton">EAT [F]</button>
            <button class="secondary" id="shieldButton">CRAFT SHIELD</button>
            <button class="secondary" id="attackButton">ATTACK [Q]</button>
          </div>
        </section>

        <section class="card">
          <h3>NEARBY SURVIVORS</h3>
          <div id="nearbyPlayers" class="nearby"></div>
          <p class="tiny">Move close to another survivor to attack or request an alliance.</p>
        </section>

        <section class="card comms">
          <h3>ISLAND COMMS</h3>
          <div id="chatLog" class="chatlog"></div>
          <form id="chatForm" class="chatform">
            <input id="chatInput" maxlength="120" placeholder="Send a message..." autocomplete="off">
            <button class="primary" type="submit">SEND</button>
          </form>
        </section>
      </aside>
    </div>`;

  buildWorld();
  bindGameControls();
  updateGameUI();
}

function buildWorld() {
  const canvas = $("islandCanvas");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ad4e0);
  scene.fog = new THREE.Fog(0x8ad4e0, 110, 245);

  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500);
  camera.position.set(0, 7, -12);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene.add(new THREE.HemisphereLight(0xc8f4ff, 0x35543b, 1.6));

  const sun = new THREE.DirectionalLight(0xfff1cc, 2);
  sun.position.set(45, 85, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  worldGroup = new THREE.Group();
  playerGroup = new THREE.Group();
  resourceGroup = new THREE.Group();

  scene.add(worldGroup, playerGroup, resourceGroup);

  makeIsland();
  makePlayerModels();

  const p = me();
  if (p) {
    myCharacter.position.set(p.x - 90, 0, p.z - 90);
  }

  clock = new THREE.Clock();
  worldReady = true;
  resize3D();

  window.addEventListener("resize", resize3D);
  canvas.addEventListener("pointerdown", onLookStart);
  canvas.addEventListener("pointermove", onLookMove);
  canvas.addEventListener("pointerup", onLookEnd);
  canvas.addEventListener("pointercancel", onLookEnd);
  canvas.addEventListener("contextmenu", e => e.preventDefault());

  animate3D();
}

function resize3D() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 400;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function mat(color, roughness = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function makeIsland() {
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshStandardMaterial({ color: 0x238fa8, roughness: .35 })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -1.4;
  worldGroup.add(ocean);

  const sand = mat(0xe0c28a);
  const grass = mat(0x3f874c);
  const hillMat = mat(0x52834a);
  const rockMat = mat(0x858d8a);
  const trunkMat = mat(0x765037);
  const leafMat = mat(0x20764a);
  const leafLight = mat(0x38975b);

  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(91, 96, 8, 64, 5),
    grass
  );
  island.position.y = -3;
  island.receiveShadow = true;
  island.castShadow = true;
  worldGroup.add(island);

  const beach = new THREE.Mesh(
    new THREE.CylinderGeometry(95, 96, 2.5, 64),
    sand
  );
  beach.position.y = -1.5;
  worldGroup.add(beach);

  const innerGrass = new THREE.Mesh(
    new THREE.CylinderGeometry(87, 88, 2, 64),
    grass
  );
  innerGrass.position.y = -.2;
  innerGrass.receiveShadow = true;
  worldGroup.add(innerGrass);

  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * Math.PI * 2;
    const radius = 28 + Math.random() * 29;
    const h = 9 + Math.random() * 17;

    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(12 + Math.random() * 9, h, 7),
      hillMat
    );
    hill.position.set(Math.cos(angle) * radius, h / 2 - .5, Math.sin(angle) * radius);
    hill.rotation.y = Math.random() * 3;
    hill.castShadow = true;
    hill.receiveShadow = true;
    worldGroup.add(hill);
  }

  for (let i = 0; i < 100; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 16 + Math.random() * 67;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    if (Math.hypot(x, z) < 15) continue;

    const roll = Math.random();

    if (roll < .63) {
      const tree = new THREE.Group();

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(.45, .8, 4.6, 7),
        trunkMat
      );
      trunk.position.y = 2.3;
      trunk.castShadow = true;
      tree.add(trunk);

      for (let j = 0; j < 3; j++) {
        const crown = new THREE.Mesh(
          new THREE.ConeGeometry(2.3 - j * .25, 4, 8),
          j === 1 ? leafLight : leafMat
        );
        crown.position.y = 4.2 + j * 1.6;
        crown.castShadow = true;
        tree.add(crown);
      }

      tree.position.set(x, 0, z);
      tree.rotation.y = Math.random() * Math.PI;
      tree.scale.setScalar(.7 + Math.random() * .65);
      tree.userData.resource = "tree";
      resourceGroup.add(tree);
    } else if (roll < .84) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.4 + Math.random() * 1.4, 0),
        rockMat
      );
      rock.position.set(x, .9, z);
      rock.scale.y = .7;
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      rock.userData.resource = "rock";
      resourceGroup.add(rock);
    } else {
      const crate = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2, 1.7, 2),
        mat(0x9a7042)
      );
      box.position.y = .85;
      box.castShadow = true;
      crate.add(box);

      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(2.05, .22, 2.05),
        mat(0xd9bd76)
      );
      stripe.position.y = 1;
      crate.add(stripe);
      crate.position.set(x, 0, z);
      crate.userData.resource = "crate";
      resourceGroup.add(crate);
    }
  }

  const hut = new THREE.Group();
  const hutBody = new THREE.Mesh(
    new THREE.BoxGeometry(9, 5, 7),
    mat(0x9c8057)
  );
  hutBody.position.y = 2.5;
  hut.add(hutBody);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(7, 4, 4),
    mat(0x57483a)
  );
  roof.position.y = 6.7;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  hut.add(roof);
  hut.position.set(-25, 0, 20);
  hut.rotation.y = .4;
  worldGroup.add(hut);

  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(3 + Math.random() * 3, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .72 })
    );
    cloud.position.set(-80 + Math.random() * 160, 40 + Math.random() * 22, -80 + Math.random() * 160);
    cloud.scale.set(1.6, .5, 1);
    worldGroup.add(cloud);
  }
}

function makeHuman(color, isMine = false) {
  const g = new THREE.Group();
  const skin = mat(0xc78f6a);
  const shirt = mat(color);
  const pants = mat(0x293846);
  const boots = mat(0x171d22);
  const dark = mat(0x3c2922);

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(.7, 1.2, 4, 8),
    shirt
  );
  body.position.y = 2.2;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(.52, 12, 10),
    skin
  );
  head.position.y = 3.5;
  head.castShadow = true;
  g.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(.53, 12, 8, 0, Math.PI * 2, 0, Math.PI * .55),
    dark
  );
  hair.position.y = 3.68;
  g.add(hair);

  const legs = [];
  const arms = [];

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.CapsuleGeometry(.24, .85, 3, 6),
      pants
    );
    leg.position.set(side * .32, .85, 0);
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);

    const boot = new THREE.Mesh(
      new THREE.BoxGeometry(.45, .25, .7),
      boots
    );
    boot.position.set(side * .32, .25, .13);
    g.add(boot);

    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(.2, .8, 3, 6),
      shirt
    );
    arm.position.set(side * .85, 2.25, 0);
    arm.rotation.z = side * -.12;
    arm.castShadow = true;
    g.add(arm);
    arms.push(arm);
  }

  g.userData.legs = legs;
  g.userData.arms = arms;
  g.userData.walking = false;
  g.userData.isMine = isMine;
  return g;
}

function makePlayerModels() {
  const p = me();
  if (!p) return;

  myCharacter = makeHuman(0x48d8a5, true);
  myCharacter.position.set(p.x - 90, 0, p.z - 90);
  scene.add(myCharacter);

  syncRemotePlayers();
}

function syncRemotePlayers() {
  if (!scene) return;
  const players = playersList();
  const myId = user?.uid || "local";
  const seen = new Set();

  players.forEach((p, i) => {
    const id = p.uid || (mode === "local" ? "local" : null);
    if (!id || id === myId || p.alive === false) return;

    seen.add(id);
    let model = playerGroup.getObjectByName(id);

    if (!model) {
      model = makeHuman([0xf0b45f, 0x7ca6ff, 0xff788b, 0xd2a5ff, 0x75cdd6][i % 5]);
      model.name = id;
      playerGroup.add(model);
    }

    model.position.set((p.x || 90) - 90, 0, (p.z || 90) - 90);
  });

  [...playerGroup.children].forEach(child => {
    if (!seen.has(child.name)) playerGroup.remove(child);
  });
}

function bindGameControls() {
  const canvas = $("islandCanvas");

  window.onkeydown = e => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    keys[e.code] = true;

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }

    if (e.code === "KeyE") gather();
    if (e.code === "KeyF") eat();
    if (e.code === "KeyQ") attackNearest();
  };

  window.onkeyup = e => {
    keys[e.code] = false;
  };

  document.querySelectorAll(".mobile-controls button").forEach(btn => {
    const key = btn.dataset.key;

    btn.addEventListener("pointerdown", e => {
      e.preventDefault();
      keys[key] = true;
      btn.setPointerCapture?.(e.pointerId);
    });

    const release = e => {
      e.preventDefault();
      keys[key] = false;
    };

    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("lostpointercapture", () => { keys[key] = false; });
  });

  $("gatherButton").onclick = gather;
  $("eatButton").onclick = eat;
  $("shieldButton").onclick = craftShield;
  $("attackButton").onclick = attackNearest;

  $("chatForm").onsubmit = async e => {
    e.preventDefault();
    const text = $("chatInput").value.trim();
    if (!text) return;
    $("chatInput").value = "";
    await sendChat(text, false);
  };

  canvas.focus();
}

function onLookStart(e) {
  pointerDown = true;
  pointerMoved = false;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  touchStart = { x: e.clientX, y: e.clientY };
}

function onLookMove(e) {
  if (!pointerDown) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;

  if (Math.abs(dx) + Math.abs(dy) > 2) pointerMoved = true;

  cameraYaw -= dx * .006;
  cameraPitch = Math.max(-.05, Math.min(.75, cameraPitch + dy * .003));
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
}

function onLookEnd() {
  pointerDown = false;
  touchStart = null;
}

function animate3D() {
  if (!worldReady || !renderer) return;

  animationId = requestAnimationFrame(animate3D);
  const dt = Math.min(clock.getDelta(), .05);
  const t = clock.elapsedTime;

  moveCharacter(dt);

  if (myCharacter) {
    const p = myCharacter.position;
    const distance = 12;
    const target = new THREE.Vector3(
      p.x + Math.sin(cameraYaw) * distance,
      p.y + 5 + cameraPitch * 5,
      p.z + Math.cos(cameraYaw) * distance
    );

    camera.position.lerp(target, .13);
    camera.lookAt(p.x, p.y + 2.1, p.z + Math.cos(cameraYaw) * -1.5);
  }

  resourceGroup.children.forEach((obj, i) => {
    if (obj.userData.resource === "crate") {
      obj.position.y = Math.sin(t * 1.7 + i) * .12;
    }
  });

  if (myCharacter?.userData.walking) {
    myCharacter.userData.legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(t * 11 + i * Math.PI) * .55;
    });
    myCharacter.userData.arms.forEach((arm, i) => {
      arm.rotation.x = Math.sin(t * 11 + (i + 1) * Math.PI) * .35;
    });
  } else if (myCharacter) {
    myCharacter.userData.legs.forEach(leg => leg.rotation.x = 0);
    myCharacter.userData.arms.forEach(arm => arm.rotation.x = 0);
  }

  renderer.render(scene, camera);
}

function moveCharacter(dt) {
  if (!myCharacter || !active()) return;

  let forward = 0;
  let sideways = 0;

  if (keys.KeyW || keys.ArrowUp) forward += 1;
  if (keys.KeyS || keys.ArrowDown) forward -= 1;
  if (keys.KeyA || keys.ArrowLeft) sideways -= 1;
  if (keys.KeyD || keys.ArrowRight) sideways += 1;

  const moving = forward !== 0 || sideways !== 0;
  myCharacter.userData.walking = moving;

  if (!moving) return;

  const len = Math.hypot(forward, sideways);
  forward /= len;
  sideways /= len;

  const speed = 13 * dt;
  const fx = -Math.sin(cameraYaw);
  const fz = -Math.cos(cameraYaw);
  const rx = Math.cos(cameraYaw);
  const rz = -Math.sin(cameraYaw);

  const dx = (fx * forward + rx * sideways) * speed;
  const dz = (fz * forward + rz * sideways) * speed;

  const nextX = myCharacter.position.x + dx;
  const nextZ = myCharacter.position.z + dz;

  if (Math.hypot(nextX, nextZ) < 86) {
    myCharacter.position.x = nextX;
    myCharacter.position.z = nextZ;
  }

  const p = me();
  if (!p) return;

  p.x = myCharacter.position.x + 90;
  p.z = myCharacter.position.z + 90;

  const now = Date.now();
  if (mode === "online" && now - lastMoveSend > 180) {
    lastMoveSend = now;
    roomRef.child(`players/${user.uid}`).update({
      x: p.x,
      z: p.z
    }).catch(() => {});
  }

  if (now - lastRender > 700) {
    lastRender = now;
    updateGameUI();
  }
}

function updateGameUI() {
  if (!worldReady && mode !== "local") return;
  const p = me();
  if (!p) return;

  $("hpValue").textContent = Math.max(0, p.hp || 0);
  $("hungerValue").textContent = Math.max(0, p.hunger || 0);
  $("woodValue").textContent = p.wood || 0;
  $("stoneValue").textContent = p.stone || 0;
  $("foodValue").textContent = p.food || 0;
  $("hpBar").style.width = Math.max(0, p.hp || 0) + "%";
  $("hungerBar").style.width = Math.max(0, p.hunger || 0) + "%";

  $("hudPlayers").textContent = "SURVIVORS: " + alivePlayers().length;

  const pub = roomPublic();
  $("sceneTip").textContent = pub.stormRadius < 45
    ? "⚠️ The storm is closing in! Move toward the island center."
    : "WASD to move · Drag to look · E to gather · Q to attack";

  renderNearby();
  renderChat();
  syncRemotePlayers();
}

function renderNearby() {
  const container = $("nearbyPlayers");
  const p = me();
  if (!container || !p) return;

  const near = alivePlayers().filter(other => {
    if (other === p || (other.uid && other.uid === user?.uid)) return false;
    return Math.hypot((other.x || 0) - p.x, (other.z || 0) - p.z) < 22;
  });

  if (!near.length) {
    container.innerHTML = '<p class="tiny">No survivors nearby. Explore the island.</p>';
    return;
  }

  container.innerHTML = near.map(other => {
    const same = p.alliance && p.alliance === other.alliance;
    return `<div class="near">
      <span>${escapeHTML(other.name)}${same ? " 🤝" : ""}</span>
      <span class="nearbtn">
        <button class="mini" data-action="ally" data-id="${escapeHTML(other.uid || "local")}">ALLY</button>
        <button class="mini hit" data-action="attack" data-id="${escapeHTML(other.uid || "local")}">HIT</button>
      </span>
    </div>`;
  }).join("");

  container.querySelectorAll("button").forEach(btn => {
    btn.onclick = () => {
      const target = playersList().find(x => (x.uid || "local") === btn.dataset.id);
      if (!target) return;
      if (btn.dataset.action === "ally") requestAlliance(target);
      else attack(target);
    };
  });
}

function renderChat() {
  const el = $("chatLog");
  if (!el) return;

  let messages = [];

  if (mode === "local") {
    messages = localChat.slice(-35);
  } else {
    messages = Object.values(room?.chat || {})
      .sort((a, b) => (a.time || 0) - (b.time || 0))
      .slice(-35);
  }

  el.innerHTML = messages.map(m => `
    <div class="msg ${m.system ? "system" : ""}">
      <b>${escapeHTML(m.name || "SURVIVOR")}:</b>
      ${escapeHTML(m.text || "")}
    </div>`).join("");

  el.scrollTop = el.scrollHeight;
}

async function sendChat(text, system = false) {
  const message = {
    name: system ? "ISLAND" : (me()?.name || nameValue()),
    text: String(text).slice(0, 120),
    time: Date.now(),
    system
  };

  if (mode === "local") {
    localChat.push(message);
    renderChat();
    return;
  }

  if (!roomRef) return;

  try {
    await roomRef.child("chat").push(message);
  } catch (e) {
    notice("Couldn't send message.", true);
  }
}

function distanceTo(a, b) {
  return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));
}

function nearestResource() {
  if (!myCharacter) return null;
  const pos = myCharacter.position;
  let nearest = null;
  let best = 6;

  resourceGroup.children.forEach(obj => {
    if (!obj.userData.resource) return;
    const d = Math.hypot(obj.position.x - pos.x, obj.position.z - pos.z);
    if (d < best) {
      best = d;
      nearest = obj;
    }
  });

  return nearest;
}

async function modifyMe(updates) {
  const p = me();
  if (!p) return;

  if (mode === "local") {
    Object.assign(p, updates);
    updateGameUI();
    renderLobby();
    return;
  }

  try {
    await roomRef.child(`players/${user.uid}`).update(updates);
  } catch (e) {
    notice("Action failed to sync.", true);
  }
}

async function gather() {
  if (!active()) return;

  const p = me();
  const obj = nearestResource();

  if (!obj) {
    notice("Move closer to a tree, rock, or supply crate first.");
    return;
  }

  const kind = obj.userData.resource;
  const updates = {};

  if (kind === "tree") {
    updates.wood = (p.wood || 0) + 2;
    notice("Collected 2 wood.");
  } else if (kind === "rock") {
    updates.stone = (p.stone || 0) + 2;
    notice("Collected 2 stone.");
  } else {
    updates.food = (p.food || 0) + 2;
    updates.wood = (p.wood || 0) + 1;
    notice("Supply crate opened! Found food and wood.");
  }

  await modifyMe(updates);

  if (mode === "local") {
    resourceGroup.remove(obj);
  } else {
    obj.userData.resource = null;
    // The visual resource is client-side; other players can still collect it.
    // Shared resource depletion can be added with a dedicated database map.
  }
}

async function eat() {
  const p = me();
  if (!active() || !p || (p.food || 0) < 1) {
    notice("You don't have any food.", true);
    return;
  }

  await modifyMe({
    food: p.food - 1,
    hunger: Math.min(100, (p.hunger || 0) + 30)
  });
  notice("You ate food. Hunger restored.");
}

async function craftShield() {
  const p = me();
  if (!active() || !p) return;

  if (p.shield) {
    notice("You already have a shield.");
    return;
  }

  if ((p.wood || 0) < 3 || (p.stone || 0) < 2) {
    notice("You need 3 wood and 2 stone to craft a shield.", true);
    return;
  }

  await modifyMe({
    wood: p.wood - 3,
    stone: p.stone - 2,
    shield: true
  });

  notice("Shield crafted! Your next attack damage is reduced.");
}

async function attackNearest() {
  const p = me();
  if (!p) return;

  const target = alivePlayers()
    .filter(other => other !== p && (!other.uid || other.uid !== user?.uid))
    .filter(other => distanceTo(p, other) < 15)
    .sort((a, b) => distanceTo(p, a) - distanceTo(p, b))[0];

  if (!target) {
    notice("No rival close enough. Move closer first.");
    return;
  }

  await attack(target);
}

async function attack(target) {
  const p = me();
  if (!active() || !p || !target || target.alive === false) return;

  if (distanceTo(p, target) > 16) {
    notice("Move closer to attack.", true);
    return;
  }

  if (p.alliance && p.alliance === target.alliance) {
    notice("You cannot attack your ally. Break the alliance first.", true);
    return;
  }

  const damage = target.shield ? 10 : 25;
  const hp = Math.max(0, (target.hp || 100) - damage);

  if (mode === "local") {
    target.hp = hp;
    if (hp <= 0) target.alive = false;
    updateGameUI();
    renderLobby();
  } else {
    await roomRef.child(`players/${target.uid}`).update({
      hp,
      alive: hp > 0
    });
  }

  notice(`You attacked ${target.name} for ${damage} damage.`);

  if (hp <= 0) {
    await sendChat(`${target.name} has been eliminated!`, true);
    await checkWinner();
  }
}

async function requestAlliance(target) {
  const p = me();
  if (!active() || !p || !target || target.alive === false) return;

  if (distanceTo(p, target) > 22) {
    notice("Move closer to request an alliance.");
    return;
  }

  const myId = mode === "local" ? "local" : user.uid;
  const targetId = target.uid || "local";

  if (target.allianceRequest === myId) {
    const allianceId = "alliance-" + [myId, targetId].sort().join("-");
    if (mode === "local") {
      p.alliance = allianceId;
      target.alliance = allianceId;
      target.allianceRequest = null;
      updateGameUI();
    } else {
      const updates = {};
      updates[`players/${myId}/alliance`] = allianceId;
      updates[`players/${targetId}/alliance`] = allianceId;
      updates[`players/${targetId}/allianceRequest`] = null;
      updates[`players/${myId}/allianceRequest`] = null;
      await roomRef.update(updates);
    }
    await sendChat(`${p.name} and ${target.name} formed an alliance!`, true);
    notice("Alliance formed!");
    return;
  }

  if (mode === "local") {
    target.allianceRequest = myId;
    updateGameUI();
  } else {
    await roomRef.child(`players/${targetId}/allianceRequest`).set(myId);
  }

  notice(`Alliance request sent to ${target.name}. They can accept by requesting you back.`);
}

async function breakAlliance() {
  const p = me();
  if (!p?.alliance) {
    notice("You are not in an alliance.");
    return;
  }

  const alliance = p.alliance;

  if (mode === "local") {
    Object.values(localPlayers).forEach(other => {
      if (other.alliance === alliance) other.alliance = null;
    });
    updateGameUI();
  } else {
    const updates = {};
    Object.entries(room.players || {}).forEach(([id, other]) => {
      if (other.alliance === alliance) updates[`players/${id}/alliance`] = null;
    });
    await roomRef.update(updates);
  }

  notice("Alliance broken.");
}

async function checkWinner() {
  if (mode !== "local" && !isHost) return;

  const alive = alivePlayers();
  if (alive.length > 1) return;

  const winner = alive[0]?.name || "Nobody";

  if (mode === "local") {
    room.public.phase = "ended";
    room.public.winner = winner;
    renderLobby();
    stop3D();
  } else {
    await roomRef.update({
      "public/phase": "ended",
      "public/winner": winner
    });
    await sendChat(`${winner} wins LAST ISLAND!`, true);
  }
}

function distanceFromCenter(p) {
  return Math.hypot((p.x || 90) - 90, (p.z || 90) - 90);
}

async function tickSurvival() {
  if (!active()) return;

  const p = me();
  const hunger = Math.max(0, (p.hunger || 100) - 1);
  const updates = { hunger };

  if (hunger === 0) updates.hp = Math.max(0, (p.hp || 100) - 5);

  if (distanceFromCenter(p) > (roomPublic().stormRadius || 75)) {
    updates.hp = Math.max(0, (updates.hp ?? p.hp ?? 100) - 5);
    notice("The storm is damaging you! Return toward the center.", true);
  }

  if ((updates.hp ?? p.hp) <= 0) updates.alive = false;

  await modifyMe(updates);

  if (updates.alive === false) {
    await sendChat(`${p.name} was eliminated by the island.`, true);
    await checkWinner();
  }
}

function startStorm() {
  if (startStorm.timer) clearInterval(startStorm.timer);

  startStorm.timer = setInterval(async () => {
    if (!active()) return;

    stormTick++;

    if (mode === "local" || isHost) {
      const radius = Math.max(18, 75 - stormTick * 2);

      if (mode === "local") {
        room.public.stormRadius = radius;
      } else {
        await roomRef.child("public/stormRadius").set(radius);
      }

      await tickSurvival();
      await checkWinner();
    } else {
      await tickSurvival();
    }

    if (worldReady) updateGameUI();
  }, 12000);
}

function leaveSession(goHome = true) {
  detachRoom();
  stop3D();

  if (startStorm.timer) clearInterval(startStorm.timer);

  room = null;
  roomCode = "";
  mode = "none";
  isHost = false;
  worldReady = false;
  localPlayer = null;
  localPlayers = {};
  localChat = [];

  if (goHome) showScreen("homeScreen");
}

async function leaveGame() {
  if (mode === "online" && roomRef && user) {
    try {
      const wasHost = isHost;
      await roomRef.child(`players/${user.uid}`).remove();

      const snap = await roomRef.once("value");
      const data = snap.val();
      const ids = Object.keys(data?.players || {});

      if (ids.length === 0) {
        await roomRef.remove();
      } else if (wasHost) {
        await roomRef.child("public/hostUid").set(ids[0]);
      }
    } catch (e) {
      console.warn("Leave room cleanup:", e);
    }
  }

  leaveSession(true);
}

$("createButton").onclick = createRoom;
$("joinButton").onclick = joinRoom;
$("localButton").onclick = startPractice;
$("leaveButton").onclick = leaveGame;

$("copyRoomButton").onclick = async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    notice("Room code copied!");
  } catch {
    notice("Your room code is " + roomCode);
  }
};

window.addEventListener("pagehide", () => {
  if (animationId) cancelAnimationFrame(animationId);
  detachRoom();
});

setStatus("READY TO CONNECT", false);
