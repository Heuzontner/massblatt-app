// Pfeile: Koordinaten normiert (0..1) auf das Foto.
// arrow = { id, x1, y1, x2, y2, kind: 'H'|'B', el: 'Fenster 1'|'Tür'|'Raumhöhe', cm: null|number, time: null|ISO }

let _id = 0;
const nid = () => 'a' + Date.now().toString(36) + (_id++);

export function arrowsForBox(b, el) {
  // b: {x0,y0,x1,y1} normiert
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const isDoor = el === 'Tür' || el === 'Balkontür';
  const hx = b.x0 + w * (isDoor ? 0.12 : 0.14);
  const by = isDoor ? b.y1 - h * 0.05 : b.y1 - h * 0.1;
  return [
    { id: nid(), x1: hx, y1: b.y1 - h * 0.02, x2: hx, y2: b.y0 + h * 0.02, kind: 'H', el, cm: null, time: null },
    { id: nid(), x1: b.x0 + w * 0.05, y1: by, x2: b.x1 - w * 0.05, y2: by, kind: 'B', el, cm: null, time: null },
  ];
}

// Reihenfolge wie in Manuels Maßblättern: Fenster links→rechts (Höhe, Breite), dann Tür (Höhe, Breite)
export function arrowsFromObjects(objs) {
  const wins = objs.filter(o => o.type === 'window').sort((a, b) => a.box.x0 - b.box.x0);
  const doors = objs.filter(o => o.type === 'door' || o.type === 'balcony');
  const out = [];
  wins.forEach((o, i) => out.push(...arrowsForBox(o.box, wins.length > 1 ? `Fenster ${i + 1}` : 'Fenster')));
  if (doors[0]) out.push(...arrowsForBox(doors[0].box, doors[0].type === 'balcony' ? 'Balkontür' : 'Tür'));
  return out;
}

export const TEMPLATES = {
  'Tür': () => arrowsFromObjects([{ type: 'door', box: { x0: 0.12, y0: 0.04, x1: 0.88, y1: 0.97 } }]),
  'Fenster': () => arrowsFromObjects([{ type: 'window', box: { x0: 0.28, y0: 0.22, x1: 0.72, y1: 0.6 } }]),
  'Tür + Fenster': () => arrowsFromObjects([
    { type: 'window', box: { x0: 0.38, y0: 0.28, x1: 0.66, y1: 0.55 } },
    { type: 'door', box: { x0: 0.08, y0: 0.03, x1: 0.92, y1: 0.98 } }]),
  '2 Fenster': () => arrowsFromObjects([
    { type: 'window', box: { x0: 0.1, y0: 0.28, x1: 0.42, y1: 0.56 } },
    { type: 'window', box: { x0: 0.58, y0: 0.28, x1: 0.9, y1: 0.56 } }]),
  // zwei Fenster an der Rückwand, Tür außen herum (Wohnzimmer mit zwei Fenstern)
  'Tür + 2 Fenster': () => arrowsFromObjects([
    { type: 'window', box: { x0: 0.24, y0: 0.3, x1: 0.47, y1: 0.54 } },
    { type: 'window', box: { x0: 0.53, y0: 0.3, x1: 0.76, y1: 0.54 } },
    { type: 'door', box: { x0: 0.08, y0: 0.03, x1: 0.92, y1: 0.98 } }]),
  // Balkontür (hoch) neben einem Fenster – typische Loggia-/Wohnzimmerwand
  'Balkontür + Fenster': () => arrowsFromObjects([
    { type: 'window', box: { x0: 0.56, y0: 0.26, x1: 0.9, y1: 0.55 } },
    { type: 'balcony', box: { x0: 0.12, y0: 0.2, x1: 0.46, y1: 0.86 } }]),
  'Raumhöhe': () => [{ id: nid(), x1: 0.5, y1: 0.95, x2: 0.5, y2: 0.05, kind: 'H', el: 'Raumhöhe', cm: null, time: null }],
};

export function newArrow() {
  return { id: nid(), x1: 0.3, y1: 0.5, x2: 0.7, y2: 0.5, kind: 'B', el: 'Maß', cm: null, time: null };
}

