// Kanten-Magnet: Pfeilenden rasten an der nächsten Bildkante ein (ohne KI).
// Gesucht wird entlang der Pfeilrichtung (die Kante steht quer zum Pfeil, z. B. Türsturz bei einem Höhen-Pfeil,
// Türstock bei einem Breiten-Pfeil). Funktioniert damit auch bei schrägen Pfeilen in der Perspektive.
// Alle Koordinaten hier in Pixeln des Graubilds.

// Graubild aus einem Bild/Canvas (verkleinert, damit es schnell geht)
export function grayFromImage(img, maxSide = 1000) {
  const w0 = img.naturalWidth || img.videoWidth || img.width, h0 = img.naturalHeight || img.videoHeight || img.height;
  const sc = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return { w, h, data: g };
}

// Helligkeit mit bilinearer Interpolation; außerhalb → NaN
function lum(g, x, y) {
  if (x < 0 || y < 0 || x > g.w - 1 || y > g.h - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1), d = g.data;
  return (d[y0 * g.w + x0] * (1 - fx) + d[y0 * g.w + x1] * fx) * (1 - fy) + (d[y1 * g.w + x0] * (1 - fx) + d[y1 * g.w + x1] * fx) * fy;
}

/**
 * Pfeilende p entlang der Richtung dir (Einheitsvektor, zeigt vom Pfeilinneren zum Ende hinaus) an die stärkste Kante schieben.
 * @param g      Graubild { w, h, data }
 * @param p      { x, y } Pfeilende
 * @param dir    { x, y } Einheitsvektor entlang des Pfeils
 * @param opts   radius (px), minContrast (0..255), step (px), lateral (px seitlich mitteln)
 * @returns      { x, y, t, score } oder null, wenn keine klare Kante
 */
export function snapEndpoint(g, p, dir, opts = {}) {
  const R = opts.radius ?? 24, minC = opts.minContrast ?? 14, step = opts.step ?? 1, lat = opts.lateral ?? 3, k = opts.k ?? 2;
  const offsets = opts.offsets || Array.from({ length: 2 * lat + 1 }, (_, i) => i - lat);
  const nx = -dir.y, ny = dir.x; // quer zum Pfeil
  const prof = [];
  for (let t = -R; t <= R; t += step) {
    let sum = 0, n = 0;
    for (const o of offsets) {
      const qx = p.x + dir.x * t + nx * o, qy = p.y + dir.y * t + ny * o;
      const a = lum(g, qx + dir.x * k, qy + dir.y * k), b = lum(g, qx - dir.x * k, qy - dir.y * k);
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      sum += Math.abs(a - b); n++;
    }
    prof.push({ t, g: n ? sum / n : 0 });
  }
  if (prof.length < 3) return null;
  const vals = prof.map(x => x.g).sort((a, b) => a - b), med = vals[vals.length >> 1], gmax = vals[vals.length - 1];
  if (gmax < minC || gmax < 1.8 * med) return null; // keine klare Kante in der Nähe
  // Kandidaten = örtliche Maxima, die deutlich sind; davon die NÄCHSTE nehmen (nicht die stärkste):
  // der Nutzer hat das Ende ja schon fast an der gewünschten Kante abgelegt
  const thr = Math.max(minC, 0.6 * gmax, 2 * med);
  let best = null;
  for (let i = 1; i < prof.length - 1; i++) {
    const x = prof[i];
    if (x.g < thr || x.g < prof[i - 1].g || x.g < prof[i + 1].g) continue;
    if (!best || Math.abs(x.t) < Math.abs(best.t) - 0.5 || (Math.abs(Math.abs(x.t) - Math.abs(best.t)) <= 0.5 && x.g > best.g)) best = { ...x, i };
  }
  if (!best) return null;
  // Feinlage: Schwerpunkt der Kantenstärke um das Maximum (±1 Schritt)
  const a = prof[best.i - 1], b = prof[best.i + 1];
  let t = best.t;
  if (a && b) { const den = a.g + best.g + b.g; if (den > 0) t = (a.t * a.g + best.t * best.g + b.t * b.g) / den; }
  return { x: p.x + dir.x * t, y: p.y + dir.y * t, t, score: best.g };
}

/** Beide Enden eines Pfeils (normierte Koordinaten 0..1) einrasten. which: 'p1' | 'p2' | 'both'. Gibt zurück, was sich bewegt hat. */
export function magnetArrow(g, a, which = 'both', opts = {}) {
  const P1 = { x: a.x1 * g.w, y: a.y1 * g.h }, P2 = { x: a.x2 * g.w, y: a.y2 * g.h };
  const len = Math.hypot(P2.x - P1.x, P2.y - P1.y);
  if (len < 8) return { moved: [] };
  const d = { x: (P2.x - P1.x) / len, y: (P2.y - P1.y) / len };
  const moved = [];
  if (which !== 'p2') { const r = snapEndpoint(g, P1, { x: -d.x, y: -d.y }, opts); if (r) { a.x1 = r.x / g.w; a.y1 = r.y / g.h; moved.push('p1'); } }
  if (which !== 'p1') { const r = snapEndpoint(g, P2, d, opts); if (r) { a.x2 = r.x / g.w; a.y2 = r.y / g.h; moved.push('p2'); } }
  return { moved };
}
