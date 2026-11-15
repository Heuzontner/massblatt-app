// Grundriss-Geometrie (reine Rechnung, ohne Oberfläche). Getrennt vom Massblatt.
// Ein Raum ist ein Streckenzug: Wand für Wand im Uhrzeigersinn. Jede Wand hat eine Länge (cm) und danach eine Ecke:
// turn = Drehung in Grad, + = nach rechts, − = nach links (90 = rechter Winkel nach rechts). Bildschirm-Koordinaten: x rechts, y unten.
const RAD = Math.PI / 180;
export const norm180 = d => { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };

// Eckpunkte des offenen Streckenzugs: n Wände → n + 1 Punkte; dazu die Laufrichtung nach der letzten Ecke
export function trace(walls) {
  const pts = [{ x: 0, y: 0 }]; let h = 0, x = 0, y = 0;
  for (const w of walls) {
    x += w.cm * Math.cos(h * RAD); y += w.cm * Math.sin(h * RAD); pts.push({ x, y });
    h += w.turn == null ? 0 : w.turn;
  }
  return { pts, heading: norm180(h) };
}
// Lücke zwischen Ende und Anfang
export function gap(walls) {
  const { pts, heading } = trace(walls); const e = pts[pts.length - 1];
  const dx = -e.x, dy = -e.y, len = Math.hypot(dx, dy);
  // Winkel zwischen Lücke und aktueller Laufrichtung: 0 = die fehlende Wand liegt genau in Laufrichtung
  const off = len < 1e-6 ? 0 : Math.abs(norm180(Math.atan2(dy, dx) / RAD - heading));
  return { dx, dy, len, off, perimeter: walls.reduce((s, w) => s + w.cm, 0) };
}
// Geschlossenes Vieleck: Restfehler anteilig nach Wandlänge verteilen (Bowditch)
export function closedPoly(walls) {
  const { pts } = trace(walls); const g = gap(walls); const per = g.perimeter || 1; let run = 0;
  const out = [{ x: 0, y: 0 }];
  for (let i = 0; i < walls.length - 1; i++) { run += walls[i].cm; out.push({ x: pts[i + 1].x + g.dx * run / per, y: pts[i + 1].y + g.dy * run / per }); }
  return out;
}
export function area(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
// Viereck mit einer Diagonale (Ecke 0 → Ecke 2): echte Eckwinkel statt 90°. Gibt die vier Drehungen zurück oder null, wenn die Maße kein Viereck ergeben.
export function quadTurns(a, b, c, d, diag, sign = 1) {
  const ang = (p, q, r) => { const v = (p * p + q * q - r * r) / (2 * p * q); return v < -1 || v > 1 ? null : Math.acos(v) / RAD; };
  const B = ang(a, b, diag), D = ang(c, d, diag);                 // Ecke zwischen Wand 1/2 und zwischen Wand 3/4
  const A1 = ang(a, diag, b), A2 = ang(d, diag, c), C1 = ang(b, diag, a), C2 = ang(c, diag, d);
  if ([B, D, A1, A2, C1, C2].some(v => v == null)) return null;
  const A = A1 + A2, C = C1 + C2;
  return [B, C, D, A].map(v => sign * (180 - v));               // Drehung nach Wand 1, 2, 3, 4
}
// Ist der Raum rechtwinklig angelegt (nur 90°-Ecken)?
export const isRect = walls => walls.every(w => w.turn == null || Math.abs(Math.abs(w.turn) - 90) < 0.01);
// Zusammenfassung für die Oberfläche
export function summary(room) {
  const walls = room.walls || []; const g = gap(walls);
  const out = { n: walls.length, gap: g.len, off: g.off, perimeter: g.perimeter, area: 0 };
  if (room.closed && walls.length >= 3) out.area = area(closedPoly(walls)) / 10000; // m²
  return out;
}

// ---------- Stufe 2: Öffnungen und Zusammenhängen der Räume ----------
// Umlaufsinn: > 0 = im Uhrzeigersinn gelaufen (Bildschirm, y nach unten) → Rauminneres rechts der Laufrichtung
export const signedArea = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };
// Wand i des geschlossenen Raums: Anfang, Ende, Richtung, Normale nach außen, Länge
export function wallGeo(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, cw = signedArea(poly) > 0;
  return { a, b, d, L, n: cw ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x } };
}
// Öffnung auf ihrer Wand: Anfangs-, End- und Mittelpunkt (Abstand ab der Ecke, an der die Wand beginnt)
export function opGeo(room, poly, op) {
  const g = wallGeo(poly, op.wall), k = g.L / (room.walls[op.wall].cm || g.L);   // ausgeglichene Wand kann minimal länger/kürzer sein
  const p0 = { x: g.a.x + g.d.x * op.pos * k, y: g.a.y + g.d.y * op.pos * k }, p1 = { x: p0.x + g.d.x * op.w * k, y: p0.y + g.d.y * op.w * k };
  return { p0, p1, c: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, d: g.d, n: g.n };
}
export const applyT = (t, p) => ({ x: t.c * p.x - t.s * p.y + t.x, y: t.s * p.x + t.c * p.y + t.y });
const rotV = (t, v) => ({ x: t.c * v.x - t.s * v.y, y: t.s * v.x + t.c * v.y });
// Räume über ihre Türen aneinanderhängen. Eine Tür in A mit Ziel B braucht ihr Gegenstück in B (Tür mit Ziel A).
// Ergebnis: Lage je Raum (Drehung + Verschiebung), nicht verbundene Räume, fehlende Gegenstücke, Versatz bei Ringschlüssen.
export function placeRooms(rooms, defThick = 15) {
  const done = rooms.filter(r => r.closed && r.walls.length >= 3), poly = new Map(done.map(r => [r.id, closedPoly(r.walls)]));
  const doors = r => (r.ops || []).filter(o => o.type === 'T' && o.to);
  const pairs = [], missing = [], used = new Set();
  for (const A of done) for (const oa of doors(A)) {
    if (used.has(oa.id)) continue; const B = done.find(r => r.id === oa.to);
    if (!B) { if (rooms.some(r => r.id === oa.to)) missing.push({ from: A.id, to: oa.to, why: 'offen' }); continue; }
    const ob = doors(B).find(o => o.to === A.id && !used.has(o.id));
    if (!ob) { missing.push({ from: A.id, to: B.id, why: 'gegenstueck' }); continue; }
    used.add(oa.id); used.add(ob.id); pairs.push({ A, B, oa, ob, thick: oa.thick || ob.thick || defThick });
  }
  const T = new Map(), issues = [];
  if (!done.length) return { T, unplaced: [], missing, issues, pairs };
  const solve = (ta, from, to, of, ot, thick) => {       // Lage von „to“, wenn „from“ bei ta liegt
    const gf = opGeo(from, poly.get(from.id), of), gt = opGeo(to, poly.get(to.id), ot);
    const nf = rotV(ta, gf.n), cf = applyT(ta, gf.c);
    const ang = Math.atan2(-nf.y, -nf.x) - Math.atan2(gt.n.y, gt.n.x), c = Math.cos(ang), s = Math.sin(ang);
    const target = { x: cf.x + nf.x * thick, y: cf.y + nf.y * thick };
    return { c, s, x: target.x - (c * gt.c.x - s * gt.c.y), y: target.y - (s * gt.c.x + c * gt.c.y) };
  };
  T.set(done[0].id, { c: 1, s: 0, x: 0, y: 0 }); const queue = [done[0]], usedPair = new Set();
  while (queue.length) {
    const R = queue.shift();
    for (const p of pairs) {
      if (usedPair.has(p)) continue; const isA = p.A === R, isB = p.B === R; if (!isA && !isB) continue; usedPair.add(p);
      const from = R, to = isA ? p.B : p.A, of = isA ? p.oa : p.ob, ot = isA ? p.ob : p.oa;
      const t = solve(T.get(R.id), from, to, of, ot, p.thick);
      if (!T.has(to.id)) { T.set(to.id, t); queue.push(to); }
      else { // Ringschluss: der Raum liegt schon – wie weit weicht diese Tür davon ab?
        const have = T.get(to.id), gt = opGeo(to, poly.get(to.id), ot), a = applyT(have, gt.c), b = applyT(t, gt.c), off = Math.hypot(a.x - b.x, a.y - b.y);
        if (off > 3) issues.push({ a: from.id, b: to.id, off });
      }
    }
  }
  return { T, unplaced: done.filter(r => !T.has(r.id)).map(r => r.id), missing, issues, pairs, poly };
}

