// Grundriss (Stufe 1): eigener Reiter, eigene Daten, eigener Code – berührt das Massblatt nicht.
// Gemeinsam genutzt werden nur: Laser-Verbindung, PIN/Sperre, Dialoge und die Raumnamen-Liste (lesend).
import * as G from './plan-geo.js';
import * as O from './plan-out.js';
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
const store = { all: () => tx('readonly', s => s.getAll()), get: id => tx('readonly', s => s.get(id)), put: v => tx('readwrite', s => s.put(v)), del: id => tx('readwrite', s => s.delete(id)), clear: () => tx('readwrite', s => s.clear()) };

const P = { plan: null, room: null, hold: null };
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
  $('#grStr').value = P.plan.name || ''; $('#grPlz').value = P.plan.plz || ''; $('#grOrt').value = P.plan.ortName || ''; $('#grKunde').value = P.plan.kunde || ''; $('#grWall').value = P.plan.wall || ''; $('#grWallOut').value = P.plan.wallOut || '';
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
  const nd = p.rooms.filter(r => r.closed).length; $('#grFlatCard').style.display = nd ? '' : 'none';
  if (nd) { const { res, msgs } = flatInfo(); $('#grFlatHint').textContent = nd < 2 ? 'Wohnung ansehen' : msgs.length ? `Wohnung ansehen · ${msgs.length} ${msgs.length === 1 ? 'Hinweis' : 'Hinweise'}` : `Wohnung ansehen · ${res.T.size} Räume verbunden ✓`; requestAnimationFrame(() => drawFlat($('#grFlatMini'), false)); }
  const tot = planArea(p), ex = (p.exports || []).slice(-1)[0]; $('#grTotal').textContent = (tot ? `Gesamt: ${fmtA(tot)} (${p.rooms.filter(r => r.closed).length} von ${p.rooms.length} Räumen fertig)` : '') + (ex ? ` · zuletzt ${ex.how} ${new Date(ex.t).toLocaleDateString('de-AT')}` : '');
  $('#grExport').disabled = !nd;
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
  P.room = P.plan.rooms.find(r => r.id === id); if (!P.room) return; P.hold = null; P.op = null;
  A().show('planRoom'); A().keepAwake(true); roomUi();
}
const walls = () => P.room.walls;
const lastW = () => walls()[walls().length - 1];
const pending = () => { const w = lastW(); return !!w && w.turn == null && !P.room.closed; }; // letzte Wand gemessen, Ecke noch offen

function roomUi() {
  const r = P.room, s = roomSum(r), n = r.walls.length;
  $('#grRoomTitle').textContent = r.name;
  let txt, sub = '';
  const op = r.closed ? P.op : null, kind = op && op.type === 'T' ? 'Tür' : 'Fenster';
  if (op && op.step === 'wall') { txt = `${kind}: an welcher Wand?`; sub = 'Wand im Bild oder unten in der Leiste antippen.'; }
  else if (op && op.step === 'pos') { txt = `${kind} an Wand ${op.wall + 1}: Abstand von der Ecke`; sub = `Vom orangen Punkt bis zur ersten Kante der ${kind === 'Tür' ? 'Tür' : 'Fensteröffnung'} messen (oder ⌨). Wand: ${Math.round(r.walls[op.wall].cm)} cm.`; }
  else if (op && op.step === 'w') { txt = `${kind} an Wand ${op.wall + 1}: Breite`; sub = `Abstand ${Math.round(op.pos)} cm ✓ – jetzt die Breite messen (oder ⌨).`; }
  else if (r.closed) { txt = `✓ Raum fertig · ${fmtA(s.area)}`; sub = `${n} Wände · Umfang ${fmtM(s.perimeter)}${r.adjust ? ` · ${Math.round(r.adjust)} cm ausgeglichen` : ''}`; }
  else if (P.hold) { txt = 'Wohin ging es vor dieser Wand?'; sub = `${Math.round(P.hold.cm)} cm gemessen – links oder rechts antippen`; }
  else if (!n) { txt = 'Erste Wand messen'; sub = 'In einer Ecke beginnen und im Uhrzeigersinn Wand für Wand messen.'; }
  else if (pending()) { txt = `Wand ${n}: ${Math.round(lastW().cm)} cm · Wohin geht es weiter?`; sub = 'Links oder rechts antippen.'; }
  else { txt = `Wand ${n + 1} messen`; sub = n >= 2 ? (s.gap < 5 ? 'Der Raum geht auf – „✓ Raum fertig“ antippen.' : `Bis zum Anfang fehlen noch ${Math.round(s.gap)} cm.`) : ''; }
  $('#grInfo').textContent = txt; $('#grSub').textContent = sub;
  const turnMode = !r.closed && (pending() || !!P.hold);
  $('#grTurnBar').style.display = turnMode ? 'flex' : 'none'; $('#grMeasBar').style.display = !r.closed && !turnMode ? 'flex' : 'none';
  $('#grDoneBar').style.display = r.closed && !op ? 'flex' : 'none'; $('#grMini').style.display = r.closed && !op ? 'flex' : 'none'; $('#grOpBar').style.display = op ? 'flex' : 'none';
  $('#grOpKey').style.display = op && op.step !== 'wall' ? '' : 'none';
  $('#grUndo').disabled = !n; $('#grClose').disabled = n < 2;
  $('#grUndo').textContent = n && lastW().turn != null ? '↶ Richtung ändern' : '↶ zurück'; $('#grUndo2').textContent = P.hold ? '↶ Wert weg' : '↶ Wand weg';
  $('#grRh').textContent = r.rh ? `Rh ${Math.round(r.rh)} cm` : '＋ Raumhöhe';
  $('#grDiag').style.display = r.closed && n === 4 ? '' : 'none'; $('#grDiag').textContent = r.diag ? `Diagonale ${Math.round(r.diag)} cm` : '＋ Diagonale';
  // Wand-Leiste
  const ch = $('#grWalls'); ch.innerHTML = '';
  r.walls.forEach((w, i) => { const b = document.createElement('button'); b.dataset.i = i; b.innerHTML = `<i>${i + 1}</i>${Math.round(w.cm)}<small>${turnIcon(w.turn)}</small>`; if (op && op.wall === i) b.classList.add('pick');
    b.onclick = () => (P.op && P.op.step === 'wall' ? opWall(i) : editWall(i)); ch.appendChild(b); });
  (r.ops || []).forEach(o => { const b = document.createElement('button'); b.className = 'op'; b.dataset.op = o.id; const to = o.to && P.plan.rooms.find(x => x.id === o.to);
    b.innerHTML = `<i>${o.type === 'T' ? 'Tür' : 'Fe'} W${o.wall + 1}</i>${Math.round(o.w)}${to ? `<small>→ ${esc(to.name)}</small>` : ''}`; b.onclick = () => editOp(o); ch.appendChild(b); });
  if (!r.closed) ch.scrollLeft = ch.scrollWidth; draw();
}
const turnIcon = t => t == null ? '?' : Math.abs(Math.abs(t) - 90) < 0.5 ? (t > 0 ? '↱' : '↰') : (t > 0 ? '↱' : '↰') + Math.round(180 - Math.abs(t)) + '°'; // angezeigt wird der Innenwinkel der Ecke

