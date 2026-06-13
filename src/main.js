import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { images } from './assets.js';
import './style.css';

// ---------------------------------------------------------------------------
// Constants / tuning
// ---------------------------------------------------------------------------
const STREET_HALF_WIDTH = 14; // playable area along X (left/right of street)
const STREET_LENGTH = 220; // along Z
const PLAYER_SPEED = 60;
const PLAYER_EYE_HEIGHT = 1.8;
const PLAYER_MAX_HEALTH = 100;

const WEAPONS = {
  shotgun: {
    name: 'SHOTGUN',
    img: images.weapons.shotgun,
    magSize: 6,
    reserveMax: 36,
    pellets: 8, // rays per shot
    spread: 0.09, // radians
    damage: 22, // per pellet
    range: 60,
    fireDelay: 0.75, // seconds between shots
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
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = 0x0a0d12;
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.022);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// ---------------------------------------------------------------------------
// Lighting (moonlit, grim)
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0x35404f, 0x05070a, 0.5));
const moon = new THREE.DirectionalLight(0x8faecf, 0.6);
moon.position.set(-40, 80, -30);
scene.add(moon);

// A flickering muzzle/ambient flare light that we pulse when firing.
const muzzleLight = new THREE.PointLight(0xffd27f, 0, 30, 2);
scene.add(muzzleLight);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.object);
controls.object.position.set(0, PLAYER_EYE_HEIGHT, STREET_LENGTH / 2 - 20);

// ---------------------------------------------------------------------------
// Environment: street, buildings, cars, backdrops
// ---------------------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();

function buildEnvironment() {
  // Asphalt ground
  const groundGeo = new THREE.PlaneGeometry(STREET_HALF_WIDTH * 2 + 30, STREET_LENGTH);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Center road markings
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x55502a, roughness: 1 });
  for (let z = -STREET_LENGTH / 2; z < STREET_LENGTH / 2; z += 10) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4), lineMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.02, z);
    scene.add(dash);
  }

  // Buildings along both sides
  const buildingColors = [0x1a1d24, 0x202430, 0x171a20, 0x23262e];
  for (let side = -1; side <= 1; side += 2) {
    for (let z = -STREET_LENGTH / 2 + 8; z < STREET_LENGTH / 2; z += 18) {
      const w = 10 + Math.random() * 6;
      const h = 16 + Math.random() * 40;
      const d = 12 + Math.random() * 6;
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({
        color: buildingColors[Math.floor(Math.random() * buildingColors.length)],
        roughness: 0.9,
        emissive: 0x080a10,
      });
      const b = new THREE.Mesh(geo, mat);
      b.position.set(
        side * (STREET_HALF_WIDTH + w / 2 + 1),
        h / 2,
        z + (Math.random() * 6 - 3)
      );
      scene.add(b);

      // A few lit windows for atmosphere
      addWindows(b, w, h, d, side);
    }
  }

  // Abandoned cars scattered on the road
  const carColors = [0x402020, 0x203040, 0x303030, 0x40381c];
  for (let i = 0; i < 14; i++) {
    const car = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.3, 4.6),
      new THREE.MeshStandardMaterial({
        color: carColors[i % carColors.length],
        roughness: 0.8,
        metalness: 0.3,
      })
    );
    car.position.set(
      (Math.random() * 2 - 1) * (STREET_HALF_WIDTH - 3),
      0.65,
      (Math.random() * 2 - 1) * (STREET_LENGTH / 2 - 10)
    );
    car.rotation.y = Math.random() * Math.PI;
    scene.add(car);
  }

  // Distant scenery billboards using the environment images
  addBackdrop(images.environments.city, 0, -STREET_LENGTH / 2 - 5, 70, 36);
  if (images.environments.mall) {
    addBackdrop(images.environments.mall, -45, -STREET_LENGTH / 2 + 30, 40, 26, Math.PI / 5);
  }
  if (images.environments.forest) {
    addBackdrop(images.environments.forest, 45, -STREET_LENGTH / 2 + 30, 40, 26, -Math.PI / 5);
  }
}

function addWindows(building, w, h, d, side) {
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0x665522,
    emissiveIntensity: 0.6,
  });
  const cols = 3;
  const rows = Math.max(2, Math.floor(h / 8));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() > 0.45) continue; // only some windows are lit
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), winMat);
      const x = (c - (cols - 1) / 2) * (w / cols);
      const y = -h / 2 + 4 + r * 7;
      // Face the street (the -side direction)
      win.position.set(x, y, (-side * d) / 2 - side * 0.06);
      win.rotation.y = side < 0 ? Math.PI : 0;
      building.add(win);
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
// Zombies
// ---------------------------------------------------------------------------
const zombieTextures = images.zombies.map((url) => {
  const t = textureLoader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
});
const bossTextures = images.bosses.map((url) => {
  const t = textureLoader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
});

const zombies = [];