// ---------- Stufe 3: Lage aller fertigen Räume für die Ausgabe ----------
// Verbundene Räume an ihrem Platz, die übrigen in einer Reihe rechts daneben (loose). Koordinaten in cm, y nach unten.
export function layout(rooms, defThick = 15) {
  const res = placeRooms(rooms, defThick), items = []; let bb = null;
  const grow = q => { bb = bb ? { x0: Math.min(bb.x0, q.x), y0: Math.min(bb.y0, q.y), x1: Math.max(bb.x1, q.x), y1: Math.max(bb.y1, q.y) } : { x0: q.x, y0: q.y, x1: q.x, y1: q.y }; };
  for (const r of rooms) { const t = res.T.get(r.id); if (!t) continue; const poly = res.poly.get(r.id).map(q => applyT(t, q)); poly.forEach(grow); items.push({ room: r, poly, loose: false }); }
  let x = bb ? bb.x1 + 150 : 0; const y0 = bb ? bb.y0 : 0;
  for (const id of res.unplaced) {
    const r = rooms.find(q => q.id === id), raw = res.poly.get(id), mnx = Math.min(...raw.map(q => q.x)), mny = Math.min(...raw.map(q => q.y));
    const poly = raw.map(q => ({ x: q.x - mnx + x, y: q.y - mny + y0 })); poly.forEach(grow); x = Math.max(...poly.map(q => q.x)) + 100; items.push({ room: r, poly, loose: true });
  }
  return { items, bb: bb || { x0: 0, y0: 0, x1: 1, y1: 1 }, res };
}
// Eine Wand in Stücke teilen: massive Abschnitte und Öffnungen (in Reihenfolge entlang der Wand)
export function wallParts(room, poly, i) {
  const n = poly.length, a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, k = L / (room.walls[i].cm || L), d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const at = s => ({ x: a.x + d.x * s, y: a.y + d.y * s }), ops = (room.ops || []).filter(o => o.wall === i).sort((p, q) => p.pos - q.pos), out = []; let s = 0;
  for (const o of ops) { const s0 = Math.max(s, o.pos * k), s1 = Math.min(L, (o.pos + o.w) * k); if (s1 <= s0) continue; if (s0 > s + 1e-6) out.push({ kind: 'W', p0: at(s), p1: at(s0) }); out.push({ kind: o.type, p0: at(s0), p1: at(s1), op: o }); s = s1; }
  if (L > s + 1e-6) out.push({ kind: 'W', p0: at(s), p1: at(L) });
  return { parts: out, d, n: wallGeo(poly, i).n, mid: at(L / 2), L };
}