// Etikett-Rechtecke der letzten Zeichnung (normiert 0..1), für „Etikett antippen = versetzen“
export const labelBoxes = new Map();
// Lage des Etiketts entlang des Pfeils: a.lab 0 = Mitte, 1 = am Anfang, 2 = am Ende; ohne Angabe automatisch (weicht anderen aus)
const LAB_T = [0.5, 0.2, 0.8];
// Zeichnet Pfeile im Bosch-Stil (gelb, schwarzer Rand, schwarzes Etikett mit weißer Schrift)
// opts: { dash: Breiten-Pfeile gestrichelt (Farbenblind-Hilfe, nur App) }
export function drawArrows(ctx, W, H, arrows, activeId, blink = 1, forExport = false, fmt = null, opts = {}) {
  const s = Math.max(W, H) / 1600;
  const placed = []; // schon gesetzte Etiketten (Rechtecke in Pixel), damit sich keine überdecken
  const overlaps = (r1, r2) => !(r1.x + r1.w < r2.x || r2.x + r2.w < r1.x || r1.y + r1.h < r2.y || r2.y + r2.h < r1.y);
  for (const a of arrows) {
    const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
    const active = !forExport && a.id === activeId;
    // in der App farbig je Art (Tür gelb, Fenster blau, Raumhöhe grün); im PDF immer gelb wie bei Bosch
    const base = forExport ? '#ffe600' : (a.el || '').startsWith('Fenster') ? '#3fb2ff' : a.el === 'Raumhöhe' ? '#4cd964' : '#ffe600';
    const col = active ? `rgba(255,${Math.round(120 + 115 * blink)},0,1)` : base;
    const lw = 7 * s;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = 26 * s;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const dashed = !forExport && opts.dash && a.kind === 'B';
    // schwarzer Rand
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? col : '#000';
      ctx.fillStyle = pass ? col : '#000';
      ctx.lineWidth = pass ? lw : lw + 4 * s;
      if (dashed) ctx.setLineDash([18 * s, 12 * s]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      for (const [px, py, dir] of [[x1, y1, ang + Math.PI], [x2, y2, ang]]) {
        const e = pass ? 0 : 3 * s;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(dir) * (head * 0.25 + e), py + Math.sin(dir) * (head * 0.25 + e));
        ctx.lineTo(px - Math.cos(dir) * head + Math.cos(dir + Math.PI / 2) * (head * 0.55 + e), py - Math.sin(dir) * head + Math.sin(dir + Math.PI / 2) * (head * 0.55 + e));
        ctx.lineTo(px - Math.cos(dir) * head - Math.cos(dir + Math.PI / 2) * (head * 0.55 + e), py - Math.sin(dir) * head - Math.sin(dir + Math.PI / 2) * (head * 0.55 + e));
        ctx.closePath(); ctx.fill();
      }
    }
    if (active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2 * s; ctx.setLineDash([10 * s, 8 * s]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    }
    // Etikett
    const label = a.cm != null ? (fmt ? fmt(a) : `${a.cm} cm`) : (forExport ? null : (active ? '? cm' : a.kind === 'H' ? 'Höhe' : 'Breite'));
    if (label) {
      let la = ang; if (la > Math.PI / 2) la -= Math.PI; if (la < -Math.PI / 2) la += Math.PI;
      // Maße 1,5× größer als ursprünglich, damit sie im Bild/PDF gut lesbar sind
      ctx.font = `bold ${Math.round(45 * s)}px "Noto Sans", Arial, sans-serif`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 27 * s, bh = 60 * s;
      // Lage: vom Nutzer gewählt (a.lab) oder automatisch so, dass sich Etiketten nicht überdecken
      // Kandidaten: entlang des Pfeils verschieben, zuletzt seitlich daneben (wenn zwei Pfeile fast aufeinander liegen)
      const cands = a.lab != null && LAB_T[a.lab] != null ? [[LAB_T[a.lab], 0]] : [[0.5, 0], [0.36, 0], [0.64, 0], [0.24, 0], [0.76, 0], [0.5, 1], [0.5, -1], [0.3, 1], [0.7, -1]];
      const nx = -Math.sin(ang), ny = Math.cos(ang); // quer zum Pfeil
      const box = (t, o) => { const cx = x1 + (x2 - x1) * t + nx * o * bh * 1.05, cy = y1 + (y2 - y1) * t + ny * o * bh * 1.05; const ex = (Math.abs(Math.cos(la)) * bw + Math.abs(Math.sin(la)) * bh) / 2, ey = (Math.abs(Math.sin(la)) * bw + Math.abs(Math.cos(la)) * bh) / 2; return { x: cx - ex, y: cy - ey, w: 2 * ex, h: 2 * ey, cx, cy }; };
      let b = box(cands[0][0], cands[0][1]);
      for (const [t, o] of cands) { const c = box(t, o); if (c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H && !placed.some(pb => overlaps(pb, c))) { b = c; break; } }
      placed.push(b);
      labelBoxes.set(a.id, { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });
      ctx.save(); ctx.translate(b.cx, b.cy); ctx.rotate(la);
      ctx.fillStyle = a.cm != null ? '#000' : (active ? '#d32f2f' : 'rgba(0,0,0,0.55)');
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 9 * s); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 1 * s);
      ctx.restore();
    } else labelBoxes.delete(a.id);
    if (!forExport) {
      for (const [px, py] of [[x1, y1], [x2, y2]]) {
        ctx.beginPath(); ctx.arc(px, py, 14 * s, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
        ctx.strokeStyle = active ? '#fff' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2 * s; ctx.stroke();
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
