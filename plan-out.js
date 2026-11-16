// Grundriss-Ausgabe (Stufe 3): PDF (maßstäblich) und DXF für BricsCAD. Reine Erzeugung, keine Oberfläche.
import * as G from './plan-geo.js';
const fmtA = m2 => m2.toFixed(2).replace('.', ',') + ' m²';
const fmtM = cm => (cm / 100).toFixed(2).replace('.', ',') + ' m';
// Wandfläche eines Raums: Umfang × Raumhöhe; abzüglich Öffnungen mit angenommenen Höhen (Tür 2,00 m, Fenster 1,30 m), solange keine Höhen gemessen werden
export const DOOR_H = 200, WIN_H = 130;
export function wallArea(r) { if (!r.rh) return null; const s = G.summary(r), gross = s.perimeter * r.rh / 10000, minus = (r.ops || []).reduce((t, op) => t + op.w * Math.min(r.rh, op.h || (op.type === 'T' ? DOOR_H : WIN_H)), 0) / 10000; return { gross, net: Math.max(0, gross - minus) }; }
const areaOf = r => G.summary(r).area;
const inner = t => Math.round((180 - Math.abs(t)) * 10) / 10;          // Innenwinkel der Ecke
export const fileBase = plan => ('Grundriss ' + (plan.name || 'ohne Adresse')).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------- DXF (R12, Einheit cm, y nach oben) ----------------
const asc = s => String(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/²/g, '2').replace(/[^\x20-\x7e]/g, '?');
// Wandflächen wie im fertigen Plan: Wandbänder aller verbundenen Räume zu einer Fläche verschmolzen,
// Raumflächen und Öffnungen (ganz durch die Wand) herausgeschnitten. Ergebnis: geschlossene Umrisse in cm.
export function wallOutlines(plan, lay, PC) {
  const ring = pl => [pl.map(q => [q.x, q.y])], out = []; out.groups = [];
  const build = (items, loose) => {
    if (!items.length) return; const gfs = items.map(it => G.gfx(plan, it.room, it.poly, { chains: false }));
    let reg = PC.union(...gfs.map(g => ring(g.band)));
    reg = PC.difference(reg, ...gfs.map(g => ring(g.inner)), ...gfs.flatMap(g => g.cutsX.map(ring)));
    const grp = []; for (const poly of reg) for (const r of poly) { const pts = r.slice(0, -1).map(([x, y]) => ({ x, y })); if (pts.length >= 3) { out.push({ pts, loose }); grp.push(pts); } } out.groups.push(grp);
  };
  for (const gi of [...new Set(lay.items.map(i => i.g))]) build(lay.items.filter(i => i.g === gi), gi > 0);   // je zusammenhängender Gruppe eine Wandfläche
  return out;
}
export function buildDxf(plan, PC = globalThis.polygonClipping) {
  const done = plan.rooms.filter(r => r.closed && r.walls.length >= 3), lay = G.layout(plan.rooms, plan.wall || 15), o = [];
  const w = (...a) => { for (let i = 0; i < a.length; i += 2) o.push(String(a[i]), String(a[i + 1])); }, f = v => (Math.round(v * 1000) / 1000).toString();
  const LAYERS = [['WAND', 7], ['WAND_SCHRAFFUR', 8], ['EINRICHTUNG', 4], ['TUER', 2], ['FENSTER', 5], ['RAUMTEXT', 3], ['MASSE', 8], ['MASSKETTE', 8], ['LOSE', 9]];
  w(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 5, 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 64, 3, 'Solid line', 72, 65, 73, 0, 40, 0.0, 0, 'ENDTAB');
  w(0, 'TABLE', 2, 'LAYER', 70, LAYERS.length); for (const [n, c] of LAYERS) w(0, 'LAYER', 2, n, 70, 64, 62, c, 6, 'CONTINUOUS'); w(0, 'ENDTAB', 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'ENTITIES');
  const line = (L, p, q) => w(0, 'LINE', 8, L, 10, f(p.x), 20, f(-p.y), 30, 0, 11, f(q.x), 21, f(-q.y), 31, 0);
  const text = (L, p, h, t, rot = 0) => w(0, 'TEXT', 8, L, 10, f(p.x), 20, f(-p.y), 30, 0, 40, f(h), 1, asc(t), 50, f(rot), 72, 1, 11, f(p.x), 21, f(-p.y), 31, 0);
  const arc = (L, c, r, from, to) => { const a0 = Math.atan2(-(from.y - c.y), from.x - c.x) * 180 / Math.PI, a1 = Math.atan2(-(to.y - c.y), to.x - c.x) * 180 / Math.PI, ccw = G.norm180(a1 - a0) > 0; w(0, 'ARC', 8, L, 10, f(c.x), 20, f(-c.y), 30, 0, 40, f(r), 50, f(((ccw ? a0 : a1) + 360) % 360), 51, f(((ccw ? a1 : a0) + 360) % 360)); };
  const rotOf = d => { const ang = Math.atan2(-d.y, d.x) * 180 / Math.PI; return ang > 90.01 || ang <= -89.99 ? ang + 180 : ang; };
  // Wände: verschmolzene, geschlossene Umrisse (Polylinien). Geht das Verschmelzen schief, bleiben die einfachen Innenkanten als Ersatz.
  let merged = null; try { if (PC) merged = wallOutlines(plan, lay, PC); } catch (e) { merged = null; }
  const poly = (L, pts) => { w(0, 'POLYLINE', 8, L, 66, 1, 70, 1); for (const q of pts) w(0, 'VERTEX', 8, L, 10, f(q.x), 20, f(-q.y), 30, 0); w(0, 'SEQEND', 8, L); };
  if (merged) for (const m of merged) poly(m.loose ? 'LOSE' : 'WAND', m.pts);
  if (merged) for (const rings of merged.groups) { try { for (const [p, q] of G.hatchLines(rings, 8)) line('WAND_SCHRAFFUR', p, q); } catch (e) { } }   // Schraffur je zusammenhängender Wandfläche
  for (const it of lay.items) {
    const r = it.room, pl = it.poly, n = pl.length, WL = it.loose ? 'LOSE' : 'WAND', gf = G.gfx(plan, r, pl, { chains: true, outerOnly: true, u: 1 }); // Maßketten nur an Wänden ohne Verbindungstür, sonst liegen sie im Nachbarraum
    for (let i = 0; i < n; i++) { // Wandmaß innen nur dort, wo außen keine Maßkette steht (Wand mit Verbindungstür)
      const wp = G.wallParts(r, pl, i); if (!merged) for (const p of wp.parts) if (p.kind === 'W') line(WL, p.p0, p.p1);
      if (!gf.chained.has(i)) { const an = G.dimAnchor(wp); text('MASSE', { x: an.x - wp.n.x * 14, y: an.y - wp.n.y * 14 }, 8, String(Math.round(r.walls[i].cm)), rotOf(wp.d)); } // jede Wand nur einmal bemaßen: außen als Kette, sonst innen
    }
    for (const wn of gf.wins) { for (let k = 0; k < 4; k++) line('FENSTER', wn.rect[k], wn.rect[(k + 1) % 4]); line('FENSTER', wn.glass[0], wn.glass[1]); }
    for (const dr of gf.doors) { if (!merged) for (const j of dr.jambs) line('TUER', j[0], j[1]); if (dr.leaf) // Laibungen sind Teil des Wandumrisses
      { line('TUER', dr.leaf[0], dr.leaf[1]); arc('TUER', dr.arc.c, dr.arc.r, dr.arc.from, dr.arc.to); } }
    for (const ob of gf.objs || []) { if (ob.quad) for (let k = 0; k < 4; k++) line('EINRICHTUNG', ob.quad[k], ob.quad[(k + 1) % 4]); for (const l of ob.lines) for (let k = 0; k + 1 < l.length; k++) line('EINRICHTUNG', l[k], l[k + 1]); if (ob.label) text('EINRICHTUNG', ob.label.p, 7, ob.label.t, rotOf(ob.label.d)); }
    for (const ch of gf.chains) { line('MASSKETTE', ch.line[0], ch.line[1]); for (const t of ch.ticks) line('MASSKETTE', t[0], t[1]); for (const l of ch.labels) text('MASSKETTE', l.p, 7, l.t, rotOf(l.d)); }
    const c = pl.reduce((s2, q) => ({ x: s2.x + q.x / n, y: s2.y + q.y / n }), { x: 0, y: 0 });
    text('RAUMTEXT', { x: c.x, y: c.y - 18 }, 14, r.name); text('RAUMTEXT', { x: c.x, y: c.y + 2 }, 10, fmtA(areaOf(r))); text('RAUMTEXT', { x: c.x, y: c.y + 18 }, 7, `U ${fmtM(G.summary(r).perimeter)}${r.rh ? ` / Rh ${fmtM(r.rh)}` : ''}`);
  }
  w(0, 'ENDSEC', 0, 'EOF');
  return { text: o.join('\r\n') + '\r\n', rooms: done.length };
}

