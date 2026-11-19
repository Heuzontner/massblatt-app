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
  if (room.closed && walls.length >= 3) out.area = (area(closedPoly(walls)) - objArea(room)) / 10000; // m², ohne Säulen/Kamine/Schächte
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
  // Wand an Wand (ohne Öffnung): Anfang der eigenen Wand + Versatz liegt dem Ende der Nachbarwand gegenüber
  for (const A of done) for (const l of A.links || []) { const B = done.find(r => r.id === l.to); if (!B || !(l.toWall < B.walls.length) || !(l.wall < A.walls.length)) continue;
    pairs.push({ A, B, oa: { wall: l.wall, pos: l.off || 0, w: 0 }, ob: { wall: l.toWall, pos: B.walls[l.toWall].cm, w: 0 }, thick: l.thick || defThick }); }
  const T = new Map(), issues = [];
  if (!done.length) return { T, unplaced: [], main: 0, groups: 0, missing, issues, pairs };
  const solve = (ta, from, to, of, ot, thick) => {       // Lage von „to“, wenn „from“ bei ta liegt
    const gf = opGeo(from, poly.get(from.id), of), gt = opGeo(to, poly.get(to.id), ot);
    const nf = rotV(ta, gf.n), cf = applyT(ta, gf.c);
    const ang = Math.atan2(-nf.y, -nf.x) - Math.atan2(gt.n.y, gt.n.x), c = Math.cos(ang), s = Math.sin(ang);
    const target = { x: cf.x + nf.x * thick, y: cf.y + nf.y * thick };
    return { c, s, x: target.x - (c * gt.c.x - s * gt.c.y), y: target.y - (s * gt.c.x + c * gt.c.y) };
  };
  // Jede zusammenhängende Gruppe wird für sich aufgebaut (g = Gruppennummer; Gruppe 0 beginnt beim ersten fertigen Raum)
  const usedPair = new Set(); let grp = -1;
  for (const seed of done) {
    if (T.has(seed.id)) continue; grp++; T.set(seed.id, { c: 1, s: 0, x: 0, y: 0, g: grp }); const queue = [seed];
    while (queue.length) {
      const R = queue.shift();
      for (const p of pairs) {
        if (usedPair.has(p)) continue; const isA = p.A === R, isB = p.B === R; if (!isA && !isB) continue; usedPair.add(p);
        const from = R, to = isA ? p.B : p.A, of = isA ? p.oa : p.ob, ot = isA ? p.ob : p.oa;
        const t = solve(T.get(R.id), from, to, of, ot, p.thick); t.g = grp;
        if (!T.has(to.id)) { T.set(to.id, t); queue.push(to); }
        else { // Ringschluss: der Raum liegt schon – wie weit weicht diese Verbindung davon ab?
          const have = T.get(to.id), gt = opGeo(to, poly.get(to.id), ot), a = applyT(have, gt.c), b = applyT(t, gt.c), off = Math.hypot(a.x - b.x, a.y - b.y);
          if (off > 3) issues.push({ a: from.id, b: to.id, off });
        }
      }
    }
  }
  const unplaced = done.filter(r => T.get(r.id).g > 0).map(r => r.id);
  return { T, unplaced, main: done.length - unplaced.length, groups: grp + 1, missing, issues, pairs, poly };

}