class Zombie {
  constructor(isBoss = false) {
    this.isBoss = isBoss;
    const texPool = isBoss && bossTextures.length ? bossTextures : zombieTextures;
    const tex = texPool[Math.floor(Math.random() * texPool.length)];

    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.sprite = new THREE.Sprite(mat);

    const height = isBoss ? 6.5 : 3.4;
    const width = height * 0.62;
    this.sprite.scale.set(width, height, 1);
    this.sprite.center.set(0.5, 0); // anchor at feet
    this.sprite.userData.zombie = this;

    this.maxHealth = isBoss ? 320 : 60;
    this.health = this.maxHealth;
    this.speed = isBoss ? 2.2 : 3.0 + Math.random() * 1.6;
    this.damage = isBoss ? 22 : 9;
    this.attackCooldown = 0;
    this.dead = false;

    this.spawn();
    scene.add(this.sprite);
    zombies.push(this);
  }

  spawn() {
    const p = controls.object.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 50;
    let x = p.x + Math.cos(angle) * dist;
    let z = p.z + Math.sin(angle) * dist;
    x = THREE.MathUtils.clamp(x, -STREET_HALF_WIDTH + 1, STREET_HALF_WIDTH - 1);
    z = THREE.MathUtils.clamp(z, -STREET_LENGTH / 2 + 4, STREET_LENGTH / 2 - 4);
    this.sprite.position.set(x, 0, z);
  }

