// Grundriss-Ausgabe (Stufe 3): PDF (maßstäblich) und DXF für BricsCAD. Reine Erzeugung, keine Oberfläche.
import * as G from './plan-geo.js';
const fmtA = m2 => m2.toFixed(2).replace('.', ',') + ' m²';
const fmtM = cm => (cm / 100).toFixed(2).replace('.', ',') + ' m';
const areaOf = r => G.summary(r).area;
const inner = t => Math.round((180 - Math.abs(t)) * 10) / 10;          // Innenwinkel der Ecke
export const fileBase = plan => ('Grundriss ' + (plan.name || 'ohne Adresse')).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------- DXF (R12, Einheit cm, y nach oben) ----------------
const asc = s => String(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/²/g, '2').replace(/[^\x20-\x7e]/g, '?');
export function buildDxf(plan) {
  const done = plan.rooms.filter(r => r.closed && r.walls.length >= 3), lay = G.layout(plan.rooms, plan.wall || 15), o = [];
  const w = (...a) => { for (let i = 0; i < a.length; i += 2) o.push(String(a[i]), String(a[i + 1])); }, f = v => (Math.round(v * 1000) / 1000).toString();
  const LAYERS = [['WAND', 7], ['TUER', 2], ['FENSTER', 5], ['RAUMTEXT', 3], ['MASSE', 8], ['LOSE', 9]];
  w(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 5, 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 64, 3, 'Solid line', 72, 65, 73, 0, 40, 0.0, 0, 'ENDTAB');
  w(0, 'TABLE', 2, 'LAYER', 70, LAYERS.length); for (const [n, c] of LAYERS) w(0, 'LAYER', 2, n, 70, 64, 62, c, 6, 'CONTINUOUS'); w(0, 'ENDTAB', 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'ENTITIES');
  const line = (L, p, q) => w(0, 'LINE', 8, L, 10, f(p.x), 20, f(-p.y), 30, 0, 11, f(q.x), 21, f(-q.y), 31, 0);
  const text = (L, p, h, t, rot = 0) => w(0, 'TEXT', 8, L, 10, f(p.x), 20, f(-p.y), 30, 0, 40, f(h), 1, asc(t), 50, f(rot), 72, 1, 11, f(p.x), 21, f(-p.y), 31, 0);
  for (const it of lay.items) {
    const r = it.room, pl = it.poly, n = pl.length, WL = it.loose ? 'LOSE' : 'WAND';
    for (let i = 0; i < n; i++) {
      const wp = G.wallParts(r, pl, i);
      for (const p of wp.parts) {
        if (p.kind === 'W') { line(WL, p.p0, p.p1); continue; }
        const L = p.kind === 'T' ? 'TUER' : 'FENSTER', nn = wp.n, off = k => q => ({ x: q.x + nn.x * k, y: q.y + nn.y * k });
        line(L, off(-5)(p.p0), off(5)(p.p0)); line(L, off(-5)(p.p1), off(5)(p.p1));                 // Laibungskanten
        if (p.kind === 'F') { const q = G.winSym(p, nn, 10); for (let k = 0; k < 4; k++) line(L, q[k], q[(k + 1) % 4]); line(L, p.p0, p.p1); }   // Rahmen + Glaslinie
        else if (G.drawLeaf(plan, r, p.op)) { // Türblatt + Viertelkreis (ARC läuft gegen den Uhrzeigersinn, y nach oben)
          const ds = G.doorSym(p, nn, p.op), a0 = Math.atan2(-(ds.tip.y - ds.hinge.y), ds.tip.x - ds.hinge.x) * 180 / Math.PI, a1 = Math.atan2(-(ds.other.y - ds.hinge.y), ds.other.x - ds.hinge.x) * 180 / Math.PI, ccw = G.norm180(a1 - a0) > 0;
          line(L, ds.hinge, ds.tip); w(0, 'ARC', 8, L, 10, f(ds.hinge.x), 20, f(-ds.hinge.y), 30, 0, 40, f(ds.r), 50, f(((ccw ? a0 : a1) + 360) % 360), 51, f(((ccw ? a1 : a0) + 360) % 360));
        }
        const m = { x: (p.p0.x + p.p1.x) / 2 + nn.x * 14, y: (p.p0.y + p.p1.y) / 2 + nn.y * 14 }; text(L, m, 7, `${p.kind === 'T' ? 'T' : 'F'} ${Math.round(p.op.w)}`);
      }
      const ang = Math.atan2(-wp.d.y, wp.d.x) * 180 / Math.PI, rot = ang > 90 || ang <= -90 ? ang + 180 : ang;
      const an = G.dimAnchor(wp); text('MASSE', { x: an.x + wp.n.x * 14, y: an.y + wp.n.y * 14 }, 8, String(Math.round(r.walls[i].cm)), rot);
    }
    const c = pl.reduce((s, q) => ({ x: s.x + q.x / n, y: s.y + q.y / n }), { x: 0, y: 0 });
    text('RAUMTEXT', { x: c.x, y: c.y - 18 }, 14, r.name); text('RAUMTEXT', { x: c.x, y: c.y + 2 }, 10, fmtA(areaOf(r))); text('RAUMTEXT', { x: c.x, y: c.y + 18 }, 7, `U ${fmtM(G.summary(r).perimeter)}${r.rh ? ` / Rh ${fmtM(r.rh)}` : ''}`);
  }
  w(0, 'ENDSEC', 0, 'EOF');
  return { text: o.join('\r\n') + '\r\n', rooms: done.length };
}

