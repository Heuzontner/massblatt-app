// Grundriss (Stufe 1): eigener Reiter, eigene Daten, eigener Code – berührt das Massblatt nicht.
// Gemeinsam genutzt werden nur: Laser-Verbindung, PIN/Sperre, Dialoge und die Raumnamen-Liste (lesend).
import * as G from './plan-geo.js';
const $ = s => document.querySelector(s);
const A = () => window.__app;                                   // Brücke aus app.js (show, toast, confirmBox, promptBox, beep …)
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- eigener Speicher (eigene Datenbank, damit sich nichts mit dem Massblatt kreuzt) ----------
let dbp = null;
function odb() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open('massblatt-grundriss', 1); r.onupgradeneeded = () => r.result.createObjectStore('plans', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
const tx = async (mode, fn) => { const d = await odb(); return new Promise((res, rej) => { const t = d.transaction('plans', mode); const r = fn(t.objectStore('plans')); let out; if (r) r.onsuccess = () => { out = r.result; }; t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); };
const store = { all: () => tx('readonly', s => s.getAll()), get: id => tx('readonly', s => s.get(id)), put: v => tx('readwrite', s => s.put(v)), del: id => tx('readwrite', s => s.delete(id)) };

const P = { plan: null, room: null, hold: null, alpha: null, lastAlpha: null };
const save = async () => { if (!P.plan) return; P.plan.updated = Date.now(); await store.put(P.plan); };
const fmtM = cm => (cm / 100).toFixed(2).replace('.', ',') + ' m';
const fmtA = m2 => m2.toFixed(2).replace('.', ',') + ' m²';
const roomSum = r => G.summary(r);
const planArea = p => (p.rooms || []).reduce((s, r) => s + roomSum(r).area, 0);

// ---------- Reiter auf der Startseite ----------
function setTab(t) {
  $('#home').classList.toggle('gr', t === 'gr');
  document.querySelectorAll('#homeTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'gr') renderList();
}
document.querySelectorAll('#homeTabs button').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

async function renderList() {
  const el = $('#grList'); const all = (await store.all()).sort((a, b) => (b.updated || 0) - (a.updated || 0)); el.innerHTML = '';
  if (!all.length) { el.innerHTML = '<p class="mute" style="text-align:center;margin:40px 12px">Noch kein Grundriss.<br>Unten auf „+ Neuer Grundriss“ tippen, dann Raum für Raum mit dem Laser ablaufen.</p>'; return; }
  for (const p of all) {
    const c = document.createElement('div'); c.className = 'card'; const n = (p.rooms || []).length, done = (p.rooms || []).filter(r => r.closed).length;
    c.innerHTML = `<div class="t"><b>${esc(p.name || 'Ohne Adresse')}</b><small>${esc([p.kunde, [p.plz, p.ortName].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}${p.kunde || p.plz ? ' · ' : ''}${n} ${n === 1 ? 'Raum' : 'Räume'}${n ? ` (${done} fertig)` : ''}${planArea(p) ? ' · ' + fmtA(planArea(p)) : ''}</small></div><span class="mute">›</span>`;
    c.onclick = () => openPlan(p.id); el.appendChild(c);
  }
}

// ---------- Grundriss-Projekt ----------
$('#grNew').onclick = async () => {
  const p = { id: uid(), name: '', plz: '', ortName: '', kunde: '', rooms: [], created: Date.now(), updated: Date.now() };
  await store.put(p); await openPlan(p.id);
};
async function openPlan(id) {
  P.plan = await store.get(id); if (!P.plan) return; P.room = null;
  $('#grStr').value = P.plan.name || ''; $('#grPlz').value = P.plan.plz || ''; $('#grOrt').value = P.plan.ortName || ''; $('#grKunde').value = P.plan.kunde || '';
  renderPlan(); A().show('plan'); A().keepAwake(true);
}
function renderPlan() {
  const p = P.plan; $('#grTitle').textContent = p.name || 'Neuer Grundriss';
  const el = $('#grRooms'); el.innerHTML = '';
  if (!p.rooms.length) el.innerHTML = '<p class="mute" style="margin:8px 2px">Noch kein Raum. Unten „+ Raum“ antippen.</p>';
  for (const r of p.rooms) {
    const s = roomSum(r), c = document.createElement('div'); c.className = 'card grroom' + (r.closed ? ' done' : '');
    c.innerHTML = `<div class="t"><b>${esc(r.name)}</b><small>${r.closed ? `✓ ${s.n} Wände · ${fmtA(s.area)}` : s.n ? `${s.n} ${s.n === 1 ? 'Wand' : 'Wände'} · noch offen` : 'noch nichts gemessen'}</small></div><span class="mute">›</span>`;
    c.onclick = () => openRoom(r.id); el.appendChild(c);
  }
  const tot = planArea(p); $('#grTotal').textContent = tot ? `Gesamt: ${fmtA(tot)} (${p.rooms.filter(r => r.closed).length} von ${p.rooms.length} Räumen fertig)` : '';
}
for (const [id, key] of [['grStr', 'name'], ['grPlz', 'plz'], ['grOrt', 'ortName'], ['grKunde', 'kunde']]) $('#' + id).addEventListener('input', () => { if (!P.plan) return; P.plan[key] = $('#' + id).value.trim(); if (key === 'name') $('#grTitle').textContent = P.plan.name || 'Neuer Grundriss'; save(); });
$('#grBack').onclick = () => A().goBack(false);
$('#grDel').onclick = async () => {
  if (!P.plan || !await A().confirmBox('Grundriss löschen?', 'Löschen', 'Abbrechen', 'danger', 'Alle Räume dieses Grundrisses gehen verloren. Das Massblatt ist davon nicht betroffen.')) return;
  await store.del(P.plan.id); P.plan = null; A().goBack(false);
};
// Adresse + Kunde aus einem Massblatt-Projekt übernehmen (reine Kopie, danach unabhängig)
$('#grTake').onclick = async () => {
  const list = (await A().liveProjects()).filter(p => (p.name || p.str || '').trim()).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 40);
  if (!list.length) { A().toast('Noch kein Massblatt-Projekt vorhanden'); return; }
  const bg = sheet('<h2>Aus Massblatt übernehmen</h2><p class="mute" style="margin:-4px 0 10px;font-size:14px">Kopiert Adresse und Kunde. Das Massblatt-Projekt bleibt unverändert.</p><div data-list></div><button class="ghost" data-close style="width:100%;margin-top:8px">Abbrechen</button>');
  for (const p of list) {
    const b = document.createElement('button'); b.className = 'ghost grpick'; b.innerHTML = `<b>${esc(p.name || p.str)}</b><small>${esc([p.firma, [p.plz, p.ortName].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</small>`;
    b.onclick = () => { P.plan.name = (p.name || p.str || '').trim(); P.plan.plz = p.plz || ''; P.plan.ortName = p.ortName || ''; P.plan.kunde = p.firma || ''; P.plan.fromMassblatt = p.id;
      $('#grStr').value = P.plan.name; $('#grPlz').value = P.plan.plz; $('#grOrt').value = P.plan.ortName; $('#grKunde').value = P.plan.kunde; save(); renderPlan(); bg.remove(); A().toast('Adresse und Kunde übernommen'); };
    bg.querySelector('[data-list]').appendChild(b);
  }
};
function sheet(html) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg on'; bg.innerHTML = `<div class="sheet">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
  document.body.appendChild(bg); return bg;
}
// Raum anlegen: Namen aus der Raumliste (nur gelesen) oder eigener Name
$('#grAddRoom').onclick = async () => {
  const names = await A().rooms(); const used = new Set(P.plan.rooms.map(r => r.name));
  const bg = sheet('<h2>Welcher Raum?</h2><div class="grgrid" data-grid></div><button class="ghost" data-own style="width:100%;margin-top:10px">✎ anderer Name</button><button class="ghost" data-close style="width:100%;margin-top:8px">Abbrechen</button>');
  const add = async name => { bg.remove(); let n = name, i = 2; while (P.plan.rooms.some(r => r.name === n)) n = `${name} ${i++}`; const r = { id: uid(), name: n, walls: [], closed: false }; P.plan.rooms.push(r); await save(); openRoom(r.id); };
  for (const [k, t] of names) { const b = document.createElement('button'); b.className = 'ghost' + (used.has(t || k) ? ' used' : ''); b.innerHTML = `<b>${esc(k)}</b><small>${esc(t || '')}</small>`; b.onclick = () => add(t || k); bg.querySelector('[data-grid]').appendChild(b); }
  bg.querySelector('[data-own]').onclick = async () => { const v = await A().promptBox('Raumname', 'z. B. Abstellraum'); if (v && v.trim()) add(v.trim()); };
};

// ---------- Raum ablaufen ----------
function openRoom(id) {
  P.room = P.plan.rooms.find(r => r.id === id); if (!P.room) return; P.hold = null; P.lastAlpha = null;
  A().show('planRoom'); A().keepAwake(true); roomUi(); gyroOn();
}
const walls = () => P.room.walls;
const lastW = () => walls()[walls().length - 1];
const pending = () => { const w = lastW(); return !!w && w.turn == null && !P.room.closed; }; // letzte Wand gemessen, Ecke noch offen

function roomUi() {
  const r = P.room, s = roomSum(r), n = r.walls.length;
  $('#grRoomTitle').textContent = r.name;
  let txt, sub = '';
  if (r.closed) { txt = `✓ Raum fertig · ${fmtA(s.area)}`; sub = `${n} Wände · Umfang ${fmtM(s.perimeter)}${r.adjust ? ` · ${Math.round(r.adjust)} cm ausgeglichen` : ''}`; }
  else if (P.hold) { txt = 'Wohin ging es vor dieser Wand?'; sub = `${Math.round(P.hold.cm)} cm gemessen – links oder rechts antippen`; }
  else if (!n) { txt = 'Erste Wand messen'; sub = 'In einer Ecke beginnen und im Uhrzeigersinn Wand für Wand messen.'; }
  else if (pending()) { txt = `Wand ${n}: ${Math.round(lastW().cm)} cm · Wohin geht es weiter?`; sub = gyroOk() ? 'Links oder rechts antippen – oder einfach die nächste Wand messen (Richtung wird erkannt).' : 'Links oder rechts antippen.'; }
  else { txt = `Wand ${n + 1} messen`; sub = n >= 2 ? (s.gap < 5 ? 'Der Raum geht auf – „✓ Raum fertig“ antippen.' : `Bis zum Anfang fehlen noch ${Math.round(s.gap)} cm.`) : ''; }
  $('#grInfo').textContent = txt; $('#grSub').textContent = sub;
  const turnMode = !r.closed && (pending() || !!P.hold);
  $('#grTurnBar').style.display = turnMode ? 'flex' : 'none'; $('#grMeasBar').style.display = !r.closed && !turnMode ? 'flex' : 'none'; $('#grDoneBar').style.display = r.closed ? 'flex' : 'none';
  $('#grUndo').disabled = !n; $('#grClose').disabled = n < 2;
  $('#grDiag').style.display = r.closed && n === 4 ? '' : 'none'; $('#grDiag').textContent = r.diag ? `Diagonale: ${Math.round(r.diag)} cm` : '＋ Diagonale (schiefer Raum)';
  // Wand-Leiste
  const ch = $('#grWalls'); ch.innerHTML = '';
  r.walls.forEach((w, i) => { const b = document.createElement('button'); b.dataset.i = i; b.innerHTML = `<i>${i + 1}</i>${Math.round(w.cm)}<small>${turnIcon(w.turn)}</small>`; if (w.auto) b.classList.add('auto'); b.onclick = () => editWall(i); ch.appendChild(b); });
  ch.scrollLeft = ch.scrollWidth; draw();
}
const turnIcon = t => t == null ? '?' : Math.abs(Math.abs(t) - 90) < 0.5 ? (t > 0 ? '↱' : '↰') : (t > 0 ? '↱' : '↰') + Math.round(180 - Math.abs(t)) + '°'; // angezeigt wird der Innenwinkel der Ecke

async function addWall(cm) {
  const r = P.room; if (!r || r.closed) return;
  r.walls.push({ cm, turn: null }); P.lastAlpha = P.alpha; A().beep(true); await save(); roomUi();
}
async function setTurn(t, auto = false) {
  const w = lastW(); if (!w || P.room.closed) return;
  w.turn = t; if (auto) w.auto = true; else delete w.auto;
  if (P.hold) { const h = P.hold; P.hold = null; await addWall(h.cm); return; }
  await save(); roomUi();
}
// Messwert vom Laser (oder von Hand): Ist die letzte Ecke noch offen, wird die Richtung aus der Drehung des Tablets genommen – sonst nachgefragt.
async function measure(cm) {
  const r = P.room; if (!r) return;
  if (r.closed) { if (P.wantDiag) { P.wantDiag = false; return applyDiag(cm); } A().toast('Raum ist fertig – „Wieder öffnen“, um weiterzumessen', 2600); A().beep(false); return; }
  if (P.hold) { P.hold = { cm }; A().toast('Erst links oder rechts antippen'); roomUi(); return; }
  if (pending()) {
    const g = gyroTurn();
    if (g) { lastW().turn = g; lastW().auto = true; A().toast(`Ecke erkannt: nach ${g > 0 ? 'rechts' : 'links'} (Wand antippen zum Ändern)`, 2400); }
    else { P.hold = { cm }; A().beep(true); roomUi(); return; }
  }
  await addWall(cm);
}
$('#grL').onclick = () => setTurn(-90); $('#grR').onclick = () => setTurn(90);
$('#grAng').onclick = async () => {
  const v = await A().promptBox('Innenwinkel der Ecke in Grad', 'rechter Winkel = 90, flache Ecke z. B. 135'); if (v == null) return;
  const d = parseFloat(String(v).replace(',', '.')); if (!(d > 0 && d < 180)) { A().toast('Bitte einen Wert zwischen 1 und 179'); return; }
  const bg = sheet(`<h2>${d}° – in welche Richtung?</h2><div class="row2"><button class="pri" data-s="-1">↰ links</button><button class="pri" data-s="1">↱ rechts</button></div>`);
  bg.querySelectorAll('[data-s]').forEach(b => { b.onclick = () => { bg.remove(); setTurn((180 - d) * +b.dataset.s); }; });
};
$('#grKey').onclick = async () => {
  const v = await A().promptBox(P.wantDiag ? 'Diagonale in cm' : 'Wandlänge in cm', 'z. B. 412'); if (v == null) return;
  const cm = parseFloat(String(v).replace(',', '.')); if (!(cm > 0 && cm < 10000)) { A().toast('Bitte eine Länge in cm eingeben'); return; } measure(cm);
};
$('#grKey2').onclick = () => $('#grKey').onclick();
$('#grUndo').onclick = $('#grUndo2').onclick = async () => {
  const r = P.room; if (P.hold) { P.hold = null; roomUi(); return; }
  if (!r.walls.length) return;
  const w = lastW(); if (w.turn != null && !r.closed) { w.turn = null; delete w.auto; } else r.walls.pop();
  r.closed = false; delete r.diag; delete r.adjust; await save(); roomUi();
};
// Raum schließen: geht er auf (≤ 5 cm) → fertig. Liegt die Lücke in Laufrichtung → das ist die fehlende letzte Wand. Sonst: Lücke zeigen.
$('#grClose').onclick = async () => {
  const r = P.room; if (r.walls.length < 2) return;
  if (pending()) { A().toast('Erst links oder rechts für die letzte Ecke antippen'); return; }
  let g = G.gap(r.walls);
  // nur wenn die Runde noch nicht voll ist (bisher weniger als 360° gedreht) – sonst ist es ein Messfehler, keine fehlende Wand
  const turned = Math.abs(r.walls.reduce((t, w) => t + (w.turn || 0), 0));
  if (g.len > 5 && g.off < 12 && r.walls.length >= 2 && turned > 180 && turned < 345) {
    const cm = Math.round(g.len);
    const ok = await A().confirmBox(`Letzte Wand: ${cm} cm`, 'Übernehmen', 'Selbst messen', 'pri', 'Bis zum Anfang fehlt genau eine Wand in Laufrichtung. Übernehmen spart die Messung – dann gibt es aber keine Kontrolle, ob alles stimmt.');
    if (!ok) return; r.walls.push({ cm: g.len, turn: null, calc: true }); g = G.gap(r.walls);
  }
  if (r.walls.length < 3) { A().toast('Ein Raum braucht mindestens 3 Wände'); return; }
  if (g.len > 5) {
    const pc = (g.len / (g.perimeter || 1) * 100).toFixed(1).replace('.', ',');
    const ok = await A().confirmBox(`Der Raum geht nicht auf: ${Math.round(g.len)} cm fehlen`, 'Trotzdem schließen', 'Weiter messen', 'pri', `Das sind ${pc} % vom Umfang. „Trotzdem schließen“ verteilt den Fehler auf alle Wände – besser ist, die verdächtige Wand nachzumessen (Wand unten antippen).`);
    if (!ok) { roomUi(); return; }
  }
  // letzte Ecke so setzen, dass die Runde 360° ergibt
  const sum = r.walls.slice(0, -1).reduce((s, w) => s + (w.turn || 0), 0); const lw = lastW(); if (lw.turn == null) lw.turn = G.norm180(360 - sum) || 90;
  r.closed = true; r.adjust = g.len > 0.5 ? g.len : 0; A().beep(true); await save(); roomUi();
};
$('#grReopen').onclick = async () => { const r = P.room; r.closed = false; delete r.diag; delete r.adjust; if (lastW() && lastW().calc) r.walls.pop(); await save(); roomUi(); };
$('#grRoomOk').onclick = $('#grRoomBack').onclick = () => A().goBack(false);
$('#grRoomDel').onclick = async () => { if (!await A().confirmBox(`Raum „${P.room.name}“ löschen?`, 'Löschen')) return; P.plan.rooms = P.plan.rooms.filter(r => r !== P.room); P.room = null; await save(); A().goBack(false); };
$('#grRoomTitle').onclick = async () => { const v = await A().promptBox('Raumname', '', P.room.name); if (v && v.trim()) { P.room.name = v.trim(); await save(); roomUi(); } };
// Diagonale von Ecke 1 zu Ecke 3 (Anfang der 1. Wand → Ende der 2. Wand): echte Winkel statt 90°
$('#grDiag').onclick = () => { P.wantDiag = true; A().toast('Diagonale messen: vom Startpunkt (●) zur gegenüberliegenden Ecke – oder ⌨', 4000); $('#grKey2').style.display = ''; };
async function applyDiag(cm) {
  const r = P.room, w = r.walls; const sign = (w[0].turn || 90) > 0 ? 1 : -1;
  const t = G.quadTurns(w[0].cm, w[1].cm, w[2].cm, w[3].cm, cm, sign);
  if (!t) { A().toast('Diese Diagonale passt nicht zu den vier Wänden – bitte nachmessen', 4000); A().beep(false); return; }
  t.forEach((v, i) => { w[i].turn = v; delete w[i].auto; }); r.diag = cm; r.adjust = 0; $('#grKey2').style.display = 'none'; A().beep(true); await save(); roomUi();
  A().toast(`Winkel berechnet: ${t.map(v => Math.round((180 - Math.abs(v)) * 10) / 10 + '°').join(' · ')}`, 4500);
}
// Wand bearbeiten: Länge ändern, Ecke umdrehen
function editWall(i) {
  const r = P.room, w = r.walls[i];
  const bg = sheet(`<h2>Wand ${i + 1}: ${Math.round(w.cm)} cm</h2><div class="row2"><button class="ghost" data-len>✎ Länge ändern</button><button class="ghost" data-re>📏 Neu messen</button></div>
    <label class="f">Ecke nach dieser Wand</label><div class="row2"><button class="${w.turn != null && w.turn < 0 ? 'pri' : 'ghost'}" data-t="-90">↰ links</button><button class="${w.turn > 0 ? 'pri' : 'ghost'}" data-t="90">↱ rechts</button></div>
    <button class="ghost" data-close style="width:100%;margin-top:10px">Schließen</button>`);
  const reclose = async () => { if (r.closed) { const g = G.gap(r.walls); r.adjust = g.len > 0.5 ? g.len : 0; delete r.diag; } await save(); roomUi(); };
  bg.querySelector('[data-len]').onclick = async () => { bg.remove(); const v = await A().promptBox(`Wand ${i + 1} in cm`, '', String(Math.round(w.cm))); if (v == null) return; const cm = parseFloat(String(v).replace(',', '.')); if (!(cm > 0 && cm < 10000)) return; w.cm = cm; delete w.calc; reclose(); };
  bg.querySelector('[data-re]').onclick = () => { bg.remove(); P.remeasure = i; A().toast(`Wand ${i + 1} neu messen …`, 3000); };
  bg.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => { bg.remove(); w.turn = +b.dataset.t; delete w.auto; reclose(); }; });
}