// ---------- Plansymbole (3.14): Tür mit Aufschlag, Fenster mit Rahmen ----------
// Tür: Anschlag am Anfang ('a', von innen gesehen links) oder Ende ('b', rechts) der Öffnung; geht in den Raum ('in') oder hinaus ('out')
export function doorSym(part, nOut, op) {
  const hinge = op.hinge === 'b' ? part.p1 : part.p0, other = op.hinge === 'b' ? part.p0 : part.p1, r = Math.hypot(other.x - hinge.x, other.y - hinge.y), s = op.swing === 'out' ? 1 : -1;
  return { hinge, other, r, tip: { x: hinge.x + nOut.x * s * r, y: hinge.y + nOut.y * s * r } };
}
export function winSym(part, nOut, depth) {
  const o = k => q => ({ x: q.x + nOut.x * k, y: q.y + nOut.y * k }), h = depth / 2;
  return [o(-h)(part.p0), o(-h)(part.p1), o(h)(part.p1), o(h)(part.p0)];
}
// Ein Türblatt wird nur einmal gezeichnet: in dem Raum, in den die Tür aufgeht – oder hier, wenn es kein Gegenstück gibt
export const partnerOf = (plan, room, op) => op.to ? ((plan.rooms.find(r => r.id === op.to) || {}).ops || []).find(o => o.type === 'T' && o.to === room.id) : null;
export const drawLeaf = (plan, room, op) => op.swing !== 'out' || !partnerOf(plan, room, op);
// Wo das Wandmaß steht: in der Mitte des längsten massiven Wandstücks, damit es keine Öffnung überschreibt
export function dimAnchor(wp) { let best = null, bl = -1; for (const p of wp.parts) if (p.kind === 'W') { const l = Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y); if (l > bl) { bl = l; best = p; } } return best ? { x: (best.p0.x + best.p1.x) / 2, y: (best.p0.y + best.p1.y) / 2 } : wp.mid; }