// ---------- Stufe 3: Lage aller fertigen Räume für die Ausgabe ----------
// Verbundene Räume an ihrem Platz, die übrigen in einer Reihe rechts daneben (loose). Koordinaten in cm, y nach unten.
export function layout(rooms, defThick = 15) {
  const res = placeRooms(rooms, defThick), items = []; let bb = null;
  const grow = q => { bb = bb ? { x0: Math.min(bb.x0, q.x), y0: Math.min(bb.y0, q.y), x1: Math.max(bb.x1, q.x), y1: Math.max(bb.y1, q.y) } : { x0: q.x, y0: q.y, x1: q.x, y1: q.y }; };
  for (let gi = 0; gi < (res.groups || 0); gi++) { // Gruppe 0 an ihrem Platz, jede weitere als Block rechts daneben
    const part = rooms.filter(r => res.T.has(r.id) && res.T.get(r.id).g === gi).map(r => ({ room: r, poly: res.poly.get(r.id).map(q => applyT(res.T.get(r.id), q)), loose: gi > 0, g: gi }));
    if (gi > 0 && bb) { const all = part.flatMap(i => i.poly), mnx = Math.min(...all.map(q => q.x)), mny = Math.min(...all.map(q => q.y)), mxx = Math.max(...all.map(q => q.x)), mxy = Math.max(...all.map(q => q.y));
      const at = part[0].room.at; // von Hand hingeschoben: Mitte der Gruppe (cm) + Vierteldrehungen; sonst als Block rechts daneben
      if (at && isFinite(at.x) && isFinite(at.y)) { const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, k = ((at.r || 0) % 4 + 4) % 4, c = [1, 0, -1, 0][k], s = [0, 1, 0, -1][k]; for (const i of part) i.poly = i.poly.map(q => ({ x: at.x + c * (q.x - cx) - s * (q.y - cy), y: at.y + s * (q.x - cx) + c * (q.y - cy) })); }
      else { const dx = bb.x1 + 150 - mnx, dy = bb.y0 - mny; for (const i of part) i.poly = i.poly.map(q => ({ x: q.x + dx, y: q.y + dy })); } }
    for (const i of part) { i.poly.forEach(grow); items.push(i); }
  }
  return { items, bb: bb || { x0: 0, y0: 0, x1: 1, y1: 1 }, res };
}
// ---------- Wandansicht (3.21): eine Wand von innen gesehen, x ab Wandanfang nach rechts, y ab Boden nach oben (cm) ----------
// Dachschräge (Objekt DS an einer Wand = Kniestockwand): diese Wand ist nur so hoch wie der Kniestock; die beiden Nachbarwände
// zeigen die Schräge als Profil (vom Kniestock an der Ecke bis zur Raumhöhe nach der Tiefe der Schräge).
// Fehlende Höhen sind angenommen (guess): Raum 250, Tür 200, Fenster 130 ab Parapet 85.
export const ELEV_DEF = { rh: 250, door: 200, win: 130, par: 85, knee: 100 };
export function elev(room, i) {
  const n = room.walls.length, L = room.walls[i].cm, H = room.rh || ELEV_DEF.rh, ds = (room.objs || []).filter(o => o.kind === 'DS');
  const own = ds.find(o => o.wall === i), prev = ds.find(o => o.wall === (i - 1 + n) % n), next = ds.find(o => o.wall === (i + 1) % n), kn = o => Math.min(H, o.knee || ELEV_DEF.knee), dp = o => Math.max(1, Math.min(L, o.d || 100));
  let top; // obere Kante von links nach rechts
  if (own) top = [{ x: 0, y: kn(own) }, { x: L, y: kn(own) }];
  else { top = []; if (prev && n > 2) top.push({ x: 0, y: kn(prev) }, { x: dp(prev), y: H }); else top.push({ x: 0, y: H });
    if (next && n > 2) { const x = Math.max(top[top.length - 1].x, L - dp(next)); top.push({ x, y: H }, { x: L, y: kn(next) }); } else top.push({ x: L, y: H }); }
  const outline = [{ x: 0, y: 0 }, { x: L, y: 0 }, ...[...top].reverse()], topAt = x => { for (let k = 0; k + 1 < top.length; k++) { const a = top[k], b = top[k + 1]; if (x >= a.x - 1e-6 && x <= b.x + 1e-6) return b.x - a.x < 1e-6 ? Math.min(a.y, b.y) : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x); } return H; };
  let gross = 0; for (let k = 0; k < outline.length; k++) { const a = outline[k], b = outline[(k + 1) % outline.length]; gross += a.x * b.y - b.x * a.y; } gross = Math.abs(gross) / 2;
  const ops = (room.ops || []).filter(o => o.wall === i).sort((a, b) => a.pos - b.pos).map(o => { const T = o.type === 'T', y = T ? 0 : (o.par != null ? o.par : ELEV_DEF.par), lim = Math.min(topAt(o.pos), topAt(o.pos + o.w)), h = Math.max(5, Math.min(o.h || (T ? ELEV_DEF.door : ELEV_DEF.win), lim - y));
    return { op: o, type: o.type, x: o.pos, w: o.w, y, h, guessH: !o.h, guessY: !T && o.par == null, noLeaf: !!o.noLeaf }; });
  const minus = ops.reduce((s, o) => s + o.w * o.h, 0);
  return { L, H, hasRh: !!room.rh, outline, top, ops, knee: own ? kn(own) : null, slope: !!(own || prev || next), gross, net: Math.max(0, gross - minus) };
}

