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

// Find the first filename containing ALL given keywords (case-insensitive).
function find(...keywords) {
  const key = Object.keys(byName).find((name) =>
    keywords.every((k) => name.toLowerCase().includes(k.toLowerCase()))
  );
  return key ? byName[key] : null;
}

// Categorised assets used by the game.
export const images = {
  all: byName,

  // Walking-enemy sprites (full-body zombies).
  zombies: [
    find('zombie', 'soldier', 'front'),
    find('riot', 'shield'),
    find('police'),
    find('nurse'),
    find('scientist'),
    find('biker'),
    find('running'),
    find('crawling'),
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
};

// Helpful when something is missing during development.
if (images.zombies.length === 0) {
  console.warn('[assets] No zombie sprites were found — check the image filenames.');
}
