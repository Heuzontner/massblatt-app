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
