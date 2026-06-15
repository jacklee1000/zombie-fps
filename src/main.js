import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { images } from './assets.js';
import { audio } from './audio.js';
import { cutoutAndCrop } from './cutout.js';
import './style.css';

// Synthesize all sounds up front (offline rendering; needs no user gesture).
audio.init();

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const ROAD_HALF_WIDTH = 9; // asphalt from centerline to curb
const SIDEWALK_WIDTH = 4.5;
const PLAY_HALF_WIDTH = ROAD_HALF_WIDTH + SIDEWALK_WIDTH; // player can roam road + sidewalk
const STREET_LENGTH = 170;
const LAMP_SPACING = 10; // street lights every 10 units (both sides)

const PLAYER_SPEED = 60;
const PLAYER_EYE_HEIGHT = 1.8;
const PLAYER_MAX_HEALTH = 100;

// Sprint: hold Shift to move faster, draining a stamina pool that regenerates.
const SPRINT_MULTIPLIER = 1.6;
const SPRINT_MAX = 100;
const SPRINT_DRAIN = 25; // stamina/sec while sprinting
const SPRINT_REGEN = 15; // stamina/sec while not sprinting

// Kill-combo: chained kills inside this window raise the score multiplier.
const COMBO_WINDOW = 2.5; // seconds to keep the combo alive

// Static-obstacle collision boxes (cars, wrecks, trash cans). Populated while
// building the environment; used for player collision + zombie avoidance.
const obstacles = []; // THREE.Box3[]

function addObstacle(object3D, shrink = 0.3) {
  const box = new THREE.Box3().setFromObject(object3D);
  if (shrink) box.expandByScalar(-shrink); // ease off edges so nothing snags
  obstacles.push(box);
}

// Push the player out of any obstacle they've walked into, along the axis of
// least penetration (so they slide along walls rather than sticking).
const _playerBox = new THREE.Box3();
const _pMin = new THREE.Vector3();
const _pMax = new THREE.Vector3();
function resolveCollisions(position) {
  const r = 0.5; // player radius
  for (const obs of obstacles) {
    _pMin.set(position.x - r, position.y - 1, position.z - r);
    _pMax.set(position.x + r, position.y + 1, position.z + r);
    _playerBox.min.copy(_pMin);
    _playerBox.max.copy(_pMax);
    if (!_playerBox.intersectsBox(obs)) continue;
    const overlapX = Math.min(_pMax.x - obs.min.x, obs.max.x - _pMin.x);
    const overlapZ = Math.min(_pMax.z - obs.min.z, obs.max.z - _pMin.z);
    if (overlapX < overlapZ) {
      position.x += position.x < (obs.min.x + obs.max.x) / 2 ? -overlapX : overlapX;
    } else {
      position.z += position.z < (obs.min.z + obs.max.z) / 2 ? -overlapZ : overlapZ;
    }
  }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------
const WEAPONS = {
  shotgun: {
    name: 'SHOTGUN',
    img: images.weapons.shotgun,
    magSize: 6,
    reserveMax: 36,
    pellets: 4,
    spread: 0.05,
    damage: 10, // 4 pellets x 10 = 40 dmg/shot -> 2 shots on a 50 HP zombie
    range: 80,
    fireDelay: 0.75,
    auto: false,
    reloadTime: 1.2,
  },
  machinegun: {
    name: 'MACHINE GUN',
    img: images.weapons.machinegun,
    magSize: 30,
    reserveMax: 180,
    pellets: 1,
    spread: 0.02,
    damage: 14,
    range: 120,
    fireDelay: 0.09,
    auto: true,
    reloadTime: 1.6,
  },
};

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY_COLOR = 0x2b2f5e; // dark blue-purple night sky
const FOG_COLOR = 0x232a4d;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.013); // heavier, cinematic haze

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// ---------------------------------------------------------------------------
// Lighting — bright, so everything is clearly visible
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x8090c8, 0.7));
scene.add(new THREE.HemisphereLight(0x4a5694, 0x20242c, 0.6));
const moon = new THREE.DirectionalLight(0xaec4f0, 0.75);
moon.position.set(-40, 90, -30);
scene.add(moon);

// Pulsing muzzle flash light
const muzzleLight = new THREE.PointLight(0xffd27f, 0, 30, 2);
scene.add(muzzleLight);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.object);
controls.object.position.set(0, PLAYER_EYE_HEIGHT, STREET_LENGTH / 2 - 18);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();

// ---------------------------------------------------------------------------
// Procedural canvas textures (brick, asphalt, rust, fire, paper, graffiti)
// ---------------------------------------------------------------------------
function canvasTexture(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function makeBrickTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#2c211e'; // mortar
    g.fillRect(0, 0, w, h);
    const bw = 60, bh = 26, gap = 4;
    for (let y = 0, row = 0; y < h; y += bh + gap, row++) {
      const off = row % 2 ? (bw + gap) / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw + gap) {
        const base = 70 + Math.random() * 35;
        g.fillStyle = `rgb(${base + 28},${base - 14},${base - 22})`; // weathered brick
        g.fillRect(x + off, y, bw, bh);
        // subtle per-brick grime
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
        g.fillRect(x + off, y, bw, bh);
      }
    }
    // vertical soot / fire-damage streaks
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * w;
      const grd = g.createLinearGradient(x, h, x, h * 0.25);
      grd.addColorStop(0, 'rgba(8,6,6,0.75)');
      grd.addColorStop(1, 'rgba(8,6,6,0)');
      g.fillStyle = grd;
      g.fillRect(x - 26, 0, 52, h);
    }
  });
}

function makeAsphaltTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#23262c';
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = Math.random() * 36 - 18;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(8,8,10,0.6)';
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += Math.random() * 44 - 22;
        y += Math.random() * 44 - 22;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, { repeat: [4, 14] });
}