// ---------------- PDF ----------------
// A4 quer mit Planrahmen und Schriftfeld; Zeichnung im genauen Maßstab 1:n; Wände mit Stärke, Symbole, Maßketten.
const SCALES = [20, 25, 50, 75, 100, 150, 200, 250, 500, 1000];
const PT_PER_CM = 72 / 2.54;
const bboxOf = pts => pts.reduce((b, q) => ({ x0: Math.min(b.x0, q.x), y0: Math.min(b.y0, q.y), x1: Math.max(b.x1, q.x), y1: Math.max(b.y1, q.y) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
export async function buildPlanPdf(PDFLib, fontkit, fontBytes, plan, msgs = []) {
  const { PDFDocument, rgb, degrees } = PDFLib, doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const ink = rgb(0.09, 0.13, 0.16), grey = rgb(0.45, 0.5, 0.54), blue = rgb(0.04, 0.5, 0.75), gold = rgb(0.75, 0.55, 0.05), fill = rgb(0.93, 0.96, 0.98), red = rgb(0.72, 0.2, 0.15), white = rgb(1, 1, 1), wallC = rgb(0.16, 0.2, 0.24), looseC = rgb(0.6, 0.64, 0.67);
  const W = 841.89, H = 595.28, F = 20, SB = 66, TBW = 272, done = plan.rooms.filter(r => r.closed && r.walls.length >= 3), pages = Math.max(1, done.length ? done.length + 2 : 1);
  doc.setTitle(fileBase(plan)); doc.setCreator('Floorplan AI Massblatt');
  const d = new Date(), date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const wOf = (t, size) => font.widthOfTextAtSize(String(t), size);
  const T = (pg, t, x, y, size, color = ink) => pg.drawText(String(t), { x, y, size, font, color });
  const TC = (pg, t, x, y, size, color = ink) => T(pg, t, x - wOf(t, size) / 2, y - size * 0.35, size, color);
  const fitText = (t, size, max) => { let x = String(t); if (wOf(x, size) <= max) return x; while (x.length > 3 && wOf(x + '…', size) > max) x = x.slice(0, -1); return x + '…'; };
  const L = (pg, a, b, thickness = 0.5, color = ink, dashArray) => pg.drawLine({ start: a, end: b, thickness, color, dashArray });
  // Rahmen + Schriftfeld + Maßstabsbalken
  const sheet = (pg, title, sN, no) => {
    pg.drawRectangle({ x: F, y: F, width: W - 2 * F, height: H - 2 * F, borderColor: ink, borderWidth: 0.9 });
    L(pg, { x: F, y: F + SB }, { x: W - F, y: F + SB }, 0.6);
    const x0 = W - F - TBW, r1 = F + SB - 26, r2 = F + 20; L(pg, { x: x0, y: F }, { x: x0, y: F + SB }, 0.6); L(pg, { x: x0, y: r1 }, { x: W - F, y: r1 }, 0.4); L(pg, { x: x0, y: r2 }, { x: W - F, y: r2 }, 0.4);
    const c2 = x0 + TBW * 0.5, c3 = x0 + TBW * 0.36, c4 = x0 + TBW * 0.68; L(pg, { x: c2, y: r2 }, { x: c2, y: r1 }, 0.4); L(pg, { x: c3, y: F }, { x: c3, y: r2 }, 0.4); L(pg, { x: c4, y: F }, { x: c4, y: r2 }, 0.4);
    const cell = (lab, val, x, y, w, size = 8.5) => { T(pg, lab, x + 4, y + (size > 9 ? 17 : 11.5), 5.5, grey); T(pg, fitText(val, size, w - 8), x + 4, y + 3.5, size); };
    cell('GRUNDRISS', title, x0, r1, TBW, 11); cell('KUNDE', plan.kunde || '–', x0, r2, TBW * 0.5); cell('ORT', [plan.plz, plan.ortName].filter(Boolean).join(' ') || '–', c2, r2, TBW * 0.5);
    cell('DATUM', date, x0, F, TBW * 0.36); cell('MASSSTAB', sN ? `1:${sN}` : '–', c3, F, TBW * 0.32); cell('BLATT', `${no} / ${pages}`, c4, F, TBW * 0.32);
    if (sN) { // Maßstabsbalken: größte runde Länge bis ca. 5,5 cm am Papier
      const m = [20, 10, 5, 2, 1].find(v => v * 100 * PT_PER_CM / sN <= 160) || 0.5, len = m * 100 * PT_PER_CM / sN, n = m === 2 ? 4 : 5, bx = F + 12, by = F + 10;
      for (let i = 0; i < n; i++) pg.drawRectangle({ x: bx + len * i / n, y: by, width: len / n, height: 4, color: i % 2 ? white : ink, borderColor: ink, borderWidth: 0.4 });
      T(pg, '0', bx - 1.5, by + 7, 6.5); T(pg, `${String(m).replace('.', ',')} m`, bx + len - 4, by + 7, 6.5); T(pg, 'Maße in cm  ·  Aufmaß mit Laser-Entfernungsmesser', bx + len + 16, by, 6.5, grey);
    }
  };
  // Formen eines Raums zeichnen (k = Punkte je cm, Ursprung ox/oy, y nach unten)
  const render = (pg, gf, k, ox, oy, st) => {
    const P = q => ({ x: ox + q.x * k, y: oy - q.y * k }), pth = pl => pl.map((q, i) => `${i ? 'L' : 'M'} ${(q.x * k).toFixed(2)} ${(q.y * k).toFixed(2)}`).join(' ') + ' Z';
    if (st.phase === 'band') { pg.drawSvgPath(pth(gf.band) + ' ' + pth([...gf.inner].reverse()), { x: ox, y: oy, color: st.loose ? looseC : wallC }); return; }
    pg.drawSvgPath(pth(gf.inner), { x: ox, y: oy, color: fill });
    for (const c of gf.cuts) pg.drawSvgPath(pth(c), { x: ox, y: oy, color: white });
    for (const w of gf.wins) { pg.drawSvgPath(pth(w.rect), { x: ox, y: oy, color: white, borderColor: blue, borderWidth: 0.6 }); L(pg, P(w.glass[0]), P(w.glass[1]), 0.5, blue); }
    for (const dr of gf.doors) {
      for (const j of dr.jambs) L(pg, P(j[0]), P(j[1]), 0.8, gold);
      if (dr.leaf) { L(pg, P(dr.leaf[0]), P(dr.leaf[1]), 1, gold); const a0 = Math.atan2(dr.arc.from.y - dr.arc.c.y, dr.arc.from.x - dr.arc.c.x), a1 = Math.atan2(dr.arc.to.y - dr.arc.c.y, dr.arc.to.x - dr.arc.c.x), sweep = G.norm180((a1 - a0) * 180 / Math.PI) > 0 ? 1 : 0, c2 = q => `${(q.x * k).toFixed(2)} ${(q.y * k).toFixed(2)}`;
        pg.drawSvgPath(`M ${c2(dr.arc.from)} A ${(dr.arc.r * k).toFixed(2)} ${(dr.arc.r * k).toFixed(2)} 0 0 ${sweep} ${c2(dr.arc.to)}`, { x: ox, y: oy, borderColor: gold, borderWidth: 0.45, borderDashArray: [1.5, 1.5] }); }
    }
    for (const ob of gf.objs || []) {
      if (ob.quad) pg.drawSvgPath(pth(ob.quad), { x: ox, y: oy, color: ob.solid ? wallC : white, borderColor: ink, borderWidth: 0.45 });
      for (const l of ob.lines) for (let i = 0; i + 1 < l.length; i++) L(pg, P(l[i]), P(l[i + 1]), 0.4, ob.solid ? white : ink, ob.dashed ? [4, 3] : undefined);
      if (ob.label) { let a = Math.atan2(ob.label.d.y, ob.label.d.x); if (a > Math.PI / 2 - 0.01 || a < -Math.PI / 2 - 0.01) a += Math.PI; const A = -a, c = P(ob.label.p), size = 6, w = wOf(ob.label.t, size), dx = Math.cos(A), dy = Math.sin(A);
        pg.drawText(ob.label.t, { x: c.x - dx * w / 2 + dy * size * 0.33, y: c.y - dy * w / 2 - dx * size * 0.33, size, font, color: grey, rotate: degrees(A * 180 / Math.PI) }); }
    }
    for (const ch of gf.chains) { L(pg, P(ch.line[0]), P(ch.line[1]), 0.4); for (const t of ch.ticks) L(pg, P(t[0]), P(t[1]), 0.5);
      for (const l of ch.labels) { let a = Math.atan2(l.d.y, l.d.x); if (a > Math.PI / 2 - 0.01 || a < -Math.PI / 2 - 0.01) a += Math.PI; const A = -a, c = P(l.p), size = 7, w = wOf(l.t, size), dx = Math.cos(A), dy = Math.sin(A);
        pg.drawText(l.t, { x: c.x - dx * w / 2 + dy * size * 0.33, y: c.y - dy * w / 2 - dx * size * 0.33, size, font, color: ink, rotate: degrees(A * 180 / Math.PI) }); } }
  };
  const stamp = (pg, r, c, wpt, big) => {
    const sm = G.summary(r), lines = [[r.name, big, ink], [fmtA(sm.area), big * 0.8, ink], [`U ${fmtM(sm.perimeter)}${r.rh ? `  ·  Rh ${fmtM(r.rh)}` : ''}`, big * 0.58, grey]].map(([t, sz, col]) => { const w = wOf(t, sz); return [t, w > wpt - 6 ? sz * (wpt - 6) / w : sz, col]; }).filter(l => l[1] >= 4);
    let y = c.y + lines.reduce((t, l) => t + l[1] * 1.3, 0) / 2; for (const [t, sz, col] of lines) { y -= sz * 1.3; TC(pg, t, c.x, y + sz * 0.65, sz, col); }
  };
  // Größten Maßstab finden, bei dem alles ins Feld passt, und zeichnen
  const place = (pg, items, box, o) => {
    let pick = null;
    for (const sN of SCALES) { const k = PT_PER_CM / sN, gfs = items.map(it => ({ it, gf: G.gfx(plan, it.room, it.poly, { chains: o.chains, allLeaf: o.allLeaf, u: 1 / k }) })), bb = bboxOf(gfs.flatMap(x => x.gf.ext)); pick = { sN, k, gfs, bb }; if ((bb.x1 - bb.x0) * k <= box.w - 2 * o.pad && (bb.y1 - bb.y0) * k <= box.h - 2 * o.pad) break; }
    const { sN, k, gfs, bb } = pick, ox = box.x + (box.w - (bb.x1 - bb.x0) * k) / 2 - bb.x0 * k, oy = box.y + box.h - (box.h - (bb.y1 - bb.y0) * k) / 2 + bb.y0 * k;
    for (const x of gfs) render(pg, x.gf, k, ox, oy, { phase: 'band', loose: x.it.loose });
    for (const x of gfs) render(pg, x.gf, k, ox, oy, { phase: 'rest' });
    for (const { it } of gfs) { const pl = it.poly, n = pl.length, c = pl.reduce((s2, q) => ({ x: s2.x + q.x / n, y: s2.y + q.y / n }), { x: 0, y: 0 }), wpt = (Math.max(...pl.map(q => q.x)) - Math.min(...pl.map(q => q.x))) * k;
      stamp(pg, it.room, { x: ox + c.x * k, y: oy - c.y * k }, wpt, Math.min(o.name, wpt / 7)); }
    return { sN, k, ox, oy };
  };
  // Blatt 1: ganze Wohnung
  const lay = G.layout(plan.rooms, plan.wall || 15);
  if (done.length) {
    const pg = doc.addPage([W, H]), box = { x: F + 6, y: F + SB + 6, w: W - 2 * F - 12, h: H - 2 * F - SB - 12 };
    const pl = place(pg, lay.items, box, { pad: 16, chains: false, allLeaf: false, name: 11 });
    sheet(pg, plan.name || 'Ohne Adresse', pl.sN, 1);
    const tot = done.reduce((s2, r) => s2 + areaOf(r), 0), tx = F + 12; let ty = F + SB - 13;
    T(pg, `Gesamt ${fmtA(tot)}  ·  ${done.length} ${done.length === 1 ? 'Raum' : 'Räume'}  ·  Wände innen ${plan.wall || 15} cm, außen ${plan.wallOut || 30} cm (Standard)`, tx, ty, 8.5); ty -= 11;
    const show = msgs.slice(0, 2); for (const m of show) { T(pg, fitText('! ' + m, 7.5, W - 2 * F - TBW - 30), tx, ty, 7.5, red); ty -= 9.5; }
    if (msgs.length > show.length) T(pg, `… und ${msgs.length - show.length} weitere Hinweise in der App`, tx, ty, 7, red);
    else if (lay.items.some(i => i.loose) && ty > F + 22) T(pg, 'Hell gezeichnete Räume sind noch nicht über eine Tür verbunden und liegen nicht an ihrem Platz.', tx, ty, 7, grey);
    if (plan.north != null) { // Nordpfeil oben rechts
      const cx = W - F - 34, cy = H - F - 44, a = -plan.north * Math.PI / 180, rot = (x, y) => ({ x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a) });
      pg.drawCircle({ x: cx, y: cy, size: 15, borderColor: ink, borderWidth: 0.8 }); const pts = [rot(0, 13), rot(5, -7), rot(0, -3), rot(-5, -7)];
      pg.drawSvgPath(pts.map((q, i) => `${i ? 'L' : 'M'} ${(q.x - cx).toFixed(2)} ${(-(q.y - cy)).toFixed(2)}`).join(' ') + ' Z', { x: cx, y: cy, color: ink }); const n = rot(0, 22); TC(pg, 'N', n.x, n.y, 8);
    }
  }
  // Je Raum ein Blatt mit Zeichnung, Maßketten und Tabelle
  done.forEach((r, idx) => {
    const pg = doc.addPage([W, H]), tw = 232, box = { x: F + 6, y: F + SB + 6, w: W - 2 * F - tw - 22, h: H - 2 * F - SB - 12 };
    const pl = place(pg, [{ room: r, poly: G.closedPoly(r.walls), loose: false }], box, { pad: 12, chains: true, allLeaf: true, name: 14 });
    pg.drawCircle({ x: pl.ox, y: pl.oy, size: 2.6, color: blue });
    sheet(pg, `${plan.name || 'Ohne Adresse'} – ${r.name}`, pl.sN, idx + 2);
    L(pg, { x: W - F - tw - 8, y: F + SB }, { x: W - F - tw - 8, y: H - F }, 0.4, grey);
    let x = W - F - tw, y = H - F - 24; const s2 = G.summary(r), row = (a, b, c = '', col = ink) => { T(pg, a, x, y, 9, col); T(pg, b, x + 50, y, 9, col); T(pg, c, x + 138, y, 9, col); y -= 13; };
    T(pg, r.name, x, y, 14); y -= 19; T(pg, `Fläche ${fmtA(s2.area)}`, x, y, 11.5); y -= 14;
    T(pg, `${r.rh ? `Raumhöhe ${fmtM(r.rh)}  ·  ` : ''}Umfang ${fmtM(s2.perimeter)}`, x, y, 8.5, grey); y -= 11;
    const wa = wallArea(r); if (wa) { T(pg, `Wandfläche ${fmtA(wa.net)} (ohne Abzug ${fmtA(wa.gross)})`, x, y, 8.5, grey); y -= 11; }
    if (r.adjust || r.diag) { T(pg, [r.adjust ? `${Math.round(r.adjust)} cm ausgeglichen` : '', r.diag ? `Diagonale ${Math.round(r.diag)} cm` : ''].filter(Boolean).join('  ·  '), x, y, 8.5, grey); y -= 11; }
    y -= 9; row('Wand', 'Länge', 'Ecke danach', grey);
    r.walls.forEach((w, i) => { if (y > F + SB + 40) row(String(i + 1), `${Math.round(w.cm * 10) / 10} cm${w.calc ? ' *' : ''}`, `${inner(w.turn)}° ${w.turn > 0 ? 'rechts' : 'links'}`); });
    if (r.walls.some(w => w.calc)) { T(pg, '* berechnet, nicht gemessen', x, y, 7.5, grey); y -= 12; }
    const ops = r.ops || [];
    if (ops.length && y > F + SB + 60) { y -= 8; row('Öffnung', 'Wand, ab Ecke', 'Breite', grey);
      for (const op of ops) { if (y < F + SB + 30) break; const to = op.to && plan.rooms.find(q => q.id === op.to); row(op.type === 'T' ? 'Tür' : 'Fenster', `Wand ${op.wall + 1}, ${Math.round(op.pos)} cm`, `${Math.round(op.w)} cm`);
        const extra = [to ? 'führt nach ' + to.name : '', op.type === 'T' && op.hinge ? `Anschlag ${op.hinge === 'a' ? 'links' : 'rechts'}, geht ${op.swing === 'out' ? 'hinaus' : 'herein'}` : '', op.h ? `Höhe ${Math.round(op.h)} cm` : '', op.par != null ? `Parapet ${Math.round(op.par)} cm` : '', op.thick ? `${op.type === 'T' ? 'Wandstärke' : 'Laibungstiefe'} ${Math.round(op.thick)} cm` : ''].filter(Boolean);
        for (const e of extra) { T(pg, fitText(e, 7.5, tw - 54), x + 50, y + 2, 7.5, grey); y -= 9.5; } y -= 1; } }
    T(pg, 'Blauer Punkt = Start, Wände im Uhrzeigersinn nummeriert', F + 12, F + SB - 13, 7.5, grey);
  });
  // Letztes Blatt: Raumliste
  if (done.length) {
    const pg = doc.addPage([W, H]); sheet(pg, `${plan.name || 'Ohne Adresse'} – Raumliste`, 0, pages);
    const cols = [['Raum', F + 30, 0], ['Fläche', F + 300, 1], ['Umfang', F + 400, 1], ['Raumhöhe', F + 500, 1], ['Wandfläche', F + 620, 1], ['ohne Abzug', F + 740, 1]], cell = (t, c, y, size = 10, col = ink) => T(pg, t, c[2] ? c[1] - wOf(t, size) : c[1], y, size, col);
    let y = H - F - 50; T(pg, 'Raumliste', F + 30, H - F - 30, 15); cols.forEach(c => cell(c[0], c, y, 8.5, grey)); y -= 6; L(pg, { x: F + 24, y }, { x: W - F - 24, y }, 0.5, grey); y -= 15;
    let tA = 0, tW = 0, tG = 0, anyW = false;
    for (const r of done) { if (y < F + SB + 40) break; const s2 = G.summary(r), wa = wallArea(r); tA += s2.area; if (wa) { tW += wa.net; tG += wa.gross; anyW = true; }
      cell(fitText(r.name, 10, 250), cols[0], y); cell(fmtA(s2.area), cols[1], y); cell(fmtM(s2.perimeter), cols[2], y); cell(r.rh ? fmtM(r.rh) : '–', cols[3], y); cell(wa ? fmtA(wa.net) : '–', cols[4], y); cell(wa ? fmtA(wa.gross) : '–', cols[5], y); y -= 15; }
    y += 6; L(pg, { x: F + 24, y }, { x: W - F - 24, y }, 0.5, grey); y -= 15; cell('Gesamt', cols[0], y, 10.5); cell(fmtA(tA), cols[1], y, 10.5); if (anyW) { cell(fmtA(tW), cols[4], y, 10.5); cell(fmtA(tG), cols[5], y, 10.5); }
    T(pg, `Wandfläche = Umfang × Raumhöhe, abzüglich Öffnungen mit gemessener Höhe – ohne Messung angenommen: Tür ${fmtM(DOOR_H)}, Fenster ${fmtM(WIN_H)}.`, F + 12, F + SB - 13, 7.5, grey);
    T(pg, 'Säulen, Kamine und Schächte sind von der Raumfläche abgezogen.', F + 12, F + SB - 23, 7.5, grey);
  }
  if (!done.length) { const pg = doc.addPage([W, H]); sheet(pg, plan.name || 'Ohne Adresse', 0, 1); T(pg, 'Noch kein Raum fertig gemessen.', F + 30, H / 2, 12, grey); }
  return doc.save();
}
