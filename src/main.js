import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { images } from './assets.js';
import { audio } from './audio.js';
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
scene.add(new THREE.AmbientLight(0x8090c8, 0.5));
scene.add(new THREE.HemisphereLight(0x4a5694, 0x20242c, 0.45));
const moon = new THREE.DirectionalLight(0xaec4f0, 0.7);
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
  const light = new THREE.PointLight(0xff7a1e, 3 * scale, 13 * scale, 2);
  light.position.y = 1.2 * scale;
  group.add(light);
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
    f.light.intensity = 2.4 + Math.sin(f.t * 12) * 0.8 + Math.random() * 0.6;
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
    emissiveIntensity: 2.2,
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

      const light = new THREE.PointLight(0xffd9a0, 14, 26, 2);
      light.position.set(x - side * 2.1, 8.4, z);
      scene.add(light);
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

// Erase the flat/vignette backdrop by region-growing from the image borders,
// then crop to the figure so it sits on the ground. Returns { canvas, aspect }.
function cutoutAndCrop(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  const visited = new Uint8Array(w * h);
  const stack = [];
  const NEIGHBOR_TOL = 44 * 44; // squared color distance between adjacent px
  const SAT_TOL = 42; // only erase greyish (low-saturation) pixels

  const seed = (x, y) => {
    const i = y * w + x;
    if (!visited[i]) {
      visited[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (stack.length) {
    const i = stack.pop();
    const p = i * 4;
    // Pixels that are already transparent (PNG alpha) are background too.
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];
    d[p + 3] = 0; // erase this background pixel

    const x = i % w;
    const y = (i / w) | 0;
    const nb = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (let n = 0; n < 4; n++) {
      const nx = nb[n][0];
      const ny = nb[n][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (visited[ni]) continue;
      const np = ni * 4;
      // Already-transparent neighbours are background — always flood through.
      if (d[np + 3] === 0) {
        visited[ni] = 1;
        stack.push(ni);
        continue;
      }
      const sat = Math.max(d[np], d[np + 1], d[np + 2]) - Math.min(d[np], d[np + 1], d[np + 2]);
      if (sat > SAT_TOL) continue; // protect colourful pixels (blood, skin)
      const dr = d[np] - r;
      const dg = d[np + 1] - g;
      const db2 = d[np + 2] - b;
      if (dr * dr + dg * dg + db2 * db2 < NEIGHBOR_TOL) {
        visited[ni] = 1;
        stack.push(ni);
      }
    }
  }

  // 1px feather on the silhouette edge to soften the cut.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const p = i * 4;
      if (d[p + 3] === 0) continue;
      if (
        d[(i - 1) * 4 + 3] === 0 ||
        d[(i + 1) * 4 + 3] === 0 ||
        d[(i - w) * 4 + 3] === 0 ||
        d[(i + w) * 4 + 3] === 0
      ) {
        d[p + 3] = 150;
      }
    }
  }

  // Bounding box of what remains.
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    minX = 0; minY = 0; maxX = w - 1; maxY = h - 1;
  }
  ctx.putImageData(imageData, 0, 0);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: out, aspect: cw / ch };
}

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

// A billboard zombie: one camera-facing PNG sprite, anchored at the feet.
function buildZombieSpriteModel(skin, height) {
  const spriteMat = new THREE.SpriteMaterial({
    map: skin ? skin.texture : null,
    transparent: true,
    alphaTest: 0.25,
    depthWrite: true,
    fog: true,
  });
  const sprite = new THREE.Sprite(spriteMat);
  const aspect = skin ? skin.aspect : 0.55;
  const width = height * aspect;
  sprite.scale.set(width, height, 1);
  sprite.center.set(0.5, 0); // anchor at feet → stands on the ground
  sprite.frustumCulled = false;
  const group = new THREE.Group();
  group.add(sprite);
  return { group, spriteMat, width };
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

    // Per-instance size jitter so reusing the same PNG still looks varied.
    const sizeScale = this.isBoss ? 1 : 0.82 + Math.random() * 0.5;
    this.height = cfg.height * sizeScale;

    // Pick a PNG skin from the right pool (boss skins for bosses).
    const pool = this.isBoss && bossSkins.length ? bossSkins : zombieSkins;
    const skin = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    const model = buildZombieSpriteModel(skin, this.height);

    this.group = model.group;
    this.spriteMat = model.spriteMat;
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
      pos.x += (dx / dist) * this.speed * delta;
      pos.z += (dz / dist) * this.speed * delta;
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

    // Hand the sprite to the corpse system to tip over and fade out.
    this.spriteMat.color.setRGB(1, 1, 1);
    this.spriteMat.alphaTest = 0; // fade smoothly instead of clipping
    this.spriteMat.transparent = true;
    corpses.push({ group: this.group, spriteMat: this.spriteMat, t: 0, duration: 0.7 });

    const i = zombies.indexOf(this);
    if (i !== -1) zombies.splice(i, 1);
  }

  // Immediate, full removal with no animation (used when resetting).
  dispose() {
    this.dead = true;
    scene.remove(this.group);
    scene.remove(this.shadow);
    scene.remove(this.healthBarBg);
    scene.remove(this.healthBarFill);
    this.spriteMat.dispose();
    this.shadow.material.dispose();
    this.shadow.geometry.dispose();
    this.healthBarBg.material.dispose();
    this.healthBarFill.material.dispose();
    const i = zombies.indexOf(this);
    if (i !== -1) zombies.splice(i, 1);
  }
}