// Light-grey base with rust blotches + scratches; meant to be multiplied by a
// car's body color so each car keeps its paint but reads as old and rusted.
function makeRustTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#cfcfcf';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 2 + Math.random() * 9;
      g.fillStyle = `rgba(${95 + Math.random() * 60},${48 + Math.random() * 30},${18 + Math.random() * 20},${0.3 + Math.random() * 0.45})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(35,28,24,0.4)';
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo(Math.random() * w, Math.random() * h);
      g.lineTo(Math.random() * w, Math.random() * h);
      g.stroke();
    }
  });
}

function makeFireTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    const grd = g.createRadialGradient(32, 42, 2, 32, 38, 30);
    grd.addColorStop(0, 'rgba(255,244,190,1)');
    grd.addColorStop(0.4, 'rgba(255,142,32,0.92)');
    grd.addColorStop(0.8, 'rgba(176,42,10,0.5)');
    grd.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

function makePaperTexture() {
  return canvasTexture(64, 80, (g, w, h) => {
    g.fillStyle = '#d6d0bd';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    g.fillRect(6, 4, w - 12, 6); // headline bar
    g.fillStyle = 'rgba(40,40,40,0.55)';
    for (let y = 16; y < h - 4; y += 6) g.fillRect(6, y, w - 12, 2);
  });
}

function makeGraffitiTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const colors = ['#39ff14', '#ff2bd6', '#ffd400', '#19c3ff', '#ff5a2b'];
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.lineWidth = 9 - pass * 3;
      g.strokeStyle = colors[Math.floor(Math.random() * colors.length)];
      g.beginPath();
      let x = 20, y = h * (0.4 + Math.random() * 0.3);
      g.moveTo(x, y);
      for (let i = 0; i < 8; i++) {
        x += 18 + Math.random() * 22;
        y = h * (0.25 + Math.random() * 0.55);
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, { srgb: true });
}

const brickTexture = makeBrickTexture();
const asphaltTexture = makeAsphaltTexture();
const rustTexture = makeRustTexture();
const fireTexture = makeFireTexture();
const paperTexture = makePaperTexture();

// ---------------------------------------------------------------------------
// Fire effect (burning cars / smoldering buildings) — flickering light + flames
// ---------------------------------------------------------------------------
const fires = [];

// Scene light budget: ambient + hemisphere + moon (3) + muzzle (1) leave room
// for at most this many flickering fire lights, keeping total lights <= 10.
// Extra fires still show flames (cheap sprites), just without a dynamic light.
let fireLightBudget = 6;

function spawnFire(pos, scale = 1) {
  const group = new THREE.Group();
  group.position.copy(pos);
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.SpriteMaterial({
      map: fireTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    const s = new THREE.Sprite(mat);
    const sz = (1.1 + Math.random() * 0.8) * scale;
    s.center.set(0.5, 0);
    s.scale.set(sz, sz * 1.6, 1);
    s.position.set((Math.random() - 0.5) * 0.7 * scale, 0, (Math.random() - 0.5) * 0.7 * scale);
    group.add(s);
    flames.push({ s, base: sz, phase: Math.random() * Math.PI * 2 });
  }
  let light = null;
  if (fireLightBudget > 0) {
    light = new THREE.PointLight(0xff7a1e, 3 * scale, 13 * scale, 2);
    light.position.y = 1.2 * scale;
    group.add(light);
    fireLightBudget -= 1;
  }
  scene.add(group);
  fires.push({ flames, light, t: 0 });
}

function updateFires(delta) {
  for (const f of fires) {
    f.t += delta;
    for (const fl of f.flames) {
      const k = 0.8 + Math.abs(Math.sin(f.t * 8 + fl.phase)) * 0.5;
      fl.s.scale.set(fl.base * k, fl.base * 1.6 * k, 1);
      fl.s.material.opacity = 0.7 + Math.random() * 0.3;
    }
    if (f.light) f.light.intensity = 2.4 + Math.sin(f.t * 12) * 0.8 + Math.random() * 0.6;
  }
}

// ---------------------------------------------------------------------------
// Atmosphere: scattered newspapers + wind-blown debris and tumbling papers
// ---------------------------------------------------------------------------
const flyers = [];

function resetFlyer(fl, anywhere) {
  fl.m.position.set(
    -PLAY_HALF_WIDTH - 2 - Math.random() * 6,
    0.3 + Math.random() * 4.5,
    (Math.random() - 0.5) * STREET_LENGTH
  );
  if (anywhere) fl.m.position.x = (Math.random() * 2 - 1) * PLAY_HALF_WIDTH;
  fl.vel.set(2.6 + Math.random() * 3.4, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 1.4);
}

function initAtmosphere() {
  // Newspapers strewn on the ground.
  const paperMat = new THREE.MeshStandardMaterial({
    map: paperTexture,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 16; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.65), paperMat);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = Math.random() * Math.PI;
    p.position.set(
      (Math.random() * 2 - 1) * PLAY_HALF_WIDTH,
      0.03,
      (Math.random() - 0.5) * STREET_LENGTH
    );
    scene.add(p);
  }
  // Wind-blown debris specks + a few tumbling papers caught in the gusts.
  for (let i = 0; i < 55; i++) {
    const isPaper = i < 6;
    const mat = isPaper
      ? new THREE.MeshStandardMaterial({ map: paperTexture, roughness: 0.9, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({
          color: 0x55554c,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          fog: true,
        });
    const sz = isPaper ? 0.5 : 0.06 + Math.random() * 0.12;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz * 1.3), mat);
    scene.add(m);
    const fl = {
      m,
      spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4),
      vel: new THREE.Vector3(),
    };
    resetFlyer(fl, true);
    flyers.push(fl);
  }
}

function updateAtmosphere(delta) {
  for (const fl of flyers) {
    fl.m.position.addScaledVector(fl.vel, delta);
    fl.m.rotation.x += fl.spin.x * delta;
    fl.m.rotation.y += fl.spin.y * delta;
    fl.m.rotation.z += fl.spin.z * delta;
    fl.m.position.y += Math.sin(fl.m.position.x + fl.m.position.z) * 0.008;
    if (fl.m.position.x > PLAY_HALF_WIDTH + 6) resetFlyer(fl, false);
  }
}

function buildEnvironment() {
  // --- Ground (dirt/base around the road) ---
  const baseGeo = new THREE.PlaneGeometry((PLAY_HALF_WIDTH + 40) * 2, STREET_LENGTH + 40);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 1 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.05;
  scene.add(base);

  // --- Road: wet asphalt (canvas texture + glossy sheen) ---
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTexture,
    color: 0x7a828c,
    roughness: 0.42,
    metalness: 0.35,
  });
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, STREET_LENGTH),
    roadMat
  );
  road.rotation.x = -Math.PI / 2;
  scene.add(road);

  // --- Puddles: dark, near-mirror pools that catch the street-light specular ---
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x0a0e16,
    roughness: 0.06,
    metalness: 0.65,
  });
  for (let z = -STREET_LENGTH / 2 + 6; z < STREET_LENGTH / 2; z += 6 + Math.random() * 9) {
    const r = 1 + Math.random() * 2.4;
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(r, 20), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.scale.y = 0.55 + Math.random() * 0.5; // squash into an ellipse
    puddle.position.set(
      (Math.random() * 2 - 1) * (ROAD_HALF_WIDTH - 2),
      0.015,
      z
    );
    scene.add(puddle);
  }

  // --- White lane markings ---
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x777777,
    roughness: 0.6,
  });
  // center dashes
  for (let z = -STREET_LENGTH / 2; z < STREET_LENGTH / 2; z += 8) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 3), whiteMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.02, z);
    scene.add(dash);
  }
  // solid edge lines
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, STREET_LENGTH),
      whiteMat
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(side * (ROAD_HALF_WIDTH - 1), 0.02, 0);
    scene.add(edge);
  }

  // --- Sidewalks (raised slabs) ---
  const walkMat = new THREE.MeshStandardMaterial({ color: 0x6b7079, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(
      new THREE.BoxGeometry(SIDEWALK_WIDTH, 0.3, STREET_LENGTH),
      walkMat
    );
    walk.position.set(side * (ROAD_HALF_WIDTH + SIDEWALK_WIDTH / 2), 0.15, 0);
    scene.add(walk);
  }

  // --- Brick buildings with lit windows, doors, graffiti + fire damage ---
  const brickTints = [0x6a5048, 0x5a4f5e, 0x4f5a52, 0x6b6056, 0x55505c];
  for (const side of [-1, 1]) {
    for (let z = -STREET_LENGTH / 2 + 8; z < STREET_LENGTH / 2; z += 16) {
      const w = 11 + Math.random() * 6;
      const h = 18 + Math.random() * 38;
      const d = 12 + Math.random() * 6;

      // Each building gets its own brick map clone so the tiling matches size.
      const tex = brickTexture.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(2, Math.round(w / 3)), Math.max(3, Math.round(h / 3)));

      const fireDamaged = Math.random() < 0.4;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({
          map: tex,
          color: fireDamaged ? 0x4a4038 : brickTints[Math.floor(Math.random() * brickTints.length)],
          roughness: 0.95,
          emissive: 0x0c0e14,
        })
      );
      const bx = side * (PLAY_HALF_WIDTH + w / 2 + 0.5);
      const bz = z + (Math.random() * 4 - 2);
      b.position.set(bx, h / 2, bz);
      scene.add(b);

      addWindows(b, w, h, d, side);
      addDoor(b, w, h, d, side);
      if (Math.random() < 0.55) addGraffiti(b, w, h, d, side);

      // Smoldering fire at the base of some fire-damaged buildings.
      if (fireDamaged && Math.random() < 0.5) {
        spawnFire(
          new THREE.Vector3(bx - side * (w / 2 + 0.4), 0.4, bz + (Math.random() - 0.5) * d * 0.6),
          0.85
        );
      }
    }
  }

  // --- Street lights every LAMP_SPACING units, both sides ---
  addStreetLights();

  // --- Parked cars along the curbs ---
  const carColors = [0x7a2222, 0x223a6a, 0x2c2c2c, 0x6a5a1c, 0x394b39, 0x553355];
  let ci = 0;
  for (const side of [-1, 1]) {
    for (let z = -STREET_LENGTH / 2 + 14; z < STREET_LENGTH / 2; z += 24) {
      const car = makeCar(carColors[ci % carColors.length]);
      ci++;
      car.position.set(side * (ROAD_HALF_WIDTH - 1.4), 0, z + (Math.random() * 6 - 3));
      car.rotation.y = (Math.random() - 0.5) * 0.15; // slightly askew
      scene.add(car);
      car.updateMatrixWorld(true);
      addObstacle(car);
    }
  }
  // a couple of crashed, burning wrecks in the road
  for (let i = 0; i < 3; i++) {
    const car = makeCar(0x2a2a2a, true);
    const cx = (Math.random() - 0.5) * ROAD_HALF_WIDTH;
    const cz = (Math.random() - 0.5) * (STREET_LENGTH - 40);
    car.position.set(cx, 0, cz);
    car.rotation.y = Math.random() * Math.PI;
    scene.add(car);
    car.updateMatrixWorld(true);
    addObstacle(car);
    spawnFire(new THREE.Vector3(cx, 1.0, cz), 1.15); // engine fire
  }

  // --- Trash cans on the sidewalks ---
  for (const side of [-1, 1]) {
    for (let z = -STREET_LENGTH / 2 + 20; z < STREET_LENGTH / 2; z += 20) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.4, 1.2, 12),
        new THREE.MeshStandardMaterial({ color: 0x2f3a2f, metalness: 0.5, roughness: 0.6 })
      );
      can.position.set(
        side * (ROAD_HALF_WIDTH + SIDEWALK_WIDTH - 0.8),
        0.75,
        z + (Math.random() * 6 - 3)
      );
      scene.add(can);
      can.updateMatrixWorld(true);
      addObstacle(can, 0.1); // thin cans need less shrink
    }
  }

  // --- Distant scenery billboards (use the environment images) ---
  addBackdrop(images.environments.city, 0, -STREET_LENGTH / 2 - 6, 70, 38);

  // --- Newspapers + wind-blown debris ---
  initAtmosphere();
}

// A detailed, weathered car: tapered body, sloped cabin with glass, bumpers,
// rims, glowing head/taillights, and a rust map. `burnt` makes a charred wreck.
function makeCar(color, burnt = false) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    map: rustTexture,
    color: burnt ? 0x1c1a18 : color,
    roughness: burnt ? 0.95 : 0.5,
    metalness: burnt ? 0.2 : 0.6,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0a0e14,
    roughness: 0.12,
    metalness: 0.5,
    emissive: 0x05080c,
    transparent: true,
    opacity: burnt ? 0.45 : 0.85,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.7 });

  // Chassis + hood + trunk + cabin + roof.
  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.4), bodyMat);
  lower.position.y = 0.75;
  g.add(lower);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 1.5), bodyMat);
  hood.position.set(0, 1.04, 1.45);
  g.add(hood);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 1.2), bodyMat);
  trunk.position.set(0, 1.06, -1.55);
  g.add(trunk);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.78, 2.2), bodyMat);
  cabin.position.set(0, 1.5, -0.1);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.12, 1.9), bodyMat);
  roof.position.set(0, 1.92, -0.1);
  g.add(roof);

  // Glass: windshield, rear window, side windows.
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.72), glassMat);
  windshield.position.set(0, 1.56, 1.02);
  windshield.rotation.x = -0.5;
  g.add(windshield);
  const rearWin = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), glassMat);
  rearWin.position.set(0, 1.56, -1.2);
  rearWin.rotation.x = 0.5;
  g.add(rearWin);
  for (const sx of [-0.94, 0.94]) {
    const sideWin = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6), glassMat);
    sideWin.position.set(sx, 1.55, -0.1);
    sideWin.rotation.y = Math.PI / 2;
    g.add(sideWin);
  }

  // Bumpers.
  for (const bz of [2.2, -2.2]) {
    const bump = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.34, 0.3), trimMat);
    bump.position.set(0, 0.55, bz);
    g.add(bump);
  }

  // Glowing headlights (front) + taillights (rear) — skipped on burnt wrecks.
  if (!burnt) {
    const hlMat = new THREE.MeshStandardMaterial({
      color: 0xfff6d2,
      emissive: 0xfff0c0,
      emissiveIntensity: 2.4,
    });
    const tlMat = new THREE.MeshStandardMaterial({
      color: 0x3a0000,
      emissive: 0xff1a1a,
      emissiveIntensity: 1.8,
    });
    for (const sx of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.12), hlMat);
      hl.position.set(sx, 0.85, 2.22);
      g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.1), tlMat);
      tl.position.set(sx, 0.92, -2.22);
      g.add(tl);
    }
  }

  // Wheels: tire + metallic rim at each corner.
  const tireGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.34, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 });
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.4, metalness: 0.85 });
  for (const wx of [-1.02, 1.02]) {
    for (const wz of [-1.45, 1.45]) {
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.position.set(wx, 0.5, wz);
      g.add(tire);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.set(wx, 0.5, wz);
      g.add(rim);
    }
  }
  return g;
}

function addWindows(building, w, h, d, side) {
  const winColors = [0xffd27f, 0xffe9b0, 0x9fd0ff, 0xfff5d8];
  const cols = 4;
  const rows = Math.max(3, Math.floor(h / 6));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() > 0.4;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a0c12,
        emissive: lit ? winColors[Math.floor(Math.random() * winColors.length)] : 0x05070b,
        emissiveIntensity: lit ? 0.9 : 0.05,
        roughness: 0.4,
      });
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.7), mat);
      const x = (c - (cols - 1) / 2) * (w / cols);
      const y = -h / 2 + 4 + r * 5.5;
      if (y > h / 2 - 2) continue;
      // street-facing face
      win.position.set(x, y, (-side * d) / 2 - side * 0.06);
      win.rotation.y = side < 0 ? Math.PI : 0;
      building.add(win);
    }
  }
}

// A dark doorway on the building's street-facing (inner) wall.
function addDoor(b, w, h, d, side) {
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1a1410,
    roughness: 0.8,
    metalness: 0.2,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 2.6), frameMat);
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x0c0a08,
    roughness: 0.7,
    metalness: 0.3,
    emissive: 0x140d06,
    emissiveIntensity: 0.5,
  });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.1), doorMat);
  const x = b.position.x - side * (w / 2);
  frame.position.set(x, 1.7, b.position.z);
  door.position.set(x - side * 0.14, 1.6, b.position.z);
  door.rotation.y = -side * (Math.PI / 2);
  scene.add(frame);
  scene.add(door);
}

// A spray-paint tag on the building's street-facing wall.
function addGraffiti(b, w, h, d, side) {
  const mat = new THREE.MeshBasicMaterial({
    map: makeGraffitiTexture(),
    transparent: true,
    fog: true,
  });
  const gw = Math.min(d * 0.7, 6) + 1.5;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(gw, gw * 0.5), mat);
  tag.position.set(
    b.position.x - side * (w / 2 + 0.07),
    2.4 + Math.random() * 3,
    b.position.z + (Math.random() - 0.5) * d * 0.5
  );
  tag.rotation.y = -side * (Math.PI / 2);
  scene.add(tag);
}

function addStreetLights() {
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x15171c,
    roughness: 0.6,
    metalness: 0.6,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0xffcf8a,
    emissiveIntensity: 3.2, // brighter glow now that lamps have no PointLight
  });

  for (const side of [-1, 1]) {
    for (let z = -STREET_LENGTH / 2 + 5; z <= STREET_LENGTH / 2 - 5; z += LAMP_SPACING) {
      const x = side * (ROAD_HALF_WIDTH + 0.6); // at the curb

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 9, 8), poleMat);
      pole.position.set(x, 4.5, z);
      scene.add(pole);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.18), poleMat);
      arm.position.set(x - side * 1.1, 9, z);
      scene.add(arm);

      const head = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 0.9), headMat);
      head.position.set(x - side * 2.1, 8.85, z);
      scene.add(head);
      // NOTE: no PointLight per lamp — emissive heads + ambient light the street
      // instead, keeping the scene light count low (avoids the freeze).
    }
  }
}

function addBackdrop(url, x, z, w, h, rotY = 0) {
  if (!url) return;
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  plane.position.set(x, h / 2, z);
  plane.rotation.y = rotY;
  scene.add(plane);
}

buildEnvironment();

// ---------------------------------------------------------------------------
// Zombies — PNG image sprites ONLY (no 3D geometry).
// ---------------------------------------------------------------------------
// Enemy types differ only in size / speed / toughness; the artwork is the PNG
// cut-outs from the project folder. The same image is reused at different sizes
// and speeds (per-instance jitter) to add variety.
const ZOMBIE_TYPES = {
  walker: { height: 1.95, health: 50, damage: 9, minSpeed: 2.2, maxSpeed: 3.0, points: 100 },
  runner: { height: 1.6, health: 32, damage: 7, minSpeed: 5.0, maxSpeed: 6.5, points: 150 },
  boss: { height: 3.0, health: 250, damage: 22, minSpeed: 1.7, maxSpeed: 2.0, points: 500 },
};

// ---------------------------------------------------------------------------
// Image-sprite zombies. Transparent PNG cut-outs are flood-filled to erase any
// residual backdrop, cropped to the figure, then shown as ground-anchored
// camera-facing billboards.
// ---------------------------------------------------------------------------
const zombieSkins = [];
const bossSkins = [];
let skinsReady = false;

function prepareSkin(url) {
  const skin = { texture: new THREE.Texture(), aspect: 0.55 };
  skin.texture.colorSpace = THREE.SRGBColorSpace;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { canvas, aspect } = cutoutAndCrop(img);
        skin.texture.image = canvas;
        skin.aspect = aspect;
      } catch (e) {
        skin.texture.image = img; // fallback: raw image
        skin.aspect = img.naturalWidth / img.naturalHeight;
      }
      skin.texture.needsUpdate = true;
      resolve(skin);
    };
    img.onerror = () => resolve(skin);
    img.src = url;
  });
}

// Scan every zombie/boss PNG in the project and prepare a sprite skin for each.
async function preloadSkins() {
  zombieSkins.push(...(await Promise.all(images.zombies.map(prepareSkin))));
  bossSkins.push(...(await Promise.all(images.bosses.map(prepareSkin))));
  skinsReady = true;
}

// A billboard zombie built for maximum visibility WITHOUT any per-zombie lights
// (those were killing performance). A bright, solid RED circle sits behind the
// camera-facing PNG sprite, so the zombie is always visible even if the sprite
// art is mostly transparent.
function buildZombieSpriteModel(skin, height) {
  const aspect = skin ? skin.aspect : 0.55;
  const width = height * aspect;
  const group = new THREE.Group();

  // A thin red ring at the feet marks the zombie at eye-catching ground level —
  // far less jarring than the old full red backing disc (which read as debug
  // art), while still keeping enemies easy to pick out against the dark street.
  const ringR = Math.max(0.45, width * 0.55);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0xff2222,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const marker = new THREE.Mesh(new THREE.RingGeometry(ringR * 0.62, ringR, 24), markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.05;
  marker.renderOrder = 1;
  marker.frustumCulled = false;
  group.add(marker);

  // Main zombie billboard: a plane with MeshBasicMaterial so the PNG renders at
  // its TRUE colours — unlit and unfogged — instead of being darkened/tinted by
  // the scene's heavy night fog (which made the old fogged sprites look dark and
  // shadowy). The plane is manually billboarded to face the camera each frame
  // (see Zombie.update / updateCorpses), matching the old Sprite behaviour.
  const geo = new THREE.PlaneGeometry(width, height);
  geo.translate(0, height / 2, 0); // pivot/anchor at the feet → stands on ground
  const spriteMat = new THREE.MeshBasicMaterial({
    map: skin ? skin.texture : null,
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    fog: false, // no fog tint → colours stay true (not dark/shadowy)
    toneMapped: false, // render the texture's exact colours
    side: THREE.DoubleSide,
  });
  const sprite = new THREE.Mesh(geo, spriteMat);
  sprite.frustumCulled = false;
  sprite.renderOrder = 3;
  group.add(sprite);

  return { group, spriteMat, markerMat, marker, sprite, width };
}

// Shared soft round shadow for zombies.
function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const shadowTexture = makeShadowTexture();

// Solid filled circle with a soft rim — the always-visible red backing disc.
function makeDiscTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,1)'); // solid core
  grad.addColorStop(1, 'rgba(255,255,255,0)'); // soft edge
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 64, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}
const discTexture = makeDiscTexture();

// A flat, camera-facing bar sprite (used for zombie health bars).
function makeBarSprite(color, opacity) {
  const mat = new THREE.SpriteMaterial({
    color,
    opacity,
    transparent: true,
    depthTest: false, // always visible above the zombie
    depthWrite: false,
    fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.renderOrder = 999;
  return s;
}

const zombies = [];
const corpses = []; // dying zombies animating their fall + fade

class Zombie {
  constructor(type = 'walker') {
    const cfg = ZOMBIE_TYPES[type] || ZOMBIE_TYPES.walker;
    this.type = type;
    this.cfg = cfg;
    this.isBoss = type === 'boss';

    // Per-instance size jitter, then a big visibility boost (~3x) so sprites
    // read clearly against the dark, foggy street. Bosses are huge already, so
    // they get a smaller multiplier.
    const sizeScale = this.isBoss ? 1 : 0.82 + Math.random() * 0.5;
    const visScale = this.isBoss ? 1.8 : 3;
    this.height = cfg.height * sizeScale * visScale;

    // Pick a PNG skin from the right pool (boss skins for bosses).
    const pool = this.isBoss && bossSkins.length ? bossSkins : zombieSkins;
    const skin = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    const model = buildZombieSpriteModel(skin, this.height);

    this.group = model.group;
    this.spriteMat = model.spriteMat;
    this.markerMat = model.markerMat;
    this.marker = model.marker;
    this.sprite = model.sprite; // billboarded plane mesh (MeshBasicMaterial)
    this.group.frustumCulled = false;
    this.group.userData.zombie = this;

    // Body dimensions used by the manual hit test + shadow.
    this.width = model.width;
    this.hitRadius = Math.max(0.6, this.width * 0.7);

    // ground shadow blob
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
        fog: true,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(this.width * 1.6, this.width * 1.6, 1);
    this.shadow.position.y = 0.04;
    this.shadow.frustumCulled = false;

    this.maxHealth = cfg.health;
    this.health = this.maxHealth;
    this.speed = cfg.minSpeed + Math.random() * (cfg.maxSpeed - cfg.minSpeed);
    this.damage = cfg.damage;
    this.attackCooldown = 0;
    this.dead = false;
    this.walkPhase = Math.random() * Math.PI * 2;
    this.groanTimer = 2 + Math.random() * 6; // seconds until the next groan

    // Floating health bar above the head (shown once the zombie takes damage).
    this.barWidth = this.isBoss ? 3 : 1.4;
    this.barY = this.height + (this.isBoss ? 0.5 : 0.3);
    this.healthBarBg = makeBarSprite(0x101010, 0.7);
    this.healthBarBg.scale.set(this.barWidth, this.isBoss ? 0.26 : 0.16, 1);
    this.healthBarFill = makeBarSprite(0x33dd33, 1);
    this.healthBarFill.center.set(0, 0.5); // left-anchored so it shrinks rightward
    this.healthBarFill.renderOrder = 1000;
    this.healthBarFill.scale.set(this.barWidth, this.isBoss ? 0.2 : 0.12, 1);
    this.healthBarBg.visible = false;
    this.healthBarFill.visible = false;
    this.healthBarBg.frustumCulled = false;
    this.healthBarFill.frustumCulled = false;

    this.spawn();
    scene.add(this.group);
    scene.add(this.shadow);
    scene.add(this.healthBarBg);
    scene.add(this.healthBarFill);
    zombies.push(this);
  }

  spawn() {
    const p = controls.object.position;
    const MIN = this.isBoss ? 26 : 20; // minimum spawn distance from the player
    const MAX = this.isBoss ? 44 : 38;
    // Bias toward the open stretch of street ahead of the player so far
    // spawns don't collapse against the narrow side walls when clamped.
    const awayDir = p.z >= 0 ? -1 : 1;
    let x, z, dist, tries = 0;
    do {
      x = THREE.MathUtils.clamp(
        p.x + (Math.random() * 2 - 1) * (PLAY_HALF_WIDTH - 1),
        -PLAY_HALF_WIDTH + 1,
        PLAY_HALF_WIDTH - 1
      );
      const dir = Math.random() < 0.85 ? awayDir : -awayDir;
      z = THREE.MathUtils.clamp(
        p.z + dir * (MIN + Math.random() * (MAX - MIN)),
        -STREET_LENGTH / 2 + 4,
        STREET_LENGTH / 2 - 4
      );
      const ddx = x - p.x;
      const ddz = z - p.z;
      dist = Math.sqrt(ddx * ddx + ddz * ddz);
      tries++;
    } while (dist < MIN && tries < 16);
    // Guarantee the minimum: push straight down-street if still too close.
    if (dist < MIN) {
      z = THREE.MathUtils.clamp(
        p.z + awayDir * MIN,
        -STREET_LENGTH / 2 + 4,
        STREET_LENGTH / 2 - 4
      );
    }
    this.group.position.set(x, 0, z);
    this.shadow.position.set(x, 0.04, z);
  }

  update(delta, playerPos) {
    if (this.dead) return;
    const pos = this.group.position;
    const dx = playerPos.x - pos.x;
    const dz = playerPos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const attackRange = this.isBoss ? 3.2 : 1.9;
    if (dist > attackRange) {
      // Desired direction toward the player...
      let moveX = dx / dist;
      let moveZ = dz / dist;
      // ...plus a cheap repulsion from nearby obstacles so zombies steer around
      // cars/wrecks instead of walking straight through them.
      const avoidRadius = 4;
      for (const obs of obstacles) {
        const cx = (obs.min.x + obs.max.x) / 2;
        const cz = (obs.min.z + obs.max.z) / 2;
        const odx = pos.x - cx;
        const odz = pos.z - cz;
        const odist = Math.sqrt(odx * odx + odz * odz);
        if (odist < avoidRadius && odist > 0.1) {
          const strength = (1 - odist / avoidRadius) * 2;
          moveX += (odx / odist) * strength;
          moveZ += (odz / odist) * strength;
        }
      }
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ) || 1;
      pos.x += (moveX / len) * this.speed * delta;
      pos.z += (moveZ / len) * this.speed * delta;
      // Subtle shamble bob while moving (sprites always face the camera).
      this.walkPhase += delta * this.speed * 2.4;
      pos.y = Math.abs(Math.sin(this.walkPhase)) * 0.05;
    } else {
      pos.y = 0;
      this.attackCooldown -= delta;
      if (this.attackCooldown <= 0) {
        damagePlayer(this.damage);
        this.attackCooldown = 1.0;
      }
    }

    // Random approaching groans, attenuated by distance.
    this.groanTimer -= delta;
    if (this.groanTimer <= 0) {
      audio.groan(1 - Math.min(1, dist / 40));
      this.groanTimer = 4 + Math.random() * 6;
    }

    // Manual billboard: the zombie plane always faces the camera (Sprites did
    // this automatically; a MeshBasicMaterial plane must be oriented by hand).
    this.sprite.quaternion.copy(camera.quaternion);

    // Shadow + health bar follow the zombie.
    this.shadow.position.x = pos.x;
    this.shadow.position.z = pos.z;
    this.updateBars();
  }

  updateBars() {
    const frac = Math.max(0, this.health / this.maxHealth);
    const show = frac < 1 && !this.dead;
    this.healthBarBg.visible = show;
    this.healthBarFill.visible = show;
    if (!show) return;
    const pos = this.group.position;
    this.healthBarBg.position.set(pos.x, this.barY, pos.z);
    this.healthBarFill.position.set(pos.x - this.barWidth / 2, this.barY, pos.z);
    this.healthBarFill.scale.x = this.barWidth * frac;
    this.healthBarFill.material.color.setHSL(0.33 * frac, 0.9, 0.5); // green→red
  }

  // Brief red hit flash (sprite colour tint).
  flashHit() {
    this.spriteMat.color.setRGB(1.6, 0.5, 0.5);
    setTimeout(() => {
      if (!this.dead) this.spriteMat.color.setRGB(1, 1, 1);
    }, 70);
  }

  hit(amount) {
    if (this.dead) return false;
    this.health -= amount;
    this.flashHit();
    this.updateBars();
    if (this.health <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  // Begin dying: remove from active gameplay immediately (so it stops
  // chasing/attacking and isn't shot again), burst blood, switch off the eye
  // glow, and hand the body to the corpse system to topple over and fade out.
  die() {
    if (this.dead) return;
    this.dead = true;

    const pos = this.group.position;
    audio.death();
    spawnBlood(new THREE.Vector3(pos.x, this.height * 0.55, pos.z), this.isBoss ? 34 : 22);

    // strip non-corpse visuals
    scene.remove(this.shadow);
    scene.remove(this.healthBarBg);
    scene.remove(this.healthBarFill);
    this.shadow.material.dispose();
    this.shadow.geometry.dispose();
    this.healthBarBg.material.dispose();
    this.healthBarFill.material.dispose();

    // Remove the red locator ring — a corpse shouldn't be flagged.
    this.group.remove(this.marker);
    this.marker.geometry.dispose();
    this.markerMat.dispose();

    // Hand the sprite to the corpse system to tip over and fade out.
    this.spriteMat.color.setRGB(1, 1, 1);
    this.spriteMat.alphaTest = 0; // fade smoothly instead of clipping
    this.spriteMat.transparent = true;
    corpses.push({
      group: this.group,
      spriteMat: this.spriteMat,
      sprite: this.sprite,
      baseQuat: this.sprite.quaternion.clone(), // last camera-facing orientation
      tipAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(this.sprite.quaternion),
      t: 0,
      duration: 0.7,
    });

    const i = zombies.indexOf(this);
    if (i !== -1) zombies.splice(i, 1);

    // Chance to drop a health/ammo pickup where the zombie fell.
    if (Math.random() < 0.25) {
      const types = ['health', 'shotgun_ammo', 'machinegun_ammo'];
      spawnPickup(types[Math.floor(Math.random() * types.length)], new THREE.Vector3(pos.x, 0, pos.z));
    }
  }

  // Immediate, full removal with no animation (used when resetting).
  dispose() {
    this.dead = true;
    scene.remove(this.group);
    scene.remove(this.shadow);
    scene.remove(this.healthBarBg);
    scene.remove(this.healthBarFill);
    this.spriteMat.dispose();
    this.sprite.geometry.dispose();
    this.marker.geometry.dispose();
    this.markerMat.dispose();
    this.shadow.material.dispose();
    this.shadow.geometry.dispose();
    this.healthBarBg.material.dispose();
    this.healthBarFill.material.dispose();
    const i = zombies.indexOf(this);
    if (i !== -1) zombies.splice(i, 1);
  }
}

// Animate falling corpses (the billboard plane tips over onto the ground while
// fading), then remove them.
const _corpseQuat = new THREE.Quaternion();
function updateCorpses(delta) {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.t += delta;
    const k = Math.min(1, c.t / c.duration);
    // Tip the plane over about its feet (pivot) and fade out.
    _corpseQuat.setFromAxisAngle(c.tipAxis, -k * (Math.PI / 2));
    c.sprite.quaternion.copy(_corpseQuat.multiply(c.baseQuat));
    c.spriteMat.opacity = 1 - k;
    if (k >= 1) {
      scene.remove(c.group);
      c.spriteMat.dispose();
      c.sprite.geometry.dispose();
      corpses.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------
// Max simultaneously-alive zombies, scaling with the wave. The cap of 20 keeps
// weak devices alive while still feeling like a horde (was a flat 6).
function getMaxZombies() {
  return Math.min(20, 6 + Math.floor(game.wave * 1.5));
}

// Per-wave enemy mix: mostly walkers early, runners ramping in, periodic bosses.
function getWaveComposition(n) {
  return {
    walkers: Math.floor(3 + n * 1.5),
    runners: Math.max(0, Math.floor((n - 2) * 1.2)),
    bosses: n >= 3 ? Math.floor((n - 2) / 3) : 0,
  };
}

const game = {
  running: false,
  health: PLAYER_MAX_HEALTH,
  kills: 0,
  score: 0,
  wave: 1,
  waveRemaining: 0, // zombies left to KILL this wave
  pending: 0, // zombies left to SPAWN this wave (sum of the pools below)
  pendingWalkers: 0,
  pendingRunners: 0,
  pendingBosses: 0,
};

function startWave(n) {
  game.wave = n;
  const comp = getWaveComposition(n);
  const total = comp.walkers + comp.runners + comp.bosses;
  game.waveRemaining = total;
  game.pending = total;
  game.pendingWalkers = comp.walkers;
  game.pendingRunners = comp.runners;
  game.pendingBosses = comp.bosses;
  if (game.running) audio.waveStart(); // dramatic sting for waves mid-game
  spawnZombies();
  updateHud();
}

// Top the active pool up to getMaxZombies() by drawing from the wave's pools.
// Bosses are held back until walkers + runners are exhausted (they spawn last).
function spawnZombies() {
  while (
    zombies.length < getMaxZombies() &&
    game.pendingWalkers + game.pendingRunners + game.pendingBosses > 0
  ) {
    let type;
    if (game.pendingBosses > 0 && game.pendingWalkers + game.pendingRunners === 0) {
      type = 'boss';
      game.pendingBosses -= 1;
    } else if (game.pendingRunners > 0 && Math.random() < 0.4) {
      type = 'runner';
      game.pendingRunners -= 1;
    } else if (game.pendingWalkers > 0) {
      type = 'walker';
      game.pendingWalkers -= 1;
    } else if (game.pendingRunners > 0) {
      type = 'runner';
      game.pendingRunners -= 1;
    } else {
      type = 'boss';
      game.pendingBosses -= 1;
    }
    new Zombie(type);
    game.pending -= 1;
  }
}

// Kill-combo state: chained kills within COMBO_WINDOW raise a score multiplier.
let comboCount = 0;
let comboTimer = 0;

function onZombieKilled(points = 100) {
  comboCount += 1;
  comboTimer = COMBO_WINDOW;
  const multiplier = Math.min(5, 1 + Math.floor(comboCount / 3));

  game.kills += 1;
  game.score += points * multiplier;
  game.waveRemaining -= 1;

  if (el.combo) {
    if (multiplier > 1) {
      el.combo.textContent = `x${multiplier} COMBO`;
      el.combo.classList.remove('hidden');
      // restart the pop animation on each qualifying kill
      el.combo.style.animation = 'none';
      void el.combo.offsetWidth;
      el.combo.style.animation = '';
    } else {
      el.combo.classList.add('hidden');
    }
  }

  spawnZombies(); // refill the pool as zombies die
  if (game.waveRemaining <= 0 && zombies.length === 0) {
    startWave(game.wave + 1);
  }
  updateHud();
}

// ---------------------------------------------------------------------------
// Pickups — health / ammo drops that zombies leave behind, so the player can
// recover and the game can't reach an unwinnable out-of-ammo state.
// ---------------------------------------------------------------------------
const pickups = [];

function spawnPickup(type, position) {
  // type: 'health' | 'shotgun_ammo' | 'machinegun_ammo'
  const color = type === 'health' ? 0x33ff33 : 0xffcc00;
  const geo = new THREE.OctahedronGeometry(0.35);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.position.y = 0.7;
  scene.add(mesh);
  pickups.push({ mesh, mat, type, time: 0 });
}

function updatePickups(delta, playerPos) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    pk.time += delta;
    pk.mesh.rotation.y += delta * 2;
    pk.mesh.position.y = 0.7 + Math.sin(pk.time * 3) * 0.15;

    const dx = playerPos.x - pk.mesh.position.x;
    const dz = playerPos.z - pk.mesh.position.z;
    if (dx * dx + dz * dz < 2.5) {
      applyPickup(pk.type);
      scene.remove(pk.mesh);
      pk.mat.dispose();
      pk.mesh.geometry.dispose();
      pickups.splice(i, 1);
    }
  }
}

function applyPickup(type) {
  if (type === 'health') {
    game.health = Math.min(PLAYER_MAX_HEALTH, game.health + 25);
  } else if (type === 'shotgun_ammo') {
    loadout.shotgun.reserve = Math.min(WEAPONS.shotgun.reserveMax, loadout.shotgun.reserve + 12);
  } else if (type === 'machinegun_ammo') {
    loadout.machinegun.reserve = Math.min(WEAPONS.machinegun.reserveMax, loadout.machinegun.reserve + 60);
  }
  audio.pickup();
  updateHud();
}

function clearPickups() {
  for (const pk of pickups) {
    scene.remove(pk.mesh);
    pk.mat.dispose();
    pk.mesh.geometry.dispose();
  }
  pickups.length = 0;
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------
const loadout = {
  shotgun: { mag: WEAPONS.shotgun.magSize, reserve: WEAPONS.shotgun.reserveMax },
  machinegun: { mag: WEAPONS.machinegun.magSize, reserve: WEAPONS.machinegun.reserveMax },
};
let currentWeaponKey = 'shotgun';
let fireTimer = 0;
let reloading = false;
let reloadTimer = 0; // counts down in the game loop (delta-based)
let reloadWeaponKey = null; // weapon the in-progress reload belongs to
let firing = false; // true while SPACE is held
let hitmarkerTimer = 0; // >0 shows the red crosshair hit flash

const currentWeapon = () => WEAPONS[currentWeaponKey];

function switchWeapon(key) {
  if (!WEAPONS[key] || key === currentWeaponKey) return;
  currentWeaponKey = key;
  reloading = false; // cancel any in-progress reload on the old weapon
  reloadTimer = 0;
  reloadWeaponKey = null;
  fireTimer = 0;
  updateHud();
}

// Begin a reload. Completion is handled in the game loop (updateReload) using a
// delta-based timer, so backgrounding the tab can't fast-forward it and a weapon
// switch cancels it cleanly (unlike the old setTimeout).
function reload() {
  const w = currentWeapon();
  const ammo = loadout[currentWeaponKey];
  if (reloading || ammo.mag >= w.magSize || ammo.reserve <= 0) return;
  reloading = true;
  reloadTimer = w.reloadTime;
  reloadWeaponKey = currentWeaponKey;
  audio.reload();
  updateHud();
}

function updateReload(delta) {
  if (!reloading) return;
  reloadTimer -= delta;
  if (reloadTimer <= 0 || currentWeaponKey !== reloadWeaponKey) {
    if (currentWeaponKey === reloadWeaponKey) {
      const ammo = loadout[currentWeaponKey];
      const take = Math.min(WEAPONS[currentWeaponKey].magSize - ammo.mag, ammo.reserve);
      ammo.mag += take;
      ammo.reserve -= take;
    }
    reloading = false;
    reloadTimer = 0;
    reloadWeaponKey = null;
    updateHud();
  }
}

// Manual ray-vs-body hit test (reliable, unlike Sprite.raycast). Models each
// zombie as a stack of spheres along its vertical body axis and returns the
// nearest one the ray passes through within range.
function nearestZombieHit(origin, dir, range) {
  let best = null;
  for (const z of zombies) {
    if (z.dead) continue;
    const px = z.group.position.x;
    const pz = z.group.position.z;
    const R = z.hitRadius;
    const steps = Math.max(3, Math.round(z.height / 0.5));
    for (let s = 0; s <= steps; s++) {
      const cy = z.height * (s / steps);
      // project sphere center onto the ray
      const ox = px - origin.x;
      const oy = cy - origin.y;
      const oz = pz - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t <= 0 || t > range) continue;
      const dx = origin.x + dir.x * t - px;
      const dy = origin.y + dir.y * t - cy;
      const dz = origin.z + dir.z * t - pz;
      if (dx * dx + dy * dy + dz * dz <= R * R) {
        if (!best || t < best.t) {
          best = {
            zombie: z,
            t,
            point: new THREE.Vector3(
              origin.x + dir.x * t,
              origin.y + dir.y * t,
              origin.z + dir.z * t
            ),
          };
        }
        break; // this zombie is hit; stop sampling its body
      }
    }
  }
  return best;
}

function tryFire() {
  if (!game.running || reloading || fireTimer > 0) return;
  // No shooting while actively sprinting — sprint to reposition, stop to fight.
  if (sprinting && sprintStamina > 0 &&
      (moveState.forward || moveState.back || moveState.left || moveState.right)) return;
  const w = currentWeapon();
  const ammo = loadout[currentWeaponKey];
  if (ammo.mag <= 0) {
    audio.empty();
    fireTimer = 0.2; // throttle repeated empty clicks on held auto-fire
    reload();
    return;
  }
  ammo.mag -= 1;
  fireTimer = w.fireDelay;
  audio.shot(currentWeaponKey);

  muzzleLight.position.copy(controls.object.position);
  muzzleLight.intensity = 5;
  vmRecoil = 1; // kick the viewmodel

  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const origin = camera.getWorldPosition(new THREE.Vector3());

  // Accumulate damage per zombie so each shot shows ONE blood burst and ONE
  // damage number (rather than one per pellet).
  const dealt = new Map(); // zombie -> { dmg, point, killed }
  for (let p = 0; p < w.pellets; p++) {
    const dir = camDir.clone();
    dir.x += (Math.random() - 0.5) * w.spread;
    dir.y += (Math.random() - 0.5) * w.spread;
    dir.z += (Math.random() - 0.5) * w.spread;
    dir.normalize();
    const hit = nearestZombieHit(origin, dir, w.range);
    if (!hit) continue;
    const z = hit.zombie;
    if (z.dead) continue;
    const killed = z.hit(w.damage);
    const rec = dealt.get(z) || { dmg: 0, point: null, killed: false };
    rec.dmg += w.damage;
    rec.point = hit.point.clone();
    rec.killed = rec.killed || killed;
    dealt.set(z, rec);
    if (killed) onZombieKilled(z.cfg.points);
  }
  for (const [, rec] of dealt) {
    spawnBlood(rec.point);
    spawnDamageNumber(rec.point, rec.dmg, rec.killed);
  }
  // One hitmarker per shot that connected (not per pellet).
  if (dealt.size > 0) {
    hitmarkerTimer = 0.15;
    audio.hitmarker();
  }
  updateHud();
}

// ---------------------------------------------------------------------------
// Player damage
// ---------------------------------------------------------------------------
const damageFlash = document.getElementById('damage-flash');
let flashTimer = 0;
let shakeIntensity = 0; // camera-shake amount, decays each frame

function damagePlayer(amount) {
  if (!game.running) return;
  game.health = Math.max(0, game.health - amount);
  audio.playerHit();
  damageFlash.classList.add('show');
  flashTimer = 0.15;
  shakeIntensity = 0.15; // jolt the camera on hit
  updateHud();
  if (game.health <= 0) endGame();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const el = {
  hud: document.getElementById('hud'),
  healthBar: document.getElementById('health-bar'),
  healthNum: document.getElementById('health-num'),
  weaponImg: document.getElementById('weapon-img'),
  viewmodel: document.getElementById('viewmodel'),
  ammoCurrent: document.getElementById('ammo-current'),
  ammoReserve: document.getElementById('ammo-reserve'),
  weaponName: document.getElementById('weapon-name'),
  kills: document.getElementById('kills'),
  wave: document.getElementById('wave'),
  score: document.getElementById('score'),
  muteState: document.getElementById('mute-state'),
  crosshair: document.getElementById('crosshair'),
  combo: document.getElementById('combo'),
  staminaBar: document.getElementById('stamina-bar'),
  radar: document.getElementById('radar'),
};

// First-person viewmodel state (only active once a viewmodel image exists).
let viewmodelActive = false;
let vmRecoil = 0; // 0..1, decays after each shot
let vmBob = 0; // walk-cycle phase

function updateViewmodel() {
  const vm = images.viewmodels || {};
  const src = vm[currentWeaponKey] || vm.generic;
  viewmodelActive = Boolean(src);
  if (viewmodelActive) {
    if (el.viewmodel.getAttribute('src') !== src) el.viewmodel.src = src;
    el.viewmodel.classList.remove('hidden');
    // Avoid showing two guns: hide the small HUD render when a viewmodel is up.
    el.weaponImg.style.display = 'none';
  } else {
    el.viewmodel.classList.add('hidden');
    el.weaponImg.style.display = '';
  }
}

function updateHud() {
  const pct = (game.health / PLAYER_MAX_HEALTH) * 100;
  el.healthBar.style.width = pct + '%';
  el.healthBar.style.background =
    pct > 50
      ? 'linear-gradient(90deg, #7a1010, #e23b3b)'
      : pct > 25
      ? 'linear-gradient(90deg, #7a4a10, #e2a33b)'
      : 'linear-gradient(90deg, #5a0000, #ff2a2a)';
  if (el.healthNum) el.healthNum.textContent = Math.ceil(game.health);

  const w = currentWeapon();
  const ammo = loadout[currentWeaponKey];
  if (w.img) el.weaponImg.src = w.img;
  el.weaponName.textContent = reloading ? 'RELOADING…' : w.name;
  el.ammoCurrent.textContent = ammo.mag;
  el.ammoReserve.textContent = ammo.reserve;
  el.kills.textContent = game.kills;
  el.wave.textContent = game.wave;
  if (el.score) el.score.textContent = game.score;
  updateViewmodel();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const moveState = { forward: false, back: false, left: false, right: false };
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let sprinting = false; // true while a Shift key is held
let sprintStamina = SPRINT_MAX;

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveState.forward = true; break;
    case 'KeyS': case 'ArrowDown': moveState.back = true; break;
    case 'KeyA': case 'ArrowLeft': moveState.left = true; break;
    case 'KeyD': case 'ArrowRight': moveState.right = true; break;
    case 'Digit1': switchWeapon('shotgun'); break;
    case 'Digit2': switchWeapon('machinegun'); break;
    case 'ShiftLeft': case 'ShiftRight': sprinting = true; break;
    case 'KeyR': reload(); break;
    case 'KeyM': {
      const muted = audio.toggleMusicMute();
      if (el.muteState) el.muteState.textContent = (muted ? '♪ MUSIC OFF' : '♪ MUSIC ON');
      break;
    }
    case 'Space':
      e.preventDefault(); // stop page scroll
      if (!game.running) break;
      firing = true;
      if (!e.repeat) tryFire(); // immediate shot on press
      break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveState.forward = false; break;
    case 'KeyS': case 'ArrowDown': moveState.back = false; break;
    case 'KeyA': case 'ArrowLeft': moveState.left = false; break;
    case 'KeyD': case 'ArrowRight': moveState.right = false; break;
    case 'ShiftLeft': case 'ShiftRight': sprinting = false; break;
    case 'Space': firing = false; break;
  }
}
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// ---------------------------------------------------------------------------
// Touch controls (mobile) — joystick to move, drag to look, buttons to act.
// Each control owns its own DOM element and tracks touches by identifier so
// moving + looking + firing can all happen at once (multi-touch).
// ---------------------------------------------------------------------------
const PI_2 = Math.PI / 2;
const _lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

// --- Look: drag anywhere on the look layer to aim (touch = mouse look). ---
const lookLayer = document.getElementById('touch-look');
const LOOK_SENS = 0.0045; // radians per pixel dragged
let lookId = null;
let lookX = 0;
let lookY = 0;

if (lookLayer) {
  lookLayer.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      if (lookId !== null) return; // already tracking a look finger
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookX = t.clientX;
      lookY = t.clientY;
    },
    { passive: false }
  );
  lookLayer.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        const dx = t.clientX - lookX;
        const dy = t.clientY - lookY;
        lookX = t.clientX;
        lookY = t.clientY;
        _lookEuler.setFromQuaternion(camera.quaternion);
        _lookEuler.y -= dx * LOOK_SENS; // yaw
        _lookEuler.x -= dy * LOOK_SENS; // pitch
        _lookEuler.x = Math.max(-PI_2 + 0.05, Math.min(PI_2 - 0.05, _lookEuler.x));
        camera.quaternion.setFromEuler(_lookEuler);
      }
    },
    { passive: false }
  );
  const endLook = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  };
  lookLayer.addEventListener('touchend', endLook);
  lookLayer.addEventListener('touchcancel', endLook);
}

// --- Joystick: drives the existing WASD moveState (8-directional). ---
const joystick = document.getElementById('joystick');
const joyKnob = document.getElementById('joystick-knob');
const JOY_RADIUS = 50; // px of knob travel
const JOY_DEAD = 0.32; // fraction of travel before a direction registers
let joyId = null;
let joyCx = 0;
let joyCy = 0;

function setJoyVector(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(len, JOY_RADIUS);
  const nx = (dx / len) * clamped;
  const ny = (dy / len) * clamped;
  if (joyKnob) joyKnob.style.transform = `translate(${nx}px, ${ny}px)`;
  const fx = nx / JOY_RADIUS;
  const fy = ny / JOY_RADIUS;
  moveState.left = fx < -JOY_DEAD;
  moveState.right = fx > JOY_DEAD;
  moveState.forward = fy < -JOY_DEAD; // up on screen = forward
  moveState.back = fy > JOY_DEAD;
}

function resetJoy() {
  if (joyKnob) joyKnob.style.transform = 'translate(0px, 0px)';
  moveState.forward = moveState.back = moveState.left = moveState.right = false;
}

if (joystick) {
  joystick.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      if (joyId !== null) return;
      const t = e.changedTouches[0];
      joyId = t.identifier;
      const r = joystick.getBoundingClientRect();
      joyCx = r.left + r.width / 2;
      joyCy = r.top + r.height / 2;
      setJoyVector(t.clientX - joyCx, t.clientY - joyCy);
    },
    { passive: false }
  );
  joystick.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) setJoyVector(t.clientX - joyCx, t.clientY - joyCy);
      }
    },
    { passive: false }
  );
  const endJoy = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyId = null;
        resetJoy();
      }
    }
  };
  joystick.addEventListener('touchend', endJoy);
  joystick.addEventListener('touchcancel', endJoy);
}

// --- Action buttons (fire / reload / weapon switch). ---
// Bind a button element to press/release callbacks with visual feedback.
function bindTouchButton(id, onPress, onRelease) {
  const elBtn = document.getElementById(id);
  if (!elBtn) return;
  elBtn.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      elBtn.classList.add('pressed');
      onPress();
    },
    { passive: false }
  );
  const release = (e) => {
    if (e) e.preventDefault();
    elBtn.classList.remove('pressed');
    if (onRelease) onRelease();
  };
  elBtn.addEventListener('touchend', release, { passive: false });
  elBtn.addEventListener('touchcancel', release, { passive: false });
}

bindTouchButton(
  'btn-fire',
  () => {
    if (!game.running) return;
    firing = true; // auto weapons keep firing in the loop while held
    tryFire(); // immediate shot on press
  },
  () => {
    firing = false;
  }
);
bindTouchButton('btn-reload', () => reload());
bindTouchButton('btn-weapon1', () => switchWeapon('shotgun'));
bindTouchButton('btn-weapon2', () => switchWeapon('machinegun'));

// ---------------------------------------------------------------------------
// Overlays / lifecycle
// ---------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const gameover = document.getElementById('gameover');

// Touch devices can't use pointer lock, so they play in "mobile" mode: the game
// runs without a locked pointer and is driven by the on-screen touch controls.
// A real phone/tablet has a coarse primary pointer and no hover. This avoids
// forcing mobile mode (and disabling mouse-look) on touch-capable laptops.
const isTouch =
  window.matchMedia('(pointer: coarse)').matches &&
  window.matchMedia('(hover: none)').matches;
let mobileActive = false;
const touchUI = document.getElementById('touch-ui');

// True whenever gameplay should be live (desktop: pointer locked; mobile: active).
const playActive = () => controls.isLocked || mobileActive;

function startFromOverlay() {
  if (isTouch) {
    mobileActive = true;
    touchUI.classList.remove('hidden');
    beginPlay();
  } else {
    controls.lock();
  }
}

document.getElementById('start-btn').addEventListener('click', startFromOverlay);
document.getElementById('restart-btn').addEventListener('click', () => {
  resetGame();
  startFromOverlay();
});

let sessionStarted = false; // so we sting once per game, not on pause/resume

// Reveal the HUD and start a play session (shared by desktop lock + mobile start).
function beginPlay() {
  overlay.classList.add('hidden');
  gameover.classList.add('hidden');
  el.hud.classList.remove('hidden');
  if (el.crosshair) el.crosshair.classList.remove('hidden');
  game.running = true;
  audio.startMusic(); // resumes the Web Audio context on this user gesture
  if (!sessionStarted) {
    audio.waveStart();
    sessionStarted = true;
  }
  updateViewmodel();
}

controls.addEventListener('lock', beginPlay);
controls.addEventListener('unlock', () => {
  el.viewmodel.classList.add('hidden');
  if (el.crosshair) el.crosshair.classList.add('hidden');
  if (game.running && game.health > 0) overlay.classList.remove('hidden');
});

function resetGame() {
  sessionStarted = false; // fresh game → sting again on next lock
  for (const z of [...zombies]) z.dispose();
  zombies.length = 0;
  // clear any falling corpses
  for (const c of corpses) {
    scene.remove(c.group);
    c.spriteMat.dispose();
    c.sprite.geometry.dispose();
  }
  corpses.length = 0;
  clearPickups();
  game.running = false;
  game.health = PLAYER_MAX_HEALTH;
  game.kills = 0;
  game.score = 0;
  game.wave = 1;
  loadout.shotgun = { mag: WEAPONS.shotgun.magSize, reserve: WEAPONS.shotgun.reserveMax };
  loadout.machinegun = { mag: WEAPONS.machinegun.magSize, reserve: WEAPONS.machinegun.reserveMax };
  currentWeaponKey = 'shotgun';
  // Reset transient combat/movement state.
  reloading = false;
  reloadTimer = 0;
  reloadWeaponKey = null;
  fireTimer = 0;
  firing = false;
  hitmarkerTimer = 0;
  shakeIntensity = 0;
  sprinting = false;
  sprintStamina = SPRINT_MAX;
  comboCount = 0;
  comboTimer = 0;
  if (el.combo) el.combo.classList.add('hidden');
  controls.object.position.set(0, PLAYER_EYE_HEIGHT, STREET_LENGTH / 2 - 18);
  startWave(1);
  game.running = true;
  updateHud();
}

function endGame() {
  game.running = false;
  mobileActive = false;
  touchUI.classList.add('hidden');
  audio.stopMusic();
  audio.gameOver();
  controls.unlock();
  el.hud.classList.add('hidden');
  el.viewmodel.classList.add('hidden');
  if (el.crosshair) {
    el.crosshair.classList.add('hidden');
    el.crosshair.classList.remove('hit');
  }
  document.getElementById('final-stats').textContent =
    `Kills: ${game.kills}   ·   Reached Wave ${game.wave}`;
  gameover.classList.remove('hidden');
}

// PNG sprites must be cut out and loaded before any zombie can spawn.
updateHud();
preloadSkins().then(() => {
  startWave(1);
  updateHud();
});

// ---------------------------------------------------------------------------
// Effects: blood splatter (3D sprites) + floating damage numbers (DOM)
// ---------------------------------------------------------------------------
function makeBloodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(190,10,10,1)');
  grad.addColorStop(0.6, 'rgba(130,0,0,0.85)');
  grad.addColorStop(1, 'rgba(80,0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 32, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}
const bloodTexture = makeBloodTexture();

// Pre-allocated blood-particle pool. Sprites/materials are created ONCE and
// reused (toggled visible/active) instead of being allocated + disposed per
// splatter — that churn was driving GC stutter / frame hitches.
const BLOOD_POOL_SIZE = 80;
const bloodPool = [];

function initBloodPool() {
  for (let i = 0; i < BLOOD_POOL_SIZE; i++) {
    const mat = new THREE.SpriteMaterial({
      map: bloodTexture,
      color: 0xaa0000,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    bloodPool.push({ sprite: s, mat, vel: new THREE.Vector3(), life: 0, maxLife: 0.5, active: false });
  }
}

function spawnBlood(point, count = 12) {
  if (!point) return;
  for (let i = 0; i < count; i++) {
    const b = bloodPool.find((p) => !p.active);
    if (!b) return; // pool exhausted — skip rather than allocate
    b.active = true;
    b.sprite.visible = true;
    const sz = 0.12 + Math.random() * 0.2;
    b.sprite.scale.set(sz, sz, 1);
    b.sprite.position.copy(point);
    b.vel.set((Math.random() - 0.5) * 4, Math.random() * 3 + 1, (Math.random() - 0.5) * 4);
    b.life = b.maxLife;
    b.mat.opacity = 1;
  }
}

function updateBlood(delta) {
  for (const b of bloodPool) {
    if (!b.active) continue;
    b.life -= delta;
    if (b.life <= 0) {
      b.active = false;
      b.sprite.visible = false;
      continue;
    }
    b.vel.y -= 9.8 * delta; // gravity
    b.sprite.position.addScaledVector(b.vel, delta);
    b.mat.opacity = b.life / b.maxLife;
  }
}
initBloodPool();

const fxLayer = document.getElementById('fx-layer');
const _proj = new THREE.Vector3();

// Pre-allocated pool of damage-number DOM nodes. Reused instead of
// createElement + remove per hit, which under rapid machine-gun fire spawned
// (and GC'd) hundreds of nodes. Lifetimes are tracked in the game loop.
const DMG_POOL_SIZE = 30;
const dmgPool = [];

function initDmgPool() {
  if (!fxLayer) return;
  for (let i = 0; i < DMG_POOL_SIZE; i++) {
    const div = document.createElement('div');
    div.className = 'dmg-number';
    div.style.display = 'none';
    fxLayer.appendChild(div);
    dmgPool.push({ div, timer: 0, active: false });
  }
}

function spawnDamageNumber(point, amount, killed) {
  if (!point || !fxLayer) return;
  const entry = dmgPool.find((d) => !d.active);
  if (!entry) return; // all visible — skip rather than flood the DOM
  _proj.copy(point).project(camera);
  if (_proj.z > 1) return; // behind the camera
  const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
  entry.div.className = 'dmg-number' + (killed ? ' kill' : '');
  entry.div.textContent = killed ? 'KILL +' + Math.round(amount) : String(Math.round(amount));
  entry.div.style.left = x + 'px';
  entry.div.style.top = y + 'px';
  entry.div.style.display = '';
  // restart the float-up CSS animation on this reused node
  entry.div.style.animation = 'none';
  void entry.div.offsetWidth;
  entry.div.style.animation = '';
  entry.active = true;
  entry.timer = 0.8;
}

function updateDamageNumbers(delta) {
  for (const d of dmgPool) {
    if (!d.active) continue;
    d.timer -= delta;
    if (d.timer <= 0) {
      d.active = false;
      d.div.style.display = 'none';
    }
  }
}
initDmgPool();

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Radar — top-down threat blips, rotated so "up" is always where you're facing.
// ---------------------------------------------------------------------------
const radarCtx = el.radar ? el.radar.getContext('2d') : null;
const _radarDir = new THREE.Vector3();

function updateRadar() {
  if (!radarCtx) return;
  const ctx = radarCtx;
  const size = 140;
  const cx = size / 2;
  const scale = size / 80; // ~80 world-units across the dish
  ctx.clearRect(0, 0, size, size);

  // Dish background.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 2, 0, Math.PI * 2);
  ctx.fill();

  // Player at the centre.
  ctx.fillStyle = '#4af';
  ctx.beginPath();
  ctx.arc(cx, cx, 3, 0, Math.PI * 2);
  ctx.fill();

  const pp = controls.object.position;
  camera.getWorldDirection(_radarDir);
  const angle = Math.atan2(_radarDir.x, _radarDir.z);
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);

  // Pickups as small green diamonds.
  ctx.fillStyle = '#3f9';
  for (const pk of pickups) {
    const dx = pk.mesh.position.x - pp.x;
    const dz = pk.mesh.position.z - pp.z;
    const rx = dx * ca - dz * sa;
    const ry = dx * sa + dz * ca;
    const sx = cx + rx * scale;
    const sy = cx - ry * scale;
    if (sx < 4 || sx > size - 4 || sy < 4 || sy > size - 4) continue;
    ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
  }

  // Zombies (bosses are bigger magenta dots).
  for (const z of zombies) {
    if (z.dead) continue;
    const dx = z.group.position.x - pp.x;
    const dz = z.group.position.z - pp.z;
    const rx = dx * ca - dz * sa;
    const ry = dx * sa + dz * ca;
    const sx = cx + rx * scale;
    const sy = cx - ry * scale;
    if (sx < 4 || sx > size - 4 || sy < 4 || sy > size - 4) continue;
    ctx.fillStyle = z.isBoss ? '#f0f' : '#f33';
    ctx.beginPath();
    ctx.arc(sx, sy, z.isBoss ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let footstepTimer = 0; // cadence for walking footstep sounds

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (game.running && playActive()) {
    const moving = moveState.forward || moveState.back || moveState.left || moveState.right;
    const canSprint = sprinting && sprintStamina > 0 && moving;
    const speedMul = canSprint ? SPRINT_MULTIPLIER : 1;

    velocity.x -= velocity.x * 10 * delta;
    velocity.z -= velocity.z * 10 * delta;
    direction.z = Number(moveState.forward) - Number(moveState.back);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();
    if (moveState.forward || moveState.back) velocity.z -= direction.z * PLAYER_SPEED * speedMul * delta;
    if (moveState.left || moveState.right) velocity.x -= direction.x * PLAYER_SPEED * speedMul * delta;
    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);

    const p = controls.object.position;
    p.x = THREE.MathUtils.clamp(p.x, -PLAY_HALF_WIDTH + 1, PLAY_HALF_WIDTH - 1);
    p.z = THREE.MathUtils.clamp(p.z, -STREET_LENGTH / 2 + 4, STREET_LENGTH / 2 - 4);
    p.y = PLAYER_EYE_HEIGHT;
    resolveCollisions(p); // keep the player out of cars/wrecks/cans

    // Sprint stamina: drain while sprinting, regenerate otherwise.
    if (canSprint) {
      sprintStamina = Math.max(0, sprintStamina - SPRINT_DRAIN * delta);
    } else {
      sprintStamina = Math.min(SPRINT_MAX, sprintStamina + SPRINT_REGEN * delta);
    }
    if (el.staminaBar) {
      el.staminaBar.style.width = sprintStamina + '%';
      el.staminaBar.classList.toggle('depleted', sprintStamina <= 0);
    }

    updateReload(delta);
    if (fireTimer > 0) fireTimer -= delta;
    if (firing && currentWeapon().auto) tryFire();

    // Footsteps while moving (WASD).
    const walking = moveState.forward || moveState.back || moveState.left || moveState.right;
    if (walking) {
      footstepTimer -= delta;
      if (footstepTimer <= 0) {
        audio.footstep();
        footstepTimer = 0.34;
      }
    } else {
      footstepTimer = 0; // step immediately when movement resumes
    }

    // Viewmodel sway: walk-bob while moving + recoil kick after firing.
    if (viewmodelActive) {
      const moving = moveState.forward || moveState.back || moveState.left || moveState.right;
      vmBob += delta * (moving ? 9 : 2.2);
      const bobX = Math.sin(vmBob) * (moving ? 10 : 3);
      const bobY = Math.abs(Math.cos(vmBob)) * (moving ? 12 : 4);
      const recoilY = vmRecoil * 60;
      const recoilRot = vmRecoil * -3;
      el.viewmodel.style.transform =
        `translate(${bobX}px, ${bobY + recoilY}px) rotate(${recoilRot}deg) scale(${1 + vmRecoil * 0.03})`;
    }
    if (vmRecoil > 0) vmRecoil = Math.max(0, vmRecoil - delta * 6);

    for (const z of [...zombies]) z.update(delta, p);
    updatePickups(delta, p);

    // Kill-combo decay: drop the chain once the window lapses.
    if (comboTimer > 0) {
      comboTimer -= delta;
      if (comboTimer <= 0) {
        comboCount = 0;
        if (el.combo) el.combo.classList.add('hidden');
      }
    }

    if (skinsReady && zombies.length === 0 && game.waveRemaining <= 0) {
      startWave(game.wave + 1);
    }
  }

  updateBlood(delta);
  updateCorpses(delta);
  updateFires(delta);
  updateAtmosphere(delta);
  updateDamageNumbers(delta);
  updateRadar();

  // Hitmarker: flash the crosshair red briefly after a connecting shot.
  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= delta;
    if (el.crosshair) el.crosshair.classList.add('hit');
  } else if (el.crosshair) {
    el.crosshair.classList.remove('hit');
  }

  if (muzzleLight.intensity > 0) {
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - delta * 30);
  }
  if (flashTimer > 0) {
    flashTimer -= delta;
    if (flashTimer <= 0) damageFlash.classList.remove('show');
  }

  // Screen shake on damage: jitter the camera, then restore so the offset
  // doesn't accumulate into the player's real position next frame.
  if (shakeIntensity > 0) {
    const sx = camera.position.x;
    const sy = camera.position.y;
    const sz = camera.position.z;
    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    camera.position.y += (Math.random() - 0.5) * shakeIntensity;
    camera.position.z += (Math.random() - 0.5) * shakeIntensity;
    shakeIntensity = Math.max(0, shakeIntensity - delta * 1.5);
    renderer.render(scene, camera);
    camera.position.set(sx, sy, sz);
  } else {
    renderer.render(scene, camera);
  }
}

animate();
