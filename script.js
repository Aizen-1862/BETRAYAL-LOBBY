
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const EYE = 1.65;
  const SPEED = 8.5;
  const GRAVITY = 22;
  const JUMP = 9.2;
  const MAX_PLAYERS = 8;
  const COLORS = [0xff5d9e, 0x56e8ff, 0xffdf70, 0x9b82ff, 0x65f0b1, 0xff945e, 0xf6f7ff, 0x83a6ff];

  const MAPS = {
    "neon-rush": {
      name: "NEON RUSH",
      description: "A glowing night course packed with spinning bars.",
      sky: 0x15204f, fog: 0x253d85, platform: 0x5948d8,
      accent: 0x55f1f3, hazard: 0xff4db8, pattern: [0, 2, -2, 3, -3, 1, -1, 2, 0],
      obstacles: ["spinner", "sweeper", "spinner", "hammer", "bumper"]
    },
    "candy-chaos": {
      name: "CANDY CHAOS",
      description: "Bubblegum platforms and bouncing bumpers.",
      sky: 0x54245d, fog: 0xa45caa, platform: 0xff80bd,
      accent: 0xffdf72, hazard: 0x8e55ff, pattern: [0, -2, 2, -3, 3, -1, 1, -2, 0],
      obstacles: ["bumper", "spinner", "bumper", "hammer", "sweeper"]
    },
    "sky-bridges": {
      name: "SKY BRIDGES",
      description: "Narrow sky islands, long jumps, and moving platforms.",
      sky: 0x59a9ec, fog: 0xb0dfff, platform: 0x4bcbd6,
      accent: 0xffffff, hazard: 0xffa54f, pattern: [0, 3, -3, 3, -3, 2, -2, 3, 0],
      obstacles: ["sweeper", "hammer", "spinner", "sweeper", "hammer"],
      moving: [2, 5, 7]
    },
    "lava-run": {
      name: "LAVA RUN",
      description: "Hot orange platforms with swinging hammers.",
      sky: 0x391c2c, fog: 0x743b43, platform: 0x9e3e50,
      accent: 0xffb84d, hazard: 0xff4e30, pattern: [0, 2, -2, 3, -3, 2, -2, 1, 0],
      obstacles: ["hammer", "spinner", "hammer", "sweeper", "hammer"]
    },
    "ice-breaker": {
      name: "ICE BREAKER",
      description: "Slippery-looking ice islands and fast sweepers.",
      sky: 0x90d8ed, fog: 0xc9f2ff, platform: 0x72bfe8,
      accent: 0xffffff, hazard: 0x5268ff, pattern: [0, -1, 2, -2, 3, -3, 2, -1, 0],
      obstacles: ["sweeper", "spinner", "sweeper", "bumper", "spinner"],
      moving: [3, 6]
    },
    "jungle-bounce": {
      name: "JUNGLE BOUNCE",
      description: "Green floating platforms, bumpers, and swinging traps.",
      sky: 0x174d4c, fog: 0x317b69, platform: 0x31845e,
      accent: 0x9aff79, hazard: 0xffcf57, pattern: [0, 2, 3, 1, -2, -3, -1, 2, 0],
      obstacles: ["bumper", "hammer", "bumper", "spinner", "sweeper"]
    },
    "cyber-factory": {
      name: "CYBER FACTORY",
      description: "Industrial steel islands and heavy mechanical hazards.",
      sky: 0x20283a, fog: 0x515f79, platform: 0x58677c,
      accent: 0x55f1f3, hazard: 0xff634d, pattern: [0, 3, 1, -2, -3, 1, 3, -1, 0],
      obstacles: ["spinner", "hammer", "sweeper", "spinner", "hammer"],
      moving: [2, 6]
    },
    "rainbow-gauntlet": {
      name: "RAINBOW GAUNTLET",
      description: "Colorful platforms with a mix of every obstacle.",
      sky: 0x483c99, fog: 0x9a87dc, platform: 0x9b82ff,
      accent: 0xffdf72, hazard: 0xff5d9e, pattern: [0, -3, 2, -2, 3, -1, 2, -3, 0],
      obstacles: ["spinner", "bumper", "hammer", "sweeper", "spinner"],
      moving: [3, 6]
    }
  };

  const MAP_IDS = Object.keys(MAPS);

  let renderer, scene, camera, clock, mapRoot;
  let built = false, loopStarted = false;
  let mode = "menu", peer = null, hostConn = null;
  let meId = "", me = null, myName = "Player";
  let roomHost = false, roundActive = false, roundWinner = "";
  let roundEndShown = false, networkTimer = 0;
  let yaw = 0, pitch = 0, jumpQueued = false;
  let lastLookX = null, lastLookY = null;
  let players = {}, connections = new Map(), remoteModels = new Map();
  let platforms = [], obstacles = [], keys = {}, touchMoves = {};
  let selectedMap = "random", actualMapId = "neon-rush";
  const velocity = { x: 0, y: 0, z: 0 };

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function status(value) { setText("homeStatus", value); }
  function connectionStatus(value) { setText("connectionStatus", value); }

  function randomName() {
    return "Player" + Math.floor(100 + Math.random() * 900);
  }

  function randomMapId() {
    return MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)];
  }

  function resolveMap(value) {
    return MAPS[value] ? value : randomMapId();
  }

  function mapDescription(value) {
    return value === "random"
      ? "A surprise course every round."
      : (MAPS[value]?.description || "Choose your next challenge.");
  }

  function updateMapDescriptions() {
    setText("mapDescription", mapDescription($("mapSelect").value));
    setText("roomMapDescription", mapDescription($("roomMapSelect").value));
  }

  function makePlayer(id, name, color) {
    return {
      id, name,
      color: color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
      x: 0, y: EYE, z: 7, yaw: 0, alive: true
    };
  }

  function resetPosition(p, index = 0) {
    const x = ((index % 8) - 3.5) * 1.7;
    p.x = x;
    p.y = EYE;
    p.z = 8 + (index % 2) * 2;
    p.yaw = 0;
    p.alive = true;

    if (p.id === meId) {
      camera.position.set(p.x, p.y, p.z);
      yaw = 0;
      pitch = 0;
      velocity.x = velocity.y = velocity.z = 0;
    }
  }

  function applyPlayerPosition(p) {
    if (!p) return;
    me.x = Number(p.x) || 0;
    me.y = Number(p.y) || EYE;
    me.z = Number(p.z) || 7;
    me.yaw = Number(p.yaw) || 0;
    me.alive = p.alive !== false;
    camera.position.set(me.x, me.y, me.z);
    yaw = me.yaw;
    pitch = 0;
    velocity.x = velocity.y = velocity.z = 0;
  }

  /* ---------- SCENE AND MAPS ---------- */

  function addToMap(object) {
    mapRoot.add(object);
    return object;
  }

  function disposeObject(object) {
    object.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material)
          ? child.material : [child.material];
        materials.forEach(material => material.dispose());
      }
    });
  }

  function clearMap() {
    if (mapRoot) {
      scene.remove(mapRoot);
      disposeObject(mapRoot);
    }
    mapRoot = new THREE.Group();
    scene.add(mapRoot);
    platforms = [];
    obstacles = [];
  }

  function addPlatform(x, z, width, depth, color, options = {}) {
    const top = options.top ?? 0;
    const height = options.height ?? 0.8;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.52,
      metalness: options.metalness ?? 0.08
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, top - height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    addToMap(mesh);

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: options.edgeColor ?? 0xffffff,
      transparent: true,
      opacity: 0.65
    });
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
    edge.position.copy(mesh.position);
    addToMap(edge);

    const platform = {
      x, z, baseX: x, baseZ: z, width, depth, top, height,
      mesh, edge, moving: !!options.moving,
      moveAmplitude: options.moveAmplitude ?? 3,
      moveSpeed: options.moveSpeed ?? 0.9,
      movePhase: Math.random() * Math.PI * 2
    };

    platforms.push(platform);
    return platform;
  }

  function addCloud(x, y, z, scale, color = 0xffffff) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color, roughness: 1, flatShading: true
    });

    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1.5 + Math.random() * 1.4, 10, 8),
        material
      );
      puff.position.set((i - 2) * 1.8, Math.random() * 0.5, Math.random() * 1.8);
      group.add(puff);
    }

    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    addToMap(group);
  }

  function addDecorationPillar(x, z, height, color) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.6, height, 10),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.45, metalness: 0.16,
        emissive: color, emissiveIntensity: 0.07
      })
    );
    mesh.position.set(x, height / 2 - 0.4, z);
    mesh.castShadow = true;
    addToMap(mesh);
  }

  function addSpinner(x, z, length, speed, color, top = 0) {
    const pivot = new THREE.Group();
    pivot.position.set(x, top + 1.05, z);

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.5, 0.85),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.3, metalness: 0.25,
        emissive: color, emissiveIntensity: 0.22
      })
    );
    bar.castShadow = true;
    pivot.add(bar);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.62, 1.0, 20),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, metalness: 0.3, roughness: 0.3
      })
    );
    hub.rotation.x = Math.PI / 2;
    pivot.add(hub);
    addToMap(pivot);

    obstacles.push({
      type: "spinner", x, z, top, pivot, length,
      speed, angle: Math.random() * Math.PI * 2
    });
  }

  function addSweeper(x, z, width, speed, color, top = 0) {
    const group = new THREE.Group();
    group.position.set(x, top + 1.0, z);

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1.0, 1.0),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.32, metalness: 0.15,
        emissive: color, emissiveIntensity: 0.18
      })
    );
    beam.castShadow = true;
    group.add(beam);

    const endMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: 0.4, roughness: 0.25
    });
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 12, 10), endMaterial
      );
      cap.position.x = side * width / 2;
      group.add(cap);
    }

    addToMap(group);
    obstacles.push({
      type: "sweeper", x, z, top, group, width, speed,
      phase: Math.random() * Math.PI * 2, offsetX: 0
    });
  }

  function addHammer(x, z, color, top = 0) {
    const pivot = new THREE.Group();
    pivot.position.set(x, top + 3.5, z);

    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 3.8, 0.42),
      new THREE.MeshStandardMaterial({
        color: 0xf4f7ff, metalness: 0.55, roughness: 0.3
      })
    );
    arm.position.y = -1.4;
    arm.castShadow = true;
    pivot.add(arm);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 1.5, 1.6),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.28, metalness: 0.25,
        emissive: color, emissiveIntensity: 0.16
      })
    );
    head.position.y = -3.1;
    head.castShadow = true;
    pivot.add(head);

    addToMap(pivot);
    obstacles.push({
      type: "hammer", x, z, top, pivot, phase: Math.random() * Math.PI * 2
    });
  }

  function addBumper(x, z, color, top = 0) {
    const group = new THREE.Group();
    group.position.set(x, top + 0.95, z);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 20, 16),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.28, metalness: 0.12,
        emissive: color, emissiveIntensity: 0.18
      })
    );
    sphere.castShadow = true;
    group.add(sphere);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.12, 0.08, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    addToMap(group);

    obstacles.push({ type: "bumper", x, z, top, group });
  }

  function addHazard(type, x, z, color, top = 0) {
    if (type === "spinner") addSpinner(x, z, 8.5, 1.7, color, top);
    if (type === "sweeper") addSweeper(x, z, 8, 1.7, color, top);
    if (type === "hammer") addHammer(x, z, color, top);
    if (type === "bumper") addBumper(x, z, color, top);
  }

  function buildMap(id) {
    if (!scene) return;
    actualMapId = MAPS[id] ? id : "neon-rush";
    const map = MAPS[actualMapId];
    clearMap();

    scene.background = new THREE.Color(map.sky);
    scene.fog = new THREE.Fog(map.fog, 65, 205);

    const baseColors = [
      map.platform, map.accent, map.hazard,
      0x9b82ff, 0x65f0b1, 0xffdf72, 0x83a6ff
    ];

    // Large starting island.
    addPlatform(0, 8, 25, 25, map.platform, {
      edgeColor: map.accent, roughness: 0.42
    });

    // Long course: the changing path makes each arena feel different.
    const route = [];
    for (let i = 0; i < 9; i++) {
      const offset = map.pattern[i] * 3.0;
      const z = -12 - i * 13.0;
      const width = i % 3 === 1 ? 10 : 12;
      const depth = i % 4 === 2 ? 11 : 10.5;
      const moving = (map.moving || []).includes(i);

      const p = addPlatform(offset, z, width, depth,
        baseColors[(i + 1) % baseColors.length], {
          edgeColor: map.accent,
          roughness: actualMapId === "ice-breaker" ? 0.23 : 0.5,
          metalness: actualMapId === "cyber-factory" ? 0.45 : 0.08,
          moving,
          moveAmplitude: moving ? 2.2 : 0,
          moveSpeed: 0.75 + (i % 3) * 0.2
        });

      route.push(p);

      // Side islands create optional detours and alternate approaches.
      if (i % 2 === 1) {
        const side = i % 4 === 1 ? -1 : 1;
        const sideX = offset + side * (width / 2 + 5.5);
        addPlatform(sideX, z - 1.5, 5.5, 6.5,
          baseColors[(i + 3) % baseColors.length], {
            edgeColor: map.accent,
            roughness: 0.55
          });
      }

      if (i > 0 || actualMapId === "neon-rush") {
        const hazardType = map.obstacles[i % map.obstacles.length];
        addHazard(hazardType, offset, z, map.hazard);
      }

      // Extra hazards add pressure without filling every landing spot.
      if (i === 3 || i === 7) {
        const side = i % 2 ? 1 : -1;
        addHazard("bumper", offset + side * 2.5, z + 2.4, map.accent);
      }
    }

    // Finish island.
    addPlatform(map.pattern[8] * 3, -132, 19, 20, map.accent, {
      edgeColor: 0xffffff, roughness: 0.4
    });

    // Map-specific scenery around the course.
    for (let i = 0; i < 18; i++) {
      const z = 12 - i * 8.3;
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (19 + (i % 4) * 3);
      addDecorationPillar(
        x, z, 2.5 + (i % 4) * 1.2,
        baseColors[i % baseColors.length]
      );
    }

    for (let i = 0; i < 15; i++) {
      const x = (Math.random() - 0.5) * 150;
      const z = 12 - Math.random() * 170;
      const y = 14 + Math.random() * 24;
      addCloud(x, y, z, 0.65 + Math.random() * 0.75,
        actualMapId === "lava-run" ? 0xffb7a0 : 0xffffff);
    }

    // Finish marker: two glowing columns and a banner.
    const finishX = map.pattern[8] * 3;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.45, 6, 12),
        new THREE.MeshStandardMaterial({
          color: map.hazard, emissive: map.hazard,
          emissiveIntensity: 0.3, metalness: 0.2
        })
      );
      post.position.set(finishX + side * 6, 3, -128);
      post.castShadow = true;
      addToMap(post);
    }

    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(12, 1.5, 0.35),
      new THREE.MeshStandardMaterial({
        color: map.accent, emissive: map.accent,
        emissiveIntensity: 0.3
      })
    );
    banner.position.set(finishX, 5, -128);
    addToMap(banner);

    setText("roundMessage", map.name + " — RUN. JUMP. SURVIVE.");
  }

  function buildWorld() {
    if (built) return;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15204f);
    scene.fog = new THREE.Fog(0x253d85, 65, 205);

    camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 400);
    camera.rotation.order = "YXZ";
    camera.position.set(0, EYE, 8);

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.65));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $("scene").appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe9f8ff, 0x394268, 2.0));

    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(-24, 45, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.bias = -0.00025;
    scene.add(sun);

    clock = new THREE.Clock();
    built = true;
    buildMap("neon-rush");
  }

  /* ---------- PLAYER AVATARS ---------- */

  function makeAvatar(p) {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.43, 0.55, 4, 10),
      new THREE.MeshStandardMaterial({
        color: p.color, roughness: 0.42
      })
    );
    body.position.y = 0.95;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 18, 14),
      new THREE.MeshStandardMaterial({
        color: 0xffdfbd, roughness: 0.48
      })
    );
    head.position.y = 1.72;
    head.castShadow = true;
    group.add(head);

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x182039 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 10, 8), eyeMaterial
      );
      eye.position.set(side * 0.13, 1.78, -0.34);
      group.add(eye);
    }

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.045, 8, 24),
      new THREE.MeshBasicMaterial({ color: p.color })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    group.add(ring);
    group.userData.ring = ring;
    scene.add(group);
    return group;
  }

  function updateRemoteModels(dt) {
    for (const p of Object.values(players)) {
      if (!p || p.id === meId) continue;

      if (!remoteModels.has(p.id)) {
        remoteModels.set(p.id, makeAvatar(p));
      }

      const model = remoteModels.get(p.id);
      model.visible = p.alive !== false;
      model.position.lerp(
        new THREE.Vector3(p.x || 0, (p.y || EYE) - EYE, p.z || 0),
        Math.min(1, dt * 10)
      );
      model.rotation.y = p.yaw || 0;
      model.userData.ring.rotation.z += dt * 1.2;
    }

    for (const [id, model] of remoteModels) {
      if (!players[id] || id === meId) {
        scene.remove(model);
        disposeObject(model);
        remoteModels.delete(id);
      }
    }
  }

  /* ---------- PLATFORM AND OBSTACLE PHYSICS ---------- */

  function platformUnder(x, z) {
    let best = null;
    for (const p of platforms) {
      if (
        Math.abs(x - p.x) <= p.width / 2 - 0.12 &&
        Math.abs(z - p.z) <= p.depth / 2 - 0.12
      ) {
        if (!best || p.top > best.top) best = p;
      }
    }
    return best;
  }

  function distanceToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = dx * dx + dz * dz;
    let t = len ? ((px - ax) * dx + (pz - az) * dz) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  }

  function knockback(x, z, strength = 8) {
    const dx = camera.position.x - x;
    const dz = camera.position.z - z;
    const length = Math.hypot(dx, dz) || 1;
    velocity.x += dx / length * strength;
    velocity.z += dz / length * strength;
    velocity.y = Math.max(velocity.y, 4.5);
  }

  function hitObstacles() {
    if (!me || !me.alive) return;

    const px = camera.position.x;
    const pz = camera.position.z;
    const feet = camera.position.y - EYE;

    for (const o of obstacles) {
      if (feet < o.top - 0.15 || feet > o.top + 2.2) continue;

      if (o.type === "spinner") {
        const half = o.length / 2;
        const a = o.angle;
        const ax = o.x - Math.cos(a) * half;
        const az = o.z - Math.sin(a) * half;
        const bx = o.x + Math.cos(a) * half;
        const bz = o.z + Math.sin(a) * half;

        if (distanceToSegment(px, pz, ax, az, bx, bz) < 1.05) {
          knockback(o.x, o.z, 8);
        }
      }

      if (o.type === "sweeper") {
        const dx = px - (o.x + o.offsetX);
        const dz = pz - o.z;
        if (Math.abs(dx) < o.width / 2 + 0.55 && Math.abs(dz) < 1.0) {
          knockback(o.x + o.offsetX, o.z, 8);
        }
      }

      if (o.type === "hammer") {
        const head = o.pivot.children[1];
        const world = new THREE.Vector3();
        head.getWorldPosition(world);
        if (Math.hypot(px - world.x, pz - world.z) < 1.8 &&
            Math.abs(feet - world.y) < 2.0) {
          knockback(world.x, world.z, 10);
        }
      }

      if (o.type === "bumper") {
        const dx = px - o.x;
        const dz = pz - o.z;
        if (Math.hypot(dx, dz) < 1.55) {
          knockback(o.x, o.z, 10);
        }
      }
    }
  }

  function eliminate() {
    if (!me || !me.alive) return;

    me.alive = false;
    velocity.x = velocity.y = velocity.z = 0;
    setText("playerStatus", "ELIMINATED");
    setText("roundMessage", "YOU FELL! WAIT FOR THE WINNER");
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

    const previousFeet = camera.position.y - EYE;
    const previousX = camera.position.x;
    const previousZ = camera.position.z;
    const previousGround = platformUnder(previousX, previousZ);

    if (jumpQueued) {
      if (previousGround && Math.abs(previousFeet - previousGround.top) < 0.18) {
        velocity.y = JUMP;
      }
      jumpQueued = false;
    }

    camera.position.x += velocity.x * dt;
    camera.position.z += velocity.z * dt;
    velocity.y -= GRAVITY * dt;
    camera.position.y += velocity.y * dt;

    const feet = camera.position.y - EYE;
    const ground = platformUnder(camera.position.x, camera.position.z);

    if (ground && previousFeet >= ground.top - 0.16 &&
        feet <= ground.top && velocity.y <= 0) {
      camera.position.y = ground.top + EYE;
      velocity.y = 0;

      if (ground.moving) {
        camera.position.x += (ground.x - ground.baseX) * 0.0;
      }
    }

    hitObstacles();

    if (camera.position.y < -12) {
      if (roundActive && mode !== "practice") {
        eliminate();
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

    setText("playerStatus", roundActive ? "IN THE ROUND" : "PRACTICE");
  }

  function updateWorld(dt) {
    const elapsed = clock.elapsedTime;

    for (const p of platforms) {
      if (!p.moving) continue;
      p.x = p.baseX + Math.sin(elapsed * p.moveSpeed + p.movePhase) * p.moveAmplitude;
      p.mesh.position.x = p.x;
      p.edge.position.x = p.x;
    }

    for (const o of obstacles) {
      if (o.type === "spinner") {
        o.angle += o.speed * dt;
        o.pivot.rotation.y = o.angle;
      } else if (o.type === "sweeper") {
        o.offsetX = Math.sin(elapsed * o.speed + o.phase) * 2.6;
        o.group.position.x = o.x + o.offsetX;
      } else if (o.type === "hammer") {
        o.pivot.rotation.z = Math.sin(elapsed * 1.7 + o.phase) * 0.78;
      } else if (o.type === "bumper") {
        o.group.scale.setScalar(1 + Math.sin(elapsed * 3 + o.x) * 0.07);
      }
    }

    updateRemoteModels(dt);
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

    $("roomMapSelect").disabled = !roomHost || roundActive;

    if (roomHost && list.length < 2) {
      setText("roomStatus", "Share your code and wait for friends.");
    } else if (roomHost && !roundActive) {
      setText("roomStatus", "Everyone ready? Start the round!");
    }
  }

  function startNewRound() {
    if (mode === "practice") {
      actualMapId = selectedMap === "random" ? randomMapId() : selectedMap;
      buildMap(actualMapId);
      roundActive = false;
      roundEndShown = false;
      resetPosition(me, 0);
      $("messageOverlay").classList.add("hidden");
      setText("roundMessage", MAPS[actualMapId].name + " — PRACTICE MODE");
      return;
    }

    if (!roomHost) {
      setText("roomStatus", "Only the host can start the round.");
      return;
    }

    actualMapId = selectedMap === "random" ? randomMapId() : selectedMap;
    buildMap(actualMapId);

    roundActive = true;
    roundWinner = "";
    roundEndShown = false;
    $("messageOverlay").classList.add("hidden");

    const list = Object.values(players).filter(Boolean);
    list.forEach((p, i) => resetPosition(p, i));
    players[meId] = me;

    for (const conn of connections.values()) {
      if (conn.open) {
        conn.send({
          type: "roundStart",
          players,
          roundActive: true,
          mapId: actualMapId
        });
      }
    }

    setText("roundMessage", MAPS[actualMapId].name + " — DON'T FALL!");
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
        if (conn.open) {
          conn.send({ type: "roundEnd", winner: roundWinner });
        }
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

  /* ---------- MULTIPLAYER ---------- */

  function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "CA";
    for (let i = 0; i < 7; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  function broadcastPlayers() {
    if (mode !== "host" || !me) return;

    players[meId] = me;
    const packet = {
      type: "players", players, roundActive,
      winner: roundWinner, mapId: actualMapId
    };

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
        roundActive,
        mapId: selectedMap,
        previewMap: actualMapId
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
      if (players[meId]) Object.assign(me, players[meId]);
      players[meId] = me;

      selectedMap = data.mapId || "random";
      $("roomMapSelect").value = selectedMap;
      actualMapId = MAPS[data.previewMap] ? data.previewMap : "neon-rush";
      buildMap(actualMapId);
      roundActive = !!data.roundActive;

      if (roundActive && players[meId]) applyPlayerPosition(players[meId]);

      setText("roomCode", hostConn.peer);
      setText("roomStatus", "Connected! Invite friends with this code.");
      connectionStatus("ONLINE");
      showGameUI();
      updateMapDescriptions();
      updateHUD();
      return;
    }

    if (data.type === "mapPreview") {
      selectedMap = data.mapId || "random";
      actualMapId = MAPS[data.previewMap] ? data.previewMap : randomMapId();
      $("roomMapSelect").value = selectedMap;

      if (!roundActive) buildMap(actualMapId);
      updateMapDescriptions();
      return;
    }

    if (data.type === "players") {
      const previousMe = me;
      players = data.players || {};
      if (players[meId]) Object.assign(previousMe, players[meId]);
      players[meId] = previousMe;
      roundActive = !!data.roundActive;
      roundWinner = data.winner || "";

      if (data.mapId && MAPS[data.mapId] && data.mapId !== actualMapId && !roundActive) {
        actualMapId = data.mapId;
        buildMap(actualMapId);
      }

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

      if (MAPS[data.mapId]) {
        actualMapId = data.mapId;
        buildMap(actualMapId);
      }

      if (players[meId]) Object.assign(me, players[meId]);
      me.alive = true;
      players[meId] = me;
      applyPlayerPosition(players[meId]);

      $("messageOverlay").classList.add("hidden");
      setText("roundMessage", MAPS[actualMapId].name + " — DON'T FALL!");
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
    selectedMap = $("mapSelect").value;
    actualMapId = selectedMap === "random" ? randomMapId() : selectedMap;
    buildMap(actualMapId);
    $("roomMapSelect").value = selectedMap;
    updateMapDescriptions();

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
        checkWinner();
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
      pitch = Math.max(-1.35, Math.min(1.35, pitch - (event.clientY - lastLookY) * 0.008));
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
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.65));
    });
  }

  /* ---------- UI AND LOOP ---------- */

  function showGameUI() {
    $("home").classList.add("hidden");
    $("hud").classList.remove("hidden");
    $("crosshair").classList.remove("hidden");

    if (matchMedia("(pointer: coarse)").matches) {
      $("mobileControls").classList.remove("hidden");
    }

    $("roomPanel").classList.toggle("hidden", mode !== "host" && mode !== "client");
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

    selectedMap = $("mapSelect").value;
    actualMapId = selectedMap === "random" ? randomMapId() : selectedMap;

    buildWorld();
    buildMap(actualMapId);
    resetPosition(me, 0);
    showGameUI();
    connectionStatus("PRACTICE");
    setText("roundMessage", MAPS[actualMapId].name + " — PRACTICE MODE");
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

      if (mode === "host" && me) {
        players[meId] = me;
        broadcastPlayers();
      } else if (mode === "client" && hostConn?.open && me) {
        try {
          hostConn.send({
            type: "state",
            x: me.x, y: me.y, z: me.z,
            yaw: me.yaw, alive: me.alive
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

  $("mapSelect").addEventListener("change", () => {
    selectedMap = $("mapSelect").value;
    const preview = selectedMap === "random" ? randomMapId() : selectedMap;
    updateMapDescriptions();
    if (mode === "menu") buildMap(preview);
  });

  $("roomMapSelect").addEventListener("change", () => {
    if (!roomHost || roundActive) return;

    selectedMap = $("roomMapSelect").value;
    const preview = selectedMap === "random" ? randomMapId() : selectedMap;
    actualMapId = preview;
    buildMap(actualMapId);
    $("mapSelect").value = selectedMap;
    updateMapDescriptions();

    for (const conn of connections.values()) {
      if (conn.open) {
        conn.send({
          type: "mapPreview",
          mapId: selectedMap,
          previewMap: actualMapId
        });
      }
    }
  });

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
      bindControls();

      if (!loopStarted) {
        loopStarted = true;
        animate();
      }

      renderer.render(scene, camera);
      $("loading").classList.add("hidden");
      connectionStatus("READY");
      updateMapDescriptions();
    } catch (error) {
      console.error(error);
      $("loading").innerHTML =
        "<strong>COULDN'T LOAD THE GAME</strong>" +
        "<small>Check your connection and reload.</small>";
    }
  }

  boot();
})();