async function addWall(cm) {
  const r = P.room; if (!r || r.closed) return;
  r.walls.push({ cm, turn: null }); A().beep(true); await save(); roomUi();
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
  if (P.thInput && document.body.contains(P.thInput)) { P.thInput.value = Math.round(cm * 10) / 10; A().beep(true); return; }
  if (P.wantRh) { if (!(cm >= 150 && cm <= 700)) { A().toast(`${Math.round(cm)} cm passt nicht als Raumhöhe (150–700)`, 3000); A().beep(false); return; } P.wantRh = false; r.rh = cm; A().beep(true); await save(); roomUi(); A().toast(`Raumhöhe ${Math.round(cm)} cm ✓`, 2000); return; }
  if (r.closed && P.op) return opValue(cm);
  if (r.closed) { if (P.wantDiag) { P.wantDiag = false; return applyDiag(cm); } A().toast('Raum ist fertig – „Wieder öffnen“, um weiterzumessen', 2600); A().beep(false); return; }
  if (P.hold) { P.hold = { cm }; A().toast('Erst links oder rechts antippen'); roomUi(); return; }
  if (pending()) { P.hold = { cm }; A().beep(true); roomUi(); return; } // Richtung wird immer getippt; der Wert wartet solange
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
  const v = await A().promptBox(P.wantRh ? 'Raumhöhe in cm' : P.wantDiag ? 'Diagonale in cm' : 'Wandlänge in cm', P.wantRh ? 'z. B. 255' : 'z. B. 412'); if (v == null) return;
  const cm = parseFloat(String(v).replace(',', '.')); if (!(cm > 0 && cm < 10000)) { A().toast('Bitte eine Länge in cm eingeben'); return; } measure(cm);
};
$('#grOpKey').onclick = async () => {
  const v = await A().promptBox(P.op && P.op.step === 'pos' ? 'Abstand von der Ecke in cm (0 = direkt an der Ecke)' : 'Breite in cm', 'z. B. 80'); if (v == null) return;
  const cm = parseFloat(String(v).replace(',', '.')); if (!(cm >= 0 && cm < 10000)) { A().toast('Bitte eine Länge in cm eingeben'); return; } opValue(cm);
};
$('#grKey2').onclick = () => $('#grKey').onclick();
$('#grUndo').onclick = $('#grUndo2').onclick = async () => {
  const r = P.room; if (P.hold) { P.hold = null; roomUi(); return; }
  if (!r.walls.length) return;
  const w = lastW(); if (w.turn != null && !r.closed) { w.turn = null; delete w.auto; } else { r.walls.pop(); if (r.ops) r.ops = r.ops.filter(o => o.wall < r.walls.length); }
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
$('#grReopen').onclick = async () => { const r = P.room; if ((r.ops || []).length && !await A().confirmBox('Raum wieder öffnen?', 'Öffnen', 'Abbrechen', 'pri', 'Türen und Fenster bleiben erhalten, solange ihre Wand bestehen bleibt.')) return; r.closed = false; P.op = null; delete r.diag; delete r.adjust; if (lastW() && lastW().calc) { r.walls.pop(); if (r.ops) r.ops = r.ops.filter(o => o.wall < r.walls.length); } await save(); roomUi(); };
$('#grRoomOk').onclick = $('#grRoomBack').onclick = () => A().goBack(false);
$('#grRoomDel').onclick = async () => { if (!await A().confirmBox(`Raum „${P.room.name}“ löschen?`, 'Löschen')) return; const gone = P.room.id; P.plan.rooms = P.plan.rooms.filter(r => r !== P.room); for (const x of P.plan.rooms) for (const o of x.ops || []) if (o.to === gone) o.to = null; P.room = null; await save(); A().goBack(false); };
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
// ---------- Stufe 2: Türen und Fenster ----------
// Ablauf: Wand antippen → Abstand von der Ecke (Beginn der Wand in Laufrichtung) → Breite → bei Türen: wohin + Wandstärke
function opStart(type) { if (!P.room.closed) return; P.op = { type, step: 'wall', wall: null }; P.wantDiag = false; P.wantRh = false; roomUi(); }
function opWall(i) { if (!P.op) return; P.op.wall = i; P.op.step = 'pos'; roomUi(); }
async function opValue(cm) {
  const r = P.room, op = P.op; if (!op) return;
  if (op.step === 'wall') { A().toast('Erst die Wand antippen'); A().beep(false); return; }
  const L = r.walls[op.wall].cm;
  if (op.step === 'pos') { if (cm >= L - 5) { A().toast(`Passt nicht: die Wand ist nur ${Math.round(L)} cm lang`, 3000); A().beep(false); return; } op.pos = cm; op.step = 'w'; A().beep(true); roomUi(); return; }
  if (!(cm > 5)) { A().toast('Breite zu klein'); A().beep(false); return; }
  if (op.pos + cm > L + 2) { A().toast(`Passt nicht: Abstand ${Math.round(op.pos)} + Breite ${Math.round(cm)} ist länger als die Wand (${Math.round(L)} cm)`, 4000); A().beep(false); return; }
  const o = { id: uid(), type: op.type, wall: op.wall, pos: op.pos, w: Math.min(cm, L - op.pos), to: null }; (r.ops = r.ops || []).push(o); P.op = null; A().beep(true); await save(); roomUi();
  if (o.type === 'T') doorTarget(o);
}
$('#grRh').onclick = () => { P.wantRh = true; P.wantDiag = false; A().toast('Raumhöhe messen (Boden → Decke) – oder ⌨', 4000); $('#grKey2').style.display = ''; };
$('#grDoor').onclick = () => opStart('T'); $('#grWin').onclick = () => opStart('F'); $('#grOpCancel').onclick = () => { P.op = null; roomUi(); };
// Tür: in welchen Raum führt sie, und wie dick ist die Wand dort (an der Laibung messen)?
function doorTarget(o) {
  const others = P.plan.rooms.filter(x => x !== P.room), def = P.plan.wall || 15;
  const bg = sheet(`<h2>Wohin führt die Tür?</h2><div class="grgrid2" data-list></div><button class="ghost" data-none style="width:100%;margin-top:8px">Nach außen / noch offen</button>
    <label class="f">Anschlag (von diesem Raum aus gesehen)</label><div class="row2"><button class="ghost" data-h="a">◧ links</button><button class="ghost" data-h="b">rechts ◨</button></div>
    <label class="f">Die Tür geht auf</label><div class="row2"><button class="ghost" data-sw="in">in diesen Raum</button><button class="ghost" data-sw="out">hinaus</button></div>
    <label class="f">Wandstärke an dieser Tür (cm)</label><div style="display:flex;gap:8px;align-items:center"><input data-th inputmode="decimal" value="${o.thick || ''}" placeholder="${def} (Standard)" style="flex:1"><span class="mute" style="font-size:13px;flex:2">An der Laibung messen – der Laserwert landet hier.</span></div>
    <button class="pri" data-ok style="width:100%;margin-top:12px">Fertig</button>`);
  P.thInput = bg.querySelector('[data-th]'); let to = o.to, hinge = o.hinge || 'a', swing = o.swing || 'in', touched = !!o.hinge;
  // Gibt es im Ziel-Raum schon das Gegenstück, ist dessen Angabe die Vorgabe (dieselbe Tür von der anderen Seite: Seite und Richtung gespiegelt)
  const fromPartner = () => { if (touched) return; const x = P.plan.rooms.find(q => q.id === to), pr = x && (x.ops || []).find(q => q.type === 'T' && q.to === P.room.id && q.hinge); if (pr) { hinge = pr.hinge === 'a' ? 'b' : 'a'; swing = pr.swing === 'out' ? 'in' : 'out'; } };
  const paint = () => { bg.querySelectorAll('[data-to]').forEach(b => b.classList.toggle('pri', b.dataset.to === to)); bg.querySelector('[data-none]').classList.toggle('pri', !to);
    bg.querySelectorAll('[data-h]').forEach(b => { b.classList.toggle('pri', b.dataset.h === hinge); b.classList.toggle('ghost', b.dataset.h !== hinge); }); bg.querySelectorAll('[data-sw]').forEach(b => { b.classList.toggle('pri', b.dataset.sw === swing); b.classList.toggle('ghost', b.dataset.sw !== swing); }); };
  bg.querySelectorAll('[data-h]').forEach(b => { b.onclick = () => { hinge = b.dataset.h; touched = true; paint(); }; }); bg.querySelectorAll('[data-sw]').forEach(b => { b.onclick = () => { swing = b.dataset.sw; touched = true; paint(); }; });
  for (const x of others) { const b = document.createElement('button'); b.className = 'ghost'; b.dataset.to = x.id; b.textContent = x.name; b.onclick = () => { to = x.id; fromPartner(); paint(); }; bg.querySelector('[data-list]').appendChild(b); }
  if (!others.length) bg.querySelector('[data-list]').innerHTML = '<p class="mute" style="margin:0 0 6px;font-size:14px">Noch kein anderer Raum angelegt – das Ziel kannst du später über die Tür unten in der Leiste setzen.</p>';
  bg.querySelector('[data-none]').onclick = () => { to = null; paint(); }; fromPartner(); paint();
  bg.querySelector('[data-ok]').onclick = async () => { const th = parseFloat(String(P.thInput.value).replace(',', '.')); o.to = to; o.hinge = hinge; o.swing = swing; if (th > 0 && th < 200) o.thick = th; else delete o.thick;
    const pr = G.partnerOf(P.plan, P.room, o); if (pr) { pr.hinge = hinge === 'a' ? 'b' : 'a'; pr.swing = swing === 'out' ? 'in' : 'out'; } // Gegenstück mitziehen, damit das Türblatt nur einmal und richtig herum erscheint
    P.thInput = null; bg.remove(); await save(); roomUi(); };
}
function editOp(o) {
  const r = P.room, kind = o.type === 'T' ? 'Tür' : 'Fenster';
  const bg = sheet(`<h2>${kind} an Wand ${o.wall + 1}</h2><p class="mute" style="margin:-4px 0 10px">Abstand von der Ecke ${Math.round(o.pos)} cm · Breite ${Math.round(o.w)} cm${o.thick ? ` · Wand ${Math.round(o.thick)} cm` : ''}</p>
    <div class="row2"><button class="ghost" data-pos>✎ Abstand</button><button class="ghost" data-w>✎ Breite</button></div>
    ${o.type === 'T' ? '<button class="ghost" data-to style="width:100%;margin-top:8px">Ziel-Raum / Wandstärke</button>' : ''}
    <button class="danger" data-del style="width:100%;margin-top:8px">Löschen</button><button class="ghost" data-close style="width:100%;margin-top:8px">Schließen</button>`);
  const num = async (title, cur) => { const v = await A().promptBox(title, '', String(Math.round(cur))); if (v == null) return null; const cm = parseFloat(String(v).replace(',', '.')); return cm >= 0 && cm < 10000 ? cm : null; };
  bg.querySelector('[data-pos]').onclick = async () => { bg.remove(); const v = await num('Abstand von der Ecke in cm', o.pos); if (v == null) return; if (v + o.w > r.walls[o.wall].cm + 2) { A().toast('Passt nicht auf die Wand'); return; } o.pos = v; await save(); roomUi(); };
  bg.querySelector('[data-w]').onclick = async () => { bg.remove(); const v = await num('Breite in cm', o.w); if (!v) return; if (o.pos + v > r.walls[o.wall].cm + 2) { A().toast('Passt nicht auf die Wand'); return; } o.w = v; await save(); roomUi(); };
  if (o.type === 'T') bg.querySelector('[data-to]').onclick = () => { bg.remove(); doorTarget(o); };
  bg.querySelector('[data-del]').onclick = async () => { bg.remove(); r.ops = r.ops.filter(x => x !== o); await save(); roomUi(); };
}
// Wand im Bild antippen (nur während „an welcher Wand?“)
$('#grCv').addEventListener('click', e => {
  if (!P.op || P.op.step !== 'wall' || !P.view) return; const b = $('#grCv').getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, pts = P.view.pts; let best = -1, bd = 44;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length], dx = c.x - a.x, dy = c.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy); if (d < bd) { bd = d; best = i; } }
  if (best >= 0) opWall(best);
});

