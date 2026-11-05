// Pfeile: Koordinaten normiert (0..1) auf das Foto.
// arrow = { id, x1, y1, x2, y2, kind: 'H'|'B', el: 'Fenster 1'|'Tür'|'Raumhöhe', cm: null|number, time: null|ISO }

let _id = 0;
const nid = () => 'a' + Date.now().toString(36) + (_id++);

export function arrowsForBox(b, el) {
  // b: {x0,y0,x1,y1} normiert
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const isDoor = el === 'Tür';
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
  const doors = objs.filter(o => o.type === 'door');
  const out = [];
  wins.forEach((o, i) => out.push(...arrowsForBox(o.box, wins.length > 1 ? `Fenster ${i + 1}` : 'Fenster')));
  if (doors[0]) out.push(...arrowsForBox(doors[0].box, 'Tür'));
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
  'Raumhöhe': () => [{ id: nid(), x1: 0.5, y1: 0.95, x2: 0.5, y2: 0.05, kind: 'H', el: 'Raumhöhe', cm: null, time: null }],
};

export function newArrow() {
  return { id: nid(), x1: 0.3, y1: 0.5, x2: 0.7, y2: 0.5, kind: 'B', el: 'Maß', cm: null, time: null };
}

// Zeichnet Pfeile im Bosch-Stil (gelb, schwarzer Rand, schwarzes Etikett mit weißer Schrift)
export function drawArrows(ctx, W, H, arrows, activeId, blink = 1, forExport = false) {
  const s = Math.max(W, H) / 1600;
  for (const a of arrows) {
    const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
    const active = !forExport && a.id === activeId;
    const col = active ? `rgba(255,${Math.round(120 + 115 * blink)},0,1)` : '#ffe600';
    const lw = 7 * s;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = 26 * s;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // schwarzer Rand
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? col : '#000';
      ctx.fillStyle = pass ? col : '#000';
      ctx.lineWidth = pass ? lw : lw + 4 * s;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
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
    const label = a.cm != null ? `${a.cm} cm` : (forExport ? null : (active ? '? cm' : a.kind === 'H' ? 'Höhe' : 'Breite'));
    if (label) {
      let la = ang; if (la > Math.PI / 2) la -= Math.PI; if (la < -Math.PI / 2) la += Math.PI;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      ctx.save(); ctx.translate(mx, my); ctx.rotate(la);
      // Maße 1,5× größer als ursprünglich, damit sie im Bild/PDF gut lesbar sind
      ctx.font = `bold ${Math.round(45 * s)}px "Noto Sans", Arial, sans-serif`;
      const tw = ctx.measureText(label).width;
      const bw = tw + 27 * s, bh = 60 * s;
      ctx.fillStyle = a.cm != null ? '#000' : (active ? '#d32f2f' : 'rgba(0,0,0,0.55)');
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 9 * s); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 1 * s);
      ctx.restore();
    }
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