// ---------------- PDF ----------------
const SCALES = [20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];
const PT_PER_CM = 72 / 2.54;
export async function buildPlanPdf(PDFLib, fontkit, fontBytes, plan, msgs = []) {
  const { PDFDocument, rgb } = PDFLib, doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const ink = rgb(0.09, 0.13, 0.16), grey = rgb(0.45, 0.5, 0.54), blue = rgb(0.04, 0.5, 0.75), gold = rgb(0.75, 0.55, 0.05), fill = rgb(0.93, 0.96, 0.98), red = rgb(0.72, 0.2, 0.15);
  const W = 841.89, H = 595.28, M = 34, done = plan.rooms.filter(r => r.closed && r.walls.length >= 3);
  doc.setTitle(fileBase(plan)); doc.setCreator('Floorplan AI Massblatt');
  const d = new Date(), date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const T = (pg, t, x, y, size, color = ink) => pg.drawText(String(t), { x, y, size, font, color });
  const TC = (pg, t, x, y, size, color = ink) => T(pg, t, x - font.widthOfTextAtSize(String(t), size) / 2, y - size * 0.35, size, color);
  const head = (pg, title) => { T(pg, 'Grundriss', M, H - M - 8, 9, grey); T(pg, title, M, H - M - 28, 17); const sub = [plan.kunde, [plan.plz, plan.ortName].filter(Boolean).join(' '), date].filter(Boolean).join('  ·  '); T(pg, sub, M, H - M - 43, 9.5, grey); pg.drawLine({ start: { x: M, y: H - M - 52 }, end: { x: W - M, y: H - M - 52 }, thickness: 0.6, color: grey }); };
  // Zeichnet Räume maßstäblich in ein Feld; gibt den gewählten Maßstab zurück
  const drawing = (pg, items, bb, box, o) => {
    const wcm = Math.max(1, bb.x1 - bb.x0), hcm = Math.max(1, bb.y1 - bb.y0);
    const sN = SCALES.find(s => wcm * PT_PER_CM / s <= box.w - 2 * o.pad && hcm * PT_PER_CM / s <= box.h - 2 * o.pad) || SCALES[SCALES.length - 1], k = PT_PER_CM / sN;
    const ox = box.x + (box.w - wcm * k) / 2 - bb.x0 * k, oy = box.y + box.h - (box.h - hcm * k) / 2 + bb.y0 * k;
    const X = q => ox + q.x * k, Y = q => oy - q.y * k, P = q => ({ x: X(q), y: Y(q) });
    for (const it of items) {
      const r = it.room, pl = it.poly, n = pl.length;
      const path = pl.map((q, i) => `${i ? 'L' : 'M'} ${(q.x * k).toFixed(2)} ${(q.y * k).toFixed(2)}`).join(' ') + ' Z';
      pg.drawSvgPath(path, { x: ox, y: oy, color: fill, opacity: 1 });
      for (let i = 0; i < n; i++) {
        const wp = G.wallParts(r, pl, i), nn = wp.n;
        for (const p of wp.parts) {
          if (p.kind === 'W') { pg.drawLine({ start: P(p.p0), end: P(p.p1), thickness: o.wall, color: it.loose ? grey : ink, dashArray: it.loose ? [5, 4] : undefined }); continue; }
          const off = c => q => ({ x: X(q) + nn.x * c, y: Y(q) - nn.y * c }), col = p.kind === 'T' ? gold : blue;
          for (const q of [p.p0, p.p1]) pg.drawLine({ start: off(-3.5)(q), end: off(3.5)(q), thickness: 0.9, color: col });
          if (p.kind === 'F') { // Rahmen in Wandtiefe (mind. 4 pt) mit Glaslinie
            const q = G.winSym(p, nn, Math.max(10, 4 / k)); pg.drawSvgPath(q.map((c, i) => `${i ? 'L' : 'M'} ${(c.x * k).toFixed(2)} ${(c.y * k).toFixed(2)}`).join(' ') + ' Z', { x: ox, y: oy, color: rgb(1, 1, 1), borderColor: col, borderWidth: 0.6 });
            pg.drawLine({ start: P(p.p0), end: P(p.p1), thickness: 0.5, color: col });
          } else if (o.allLeaf || G.drawLeaf(plan, r, p.op)) { // Türblatt + Viertelkreis
            const ds = G.doorSym(p, nn, p.op), a0 = Math.atan2(ds.tip.y - ds.hinge.y, ds.tip.x - ds.hinge.x), a1 = Math.atan2(ds.other.y - ds.hinge.y, ds.other.x - ds.hinge.x), sweep = G.norm180((a1 - a0) * 180 / Math.PI) > 0 ? 1 : 0, c2 = q => `${(q.x * k).toFixed(2)} ${(q.y * k).toFixed(2)}`;
            pg.drawLine({ start: P(ds.hinge), end: P(ds.tip), thickness: 1, color: col });
            pg.drawSvgPath(`M ${c2(ds.tip)} A ${(ds.r * k).toFixed(2)} ${(ds.r * k).toFixed(2)} 0 0 ${sweep} ${c2(ds.other)}`, { x: ox, y: oy, borderColor: col, borderWidth: 0.45, borderDashArray: [1.5, 1.5] });
          }
          if (o.ops) { const m = { x: (p.p0.x + p.p1.x) / 2 + nn.x * (11 / k), y: (p.p0.y + p.p1.y) / 2 + nn.y * (11 / k) }; TC(pg, `${p.kind === 'T' ? 'T' : 'F'} ${Math.round(p.op.w)}`, X(m), Y(m), 6.5, col); }
        }
        // Übersicht: Maße innen, damit sich Nachbarräume nicht überschreiben
        if (o.dims) { const sg = o.dimIn ? -1 : 1, an = G.dimAnchor(wp), m = { x: an.x + sg * nn.x * (10 / k), y: an.y + sg * nn.y * (10 / k) }; TC(pg, String(Math.round(r.walls[i].cm)), X(m), Y(m), 7.5, ink); }
      }
      const c = pl.reduce((s, q) => ({ x: s.x + q.x / n, y: s.y + q.y / n }), { x: 0, y: 0 }), wpt = (Math.max(...pl.map(q => q.x)) - Math.min(...pl.map(q => q.x))) * k;
      const fs = Math.min(o.name, (wpt - 6) / Math.max(3, font.widthOfTextAtSize(r.name, 10) / 10));
      if (fs >= 4) { const sm = G.summary(r), l3 = `U ${fmtM(sm.perimeter)}${r.rh ? `  ·  Rh ${fmtM(r.rh)}` : ''}`, f3 = Math.max(4, fs * 0.58), show3 = font.widthOfTextAtSize(l3, f3) < wpt - 6;
        TC(pg, r.name, X(c), Y(c) + fs * (show3 ? 1.05 : 0.6), fs); TC(pg, fmtA(areaOf(r)), X(c), Y(c) - fs * (show3 ? 0.1 : 0.7), Math.max(4, fs * 0.8)); if (show3) TC(pg, l3, X(c), Y(c) - fs * 1.05, f3, grey); }
    }
    return sN;
  };
  // Seite 1: ganze Wohnung
  const lay = G.layout(plan.rooms, plan.wall || 15);
  if (done.length) {
    const pg = doc.addPage([W, H]); head(pg, plan.name || 'Ohne Adresse');
    const foot = 30 + Math.min(msgs.length, 5) * 12, box = { x: M, y: M + foot, w: W - 2 * M, h: H - 2 * M - 58 - foot };
    const sN = drawing(pg, lay.items, lay.bb, box, { pad: 14, wall: 1.8, dims: lay.items.length <= 8, dimIn: true, ops: false, name: 11 });
    const tot = done.reduce((s, r) => s + areaOf(r), 0);
    T(pg, `Gesamt ${fmtA(tot)}  ·  ${done.length} ${done.length === 1 ? 'Raum' : 'Räume'}  ·  Wandstärke Standard ${plan.wall || 15} cm  ·  M 1:${sN}  ·  Maße in cm`, M, M + foot - 14, 9.5);
    msgs.slice(0, 5).forEach((m, i) => T(pg, '! ' + m, M, M + foot - 28 - i * 12, 8.5, red));
    if (lay.items.some(i => i.loose)) T(pg, 'Gestrichelte Räume sind noch nicht über eine Tür verbunden und liegen nicht an ihrem Platz.', M, M - 4, 8, grey);
  }
  // Je Raum eine Seite mit Zeichnung und Tabelle
  for (const r of done) {
    const pg = doc.addPage([W, H]); head(pg, `${plan.name || 'Ohne Adresse'}  –  ${r.name}`);
    const pl = G.closedPoly(r.walls), bb = pl.reduce((b, q) => ({ x0: Math.min(b.x0, q.x), y0: Math.min(b.y0, q.y), x1: Math.max(b.x1, q.x), y1: Math.max(b.y1, q.y) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
    for (let i = 0; i < pl.length; i++) { const wp = G.wallParts(r, pl, i); for (const p of wp.parts) if (p.kind === 'T') { const t = G.doorSym(p, wp.n, p.op).tip; bb.x0 = Math.min(bb.x0, t.x); bb.y0 = Math.min(bb.y0, t.y); bb.x1 = Math.max(bb.x1, t.x); bb.y1 = Math.max(bb.y1, t.y); } }
    const tw = 250, box = { x: M, y: M + 18, w: W - 2 * M - tw - 16, h: H - 2 * M - 76 };
    const sN = drawing(pg, [{ room: r, poly: pl, loose: false }], bb, box, { pad: 34, wall: 2.2, dims: true, ops: true, allLeaf: true, name: 14 });
    pg.drawCircle({ x: box.x + (box.w - (bb.x1 - bb.x0) * PT_PER_CM / sN) / 2 - bb.x0 * PT_PER_CM / sN, y: box.y + box.h - (box.h - (bb.y1 - bb.y0) * PT_PER_CM / sN) / 2 + bb.y0 * PT_PER_CM / sN, size: 2.6, color: blue });
    T(pg, `M 1:${sN}  ·  Maße in cm  ·  blauer Punkt = Start, Wände im Uhrzeigersinn nummeriert`, M, M, 8.5, grey);
    let x = W - M - tw, y = H - M - 70; const s = G.summary(r), row = (a, b, c = '', col = ink) => { T(pg, a, x, y, 9.5, col); T(pg, b, x + 52, y, 9.5, col); T(pg, c, x + 150, y, 9.5, col); y -= 13.5; };
    T(pg, `Fläche ${fmtA(s.area)}`, x, y, 13); y -= 16; T(pg, `${r.rh ? `Raumhöhe ${fmtM(r.rh)}  ·  ` : ''}Umfang ${fmtM(s.perimeter)}${r.adjust ? `  ·  ${Math.round(r.adjust)} cm ausgeglichen` : ''}${r.diag ? `  ·  Diagonale ${Math.round(r.diag)} cm` : ''}`, x, y, 8.5, grey); y -= 20;
    row('Wand', 'Länge', 'Ecke danach', grey);
    r.walls.forEach((w, i) => { if (y > M + 40) row(String(i + 1), `${Math.round(w.cm * 10) / 10} cm${w.calc ? ' *' : ''}`, `${inner(w.turn)}° ${w.turn > 0 ? 'rechts' : 'links'}`); });
    if (r.walls.some(w => w.calc)) { T(pg, '* berechnet, nicht gemessen', x, y, 8, grey); y -= 13; }
    const ops = r.ops || [];
    if (ops.length && y > M + 60) { y -= 8; row('Öffnung', 'Wand, ab Ecke', 'Breite', grey);
      for (const op of ops) { if (y < M + 30) break; const to = op.to && plan.rooms.find(q => q.id === op.to); row(op.type === 'T' ? 'Tür' : 'Fenster', `Wand ${op.wall + 1}, ${Math.round(op.pos)} cm`, `${Math.round(op.w)} cm`);
        const extra = [to ? 'führt nach ' + to.name : '', op.type === 'T' && op.hinge ? `Anschlag ${op.hinge === 'a' ? 'links' : 'rechts'}, geht ${op.swing === 'out' ? 'hinaus' : 'herein'}` : '', op.thick ? `Wandstärke ${Math.round(op.thick)} cm` : ''].filter(Boolean);
        for (let e = 0; e < extra.length; e += 2) { T(pg, extra.slice(e, e + 2).join(' · '), x + 52, y + 2, 8, grey); y -= 10.5; } y -= 1; } }
  }
  if (!done.length) { const pg = doc.addPage([W, H]); head(pg, plan.name || 'Ohne Adresse'); T(pg, 'Noch kein Raum fertig gemessen.', M, H / 2, 12, grey); }
  return doc.save();
}