// ---------- Stufe 2: ganze Wohnung ----------
function flatInfo() {
  const p = P.plan, res = G.placeRooms(p.rooms, p.wall || 15), name = id => (p.rooms.find(r => r.id === id) || {}).name || '?', msgs = [];
  for (const m of res.missing) msgs.push(m.why === 'offen' ? `„${name(m.to)}“ ist noch nicht fertig gemessen (Tür von „${name(m.from)}“ führt dorthin).` : `In „${name(m.to)}“ fehlt die Tür zu „${name(m.from)}“.`);
  for (const id of res.unplaced) if (!res.missing.some(m => m.to === id || m.from === id)) msgs.push(`„${name(id)}“ hängt noch an keiner Tür.`);
  for (const i of res.issues) msgs.push(`Zwischen „${name(i.a)}“ und „${name(i.b)}“ geht es nicht auf: ${Math.round(i.off)} cm Versatz – eine Türposition, Wandlänge oder Wandstärke stimmt nicht.`);
  return { res, msgs };
}
// ---------- Plan-Darstellung (3.15): Wände mit Stärke, Symbole, Maßketten ----------
const bboxOf = pts => pts.reduce((b, q) => ({ x0: Math.min(b.x0, q.x), y0: Math.min(b.y0, q.y), x1: Math.max(b.x1, q.x), y1: Math.max(b.y1, q.y) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
function gfxBand(g, gf, X, Y, color) {   // Wand als gefüllter Ring zwischen Innenkante und Außenkante
  g.beginPath(); gf.band.forEach((q, i) => i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))); g.closePath();
  [...gf.inner].reverse().forEach((q, i) => i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))); g.closePath(); g.fillStyle = color; g.fill('evenodd');
}
function gfxRest(g, gf, X, Y, st) {      // Raumfläche, Öffnungen mit Symbolen, Maßketten
  const path = pl => { g.beginPath(); pl.forEach((q, i) => i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))); g.closePath(); }, ln = (p, q) => { g.beginPath(); g.moveTo(X(p), Y(p)); g.lineTo(X(q), Y(q)); g.stroke(); };
  path(gf.inner); g.fillStyle = st.fill; g.fill();
  for (const c of gf.cuts) { path(c); g.fillStyle = st.cut; g.fill(); }
  g.lineCap = 'butt'; g.lineJoin = 'miter';
  for (const w of gf.wins) { path(w.rect); g.fillStyle = st.panel; g.fill(); g.strokeStyle = st.win; g.lineWidth = 1.4; g.stroke(); ln(w.glass[0], w.glass[1]); }
  for (const d of gf.doors) {
    g.strokeStyle = st.door; g.lineWidth = 2; for (const j of d.jambs) ln(j[0], j[1]);
    if (d.leaf) { g.lineWidth = 2.4; ln(d.leaf[0], d.leaf[1]); const c = { x: X(d.arc.c), y: Y(d.arc.c) }, f = { x: X(d.arc.from), y: Y(d.arc.from) }, t = { x: X(d.arc.to), y: Y(d.arc.to) }, a0 = Math.atan2(f.y - c.y, f.x - c.x), a1 = Math.atan2(t.y - c.y, t.x - c.x);
      g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.arc(c.x, c.y, Math.hypot(f.x - c.x, f.y - c.y), a0, a1, G.norm180((a1 - a0) * 180 / Math.PI) < 0); g.stroke(); g.setLineDash([]); }
  }
  if (gf.chains.length) { g.strokeStyle = st.dim; g.fillStyle = st.dim; g.lineWidth = 1; g.font = `600 12px ${st.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const ch of gf.chains) { ln(ch.line[0], ch.line[1]); for (const t of ch.ticks) ln(t[0], t[1]);
      for (const l of ch.labels) { let a = Math.atan2(l.d.y, l.d.x); if (a > Math.PI / 2 - 0.01 || a < -Math.PI / 2 - 0.01) a += Math.PI; g.save(); g.translate(X(l.p), Y(l.p)); g.rotate(a); g.fillText(l.t, 0, 0); g.restore(); } } }
}
function northArrow(g, x, y, deg, col, mono) {  // deg: wohin Norden im Bild zeigt (0 = oben, im Uhrzeigersinn)
  g.save(); g.translate(x, y); g.rotate(deg * Math.PI / 180); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.5;
  g.beginPath(); g.arc(0, 0, 17, 0, 7); g.stroke(); g.beginPath(); g.moveTo(0, -15); g.lineTo(6, 8); g.lineTo(0, 3); g.lineTo(-6, 8); g.closePath(); g.fill();
  g.font = `700 11px ${mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', 0, -26); g.restore();
}
// Zeichnet alle fertigen Räume: verbundene an ihrem Platz, die übrigen daneben (heller)
function drawFlat(cv, big) {
  const p = P.plan; if (!p || !cv) return; const box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(50, box.width), H = Math.max(50, box.height); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const lay = G.layout(p.rooms, p.wall || 15); if (!lay.items.length) return;
  const gfs = lay.items.map(it => ({ it, gf: G.gfx(p, it.room, it.poly, { chains: false }) })), bb = bboxOf(gfs.flatMap(x => x.gf.ext));
  const pad = big ? 30 : 8, sc = Math.min((W - 2 * pad) / Math.max(1, bb.x1 - bb.x0), (H - 2 * pad) / Math.max(1, bb.y1 - bb.y0)), ox = (W - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy = (H - (bb.y1 - bb.y0) * sc) / 2 - bb.y0 * sc;
  const X = q => ox + q.x * sc, Y = q => oy + q.y * sc, css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || '#888', mono = css.getPropertyValue('--mono') || 'monospace', display = css.getPropertyValue('--display') || 'sans-serif';
  for (const x of gfs) gfxBand(g, x.gf, X, Y, x.it.loose ? col('--mute') : col('--text'));
  for (const x of gfs) gfxRest(g, x.gf, X, Y, { fill: col('--acc-soft'), cut: col('--bg'), panel: col('--panel'), win: col('--acc'), door: col('--warn'), dim: col('--mute'), mono });
  for (const { it } of gfs) { const pl = it.poly, n = pl.length, c = pl.reduce((s, q) => ({ x: s.x + X(q) / n, y: s.y + Y(q) / n }), { x: 0, y: 0 }), wpx = (Math.max(...pl.map(q => q.x)) - Math.min(...pl.map(q => q.x))) * sc;
    const fs = Math.min(big ? 15 : 10, (wpx - 8) / Math.max(3, it.room.name.length * 0.6)); if (fs < 6) continue; g.fillStyle = col('--text'); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (big && fs > 10) stamp(g, it.room, c.x, c.y, { ink: col('--text'), mute: col('--mute'), display, mono, size: fs, name: true, maxW: wpx - 6 }); else { g.font = `700 ${fs}px ${display}`; g.fillText(it.room.name, c.x, c.y); } }
  if (big && p.north != null) northArrow(g, W - 38, 46, p.north, col('--text'), mono);
}
// Raumstempel in der Raummitte: (Name) · Fläche · Umfang · Raumhöhe. Zu breite Zeilen werden kleiner gesetzt, unter 8 px entfallen sie.
function stamp(g, r, x, y, o) {
  const s = roomSum(r), raw = []; if (o.name) raw.push([r.name, 700, o.size, o.display, o.ink]);
  raw.push([fmtA(s.area), o.name ? 600 : 700, o.name ? Math.max(11, o.size * 0.8) : o.size, o.name ? o.mono : o.display, o.ink]);
  raw.push([`U ${fmtM(s.perimeter)}${r.rh ? ` · Rh ${fmtM(r.rh)}` : ''}`, 400, Math.max(10, o.size * 0.6), o.mono, o.mute]);
  const lines = [];
  for (const [t, wgt, size, fam, c] of raw) { let fs = size; g.font = `${wgt} ${fs}px ${fam}`; const w = g.measureText(t).width; if (o.maxW && w > o.maxW) fs = fs * o.maxW / w; if (fs < 8) continue; lines.push([t, `${wgt} ${fs}px ${fam}`, c, fs * 1.3]); }
  let yy = y - lines.reduce((t, l) => t + l[3], 0) / 2; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [t, f, c, h] of lines) { g.font = f; g.fillStyle = c; g.fillText(t, x, yy + h / 2); yy += h; }
}
function flatUi() {
  const { res, msgs } = flatInfo(), p = P.plan, n = p.rooms.filter(r => r.closed).length;
  $('#grFlatTitle').textContent = p.name || 'Wohnung';
  $('#grFlatSum').textContent = `${res.T.size} von ${n} fertigen Räumen verbunden · ${fmtA(planArea(p))} · Wände innen ${p.wall || 15} / außen ${p.wallOut || 30} cm`;
  const el = $('#grFlatMsgs'); el.innerHTML = '';
  if (!msgs.length && n > 1) el.innerHTML = '<p class="grok">✓ Alle Räume hängen zusammen und es geht auf.</p>';
  for (const m of msgs) { const d = document.createElement('p'); d.className = 'grwarn'; d.textContent = '⚠ ' + m; el.appendChild(d); }
  drawFlat($('#grFlatCv'), true);
}
$('#grFlatCard').onclick = () => { A().show('planFlat'); A().keepAwake(true); flatUi(); };
$('#grFlatBack').onclick = () => A().goBack(false);
// Nordpfeil: wohin zeigt Norden im Bild?
$('#grNorth').onclick = () => {
  const dirs = [[315, '↖'], [0, '↑'], [45, '↗'], [270, '←'], [null, '✕'], [90, '→'], [225, '↙'], [180, '↓'], [135, '↘']];
  const bg = sheet('<h2>Wohin zeigt Norden im Bild?</h2><p class="mute" style="margin:-4px 0 10px;font-size:14px">Pfeil antippen. ✕ = kein Nordpfeil.</p><div class="grcompass" data-c></div><button class="ghost" data-close style="width:100%;margin-top:10px">Schließen</button>');
  for (const [d, t] of dirs) { const b = document.createElement('button'); b.className = (P.plan.north == null ? d == null : P.plan.north === d) ? 'pri' : 'ghost'; b.textContent = t; b.dataset.n = d == null ? '' : d; b.onclick = async () => { if (d == null) delete P.plan.north; else P.plan.north = d; await save(); bg.remove(); flatUi(); }; bg.querySelector('[data-c]').appendChild(b); }
};
$('#grWallOut').addEventListener('input', () => { if (!P.plan) return; const v = parseFloat($('#grWallOut').value.replace(',', '.')); if (v > 0 && v < 200) P.plan.wallOut = v; else delete P.plan.wallOut; save(); renderPlan(); });
$('#grWall').addEventListener('input', () => { if (!P.plan) return; const v = parseFloat($('#grWall').value.replace(',', '.')); if (v > 0 && v < 200) P.plan.wall = v; else delete P.plan.wall; save(); renderPlan(); });

// ---------- Stufe 3: PDF + DXF, Dropbox ----------
let fontBytes = null;
async function planFiles() {
  if (!fontBytes) fontBytes = new Uint8Array(await (await fetch('vendor/NotoSans.woff')).arrayBuffer());
  const base = O.fileBase(P.plan), pdf = await O.buildPlanPdf(window.PDFLib, window.fontkit, fontBytes, P.plan, flatInfo().msgs), dxf = O.buildDxf(P.plan);
  return { pdf: new File([pdf], base + '.pdf', { type: 'application/pdf' }), dxf: new File([dxf.text], base + '.dxf', { type: 'application/dxf' }) };
}
const planSub = () => 'Grundrisse' + ((P.plan.kunde || '').trim() ? '/' + P.plan.kunde.trim().replace(/[\\/:*?"<>|]+/g, ' ') : '');
function saveLocal(file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
async function shareFiles(files) {
  try { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title: files[0].name }); return true; } } catch (e) { if (e && e.name === 'AbortError') return true; }
  return false;
}
$('#grExport').onclick = async () => {
  const p = P.plan, n = p.rooms.filter(r => r.closed).length;
  if (!n) { A().toast('Erst mindestens einen Raum fertig messen'); return; }
  const open = p.rooms.length - n, dbx = A().dropbox.connected;
  const bg = sheet(`<h2>Grundriss ausgeben</h2><p class="mute" style="margin:-4px 0 10px;font-size:14px">${n} ${n === 1 ? 'Raum' : 'Räume'} fertig${open ? ` · ${open} noch offen (${open === 1 ? 'fehlt' : 'fehlen'} in der Ausgabe)` : ''} · PDF maßstäblich, DXF in cm für BricsCAD</p>
    <button class="pri" data-dbx style="width:100%">☁ PDF + DXF in die Dropbox</button><p class="mute" data-where style="margin:4px 0 10px;font-size:13px"></p>
    <div class="row2"><button class="ghost" data-pdf>PDF speichern</button><button class="ghost" data-dxf>DXF speichern</button></div>
    <button class="ghost" data-share style="width:100%;margin-top:8px">Teilen …</button><button class="ghost" data-close style="width:100%;margin-top:8px">Schließen</button>`);
  bg.querySelector('[data-where]').textContent = dbx ? 'Ordner: ' + A().dropbox.pathFor(planSub()) : 'Dropbox ist nicht verbunden (⚙ → Dropbox).';
  bg.querySelector('[data-dbx]').disabled = !dbx;
  const make = async () => { A().toast('Grundriss wird erstellt …', 8000); return planFiles(); };
  bg.querySelector('[data-pdf]').onclick = async () => { const f = await make(); saveLocal(f.pdf); A().toast('PDF gespeichert: ' + f.pdf.name, 3000); };
  bg.querySelector('[data-dxf]').onclick = async () => { const f = await make(); saveLocal(f.dxf); A().toast('DXF gespeichert: ' + f.dxf.name, 3000); };
  bg.querySelector('[data-share]').onclick = async () => { const f = await make(); if (!await shareFiles([f.pdf, f.dxf])) { saveLocal(f.pdf); saveLocal(f.dxf); A().toast('Teilen geht hier nicht – beide Dateien wurden gespeichert', 3500); } };
  bg.querySelector('[data-dbx]').onclick = async () => {
    const bt = bg.querySelector('[data-dbx]'); bt.disabled = true; bt.textContent = 'Wird hochgeladen …';
    try {
      const f = await planFiles(), sub = planSub();
      if (!navigator.onLine) { await A().queueAdd(f.pdf, sub); await A().queueAdd(f.dxf, sub); p.exports = [...(p.exports || []), { t: Date.now(), how: 'wartet auf Netz' }]; await save(); bg.remove(); A().toast('Kein Netz – PDF und DXF werden hochgeladen, sobald wieder Netz da ist', 4500); renderPlan(); return; }
      const a = await A().dbxUpload(f.pdf, sub), b = await A().dbxUpload(f.dxf, sub);
      p.exports = [...(p.exports || []), { t: Date.now(), how: 'in Dropbox', path: a.path, dxf: b.path }].slice(-20); await save(); bg.remove(); A().beep(true); A().toast('In Dropbox: ' + a.path.split('/').slice(-3).join('/') + ' + DXF', 5000); renderPlan();
    } catch (e) { bt.disabled = false; bt.textContent = '☁ PDF + DXF in die Dropbox'; A().toast('Hochladen fehlgeschlagen: ' + e.message, 6000); }
  };
};

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

// ---------- Zeichnung ----------
// Fertiger Raum: Wände mit Stärke, Tür-/Fenstersymbole, Maßketten, Raumstempel
function drawClosed(g, r, pts, W, H, col, css) {
  const mono = css.getPropertyValue('--mono') || 'monospace', n = pts.length, pad = 14; let u = 1, gf, bb, sc = 1;
  for (let pass = 0; pass < 3; pass++) { gf = G.gfx(P.plan, r, pts, { chains: true, allLeaf: true, u }); bb = bboxOf(gf.ext); sc = Math.min((W - 2 * pad) / Math.max(1, bb.x1 - bb.x0), (H - 2 * pad) / Math.max(1, bb.y1 - bb.y0)); u = 1 / sc; } // Abstände der Maßketten hängen vom Maßstab ab
  const ox = (W - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy = (H - (bb.y1 - bb.y0) * sc) / 2 - bb.y0 * sc, X = p => ox + p.x * sc, Y = p => oy + p.y * sc;
  P.view = { sc, pts: pts.map(p => ({ x: X(p), y: Y(p) })) };
  gfxBand(g, gf, X, Y, col('--text'));
  gfxRest(g, gf, X, Y, { fill: col('--acc-soft'), cut: col('--bg'), panel: col('--panel'), win: col('--acc'), door: col('--warn'), dim: col('--text'), mono });
  if (P.op && P.op.wall != null) { const a = pts[P.op.wall], b = pts[(P.op.wall + 1) % n]; g.strokeStyle = col('--warn'); g.lineWidth = 6; g.beginPath(); g.moveTo(X(a), Y(a)); g.lineTo(X(b), Y(b)); g.stroke(); g.fillStyle = col('--warn'); g.beginPath(); g.arc(X(a), Y(a), 9, 0, 7); g.fill(); }
  g.fillStyle = col('--acc'); g.beginPath(); g.arc(X(pts[0]), Y(pts[0]), 6, 0, 7); g.fill();
  const c = pts.reduce((s, p) => ({ x: s.x + X(p) / n, y: s.y + Y(p) / n }), { x: 0, y: 0 }), wpx = (Math.max(...pts.map(q => q.x)) - Math.min(...pts.map(q => q.x))) * sc;
  stamp(g, r, c.x, c.y, { ink: col('--text'), mute: col('--mute'), display: css.getPropertyValue('--display') || 'sans-serif', mono, size: Math.min(20, wpx / 8), maxW: wpx - 10 });
}
function draw() {
  const cv = $('#grCv'), r = P.room; if (!cv || !r) return;
  const box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(50, box.width), H = Math.max(50, box.height); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || '#888';
  const ink = col('--text'), acc = col('--acc'), mute = col('--mute'), red = col('--red'), green = col('--green'), mono = css.getPropertyValue('--mono') || 'monospace';
  const w = r.walls; if (!w.length) { g.fillStyle = mute; g.font = `15px ${mono}`; g.textAlign = 'center'; g.fillText('Hier entsteht der Raum.', W / 2, H / 2); return; }
  const tr = G.trace(w); let pts = r.closed ? [...G.closedPoly(w)] : tr.pts;
  if (r.closed) return drawClosed(g, r, pts, W, H, col, css);
  const all = r.closed ? pts : [...pts];
  // Vorschau-Stummel für links/rechts mit einrechnen, damit nichts aus dem Bild läuft
  const end = tr.pts[tr.pts.length - 1], hd = tr.heading * Math.PI / 180;
  const stub = Math.max(60, Math.min(...w.map(x => x.cm)) * 0.5);
  const opts = pending() ? [-90, 90].map(t => { const a = (tr.heading + t) * Math.PI / 180; return { t, x: end.x + stub * Math.cos(a), y: end.y + stub * Math.sin(a) }; }) : [];
  const tips = []; if (r.closed) for (let i = 0; i < w.length; i++) { const wp = G.wallParts(r, pts, i); for (const p of wp.parts) if (p.kind === 'T') tips.push(G.doorSym(p, wp.n, p.op).tip); } // Türblätter sollen ins Bild passen
  const bb = [...all, ...opts, ...tips].reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: 0, y0: 0, x1: 0, y1: 0 });
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
    let mxw = (a.x + b.x) / 2, myw = (a.y + b.y) / 2; if (r.closed && (r.ops || []).some(o => o.wall === i)) { const an = G.dimAnchor(G.wallParts(r, pts, i)); mxw = an.x; myw = an.y; } // nicht über eine Öffnung schreiben
    const mx = X({ x: mxw, y: myw }), my = Y({ x: mxw, y: myw }), dx = X(b) - X(a), dy = Y(b) - Y(a), L = Math.hypot(dx, dy) || 1;
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
    stamp(g, r, c.x, c.y, { ink, mute, display: css.getPropertyValue('--display') || 'sans-serif', mono, size: 20 });
  }
}
window.addEventListener('resize', () => { if ($('#planRoom').classList.contains('on')) draw(); if ($('#planFlat').classList.contains('on')) drawFlat($('#grFlatCv'), true); });

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
    if (cur === 'planFlat') { renderPlan(); A().show('plan', viaPop); A().keepAwake(true); return true; }
    if (cur === 'planRoom') { P.room = null; P.hold = null; P.op = null; P.thInput = null; P.wantDiag = false; P.wantRh = false; P.remeasure = null; renderPlan(); A().show('plan', viaPop); A().keepAwake(true); return true; }
    if (cur === 'plan') { P.plan = null; A().show('home', viaPop); setTab('gr'); return true; }
    return false;
  },
  state: P, store, setTab, G, O,
};
