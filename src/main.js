import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { images } from './assets.js';
import './style.css';

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
    pellets: 8,
    spread: 0.09,
    damage: 22,
    range: 60,
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
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.006);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// ---------------------------------------------------------------------------
// Lighting — bright, so everything is clearly visible
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x9fb0d8, 0.8));
scene.add(new THREE.HemisphereLight(0x5c6cae, 0x2c3038, 0.7));
const moon = new THREE.DirectionalLight(0xaec4f0, 0.8);
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

function buildEnvironment() {
  // --- Ground (dirt/base around the road) ---
  const baseGeo = new THREE.PlaneGeometry((PLAY_HALF_WIDTH + 40) * 2, STREET_LENGTH + 40);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 1 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.05;
  scene.add(base);

  // --- Road asphalt ---
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.95 });
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, STREET_LENGTH),
    roadMat
  );
  road.rotation.x = -Math.PI / 2;
  scene.add(road);

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

  // --- Buildings with lit windows ---
  const buildingColors = [0x4a5160, 0x545c6e, 0x3f4654, 0x5b6070, 0x474e5e];
  for (const side of [-1, 1]) {
    for (let z = -STREET_LENGTH / 2 + 8; z < STREET_LENGTH / 2; z += 16) {
      const w = 11 + Math.random() * 6;
      const h = 18 + Math.random() * 38;
      const d = 12 + Math.random() * 6;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({
          color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
          roughness: 0.92,
          emissive: 0x14161e,
        })
      );
      b.position.set(
        side * (PLAY_HALF_WIDTH + w / 2 + 0.5),
        h / 2,
        z + (Math.random() * 4 - 2)
      );
      scene.add(b);
      addWindows(b, w, h, d, side);
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
  // a couple of crashed cars in the road
  for (let i = 0; i < 3; i++) {
    const car = makeCar(0x333333);
    car.position.set(
      (Math.random() - 0.5) * ROAD_HALF_WIDTH,
      0,
      (Math.random() - 0.5) * (STREET_LENGTH - 40)
    );
    car.rotation.y = Math.random() * Math.PI;
    scene.add(car);
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
}

function makeCar(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.0, 4.6),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.5 })
  );
  body.position.y = 0.8;
  g.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.85, 2.4),
    new THREE.MeshStandardMaterial({
      color: 0x10141c,
      roughness: 0.2,
      metalness: 0.7,
    })
  );
  cabin.position.set(0, 1.65, -0.2);
  g.add(cabin);

  // headlights
  const hlMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0xfff2c0,
    emissiveIntensity: 1.2,
  });
  for (const sx of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.1), hlMat);
    hl.position.set(sx, 0.8, 2.35);
    g.add(hl);
  }

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 });
  for (const wx of [-1.05, 1.05]) {
    for (const wz of [-1.5, 1.5]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, 0.5, wz);
      g.add(wheel);
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
// Zombie sprites — background removed (flood-fill cutout) + ground shadow
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

async function preloadSkins() {
  zombieSkins.push(...(await Promise.all(images.zombies.map(prepareSkin))));
  bossSkins.push(...(await Promise.all(images.bosses.map(prepareSkin))));
  skinsReady = true;
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

const zombies = [];

class Zombie {
  constructor(isBoss = false) {
    this.isBoss = isBoss;
    const pool = isBoss && bossSkins.length ? bossSkins : zombieSkins;
    const skin = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;

    const mat = new THREE.SpriteMaterial({
      map: skin ? skin.texture : null,
      transparent: true,
      alphaTest: 0.25,
      depthWrite: true,
      fog: true,
    });
    this.sprite = new THREE.Sprite(mat);

    const height = isBoss ? 6.5 : 3.4;
    const aspect = skin ? skin.aspect : 0.55;
    const width = height * aspect;
    this.sprite.scale.set(width, height, 1);
    this.sprite.center.set(0.5, 0); // anchor at feet → stands on the ground
    this.sprite.userData.zombie = this;

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
    this.shadow.scale.set(width * 1.5, width * 1.5, 1);
    this.shadow.position.y = 0.04;

    this.maxHealth = isBoss ? 320 : 60;
    this.health = this.maxHealth;
    this.speed = isBoss ? 2.2 : 3.0 + Math.random() * 1.6;
    this.damage = isBoss ? 22 : 9;
    this.attackCooldown = 0;
    this.dead = false;

    this.spawn();
    scene.add(this.sprite);
    scene.add(this.shadow);
    zombies.push(this);
  }

  spawn() {
    const p = controls.object.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 35 + Math.random() * 45;
    let x = p.x + Math.cos(angle) * dist;
    let z = p.z + Math.sin(angle) * dist;
    x = THREE.MathUtils.clamp(x, -PLAY_HALF_WIDTH + 1, PLAY_HALF_WIDTH - 1);
    z = THREE.MathUtils.clamp(z, -STREET_LENGTH / 2 + 4, STREET_LENGTH / 2 - 4);
    this.sprite.position.set(x, 0, z);
    this.shadow.position.set(x, 0.04, z);
  }

  update(delta, playerPos) {
    if (this.dead) return;
    const pos = this.sprite.position;
    const dx = playerPos.x - pos.x;
    const dz = playerPos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const attackRange = this.isBoss ? 4.5 : 2.6;
    if (dist > attackRange) {
      pos.x += (dx / dist) * this.speed * delta;
      pos.z += (dz / dist) * this.speed * delta;
      this.shadow.position.x = pos.x;
      this.shadow.position.z = pos.z;
    } else {
      this.attackCooldown -= delta;
      if (this.attackCooldown <= 0) {
        damagePlayer(this.damage);
        this.attackCooldown = 1.0;
      }
    }
  }

  hit(amount) {
    if (this.dead) return false;
    this.health -= amount;
    this.sprite.material.color.setRGB(1.6, 0.5, 0.5);
    setTimeout(() => {
      if (!this.dead) this.sprite.material.color.setRGB(1, 1, 1);
    }, 60);
    if (this.health <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  kill() {
    this.dead = true;
    scene.remove(this.sprite);
    scene.remove(this.shadow);
    this.sprite.material.dispose();
    this.shadow.material.dispose();
    this.shadow.geometry.dispose();
    const i = zombies.indexOf(this);
    if (i !== -1) zombies.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------
const game = {
  running: false,
  health: PLAYER_MAX_HEALTH,
  kills: 0,
  wave: 1,
  waveRemaining: 0,
};

function startWave(n) {
  game.wave = n;
  const count = 4 + n * 2;
  game.waveRemaining = count;
  for (let i = 0; i < count; i++) {
    const isBoss = n >= 3 && i === count - 1;
    new Zombie(isBoss);
  }
  updateHud();
}

function onZombieKilled() {
  game.kills += 1;
  game.waveRemaining -= 1;
  if (game.waveRemaining <= 0 && zombies.length === 0) {
    startWave(game.wave + 1);
  }
  updateHud();
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();

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
  updateHud();
  setTimeout(() => {
    const take = Math.min(w.magSize - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    reloading = false;
    updateHud();
  }, w.reloadTime * 1000);
}

function tryFire() {
  if (!game.running || reloading || fireTimer > 0) return;
  const w = currentWeapon();
  const ammo = loadout[currentWeaponKey];
  if (ammo.mag <= 0) {
    reload();
    return;
  }
  ammo.mag -= 1;
  fireTimer = w.fireDelay;

  muzzleLight.position.copy(controls.object.position);
  muzzleLight.intensity = 5;
  vmRecoil = 1; // kick the viewmodel

  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const sprites = zombies.map((z) => z.sprite);

  for (let p = 0; p < w.pellets; p++) {
    const dir = camDir.clone();
    dir.x += (Math.random() - 0.5) * w.spread;
    dir.y += (Math.random() - 0.5) * w.spread;
    dir.z += (Math.random() - 0.5) * w.spread;
    dir.normalize();
    raycaster.set(origin, dir);
    raycaster.far = w.range;
    const hits = raycaster.intersectObjects(sprites, false);
    if (hits.length) {
      const z = hits[0].object.userData.zombie;
      if (z && z.hit(w.damage)) onZombieKilled();
    }
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

controls.addEventListener('lock', () => {
  overlay.classList.add('hidden');
  gameover.classList.add('hidden');
  el.hud.classList.remove('hidden');
  game.running = true;
  updateViewmodel();
});
controls.addEventListener('unlock', () => {
  el.viewmodel.classList.add('hidden');
  if (game.running && game.health > 0) overlay.classList.remove('hidden');
});

function resetGame() {
  for (const z of [...zombies]) z.kill();
  zombies.length = 0;
  game.running = false;
  game.health = PLAYER_MAX_HEALTH;
  game.kills = 0;
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
  controls.unlock();
  el.hud.classList.add('hidden');
  el.viewmodel.classList.add('hidden');
  document.getElementById('final-stats').textContent =
    `Kills: ${game.kills}   ·   Reached Wave ${game.wave}`;
  gameover.classList.remove('hidden');
}

// Preload cut-out skins, then spawn the first wave.
preloadSkins().then(() => {
  startWave(1);
  updateHud();
});
updateHud();

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