// Andocken: Welche Wand einer losen Gruppe liegt einer Wand eines anderen Raums gegenüber (fast parallel, nah, mit Überdeckung)?
// Ergebnis ist eine „Wand an Wand“-Verbindung (wie room.links): Anfang der eigenen Wand + off liegt dem Ende der Nachbarwand gegenüber.
// Liegen die Wandenden fast bündig (≤ snap cm), wird bündig gesetzt.
export function dockFind(lay, gi, reach = 90, snap = 25) {
  const mov = lay.items.filter(i => i.g === gi), fix = lay.items.filter(i => i.g !== gi); let best = null;
  for (const m of mov) for (let i = 0; i < m.poly.length; i++) { const gm = wallGeo(m.poly, i);
    for (const f of fix) for (let j = 0; j < f.poly.length; j++) { const gf = wallGeo(f.poly, j);
      if (gm.n.x * gf.n.x + gm.n.y * gf.n.y > -0.94) continue;                         // müssen sich ansehen (±20°)
      const gap = (gf.a.x - gm.a.x) * gm.n.x + (gf.a.y - gm.a.y) * gm.n.y; if (gap < -40 || gap > reach) continue;
      const t = q => (q.x - gm.a.x) * gm.d.x + (q.y - gm.a.y) * gm.d.y, tE = t(gf.b), tS = t(gf.a), over = Math.min(gm.L, Math.max(tE, tS)) - Math.max(0, Math.min(tE, tS)); if (over < 30) continue;
      const score = Math.abs(gap) - over * 0.05; if (best && score >= best.score) continue;
      let off = tE; const Lm = m.room.walls[i].cm, Lf = f.room.walls[j].cm; if (Math.abs(off) <= snap) off = 0; else if (Math.abs(off - (Lm - Lf)) <= snap) off = Lm - Lf;
      best = { score, room: m.room, wall: i, to: f.room, toWall: j, off: Math.round(off * 10) / 10, gap };
    } }
  return best;
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
export const drawLeaf = (plan, room, op) => !op.noLeaf && (op.swing !== 'out' || !partnerOf(plan, room, op)); // Durchgang: kein Türblatt
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
export const opDepth = (plan, room, op) => { const pr = op.type === 'T' ? partnerOf(plan, room, op) : null; return pr ? (op.thick || pr.thick || plan.wall || 15) : Math.max(op.thick || 0, plan.wallOut || 30); }; // ohne Gegenstück mindestens die Außenwand, damit die Öffnung die Wand ganz durchdringt
// Alles, was für einen Raum zu zeichnen ist, als einfache Formen in cm (y nach unten). u = cm je Ausgabe-Einheit (Pixel/Punkt) für Abstände der Maßketten.
export function gfx(plan, room, poly, o = {}) {
  const n = poly.length, wOut = plan.wallOut || 30, u = o.u || 1, add = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
  const out = { band: offsetPoly(poly, wOut), inner: poly, cuts: [], cutsX: [], wins: [], doors: [], chains: [], chained: new Set(), ext: [] };
  out.ext.push(...out.band);
  out.objs = (room.objs || []).filter(q => q.wall < n).map(q => objGfx(room, poly, q));
  for (let i = 0; i < n; i++) {
    const wp = wallParts(room, poly, i), nn = wp.n;
    for (const p of wp.parts) {
      if (p.kind === 'W') continue; const dep = opDepth(plan, room, p.op), q0 = add(p.p0, nn, dep), q1 = add(p.p1, nn, dep);
      out.cuts.push([p.p0, p.p1, q1, q0]);
      out.cutsX.push([add(p.p0, nn, -1), add(p.p1, nn, -1), add(p.p1, nn, dep + 1), add(p.p0, nn, dep + 1)]); // 1 cm über beide Wandkanten hinaus: schneidet beim Verschmelzen sicher durch
      if (p.kind === 'F') out.wins.push({ rect: [p.p0, p.p1, q1, q0], glass: [add(p.p0, nn, dep / 2), add(p.p1, nn, dep / 2)] });
      else {
        const d = { jambs: [[p.p0, q0], [p.p1, q1]], op: p.op };
        if (!p.op.noLeaf && (o.allLeaf || drawLeaf(plan, room, p.op))) {
          const hb = p.op.hinge === 'b', outw = p.op.swing === 'out', h0 = hb ? p.p1 : p.p0, e0 = hb ? p.p0 : p.p1, r = Math.hypot(e0.x - h0.x, e0.y - h0.y);
          const hinge = outw ? add(h0, nn, dep) : h0, other = outw ? add(e0, nn, dep) : e0, tip = add(hinge, nn, outw ? r : -r);
          d.leaf = [hinge, tip]; d.arc = { c: hinge, r, from: tip, to: other }; out.ext.push(tip);
        }
        out.doors.push(d);
      }
    }
    const innerWall = (room.ops || []).some(q => q.wall === i && q.type === 'T' && partnerOf(plan, room, q));
    if (o.chains && !(o.outerOnly && innerWall)) { // Maßkette außen: Teilmaße (Abstand – Öffnung – Rest) und darüber das Gesamtmaß
      const cmL = room.walls[i].cm, k = wp.L / (cmL || wp.L), segs = wp.parts.map(p => ({ p0: p.p0, p1: p.p1, cm: p.kind === 'W' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) / k : p.op.w, op: p.op }));
      const a = poly[i], b = poly[(i + 1) % n], mk = (off, list) => { const line = [add(a, nn, off), add(b, nn, off)], ticks = [], labels = [];
        for (const s of list) { ticks.push([add(s.p0, nn, off - 3 * u), add(s.p0, nn, off + 3 * u)]); labels.push({ p: add({ x: (s.p0.x + s.p1.x) / 2, y: (s.p0.y + s.p1.y) / 2 }, nn, off + 7 * u), t: String(Math.round(s.cm)) + (s.op && s.op.h ? '/' + Math.round(s.op.h) : ''), d: wp.d, len: Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) });
          if (s.op && s.op.par != null) labels.push({ p: add({ x: (s.p0.x + s.p1.x) / 2, y: (s.p0.y + s.p1.y) / 2 }, nn, off - 7 * u), t: 'P ' + Math.round(s.op.par), d: wp.d, len: Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) }); }
        const last = list[list.length - 1]; ticks.push([add(last.p1, nn, off - 3 * u), add(last.p1, nn, off + 3 * u)]); out.ext.push(add(a, nn, off + 13 * u), add(b, nn, off + 13 * u)); return { line, ticks, labels }; };
      let off = wOut + 10 * u; for (const d of out.doors) if (d.leaf && d.op.wall === i && d.op.swing === 'out') off = Math.max(off, opDepth(plan, room, d.op) + d.arc.r + 8 * u); // nach außen aufgehende Tür: Kette dahinter
      if (segs.length > 1) { out.chains.push(mk(off, segs)); off += 17 * u; }
      out.chains.push(mk(off, [{ p0: a, p1: b, cm: cmL }])); out.chained.add(i);
    }
  }
  return out;
}

