// Pull every image in the project root into the bundle. Vite returns a map of
// { '../filename.jpg': 'resolved-url' } that works in both dev and build.
const modules = import.meta.glob('../*.{jpg,jpeg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
});

// Normalise to { filename: url }
const byName = {};
for (const [path, url] of Object.entries(modules)) {
  const name = path.split('/').pop();
  byName[name] = url;
}

// Pull in any audio files dropped into the project root too.
const audioByName = {};
for (const [path, url] of Object.entries(
  import.meta.glob('../*.{mp3,wav,ogg,m4a}', { eager: true, query: '?url', import: 'default' })
)) {
  audioByName[path.split('/').pop()] = url;
}
function findAudio(...keywords) {
  const key = Object.keys(audioByName).find((name) =>
    keywords.some((k) => name.toLowerCase().includes(k.toLowerCase()))
  );
  return key ? audioByName[key] : null;
}

// Find the first filename containing ALL given keywords (case-insensitive).
function find(...keywords) {
  const key = Object.keys(byName).find((name) =>
    keywords.every((k) => name.toLowerCase().includes(k.toLowerCase()))
  );
  return key ? byName[key] : null;
}

// Strong first-person hints (avoid bare "view" — the shotgun render is a
// "side_view" and must not be mistaken for a viewmodel).
const VIEWMODEL_HINTS = [
  'viewmodel',
  'view_model',
  'view-model',
  'first_person',
  'firstperson',
  'first-person',
  'fps',
  'pov',
  'holding',
  'hands',
  'handgun_fp',
];

// Find a viewmodel image: prefer one whose name matches BOTH a first-person
// hint and one of the given weapon words; otherwise any first-person image.
function findViewmodel(...weaponWords) {
  const names = Object.keys(byName);
  const isVm = (n) => VIEWMODEL_HINTS.some((h) => n.toLowerCase().includes(h));
  let key = names.find(
    (n) => isVm(n) && weaponWords.some((w) => n.toLowerCase().includes(w))
  );
  if (!key) key = names.find(isVm);
  return key ? byName[key] : null;
}

// Categorised assets used by the game.
export const images = {
  all: byName,

  // Optional real audio files (auto-detected by filename keyword). When a
  // category has a file the audio engine uses it; otherwise it synthesizes one.
  sounds: {
    music: findAudio('music', 'theme', 'ambient', 'background', 'bgm', 'horror'),
    shotgun: findAudio('shotgun', 'gunshot', 'shot', 'boom'),
    machinegun: findAudio('machinegun', 'machine', 'rifle', 'auto'),
    reload: findAudio('reload'),
    groan: findAudio('groan', 'moan'),
    death: findAudio('death', 'splat', 'scream'),
    hit: findAudio('hit', 'grunt', 'hurt'),
  },

  // Walking-enemy sprites (full-body zombies).
  // NOTE: the soldier (front + riot-shield) and police/cop sprites are
  // intentionally excluded — they were blocking the player's view.
  zombies: [
    find('nurse'),
    find('scientist'),
    find('biker'),
    find('running'),
  ].filter(Boolean),

  // Tougher, larger enemies.
  bosses: [find('enormous', 'mutant'), find('giant', 'mutant', 'boss')].filter(Boolean),

  // Backdrop scenery for the street.
  environments: {
    city: find('city', 'street'),
    mall: find('shopping', 'mall'),
    forest: find('forest'),
  },

  // Weapon art for the HUD.
  weapons: {
    shotgun: find('shotgun'),
    machinegun: find('11_07_22'), // ChatGPT AR-15 render
  },

  // First-person viewmodel(s): the held-gun image shown bottom-right, COD-style.
  // Detected by first-person keywords so a dropped-in file is picked up
  // automatically. Mapped per weapon when the filename also hints at one.
  viewmodels: {
    shotgun: findViewmodel('shotgun', 'pump'),
    machinegun: findViewmodel('machine', 'rifle', 'smg', 'assault', 'minigun', 'uzi', 'thompson', 'ar15', 'ar-15'),
    generic: findViewmodel(),
  },
};

// Helpful when something is missing during development.
if (images.zombies.length === 0) {
  console.warn('[assets] No zombie sprites were found — check the image filenames.');
}