  update(delta, playerPos) {
    if (this.dead) return;

    const pos = this.sprite.position;
    const dx = playerPos.x - pos.x;
    const dz = playerPos.z - pos.z;
    const distSq = dx * dx + dz * dz;
    const dist = Math.sqrt(distSq);

    const attackRange = this.isBoss ? 4.5 : 2.6;
    if (dist > attackRange) {
      // Chase
      pos.x += (dx / dist) * this.speed * delta;
      pos.z += (dz / dist) * this.speed * delta;
    } else {
      // Attack on cooldown
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
    // brief red tint feedback
    this.sprite.material.color.setRGB(1.5, 0.5, 0.5);
    setTimeout(() => {
      if (!this.dead) this.sprite.material.color.setRGB(1, 1, 1);
    }, 60);
    if (this.health <= 0) {
      this.kill();
      return true; // killed
    }
    return false;
  }

  kill() {
    this.dead = true;
    scene.remove(this.sprite);
    this.sprite.material.dispose();
    const i = zombies.indexOf(this);
    if (i !== -1) zombies.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Wave management
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
    const isBoss = n >= 3 && i === count - 1; // a boss caps later waves
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
// Weapons / shooting
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);

const loadout = {
  shotgun: { mag: WEAPONS.shotgun.magSize, reserve: WEAPONS.shotgun.reserveMax },
  machinegun: { mag: WEAPONS.machinegun.magSize, reserve: WEAPONS.machinegun.reserveMax },
};
let currentWeaponKey = 'shotgun';
let fireTimer = 0;
let reloading = false;
let mouseDown = false;

function currentWeapon() {
  return WEAPONS[currentWeaponKey];
}

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
  setTimeout(() => {
    const need = w.magSize - ammo.mag;
    const take = Math.min(need, ammo.reserve);
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

  // Muzzle flash
  muzzleLight.position.copy(controls.object.position);
  muzzleLight.intensity = 4;

  // Fire pellets
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);

  for (let p = 0; p < w.pellets; p++) {
    const dir = camDir.clone();
    dir.x += (Math.random() - 0.5) * w.spread;
    dir.y += (Math.random() - 0.5) * w.spread;
    dir.z += (Math.random() - 0.5) * w.spread;
    dir.normalize();

    raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir);
    raycaster.far = w.range;
    const sprites = zombies.map((z) => z.sprite);
    const hits = raycaster.intersectObjects(sprites, false);
    if (hits.length) {
      const z = hits[0].object.userData.zombie;
      if (z && z.hit(w.damage)) {
        onZombieKilled();
      }
    }
  }

  updateHud();
}

// ---------------------------------------------------------------------------
// Player damage / death
// ---------------------------------------------------------------------------
const damageFlash = document.getElementById('damage-flash');
let flashTimer = 0;

function damagePlayer(amount) {
  if (!game.running) return;
  game.health = Math.max(0, game.health - amount);
  damageFlash.classList.add('show');
  flashTimer = 0.15;
  updateHud();
  if (game.health <= 0) {
    endGame();
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const el = {
  hud: document.getElementById('hud'),
  healthBar: document.getElementById('health-bar'),
  weaponImg: document.getElementById('weapon-img'),
  ammoCurrent: document.getElementById('ammo-current'),
  ammoReserve: document.getElementById('ammo-reserve'),
  weaponName: document.getElementById('weapon-name'),
  kills: document.getElementById('kills'),
  wave: document.getElementById('wave'),
};

function updateHud() {
  const pct = (game.health / PLAYER_MAX_HEALTH) * 100;
  el.healthBar.style.width = pct + '%';
  el.healthBar.style.background =
    pct > 50
      ? 'linear-gradient(90deg, #7a1010, #e23b3b)'
      : pct > 25
      ? 'linear-gradient(90deg, #7a4a10, #e2a33b)'
      : 'linear-gradient(90deg, #5a0000, #ff2a2a)';

  const w = currentWeapon();
  const ammo = loadout[currentWeaponKey];
  if (w.img) el.weaponImg.src = w.img;
  el.weaponName.textContent = reloading ? 'RELOADING…' : w.name;
  el.ammoCurrent.textContent = ammo.mag;
  el.ammoReserve.textContent = ammo.reserve;
  el.kills.textContent = game.kills;
  el.wave.textContent = game.wave;
}

// ---------------------------------------------------------------------------
// Movement input
// ---------------------------------------------------------------------------
const move = { forward: false, back: false, left: false, right: false };
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = true; break;
    case 'KeyS': case 'ArrowDown': move.back = true; break;
    case 'KeyA': case 'ArrowLeft': move.left = true; break;
    case 'KeyD': case 'ArrowRight': move.right = true; break;
    case 'Digit1': switchWeapon('shotgun'); break;
    case 'Digit2': switchWeapon('machinegun'); break;
    case 'KeyR': reload(); break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': move.forward = false; break;
    case 'KeyS': case 'ArrowDown': move.back = false; break;
    case 'KeyA': case 'ArrowLeft': move.left = false; break;
    case 'KeyD': case 'ArrowRight': move.right = false; break;
  }
}
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

renderer.domElement.addEventListener('mousedown', () => {
  if (!game.running) return;
  mouseDown = true;
  tryFire(); // first shot is immediate for both weapons
});
window.addEventListener('mouseup', () => {
  mouseDown = false;
});

// ---------------------------------------------------------------------------
// Overlays / lifecycle
// ---------------------------------------------------------------------------
const overlay = document.getElementById('overlay');
const gameover = document.getElementById('gameover');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

startBtn.addEventListener('click', () => controls.lock());
restartBtn.addEventListener('click', () => {
  resetGame();
  controls.lock();
});

controls.addEventListener('lock', () => {
  overlay.classList.add('hidden');
  gameover.classList.add('hidden');
  el.hud.classList.remove('hidden');
  if (!game.running) {
    game.running = true;
  }
});

controls.addEventListener('unlock', () => {
  // Show the start overlay again only if the player is still alive (paused).
  if (game.running && game.health > 0) {
    overlay.classList.remove('hidden');
  }
});

function resetGame() {
  // Clear existing zombies
  for (const z of [...zombies]) z.kill();
  zombies.length = 0;

  game.running = false;
  game.health = PLAYER_MAX_HEALTH;
  game.kills = 0;
  game.wave = 1;

  loadout.shotgun = { mag: WEAPONS.shotgun.magSize, reserve: WEAPONS.shotgun.reserveMax };
  loadout.machinegun = { mag: WEAPONS.machinegun.magSize, reserve: WEAPONS.machinegun.reserveMax };
  currentWeaponKey = 'shotgun';

  controls.object.position.set(0, PLAYER_EYE_HEIGHT, STREET_LENGTH / 2 - 20);
  startWave(1);
  game.running = true;
  updateHud();
}

function endGame() {
  game.running = false;
  controls.unlock();
  el.hud.classList.add('hidden');
  document.getElementById('final-stats').textContent =
    `Kills: ${game.kills}   ·   Reached Wave ${game.wave}`;
  gameover.classList.remove('hidden');
}

// Kick off the first wave so enemies exist the moment play starts.
startWave(1);
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
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (game.running && controls.isLocked) {
    // Movement
    velocity.x -= velocity.x * 10 * delta;
    velocity.z -= velocity.z * 10 * delta;

    direction.z = Number(move.forward) - Number(move.back);
    direction.x = Number(move.right) - Number(move.left);
    direction.normalize();

    if (move.forward || move.back) velocity.z -= direction.z * PLAYER_SPEED * delta;
    if (move.left || move.right) velocity.x -= direction.x * PLAYER_SPEED * delta;

    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);

    // Keep the player on the street
    const p = controls.object.position;
    p.x = THREE.MathUtils.clamp(p.x, -STREET_HALF_WIDTH + 1, STREET_HALF_WIDTH - 1);
    p.z = THREE.MathUtils.clamp(p.z, -STREET_LENGTH / 2 + 4, STREET_LENGTH / 2 - 4);
    p.y = PLAYER_EYE_HEIGHT;

    // Fire timer + automatic weapons
    if (fireTimer > 0) fireTimer -= delta;
    if (mouseDown && currentWeapon().auto) tryFire();

    // Zombies
    const playerPos = controls.object.position;
    for (const z of [...zombies]) z.update(delta, playerPos);

    // Top up the wave if it somehow empties without the counter (safety net)
    if (zombies.length === 0 && game.waveRemaining <= 0) {
      startWave(game.wave + 1);
    }
  }

  // Muzzle light decay
  if (muzzleLight.intensity > 0) {
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - delta * 30);
  }

  // Damage flash decay
  if (flashTimer > 0) {
    flashTimer -= delta;
    if (flashTimer <= 0) damageFlash.classList.remove('show');
  }

  renderer.render(scene, camera);
}

animate();