// ---------- 3.17: Durchgang, Wand an Wand, Kontrollmaß, Diagonalen-Fächer, Nische, Objekte, Schraffur ----------
// Kontrollmaß: Abstand zwischen zwei (gegenüberliegenden) Wänden im zusammengehängten Plan, in cm
export function checkDist(lay, a, wa, b, wb) {
  const ia = lay.items.find(i => i.room.id === a), ib = lay.items.find(i => i.room.id === b); if (!ia || !ib || ia.g !== ib.g) return null; // nur innerhalb einer zusammenhängenden Gruppe
  const ga = wallGeo(ia.poly, wa), gb = wallGeo(ib.poly, wb), m = { x: (gb.a.x + gb.b.x) / 2, y: (gb.a.y + gb.b.y) / 2 };
  return Math.abs((m.x - ga.a.x) * ga.n.x + (m.y - ga.a.y) * ga.n.y);
}
// Diagonalen vom Startpunkt zu den Ecken 2 … n−2 legen die Form eindeutig fest (Fächer aus Dreiecken). diags[k] = Abstand Startpunkt → Ecke k.
// Auf welcher Seite jedes Dreieck liegt, kommt aus der bisher getippten Form. Gibt die Drehungen je Wand zurück oder null.
export function fanTurns(walls, diags) {
  const n = walls.length, L = walls.map(w => w.cm), cur = closedPoly(walls), c = [{ x: 0, y: 0 }, { x: L[0], y: 0 }]; let sgn = 1;
  for (let k = 2; k < n; k++) {
    const B = c[k - 1], dAB = Math.hypot(B.x, B.y), side = L[k - 1], dAK = k === n - 1 ? L[n - 1] : diags[k]; if (!(dAK > 0) || !(dAB > 0)) return null;
    const cs = (dAB * dAB + dAK * dAK - side * side) / (2 * dAB * dAK); if (cs < -1.0001 || cs > 1.0001) return null;
    const cr = (cur[k - 1].x - cur[0].x) * (cur[k].y - cur[0].y) - (cur[k - 1].y - cur[0].y) * (cur[k].x - cur[0].x); if (Math.abs(cr) > 1e-6) sgn = cr > 0 ? 1 : -1;
    const ang = Math.atan2(B.y, B.x) + sgn * Math.acos(Math.max(-1, Math.min(1, cs))); c.push({ x: dAK * Math.cos(ang), y: dAK * Math.sin(ang) });
  }
  const dir = i => { const a = c[i], b = c[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  return L.map((_, i) => { const d1 = dir(i), d2 = dir((i + 1) % n); return Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y) / RAD; });
}
// Nische (Raum wird an dieser Stelle größer) oder Vorsprung (kleiner) in Wand i einfügen: Abstand a, Breite b, Tiefe t. Verschiebt die Wandnummern dahinter.
export function insertNiche(room, i, a, b, t, inward) {
  const w = room.walls[i], rest = w.cm - a - b; if (!(a > 0 && b > 0 && t > 0 && rest > 0)) return false;
  const cw = room.walls.reduce((s, x) => s + (x.turn || 0), 0) > 0, X = (cw ? -90 : 90) * (inward ? -1 : 1);
  room.walls.splice(i, 1, { cm: a, turn: X }, { cm: t, turn: -X }, { cm: b, turn: -X }, { cm: t, turn: X }, { cm: rest, turn: w.turn });
  for (const list of [room.ops, room.objs, room.links]) for (const o of list || []) if (o.wall > i) o.wall += 4;
  return true;
}
// Kopie eines Raums, auf Wunsch gespiegelt (Drehungen und Türanschläge umgekehrt); Verbindungen werden nicht mitkopiert
export function copyRoom(room, mirror, uid) {
  const r = JSON.parse(JSON.stringify(room)); r.id = uid(); delete r.links; delete r.at;
  for (const w of r.walls) if (mirror && w.turn != null) w.turn = -w.turn;
  for (const o of r.ops || []) { o.id = uid(); o.to = null; if (mirror && o.hinge) o.hinge = o.hinge === 'a' ? 'b' : 'a'; }
  for (const o of r.objs || []) o.id = uid();
  return r;
}
// Objekte an einer Wand: Säule, Kamin, Schacht, Heizkörper, Sanitär, Treppe, Dachschräge
export const OBJ = { S: ['Säule', 30, 30, 1], K: ['Kamin', 40, 40, 1], C: ['Schacht', 60, 30, 1], H: ['Heizkörper', 100, 12, 0], WC: ['WC', 40, 65, 0], WB: ['Waschbecken', 60, 45, 0], DU: ['Dusche', 90, 90, 0], WA: ['Wanne', 170, 75, 0], TR: ['Treppe', 100, 250, 0], DS: ['Dachschräge', 0, 100, 0] };
export const objArea = room => (room.objs || []).reduce((s, o) => s + ((OBJ[o.kind] || [])[3] ? o.w * o.d : 0), 0);   // Säule, Kamin, Schacht zählen nicht zur Fläche
export function objGfx(room, poly, o) {
  const g = wallGeo(poly, o.wall), k = g.L / (room.walls[o.wall].cm || g.L), W = (o.kind === 'DS' ? room.walls[o.wall].cm : o.w) * k, D = o.d, pos = (o.kind === 'DS' ? 0 : o.pos) * k, gap = o.gap || 0;
  const f = (u, v) => ({ x: g.a.x + g.d.x * (pos + u * W) - g.n.x * (gap + v * D), y: g.a.y + g.d.y * (pos + u * W) - g.n.y * (gap + v * D) });
  const rect = (u0, v0, u1, v1) => [f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1), f(u0, v0)], ell = (cu, cv, ru, rv) => Array.from({ length: 21 }, (_, i) => f(cu + ru * Math.cos(i * Math.PI / 10), cv + rv * Math.sin(i * Math.PI / 10)));
  const out = { kind: o.kind, quad: [f(0, 0), f(1, 0), f(1, 1), f(0, 1)], solid: !!(OBJ[o.kind] || [])[3], lines: [], dashed: false, label: null, c: f(0.5, 0.5) };
  if (o.kind === 'K') out.lines.push([f(0, 0), f(1, 1)], [f(1, 0), f(0, 1)]);
  else if (o.kind === 'C') out.lines.push([f(0, 0), f(1, 1)]);
  else if (o.kind === 'H') for (let i = 1; i < 8; i++) out.lines.push([f(i / 8, 0), f(i / 8, 1)]);
  else if (o.kind === 'WC') out.lines.push(rect(0.05, 0, 0.95, 0.28), ell(0.5, 0.64, 0.42, 0.34));
  else if (o.kind === 'WB') out.lines.push(ell(0.5, 0.52, 0.36, 0.34), [f(0.5, 0.06), f(0.5, 0.2)]);
  else if (o.kind === 'DU') out.lines.push([f(0, 0), f(1, 1)], [f(1, 0), f(0, 1)], ell(0.5, 0.5, 0.06, 0.06));
  else if (o.kind === 'WA') out.lines.push(rect(0.06, 0.1, 0.94, 0.9), ell(0.14, 0.5, 0.03, 0.06));
  else if (o.kind === 'TR') { const n = Math.max(3, Math.round(D / 27)); for (let i = 1; i < n; i++) out.lines.push([f(0, i / n), f(1, i / n)]); out.lines.push([f(0.5, 0.04), f(0.5, 0.96)], [f(0.38, 0.86), f(0.5, 0.96), f(0.62, 0.86)]); }
  else if (o.kind === 'DS') { out.quad = null; out.dashed = true; out.lines.push([f(0, 1), f(1, 1)]); out.label = { p: f(0.5, 0.5), t: `Schräge${o.knee ? ', Kniestock ' + Math.round(o.knee) : ''}`, d: g.d }; }
  return out;
}
// Schraffur: schräge Linien im Abstand „step“, auf die Wandflächen zugeschnitten (rings = geschlossene Umrisse, innen/außen nach Gerade-Ungerade-Regel)
export function hatchLines(rings, step = 8) {
  const c = Math.SQRT1_2, R = p => ({ x: (p.x + p.y) * c, y: (p.y - p.x) * c }), B = p => ({ x: (p.x - p.y) * c, y: (p.x + p.y) * c }), rs = rings.map(r => r.map(R)), out = [];
  const ys = rs.flat().map(p => p.y); if (!ys.length) return out;
  for (let y = Math.ceil(Math.min(...ys) / step) * step + step / 2; y < Math.max(...ys); y += step) {
    const xs = []; for (const r of rs) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)); }
    xs.sort((p, q) => p - q); for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.5) out.push([B({ x: xs[i], y }), B({ x: xs[i + 1], y })]);
  }
  return out;
}