// Animate falling corpses (sprite tips over in place + fades), then remove them.
function updateCorpses(delta) {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.t += delta;
    const k = Math.min(1, c.t / c.duration);
    c.spriteMat.rotation = -k * (Math.PI / 2); // billboard tips over in place
    c.spriteMat.opacity = 1 - k;
    if (k >= 1) {
      scene.remove(c.group);
      c.spriteMat.dispose();
      corpses.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------
const game = {
  running: false,
  health: PLAYER_MAX_HEALTH,
  kills: 0,
  score: 0,
  wave: 1,
  waveRemaining: 0,
};

function startWave(n) {
  game.wave = n;
  const count = 4 + n * 2;
  game.waveRemaining = count;
  if (game.running) audio.waveStart(); // dramatic sting for waves mid-game
  // Runners grow more common as the waves climb; a boss caps wave 3+.
  const runnerChance = Math.min(0.5, 0.12 + n * 0.06);
  for (let i = 0; i < count; i++) {
    let type = 'walker';
    if (n >= 3 && i === count - 1) type = 'boss';
    else if (Math.random() < runnerChance) type = 'runner';
    new Zombie(type);
  }
  updateHud();
}

function onZombieKilled(points = 100) {
  game.kills += 1;
  game.score += points;
  game.waveRemaining -= 1;
  if (game.waveRemaining <= 0 && zombies.length === 0) {
    startWave(game.wave + 1);
  }
  updateHud();
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
let firing = false; // true while SPACE is held

const currentWeapon = () => WEAPONS[currentWeaponKey];

function switchWeapon(key) {
  if (!WEAPONS[key] || key === currentWeaponKey) return;
  currentWeaponKey = key;
  reloading = false;
  fireTimer = 0;
  updateHud();
}

function reload() {
  const w = currentWeapon();
  const ammo = loadout[currentWeaponKey];
  if (reloading || ammo.mag >= w.magSize || ammo.reserve <= 0) return;
  reloading = true;
  audio.reload();
  updateHud();
  setTimeout(() => {
    const take = Math.min(w.magSize - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    reloading = false;
    updateHud();
  }, w.reloadTime * 1000);
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
  updateHud();
}

// ---------------------------------------------------------------------------
// Player damage
// ---------------------------------------------------------------------------
const damageFlash = document.getElementById('damage-flash');
let flashTimer = 0;

function damagePlayer(amount) {
  if (!game.running) return;
  game.health = Math.max(0, game.health - amount);
  audio.playerHit();
  damageFlash.classList.add('show');
  flashTimer = 0.15;
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

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveState.forward = true; break;
    case 'KeyS': case 'ArrowDown': moveState.back = true; break;
    case 'KeyA': case 'ArrowLeft': moveState.left = true; break;
    case 'KeyD': case 'ArrowRight': moveState.right = true; break;
    case 'Digit1': switchWeapon('shotgun'); break;
    case 'Digit2': switchWeapon('machinegun'); break;
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
    case 'Space': firing = false; break;
  }
}
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// ---------------------------------------------------------------------------
// Overlays / lifecycle
// ---------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const gameover = document.getElementById('gameover');
document.getElementById('start-btn').addEventListener('click', () => controls.lock());
document.getElementById('restart-btn').addEventListener('click', () => {
  resetGame();
  controls.lock();
});

let sessionStarted = false; // so we sting once per game, not on pause/resume
controls.addEventListener('lock', () => {
  overlay.classList.add('hidden');
  gameover.classList.add('hidden');
  el.hud.classList.remove('hidden');
  game.running = true;
  audio.startMusic(); // resumes the Web Audio context on this user gesture
  if (!sessionStarted) {
    audio.waveStart();
    sessionStarted = true;
  }
  updateViewmodel();
});
controls.addEventListener('unlock', () => {
  el.viewmodel.classList.add('hidden');
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
  }
  corpses.length = 0;
  game.running = false;
  game.health = PLAYER_MAX_HEALTH;
  game.kills = 0;
  game.score = 0;
  game.wave = 1;
  loadout.shotgun = { mag: WEAPONS.shotgun.magSize, reserve: WEAPONS.shotgun.reserveMax };
  loadout.machinegun = { mag: WEAPONS.machinegun.magSize, reserve: WEAPONS.machinegun.reserveMax };
  currentWeaponKey = 'shotgun';
  controls.object.position.set(0, PLAYER_EYE_HEIGHT, STREET_LENGTH / 2 - 18);
  startWave(1);
  game.running = true;
  updateHud();
}

function endGame() {
  game.running = false;
  audio.stopMusic();
  audio.gameOver();
  controls.unlock();
  el.hud.classList.add('hidden');
  el.viewmodel.classList.add('hidden');
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
const bloodParticles = [];

function spawnBlood(point, count = 12) {
  if (!point) return;
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: bloodTexture,
      color: 0xaa0000,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    const s = new THREE.Sprite(mat);
    const sz = 0.12 + Math.random() * 0.2;
    s.scale.set(sz, sz, 1);
    s.position.copy(point);
    scene.add(s);
    bloodParticles.push({
      sprite: s,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 4
      ),
      life: 0.5,
      maxLife: 0.5,
    });
  }
}

function updateBlood(delta) {
  for (let i = bloodParticles.length - 1; i >= 0; i--) {
    const b = bloodParticles[i];
    b.life -= delta;
    if (b.life <= 0) {
      scene.remove(b.sprite);
      b.sprite.material.dispose();
      bloodParticles.splice(i, 1);
      continue;
    }
    b.vel.y -= 9.8 * delta; // gravity
    b.sprite.position.addScaledVector(b.vel, delta);
    b.sprite.material.opacity = b.life / b.maxLife;
  }
}

const fxLayer = document.getElementById('fx-layer');
const _proj = new THREE.Vector3();

function spawnDamageNumber(point, amount, killed) {
  if (!point || !fxLayer) return;
  _proj.copy(point).project(camera);
  if (_proj.z > 1) return; // behind the camera
  const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
  const div = document.createElement('div');
  div.className = 'dmg-number' + (killed ? ' kill' : '');
  div.textContent = killed ? 'KILL +' + Math.round(amount) : String(Math.round(amount));
  div.style.left = x + 'px';
  div.style.top = y + 'px';
  fxLayer.appendChild(div);
  setTimeout(() => div.remove(), 800);
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let footstepTimer = 0; // cadence for walking footstep sounds

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (game.running && controls.isLocked) {
    velocity.x -= velocity.x * 10 * delta;
    velocity.z -= velocity.z * 10 * delta;
    direction.z = Number(moveState.forward) - Number(moveState.back);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();
    if (moveState.forward || moveState.back) velocity.z -= direction.z * PLAYER_SPEED * delta;
    if (moveState.left || moveState.right) velocity.x -= direction.x * PLAYER_SPEED * delta;
    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);

    const p = controls.object.position;
    p.x = THREE.MathUtils.clamp(p.x, -PLAY_HALF_WIDTH + 1, PLAY_HALF_WIDTH - 1);
    p.z = THREE.MathUtils.clamp(p.z, -STREET_LENGTH / 2 + 4, STREET_LENGTH / 2 - 4);
    p.y = PLAYER_EYE_HEIGHT;

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

    if (skinsReady && zombies.length === 0 && game.waveRemaining <= 0) {
      startWave(game.wave + 1);
    }
  }

  updateBlood(delta);
  updateCorpses(delta);
  updateFires(delta);
  updateAtmosphere(delta);

  if (muzzleLight.intensity > 0) {
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - delta * 30);
  }
  if (flashTimer > 0) {
    flashTimer -= delta;
    if (flashTimer <= 0) damageFlash.classList.remove('show');
  }

  renderer.render(scene, camera);
}

animate();