// ---------- Drehung des Tablets (Vorschlag für links/rechts) ----------
let gyroBound = false;
function gyroOn() {
  if (gyroBound) return; gyroBound = true;
  const h = e => { if (e.alpha != null) P.alpha = e.alpha; };
  window.addEventListener('deviceorientation', h);
}
const gyroOk = () => P.alpha != null && localStorage.getItem('mb_grGyro') !== '0';
function gyroTurn() {
  if (!gyroOk() || P.lastAlpha == null) return 0;
  const d = G.norm180(P.alpha - P.lastAlpha);                    // alpha wächst bei Drehung nach links
  if (Math.abs(d) < 50 || Math.abs(d) > 130) return 0;           // nicht eindeutig → nachfragen
  return d < 0 ? 90 : -90;
}

// ---------- Zeichnung ----------
function draw() {
  const cv = $('#grCv'), r = P.room; if (!cv || !r) return;
  const box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(50, box.width), H = Math.max(50, box.height); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || '#888';
  const ink = col('--text'), acc = col('--acc'), mute = col('--mute'), red = col('--red'), green = col('--green'), mono = css.getPropertyValue('--mono') || 'monospace';
  const w = r.walls; if (!w.length) { g.fillStyle = mute; g.font = `15px ${mono}`; g.textAlign = 'center'; g.fillText('Hier entsteht der Raum.', W / 2, H / 2); return; }
  const tr = G.trace(w); let pts = r.closed ? [...G.closedPoly(w)] : tr.pts;
  const all = r.closed ? pts : [...pts];
  // Vorschau-Stummel für links/rechts mit einrechnen, damit nichts aus dem Bild läuft
  const end = tr.pts[tr.pts.length - 1], hd = tr.heading * Math.PI / 180;
  const stub = Math.max(60, Math.min(...w.map(x => x.cm)) * 0.5);
  const opts = pending() ? [-90, 90].map(t => { const a = (tr.heading + t) * Math.PI / 180; return { t, x: end.x + stub * Math.cos(a), y: end.y + stub * Math.sin(a) }; }) : [];
  const bb = [...all, ...opts].reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: 0, y0: 0, x1: 0, y1: 0 });
  const pad = 46, sc = Math.min((W - 2 * pad) / Math.max(1, bb.x1 - bb.x0), (H - 2 * pad) / Math.max(1, bb.y1 - bb.y0));
  const ox = (W - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy = (H - (bb.y1 - bb.y0) * sc) / 2 - bb.y0 * sc;
  const X = p => ox + p.x * sc, Y = p => oy + p.y * sc;
  P.view = { sc, pts: pts.map(p => ({ x: X(p), y: Y(p) })) };
  if (r.closed) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.closePath(); g.fillStyle = col('--acc-soft'); g.fill(); }
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = 4; g.strokeStyle = ink; g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); if (r.closed) g.closePath(); g.stroke();
  // Maße an den Wänden (außen)
  g.font = `600 13px ${mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = w.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = r.closed ? pts[(i + 1) % n] : pts[i + 1]; if (!b) continue;
    const mx = (X(a) + X(b)) / 2, my = (Y(a) + Y(b)) / 2, dx = X(b) - X(a), dy = Y(b) - Y(a), L = Math.hypot(dx, dy) || 1;
    const nx = dy / L, ny = -dx / L;                              // im Uhrzeigersinn gelaufen → links der Laufrichtung ist außen
    const t = `${Math.round(w[i].cm)}`, tw = g.measureText(t).width + 10;
    const lx = mx + nx * 16, ly = my + ny * 16;
    g.fillStyle = col('--panel'); g.fillRect(lx - tw / 2, ly - 10, tw, 20); g.fillStyle = w[i].calc ? mute : ink; g.fillText(t, lx, ly);
  }
  // Startpunkt
  g.fillStyle = acc; g.beginPath(); g.arc(X(pts[0]), Y(pts[0]), 6, 0, 7); g.fill();
  if (!r.closed) {
    const e = { x: X(end), y: Y(end) };
    if (n >= 2) { const gp = G.gap(w); if (gp.len > 5) { g.setLineDash([6, 6]); g.strokeStyle = red; g.lineWidth = 2; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(X(pts[0]), Y(pts[0])); g.stroke(); g.setLineDash([]); } }
    if (pending()) for (const o of opts) {
      g.setLineDash([4, 5]); g.strokeStyle = acc; g.lineWidth = 3; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(X(o), Y(o)); g.stroke(); g.setLineDash([]);
      g.fillStyle = acc; g.font = `600 13px ${mono}`; g.fillText(o.t < 0 ? 'links' : 'rechts', X(o) + (X(o) - e.x) * 0.28, Y(o) + (Y(o) - e.y) * 0.28);
    } else { // Pfeil: hier geht es weiter
      const L = 34; g.strokeStyle = acc; g.fillStyle = acc; g.lineWidth = 3; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(e.x + L * Math.cos(hd), e.y + L * Math.sin(hd)); g.stroke();
      const tx = e.x + L * Math.cos(hd), ty = e.y + L * Math.sin(hd); g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - 10 * Math.cos(hd - 0.5), ty - 10 * Math.sin(hd - 0.5)); g.lineTo(tx - 10 * Math.cos(hd + 0.5), ty - 10 * Math.sin(hd + 0.5)); g.closePath(); g.fill();
    }
    g.fillStyle = green; g.beginPath(); g.arc(e.x, e.y, 5, 0, 7); g.fill();
  } else {
    const c = pts.reduce((s, p) => ({ x: s.x + X(p) / n, y: s.y + Y(p) / n }), { x: 0, y: 0 });
    g.fillStyle = ink; g.font = `700 20px ${css.getPropertyValue('--display') || 'sans-serif'}`; g.fillText(fmtA(roomSum(r).area), c.x, c.y);
  }
}
window.addEventListener('resize', () => { if ($('#planRoom').classList.contains('on')) draw(); });

// ---------- Andockstellen für app.js ----------
window.__plan = {
  // Messwert: nur wenn der Raum-Bildschirm offen ist; sonst bekommt ihn das Massblatt wie bisher
  measure(cm) {
    if ($('#planRoom').classList.contains('on') && P.room) {
      if (P.remeasure != null && P.room.walls[P.remeasure]) { const w = P.room.walls[P.remeasure]; w.cm = cm; delete w.calc; P.remeasure = null; if (P.room.closed) { const g = G.gap(P.room.walls); P.room.adjust = g.len > 0.5 ? g.len : 0; delete P.room.diag; } A().beep(true); save().then(roomUi); return true; }
      measure(cm); return true;
    }
    if ($('#plan').classList.contains('on')) { A().toast(`${Math.round(cm)} cm gemessen – erst einen Raum öffnen`, 2000); A().beep(false); return true; }
    return false;
  },
  // Zurück: Raum → Grundriss → Startseite (Reiter Grundriss)
  back(cur, viaPop) {
    if (cur === 'planRoom') { P.room = null; P.hold = null; P.wantDiag = false; P.remeasure = null; renderPlan(); A().show('plan', viaPop); A().keepAwake(true); return true; }
    if (cur === 'plan') { P.plan = null; A().show('home', viaPop); setTab('gr'); return true; }
    return false;
  },
  state: P, store, setTab, G,
};