// ---------- Plan-Darstellung (3.15): Wände mit Stärke, Maßketten ----------
// Vieleck um d nach außen versetzen (Gehrung an den Ecken)
export function offsetPoly(poly, d) {
  const n = poly.length, cw = signedArea(poly) > 0, out = [];
  const nrm = i => { const a = poly[i], b = poly[(i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / L, dy = (b.y - a.y) / L; return cw ? { x: dy, y: -dx } : { x: -dy, y: dx }; };
  for (let i = 0; i < n; i++) { const n0 = nrm((i - 1 + n) % n), n1 = nrm(i), k = 1 + n0.x * n1.x + n0.y * n1.y, m = k < 0.05 ? n1 : { x: (n0.x + n1.x) / k, y: (n0.y + n1.y) / k }; out.push({ x: poly[i].x + m.x * d, y: poly[i].y + m.y * d }); }
  return out;
}
// Wandtiefe an einer Öffnung: Tür mit Gegenstück = gemessene/Standard-Innenwand, sonst Außenwand
export const opDepth = (plan, room, op) => { const pr = op.type === 'T' ? partnerOf(plan, room, op) : null; return pr ? (op.thick || pr.thick || plan.wall || 15) : (op.thick || plan.wallOut || 30); };
// Alles, was für einen Raum zu zeichnen ist, als einfache Formen in cm (y nach unten). u = cm je Ausgabe-Einheit (Pixel/Punkt) für Abstände der Maßketten.
export function gfx(plan, room, poly, o = {}) {
  const n = poly.length, wOut = plan.wallOut || 30, u = o.u || 1, add = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
  const out = { band: offsetPoly(poly, wOut), inner: poly, cuts: [], wins: [], doors: [], chains: [], ext: [] };
  out.ext.push(...out.band);
  for (let i = 0; i < n; i++) {
    const wp = wallParts(room, poly, i), nn = wp.n;
    for (const p of wp.parts) {
      if (p.kind === 'W') continue; const dep = opDepth(plan, room, p.op), q0 = add(p.p0, nn, dep), q1 = add(p.p1, nn, dep);
      out.cuts.push([p.p0, p.p1, q1, q0]);
      if (p.kind === 'F') out.wins.push({ rect: [p.p0, p.p1, q1, q0], glass: [add(p.p0, nn, dep / 2), add(p.p1, nn, dep / 2)] });
      else {
        const d = { jambs: [[p.p0, q0], [p.p1, q1]], op: p.op };
        if (o.allLeaf || drawLeaf(plan, room, p.op)) {
          const hb = p.op.hinge === 'b', outw = p.op.swing === 'out', h0 = hb ? p.p1 : p.p0, e0 = hb ? p.p0 : p.p1, r = Math.hypot(e0.x - h0.x, e0.y - h0.y);
          const hinge = outw ? add(h0, nn, dep) : h0, other = outw ? add(e0, nn, dep) : e0, tip = add(hinge, nn, outw ? r : -r);
          d.leaf = [hinge, tip]; d.arc = { c: hinge, r, from: tip, to: other }; out.ext.push(tip);
        }
        out.doors.push(d);
      }
    }
    const innerWall = (room.ops || []).some(q => q.wall === i && q.type === 'T' && partnerOf(plan, room, q));
    if (o.chains && !(o.outerOnly && innerWall)) { // Maßkette außen: Teilmaße (Abstand – Öffnung – Rest) und darüber das Gesamtmaß
      const cmL = room.walls[i].cm, k = wp.L / (cmL || wp.L), segs = wp.parts.map(p => ({ p0: p.p0, p1: p.p1, cm: p.kind === 'W' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) / k : p.op.w }));
      const a = poly[i], b = poly[(i + 1) % n], mk = (off, list) => { const line = [add(a, nn, off), add(b, nn, off)], ticks = [], labels = [];
        for (const s of list) { ticks.push([add(s.p0, nn, off - 3 * u), add(s.p0, nn, off + 3 * u)]); labels.push({ p: add({ x: (s.p0.x + s.p1.x) / 2, y: (s.p0.y + s.p1.y) / 2 }, nn, off + 7 * u), t: String(Math.round(s.cm)), d: wp.d, len: Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) }); }
        const last = list[list.length - 1]; ticks.push([add(last.p1, nn, off - 3 * u), add(last.p1, nn, off + 3 * u)]); out.ext.push(add(a, nn, off + 13 * u), add(b, nn, off + 13 * u)); return { line, ticks, labels }; };
      let off = wOut + 10 * u; for (const d of out.doors) if (d.leaf && d.op.wall === i && d.op.swing === 'out') off = Math.max(off, opDepth(plan, room, d.op) + d.arc.r + 8 * u); // nach außen aufgehende Tür: Kette dahinter
      if (segs.length > 1) { out.chains.push(mk(off, segs)); off += 17 * u; }
      out.chains.push(mk(off, [{ p0: a, p1: b, cm: cmL }]));
    }
  }
  return out;
}
