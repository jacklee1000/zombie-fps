// Background-removal for zombie sprite art.
// ---------------------------------------------------------------------------
// Erase the flat backdrop by region-growing from the image borders, then crop
// to the figure so it sits on the ground. Handles the black-background renders
// (pure black + dark vignette corners) as well as the older flat-grey
// backdrops — both are removed; only colourful figure pixels are protected.
// Returns { canvas, aspect }.
export function cutoutAndCrop(img) {
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
  // Gradient-following flood: a neighbour is only erased if its colour is very
  // close to the pixel we stepped from. Smooth backdrops (flat black, grey, or
  // a dark vignette) get traversed step-by-step, but the high-contrast figure
  // silhouette stops the flood — so grey flesh / dark clothing is preserved.
  const STEP_TOL = 13 * 13; // squared colour distance allowed between adjacent px
  const SAT_GUARD = 70; // never erase strongly-coloured pixels (blood, eyes)

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
      const nr = d[np];
      const ng = d[np + 1];
      const nbl = d[np + 2];
      // Protect strongly-coloured figure pixels outright (blood, glowing eyes).
      const sat = Math.max(nr, ng, nbl) - Math.min(nr, ng, nbl);
      if (sat > SAT_GUARD) continue;
      // Otherwise flood only across small colour steps (smooth backdrop).
      const dr = nr - r;
      const dg = ng - g;
      const db2 = nbl - b;
      if (dr * dr + dg * dg + db2 * db2 >= STEP_TOL) continue;
      visited[ni] = 1;
      stack.push(ni);
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
