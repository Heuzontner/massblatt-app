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

const P = { plan: null, room: null, hold: null, fv: { z: 1, x: 0, y: 0 } };
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

let showArch = false;
async function renderList() {
  const el = $('#grList'), q = ($('#grSearch').value || '').trim().toLowerCase(), every = (await store.all()).sort((a, b) => (b.updated || 0) - (a.updated || 0)), nArch = every.filter(p => p.archived).length;
  if (!nArch) showArch = false; $('#grArch').style.display = nArch ? '' : 'none'; $('#grArch').textContent = showArch ? '‹ Aktive Grundrisse' : `📦 Archiv (${nArch})`;
  const all = every.filter(p => !!p.archived === showArch && (!q || [p.name, p.kunde, p.plz, p.ortName].some(v => String(v || '').toLowerCase().includes(q)))); el.innerHTML = '';
  const evs = showArch ? [] : await A().planEvents().catch(() => []), open = evs.filter(e => !every.some(p => p.gcalId === e.id)); $('#grCal').style.display = open.length ? '' : 'none'; $('#grCal').textContent = `📅 Termine heute (${open.length})`; $('#grCal').onclick = () => calSheet(open);
  if (!all.length) { el.innerHTML = `<p class="mute" style="text-align:center;margin:40px 12px">${q ? 'Nichts gefunden.' : showArch ? 'Das Archiv ist leer.' : 'Noch kein Grundriss.<br>Unten auf „+ Neuer Grundriss“ tippen, dann Raum für Raum mit dem Laser ablaufen.'}</p>`; return; }
  for (const p of all) {
    const c = document.createElement('div'); c.className = 'card'; const n = (p.rooms || []).length, done = (p.rooms || []).filter(r => r.closed).length;
    c.innerHTML = `<div class="t"><b>${esc(p.name || 'Ohne Adresse')}</b><small>${esc([p.kunde, [p.plz, p.ortName].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}${p.kunde || p.plz ? ' · ' : ''}${n} ${n === 1 ? 'Raum' : 'Räume'}${n ? ` (${done} fertig)` : ''}${planArea(p) ? ' · ' + fmtA(planArea(p)) : ''}</small></div><span class="mute">›</span>`;
    c.onclick = () => openPlan(p.id); el.appendChild(c);
  }
}
$('#grSearch').addEventListener('input', renderList); $('#grArch').onclick = () => { showArch = !showArch; renderList(); };
function calSheet(evs) {
  const bg = sheet('<h2>Grundriss aus Termin</h2><div data-list></div><button class="ghost" data-close style="width:100%;margin-top:8px">Abbrechen</button>');
  for (const e of evs) { const b = document.createElement('button'); b.className = 'ghost grpick'; const t = new Date(e.start); b.innerHTML = `<b>${esc(e.name)}</b><small>${isNaN(t) ? '' : t.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) + ' · '}${esc([e.kunde, [e.plz, e.ortName].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</small>`;
    b.onclick = async () => { bg.remove(); const p = { id: uid(), name: e.name, plz: e.plz, ortName: e.ortName, kunde: e.kunde, gcalId: e.id, rooms: [], created: Date.now(), updated: Date.now() }; await store.put(p); openPlan(p.id); }; bg.querySelector('[data-list]').appendChild(b); }
}

// ---------- Grundriss-Projekt ----------
$('#grNew').onclick = async () => {
  const p = { id: uid(), name: '', plz: '', ortName: '', kunde: '', rooms: [], created: Date.now(), updated: Date.now() };
  await store.put(p); await openPlan(p.id);
};
async function openPlan(id) {
  P.plan = await store.get(id); if (!P.plan) return; P.room = null;
  $('#grStr').value = P.plan.name || ''; $('#grPlz').value = P.plan.plz || ''; $('#grOrt').value = P.plan.ortName || ''; $('#grKunde').value = P.plan.kunde || ''; $('#grWall').value = P.plan.wall || ''; $('#grWallOut').value = P.plan.wallOut || '';
  $('#grArchive').textContent = P.plan.archived ? '📤 Aus dem Archiv holen' : '📦 Archivieren';
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
  if (nd) { const { res, msgs } = flatInfo(); $('#grFlatHint').textContent = nd < 2 ? 'Wohnung ansehen' : msgs.length ? `Wohnung ansehen · ${msgs.length} ${msgs.length === 1 ? 'Hinweis' : 'Hinweise'}` : `Wohnung ansehen · ${res.main} Räume verbunden ✓`; requestAnimationFrame(() => drawFlat($('#grFlatMini'), false)); }
  const tot = planArea(p), ex = (p.exports || []).slice(-1)[0]; $('#grTotal').textContent = (tot ? `Gesamt: ${fmtA(tot)} (${p.rooms.filter(r => r.closed).length} von ${p.rooms.length} Räumen fertig)` : '') + (ex ? ` · zuletzt ${ex.how} ${new Date(ex.t).toLocaleDateString('de-AT')}` : '');
  $('#grExport').disabled = !nd;
}
for (const [id, key] of [['grStr', 'name'], ['grPlz', 'plz'], ['grOrt', 'ortName'], ['grKunde', 'kunde']]) $('#' + id).addEventListener('input', () => { if (!P.plan) return; P.plan[key] = $('#' + id).value.trim(); if (key === 'name') $('#grTitle').textContent = P.plan.name || 'Neuer Grundriss'; save(); });
$('#grBack').onclick = () => A().goBack(false);
$('#grArchive').onclick = async () => { if (!P.plan) return; P.plan.archived = !P.plan.archived; await save(); A().toast(P.plan.archived ? 'Ins Archiv verschoben' : 'Wieder aktiv', 2000); A().goBack(false); };
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
      $('#grStr').value = P.plan.name; $('#grPlz').value = P.plan.plz; $('#grOrt').value = P.plan.ortName; $('#grKunde').value = P.plan.kunde; save(); renderPlan(); bg.remove(); A().toast('Adresse und Kunde übernommen');
      (async () => { // dieselben Räume wie im Massblatt als leere Räume anlegen (nur Namen, reine Kopie)
        const shots = await A().shotsOf(p.id).catch(() => []), names = await A().rooms(), ks = [...new Set(shots.map(x => x.room).filter(k => k && k !== 'Rh'))]; if (!ks.length) return;
        const want = ks.map(k => { const hit = names.find(([kk]) => kk === k); return hit && hit[1] ? hit[1] : k; }).filter(nm => !P.plan.rooms.some(r => r.name === nm)); if (!want.length) return;
        if (!await A().confirmBox(`Auch die ${want.length} ${want.length === 1 ? 'Raum' : 'Räume'} anlegen?`, 'Anlegen', 'Nein', 'pri', want.join(', '))) return;
        for (const nm of want) P.plan.rooms.push({ id: uid(), name: nm, walls: [], closed: false }); await save(); renderPlan(); })(); };
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

// Laserwert in das aktive Zahlenfeld eines offenen Dialogs; danach springt die Eingabe zum nächsten leeren Feld
function fillInput(cm) {
  const el = P.thInput; if (!el || !document.body.contains(el)) return false;
  el.value = Math.round(cm * 10) / 10; el.dispatchEvent(new Event('input')); A().beep(true);
  const nx = [...el.closest('.sheet').querySelectorAll('input[data-num]')].find(i => !i.value); if (nx) { P.thInput = nx; markInput(); }
  return true;
}
function markInput() { document.querySelectorAll('input[data-num]').forEach(i => i.classList.toggle('gract', i === P.thInput)); }
// Dialog mit Auswahlfeldern und Zahlenfeldern; gibt die Werte zurück (Zahlen in cm) oder null
function formSheet(title, hint, rows, okText = 'Fertig') {
  return new Promise(res => {
    const bg = sheet(`<h2>${esc(title)}</h2>${hint ? `<p class="mute" style="margin:-4px 0 8px;font-size:14px">${esc(hint)}</p>` : ''}<div data-rows></div><div class="row2" style="margin-top:12px"><button class="ghost" data-no>Abbrechen</button><button class="pri" data-ok>${esc(okText)}</button></div>`), box = bg.querySelector('[data-rows]');
    for (const r of rows) { const l = document.createElement('label'); l.className = 'f'; l.textContent = r.label; box.appendChild(l);
      if (r.type === 'sel') { const e = document.createElement('select'); e.dataset.k = r.k; for (const [v, t] of r.opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; e.appendChild(o); } if (r.val != null) e.value = r.val; if (r.onchange) e.onchange = () => r.onchange(e.value, bg); box.appendChild(e); }
      else { const e = document.createElement('input'); e.dataset.k = r.k; e.dataset.num = '1'; e.inputMode = 'decimal'; e.autocomplete = 'off'; if (r.val != null && r.val !== '') e.value = r.val; e.placeholder = r.ph || ''; e.onfocus = () => { P.thInput = e; markInput(); }; box.appendChild(e); } }
    P.thInput = [...box.querySelectorAll('input[data-num]')].find(i => !i.value) || null; markInput();
    const done = v => { P.thInput = null; bg.remove(); res(v); };
    bg.querySelector('[data-no]').onclick = e => { e.stopPropagation(); done(null); };
    bg.addEventListener('click', e => { if (e.target === bg) { P.thInput = null; res(null); } });
    bg.querySelector('[data-ok]').onclick = e => { e.stopPropagation(); const v = {}; box.querySelectorAll('[data-k]').forEach(el => { v[el.dataset.k] = el.dataset.num ? parseFloat(String(el.value).replace(',', '.')) : el.value; }); done(v); };
  });
}
const wallOpts = r => r.walls.map((w, i) => [i, `Wand ${i + 1} (${Math.round(w.cm)} cm)`]);

// ---------- Raum ablaufen ----------
function openRoom(id) {
  P.room = P.plan.rooms.find(r => r.id === id); if (!P.room) return; P.trash = []; P.hold = null; P.op = null; P.rect = null; P.fan = null;
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
  if (P.rect) { txt = P.rect.a ? 'Rechteck: zweite Seite messen' : 'Rechteck: erste Seite messen'; sub = P.rect.a ? `Erste Seite ${Math.round(P.rect.a)} cm ✓ – jetzt die Wand daneben (oder ⌨).` : 'Zwei Wände messen, die an einer Ecke zusammenstoßen (oder ⌨).'; }
  else if (P.fan) { txt = `Diagonale ${P.fan.k - 1} von ${n - 3} messen`; sub = `Vom Startpunkt (●) zur Ecke nach Wand ${P.fan.k} – im Bild gestrichelt (oder ⌨).`; }
  else if (op && op.step === 'wall') { txt = `${kind}: an welcher Wand?`; sub = 'Wand im Bild oder unten in der Leiste antippen.'; }
  else if (op && op.step === 'pos') { txt = `${kind} an Wand ${op.wall + 1}: Abstand von der Ecke`; sub = `Vom orangen Punkt bis zur ersten Kante der ${kind === 'Tür' ? 'Tür' : 'Fensteröffnung'} messen (oder ⌨). Wand: ${Math.round(r.walls[op.wall].cm)} cm.`; }
  else if (op && op.step === 'w') { txt = `${kind} an Wand ${op.wall + 1}: Breite`; sub = `Abstand ${Math.round(op.pos)} cm ✓ – jetzt die Breite messen (oder ⌨).`; }
  else if (r.closed) { txt = `✓ Raum fertig · ${fmtA(s.area)}`; sub = `${n} Wände · Umfang ${fmtM(s.perimeter)}${r.adjust ? ` · ${Math.round(r.adjust)} cm ausgeglichen` : ''}`; }
  else if (P.hold) { txt = 'Wohin ging es vor dieser Wand?'; sub = `${Math.round(P.hold.cm)} cm gemessen – links oder rechts antippen`; }
  else if (!n) { txt = 'Erste Wand messen'; sub = 'In einer Ecke beginnen und im Uhrzeigersinn Wand für Wand messen.'; }
  else if (pending()) { txt = `Wand ${n}: ${Math.round(lastW().cm)} cm · Wohin geht es weiter?`; sub = 'Links oder rechts antippen.'; }
  else { txt = `Wand ${n + 1} messen`; sub = n >= 2 ? (s.gap < 5 ? 'Der Raum geht auf – „✓ Raum fertig“ antippen.' : `Bis zum Anfang fehlen noch ${Math.round(s.gap)} cm.`) : ''; }
  $('#grInfo').textContent = txt; $('#grSub').textContent = sub; extraUi();
  const turnMode = !r.closed && (pending() || !!P.hold);
  $('#grTurnBar').style.display = turnMode ? 'flex' : 'none'; $('#grMeasBar').style.display = !r.closed && !turnMode ? 'flex' : 'none';
  $('#grDoneBar').style.display = r.closed && !op ? 'flex' : 'none'; $('#grMini').style.display = r.closed && !op ? 'flex' : 'none'; $('#grOpBar').style.display = op ? 'flex' : 'none';
  $('#grOpKey').style.display = op && op.step !== 'wall' ? '' : 'none';
  const hb = $('#grHints'); hb.innerHTML = ''; if (op && op.step === 'w' && (P.hints || []).length) for (const v of P.hints) { const b = document.createElement('button'); b.className = 'ghost'; b.dataset.hint = v; b.textContent = `${v} cm`; b.title = 'aus dem Massblatt'; b.onclick = () => opValue(v); hb.appendChild(b); }
  $('#grUndo').disabled = !n; $('#grClose').disabled = n < 2; $('#grRect').style.display = !n && !P.rect ? '' : 'none';
  $('#grUndo').textContent = n && lastW().turn != null ? '↶ Richtung ändern' : '↶ zurück'; $('#grUndo2').textContent = P.hold ? '↶ Wert weg' : '↶ Wand weg';
  if ((P.trash || []).length && P.trash[P.trash.length - 1].after !== sig(r)) P.trash = []; // seither etwas anderes geändert → Wiederholen verfällt
  document.querySelectorAll('.grRedo').forEach(b => { b.style.display = (P.trash || []).length && !op ? '' : 'none'; });
  $('#grRh').textContent = r.rh ? `Rh ${Math.round(r.rh)} cm` : '＋ Raumhöhe';
  $('#grDiag').style.display = r.closed && n >= 4 ? '' : 'none'; $('#grDiag').textContent = r.diag ? `Diagonale ${Math.round(r.diag)} cm` : r.diags ? 'Diagonalen ✓' : n > 4 ? '＋ Diagonalen' : '＋ Diagonale';
  // Wand-Leiste
  const ch = $('#grWalls'); ch.innerHTML = '';
  r.walls.forEach((w, i) => { const b = document.createElement('button'); b.dataset.i = i; b.innerHTML = `<i>${i + 1}</i>${Math.round(w.cm)}<small>${turnIcon(w.turn)}</small>`; if (op && op.wall === i) b.classList.add('pick');
    b.onclick = () => (P.op && P.op.step === 'wall' ? opWall(i) : editWall(i)); ch.appendChild(b); });
  (r.ops || []).forEach(o => { const b = document.createElement('button'); b.className = 'op'; b.dataset.op = o.id; const to = o.to && P.plan.rooms.find(x => x.id === o.to);
    b.innerHTML = `<i>${o.type === 'T' ? 'Tür' : 'Fe'} W${o.wall + 1}</i>${Math.round(o.w)}${to ? `<small>→ ${esc(to.name)}</small>` : ''}`; b.onclick = () => editOp(o); ch.appendChild(b); });
  (r.objs || []).forEach(o => { const b = document.createElement('button'); b.className = 'op'; b.dataset.obj = o.id; b.innerHTML = `<i>W${o.wall + 1}</i>${esc(G.OBJ[o.kind][0])}`; b.onclick = () => objEdit(o); ch.appendChild(b); });
  (r.links || []).forEach(l => { const to = P.plan.rooms.find(x => x.id === l.to); const b = document.createElement('button'); b.className = 'op'; b.dataset.link = l.id; b.innerHTML = `<i>W${l.wall + 1}</i>↔ ${esc(to ? to.name : '?')}`; b.onclick = async () => { if (await A().confirmBox('Verbindung Wand an Wand löschen?', 'Löschen')) { r.links = r.links.filter(x => x !== l); await save(); roomUi(); } }; ch.appendChild(b); });
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
  if (fillInput(cm)) return;
  if (wizOn()) { P.wiz.value(cm); return; }
  if (P.rect) return rectValue(cm);
  if (P.fan) return fanValue(cm);
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
// ---------- Wände löschen, zurück und wiederholen (Manuel 16.11.) ----------
// Vor jedem Löschen wird der Raum gemerkt (nur solange der Raum offen ist, nicht gespeichert). „↷“ holt den letzten Stand zurück –
// aber nur, solange seither nichts anderes geändert wurde (Vergleich über sig), sonst würde es neue Arbeit überschreiben.
const KEEP = ['walls', 'closed', 'diag', 'diags', 'adjust', 'ops', 'objs', 'links'];
const clone = v => JSON.parse(JSON.stringify(v));
const sig = r => JSON.stringify(KEEP.map(k => r[k] ?? null));
function snap() {
  const r = P.room, o = { room: {}, others: {}, checks: P.plan.checks ? clone(P.plan.checks) : null };
  for (const k of KEEP) if (r[k] !== undefined) o.room[k] = clone(r[k]);
  for (const x of P.plan.rooms) if (x !== r && (x.links || []).some(l => l.to === r.id)) o.others[x.id] = clone(x.links);
  return o;
}
function pushTrash(o) { (P.trash = P.trash || []).push(o); if (P.trash.length > 30) P.trash.shift(); o.after = sig(P.room); }
// Wand i entfernen: was an ihr hängt, geht mit; alles an späteren Wänden rückt eine Nummer vor. Der Raum ist danach wieder offen.
function cutWall(i) {
  const r = P.room, fix = (list, key = 'wall') => (list || []).filter(o => o[key] !== i).map(o => (o[key] > i && o[key]--, o));
  r.walls.splice(i, 1);
  if (r.ops) r.ops = fix(r.ops); if (r.objs) r.objs = fix(r.objs); if (r.links) r.links = fix(r.links);
  for (const x of P.plan.rooms) if (x !== r && x.links) x.links = x.links.filter(l => !(l.to === r.id && l.toWall === i)).map(l => (l.to === r.id && l.toWall > i && l.toWall--, l));
  if (P.plan.checks) { P.plan.checks = P.plan.checks.filter(c => !((c.a === r.id && c.wa === i) || (c.b === r.id && c.wb === i))); for (const c of P.plan.checks) { if (c.a === r.id && c.wa > i) c.wa--; if (c.b === r.id && c.wb > i) c.wb--; } if (!P.plan.checks.length) delete P.plan.checks; }
  r.closed = false; delete r.diag; delete r.diags; delete r.adjust; P.op = null; P.fan = null; P.remeasure = null;
}
const hangsOn = i => { const r = P.room, c = k => (r[k] || []).filter(o => o.wall === i).length; const t = c('ops'), o = c('objs'), l = c('links'); return t + o + l ? [t && `${t} Tür/Fenster`, o && `${o} Objekt${o > 1 ? 'e' : ''}`, l && `${l} Verbindung${l > 1 ? 'en' : ''}`].filter(Boolean).join(', ') : ''; };
async function deleteWall(i) {
  const r = P.room; if (!r.walls[i]) return;
  const h = hangsOn(i); if (h && !await A().confirmBox(`Wand ${i + 1} löschen?`, 'Löschen', 'Abbrechen', 'danger', `An dieser Wand hängt: ${h}. Das wird mit gelöscht.`)) return;
  const o = snap(); P.hold = null; cutWall(i); pushTrash(o); await save(); roomUi();
}
async function undoStep() {
  const r = P.room; if (P.hold) { P.hold = null; roomUi(); return; }
  if (!r.walls.length) return;
  const w = lastW(), i = r.walls.length - 1;
  if (w.turn != null && !r.closed) { const o = snap(); w.turn = null; delete w.auto; pushTrash(o); await save(); roomUi(); return; }
  await deleteWall(i);
}
async function redoStep() {
  const o = (P.trash || []).pop(); if (!o) return;
  const r = P.room; for (const k of KEEP) { if (o.room[k] === undefined) delete r[k]; else r[k] = o.room[k]; }
  for (const x of P.plan.rooms) if (o.others[x.id]) x.links = o.others[x.id];
  if (o.checks) P.plan.checks = o.checks; else delete P.plan.checks;
  P.hold = null; P.op = null; P.fan = null; await save(); roomUi(); A().toast('Wieder da', 1200);
}
$('#grUndo').onclick = $('#grUndo2').onclick = $('#grUndo3').onclick = undoStep;
document.querySelectorAll('.grRedo').forEach(b => { b.onclick = redoStep; });
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
$('#grDiag').onclick = () => { if (P.room.walls.length > 4) { P.fan = { k: 2, d: {} }; P.wantRh = false; $('#grKey2').style.display = ''; roomUi(); return; } P.wantDiag = true; A().toast('Diagonale messen: vom Startpunkt (●) zur gegenüberliegenden Ecke – oder ⌨', 4000); $('#grKey2').style.display = ''; };
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
function opWall(i) { if (!P.op) return; P.op.wall = i; P.op.step = 'pos'; roomUi(); doorHints(); }
// Breiten aus dem Massblatt-Projekt, aus dem die Adresse übernommen wurde (gleicher Raum, Breiten-Pfeile 55–110 cm) – nur als Vorschlag
async function doorHints() {
  P.hints = []; const p = P.plan, r = P.room; if (!P.op || P.op.type !== 'T' || !p.fromMassblatt) return;
  try { const names = await A().rooms(), key = (names.find(([k, t]) => (t || k) === r.name) || [r.name])[0], shots = await A().shotsOf(p.fromMassblatt);
    P.hints = [...new Set(shots.filter(s => s.room === key || s.room === r.name).flatMap(s => s.arrows || []).filter(a => a.kind === 'B' && a.cm >= 55 && a.cm <= 110).map(a => Math.round(a.cm)))].sort((a, b) => a - b).slice(0, 4); } catch (e) { P.hints = []; }
  if (P.op) roomUi();
}
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
// Schnellstart Rechteck: zwei Seiten messen → vier Wände, Raum fertig
$('#grRect').onclick = () => { P.rect = {}; roomUi(); };
async function rectValue(cm) {
  const r = P.room; if (r.walls.length || r.closed) { P.rect = null; return measure(cm); }
  if (!P.rect.a) { P.rect.a = cm; A().beep(true); roomUi(); return; }
  const a = P.rect.a; P.rect = null; r.walls = [a, cm, a, cm].map(v => ({ cm: v, turn: 90 })); r.closed = true; r.adjust = 0; A().beep(true); await save(); roomUi();
}
// Diagonalen bei mehr als vier Wänden: vom Startpunkt zu jeder Ecke, die nicht an Wand 1 oder der letzten Wand hängt
async function fanValue(cm) {
  const r = P.room, n = r.walls.length, f = P.fan; f.d[f.k] = cm; A().beep(true);
  if (f.k < n - 2) { f.k++; roomUi(); return; }
  P.fan = null; const t = G.fanTurns(r.walls, f.d);
  if (!t) { A().toast('Diese Diagonalen passen nicht zu den Wandlängen – bitte nachmessen', 4500); A().beep(false); roomUi(); return; }
  t.forEach((v, i) => { r.walls[i].turn = v; delete r.walls[i].auto; }); r.diags = f.d; delete r.diag; r.adjust = 0; $('#grKey2').style.display = 'none'; await save(); roomUi();
  A().toast(`Winkel berechnet: ${t.map(v => Math.round((180 - Math.abs(v)) * 10) / 10 + '°').join(' · ')}`, 5000);
}
$('#grDoor').onclick = () => opWizard('T'); $('#grWin').onclick = () => opWizard('F'); $('#grOpCancel').onclick = () => { P.op = null; roomUi(); };
// ---------- Tür/Fenster einsetzen: ein Fenster, das Schritt für Schritt führt (Manuel 16.11.: „so einfach und verständlich wie möglich“) ----------
// Bleibt offen, bis die Öffnung in der Wand sitzt. Jeder Schritt: großer Satz, was zu tun ist + Skizze, in der die Strecke markiert ist.
// Der Laserwert landet immer im aktuellen Schritt; daneben kann man eintippen. Gespeichert wird erst bei „✓ Fertig“.
const wizOn = () => !!(P.wiz && document.body.contains(P.wiz.bg));
function opWizard(type) {
  const r = P.room; if (!r || !r.closed) return;
  P.op = null; P.wantDiag = false; P.wantRh = false;
  const T = type === 'T', der = T ? 'die Tür' : 'das Fenster', Der = T ? 'Die Tür' : 'Das Fenster', zur = T ? 'zur Tür' : 'zum Fenster', others = P.plan.rooms.filter(x => x !== r), def = P.plan.wall || 15;
  const steps = T ? ['wall', 'pos', 'w', 'h', ...(others.length ? ['to'] : []), 'how'] : ['wall', 'pos', 'w', 'par', 'h', 'th', 'done']; // h = Höhe, par = Parapet, th = Laibungstiefe – alle drei überspringbar
  const st = { step: 'wall', wall: null, from: 'a', d: null, w: null, to: null, hinge: 'a', swing: 'in', noLeaf: false, thick: null, h: null, par: null, hFloor: false, touched: false, hints: [] };
  const bg = sheet(`<div class="grwiz"><div class="grwiz-top"><span data-no></span><button class="ghost" data-x aria-label="Abbrechen">✕</button></div>
    <h2 data-title></h2><p class="grwiz-hint" data-hint></p><canvas data-cv></canvas><div data-body></div>
    <div class="grwiz-nav"><button class="ghost" data-prev>‹ Zurück</button><button class="pri" data-next>✓ Fertig</button></div></div>`);
  const q = k => bg.querySelector(k), body = q('[data-body]'), L = () => r.walls[st.wall].cm, num = v => parseFloat(String(v).replace(',', '.'));
  const pos = () => st.from === 'a' ? st.d : L() - st.d - (st.w || 0);   // gespeichert wird immer der Abstand vom Anfang der Wand
  const close = () => { bg.remove(); P.wiz = null; roomUi(); };
  const go = step => { st.step = step; const t = document.querySelector('#toast'); if (t) t.classList.remove('on'); paint(); }; // alte Warnung soll nicht über dem nächsten Schritt stehen bleiben
  const next = () => go(steps[steps.indexOf(st.step) + 1]);
  const fail = msg => { A().toast(msg, 4000, 'warn'); A().beep(false); };
  const fromPartner = () => { if (st.touched) return; const x = P.plan.rooms.find(z => z.id === st.to), pr = x && (x.ops || []).find(z => z.type === 'T' && z.to === r.id && z.hinge); if (pr) { st.hinge = pr.hinge === 'a' ? 'b' : 'a'; st.swing = pr.swing === 'out' ? 'in' : 'out'; } };
  // Zahl annehmen (Laser oder eingetippt)
  const value = cm => {
    if (st.step === 'wall') return fail('Erst die Wand antippen');
    if (st.step === 'pos') { if (!(cm >= 0) || cm >= L() - 5) return fail(`Passt nicht: die Wand ist nur ${Math.round(L())} cm lang`); st.d = cm; A().beep(true); return next(); }
    if (st.step === 'w') { if (!(cm > 5)) return fail('Breite zu klein'); if (st.d + cm > L() + 2) return fail(`Passt nicht: ${Math.round(st.d)} + ${Math.round(cm)} cm ist länger als die Wand (${Math.round(L())} cm)`); st.w = Math.min(cm, L() - st.d); A().beep(true); return next(); }
    if (st.step === 'par') { if (!(cm >= 0 && cm <= 250)) return fail('Das passt nicht als Parapet (0–250 cm)'); st.par = cm; A().beep(true); return next(); }
    if (st.step === 'h') { let h = cm; if (!T && st.hFloor && st.par != null) h = cm - st.par;
      if (!(h >= (T ? 100 : 20) && h <= (T ? 350 : 350))) return fail(T ? 'Das passt nicht als Türhöhe (100–350 cm)' : 'Das passt nicht als Fensterhöhe (20–350 cm)');
      if (r.rh && (st.par || 0) + h > r.rh + 2) return fail(`Passt nicht: höher als der Raum (${Math.round(r.rh)} cm)`); st.h = h; A().beep(true); return next(); }
    if (st.step === 'th') { if (!(cm >= 5 && cm <= 150)) return fail('Das passt nicht als Laibungstiefe (5–150 cm)'); st.thick = cm; A().beep(true); return next(); }
    if (st.step === 'how') { if (cm > 0 && cm < 200) { st.thick = cm; A().beep(true); paint(); } return; }
  };
  const finish = async again => {
    const o = { id: uid(), type, wall: st.wall, pos: Math.max(0, pos()), w: st.w, to: null }; if (st.h) o.h = st.h; if (!T && st.par != null) o.par = st.par; if (!T && st.thick) o.thick = st.thick;
    if (T) { o.to = st.to; o.hinge = st.hinge; o.swing = st.swing; if (st.noLeaf) o.noLeaf = true; if (st.thick) o.thick = st.thick;
      (r.ops = r.ops || []).push(o); const pr = G.partnerOf(P.plan, r, o); if (pr) { pr.hinge = o.hinge === 'a' ? 'b' : 'a'; pr.swing = o.swing === 'out' ? 'in' : 'out'; if (o.noLeaf) pr.noLeaf = true; else delete pr.noLeaf; } }
    else (r.ops = r.ops || []).push(o);
    A().beep(true); await save(); close(); A().toast(`${Der} sitzt in Wand ${o.wall + 1}`, 1800); if (again) opWizard(type);
  };
  const inputRow = ph => `<div class="grwiz-in"><span>oder eintippen:</span><input data-val inputmode="decimal" autocomplete="off" placeholder="${ph}"><button class="ghost" data-ok>OK</button></div>`;
  const wireInput = () => { const i = q('[data-val]'); if (!i) return; const ok = () => { const v = num(i.value); if (isNaN(v)) return fail('Bitte eine Zahl in cm'); value(v); }; q('[data-ok]').onclick = ok; i.onkeydown = e => { if (e.key === 'Enter') ok(); }; };
  function paint() {
    const i = steps.indexOf(st.step); q('[data-no]').textContent = `${T ? 'Tür' : 'Fenster'} einsetzen · Schritt ${i + 1} von ${steps.length}`;
    q('[data-prev]').style.visibility = i ? '' : 'hidden'; const nx = q('[data-next]'); nx.style.display = st.step === 'how' || st.step === 'done' ? '' : 'none';
    let title = '', hint = '', html = '';
    if (st.step === 'wall') { title = `An welcher Wand ist ${der}?`; hint = 'Die Wand im Bild antippen – oder unten.'; html = `<div class="grgrid2">${r.walls.map((w, k) => `<button class="ghost" data-w="${k}">Wand ${k + 1} · ${Math.round(w.cm)} cm</button>`).join('')}</div>`; }
    else if (st.step === 'pos') { title = `Miss von der Ecke bis ${zur}`; hint = `Laser in die Ecke mit dem orangen Punkt halten und bis zur ersten Kante ${T ? 'der Tür' : 'des Fensters'} messen.`;
      html = `<div class="grwiz-wait">📏 Warte auf den Laser …</div>${inputRow('cm')}<div class="row2" style="margin-top:8px"><button class="ghost" data-flip>⇄ Andere Ecke nehmen</button><button class="ghost" data-zero>Direkt an der Ecke</button></div>`; }
    else if (st.step === 'w') { title = `Miss die Breite ${T ? 'der Tür' : 'des Fensters'}`; hint = `Von Kante zu Kante der Öffnung – im Bild orange. (Abstand ${Math.round(st.d)} cm ✓)`;
      html = `<div class="grwiz-wait">📏 Warte auf den Laser …</div>${inputRow('cm')}${st.hints.length ? `<div class="grwiz-chips"><span>aus dem Massblatt:</span>${st.hints.map(v => `<button class="ghost" data-hint="${v}">${v} cm</button>`).join('')}</div>` : ''}`; }
    else if (st.step === 'par') { title = 'Miss vom Boden bis zur Fensterbank'; hint = 'Das ist das Parapet: Laser auf den Boden stellen und bis zur Unterkante des Fensters messen.'; html = `<div class="grwiz-wait">📏 Warte auf den Laser …</div>${inputRow('cm')}<button class="ghost" data-skip style="width:100%;margin-top:8px">Überspringen</button>`; }
    else if (st.step === 'h') { title = `Miss die Höhe ${T ? 'der Tür' : 'des Fensters'}`; hint = T ? 'Vom Boden bis zur Oberkante der Türöffnung.' : st.hFloor ? 'Vom Boden bis zur Oberkante des Fensters – das Parapet zieht die App ab.' : 'Von der Fensterbank bis zur Oberkante des Fensters.';
      html = `<div class="grwiz-wait">📏 Warte auf den Laser …</div>${inputRow('cm')}<div class="row2" style="margin-top:8px">${!T && st.par != null ? `<button class="ghost" data-hfloor>⇄ ${st.hFloor ? 'Ab Fensterbank messen' : 'Vom Boden messen'}</button>` : ''}<button class="ghost" data-skip>Überspringen</button></div>`; }
    else if (st.step === 'th') { title = 'Miss die Tiefe der Laibung'; hint = 'Wie dick ist die Wand am Fenster? Von der Innenkante der Wand bis zur Außenkante.'; html = `<div class="grwiz-wait">📏 Warte auf den Laser …</div>${inputRow('cm')}<button class="ghost" data-skip style="width:100%;margin-top:8px">Überspringen</button>`; }
    else if (st.step === 'to') { title = 'Wohin führt die Tür?'; hint = 'Den Raum auf der anderen Seite antippen.'; html = `<div class="grgrid2">${others.map(x => `<button class="ghost" data-to="${x.id}">${esc(x.name)}</button>`).join('')}</div><button class="ghost" data-to="" style="width:100%;margin-top:8px">Nach außen / weiß ich noch nicht</button>`; }
    else if (st.step === 'how') { title = 'Wie geht die Tür auf?'; hint = 'Antippen, bis das Bild so aussieht wie die echte Tür. Dann „✓ Fertig“.';
      html = `<div class="row2"><button data-h="a">◧ Anschlag links</button><button data-h="b">Anschlag rechts ◨</button></div><div class="row2" style="margin-top:8px"><button data-sw="in">geht herein</button><button data-sw="out">geht hinaus</button></div>
        <button data-noleaf style="width:100%;margin-top:8px">Durchgang ohne Türblatt</button><p class="grwiz-th">Wandstärke hier: <b>${st.thick ? Math.round(st.thick) : def} cm</b>${st.thick ? '' : ' (Standard)'} – anders? Einfach an der Laibung messen.</p>`; }
    else { title = 'Passt das so?'; hint = `${Der} sitzt ${Math.round(st.d)} cm von der Ecke mit dem orangen Punkt: ${Math.round(st.w)} cm breit${st.h ? `, ${Math.round(st.h)} cm hoch` : ''}${st.par != null ? `, Parapet ${Math.round(st.par)} cm` : ''}${st.thick ? `, Laibung ${Math.round(st.thick)} cm` : ''}.`; html = `<button class="ghost" data-again style="width:100%">✓ Fertig und noch ein Fenster</button>`; }
    q('[data-title]').textContent = title; q('[data-hint]').textContent = hint; body.innerHTML = html; wireInput();
    body.querySelectorAll('[data-w]').forEach(b => { b.onclick = () => pickWall(+b.dataset.w); });
    const f = q('[data-flip]'); if (f) f.onclick = () => { st.from = st.from === 'a' ? 'b' : 'a'; draw(); }; const z = q('[data-zero]'); if (z) z.onclick = () => value(0);
    body.querySelectorAll('[data-hint]').forEach(b => { b.onclick = () => value(+b.dataset.hint); });
    body.querySelectorAll('[data-to]').forEach(b => { b.onclick = () => { st.to = b.dataset.to || null; fromPartner(); next(); }; });
    body.querySelectorAll('[data-h]').forEach(b => { b.className = b.dataset.h === st.hinge && !st.noLeaf ? 'pri' : 'ghost'; b.onclick = () => { st.hinge = b.dataset.h; st.noLeaf = false; st.touched = true; paint(); }; });
    body.querySelectorAll('[data-sw]').forEach(b => { b.className = b.dataset.sw === st.swing && !st.noLeaf ? 'pri' : 'ghost'; b.onclick = () => { st.swing = b.dataset.sw; st.noLeaf = false; st.touched = true; paint(); }; });
    const nl = q('[data-noleaf]'); if (nl) { nl.className = st.noLeaf ? 'pri' : 'ghost'; nl.onclick = () => { st.noLeaf = !st.noLeaf; paint(); }; }
    const ag = q('[data-again]'); if (ag) ag.onclick = () => finish(true);
    const sk = q('[data-skip]'); if (sk) sk.onclick = () => { if (st.step === 'par') st.par = null; else if (st.step === 'h') st.h = null; else st.thick = null; next(); };
    const hf = q('[data-hfloor]'); if (hf) hf.onclick = () => { st.hFloor = !st.hFloor; paint(); };
    draw();
  }
  const pickWall = k => { st.wall = k; st.d = st.w = null; st.from = 'a'; next(); if (T) wizHints(); };
  async function wizHints() { // Türbreiten aus dem übernommenen Massblatt-Projekt als Vorschlag
    const p = P.plan; if (!p.fromMassblatt) return;
    try { const names = await A().rooms(), key = (names.find(([k, t]) => (t || k) === r.name) || [r.name])[0], shots = await A().shotsOf(p.fromMassblatt);
      st.hints = [...new Set(shots.filter(s => s.room === key || s.room === r.name).flatMap(s => s.arrows || []).filter(a => a.kind === 'B' && a.cm >= 55 && a.cm <= 110).map(a => Math.round(a.cm)))].sort((a, b) => a - b).slice(0, 4); } catch (e) { st.hints = []; }
    if (wizOn() && st.step === 'w') paint();
  }
  // Skizze: Raum von oben, die gewählte Wand und die zu messende Strecke hervorgehoben
  let view = null;
  function draw() {
    const cv = q('[data-cv]'), W = cv.clientWidth || 320, H = 210, dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || '#888', ink = col('--text'), warn = '#e8590c', acc = col('--acc'), mono = css.getPropertyValue('--mono') || 'monospace';
    const pts = [...G.closedPoly(r.walls)], n = pts.length, bb = bboxOf(pts), pad = 34, sc = Math.min((W - 2 * pad) / Math.max(1, bb.x1 - bb.x0), (H - 2 * pad) / Math.max(1, bb.y1 - bb.y0));
    const ox = (W - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy = (H - (bb.y1 - bb.y0) * sc) / 2 - bb.y0 * sc, S = p => ({ x: ox + p.x * sc, y: oy + p.y * sc }), sp = pts.map(S); view = sp;
    const line = (a, b, c, w, dash) => { g.strokeStyle = c; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]); };
    const dot = (p, c, rad) => { g.fillStyle = c; g.beginPath(); g.arc(p.x, p.y, rad, 0, 7); g.fill(); };
    g.lineCap = 'round'; g.font = `600 13px ${mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (st.step === 'h' || st.step === 'par' || st.step === 'th') { // Höhen: Ansicht der Wand von vorne; Laibung: Schnitt durch die Wand von oben
      const tag = (p, t, c) => { const w = g.measureText(t).width + 10; g.fillStyle = col('--panel'); g.fillRect(p.x - w / 2, p.y - 10, w, 20); g.fillStyle = c; g.fillText(t, p.x, p.y + 1); };
      const P2 = (x, y) => ({ x, y }), cx = W / 2;
      if (st.step === 'th') { const y0 = 70, y1 = 140, gap = 110; g.fillStyle = ink; g.fillRect(cx - 150, y0, 150 - gap / 2, y1 - y0); g.fillRect(cx + gap / 2, y0, 150 - gap / 2, y1 - y0);
        line(P2(cx - gap / 2, y0 + 30), P2(cx + gap / 2, y0 + 30), acc, 3); g.fillStyle = col('--mute'); g.fillText('außen', cx, y0 - 22); g.fillText('innen (Raum)', cx, y1 + 24);
        const x = cx + gap / 2 - 16; line(P2(x, y0), P2(x, y1), warn, 3, [7, 6]); dot(P2(x, y0), warn, 4); dot(P2(x, y1), warn, 4); tag(P2(x - 44, (y0 + y1) / 2), '? cm', warn); return; }
      const fl = H - 26, top = 22, k = (fl - top) / (r.rh || 260), ow = Math.min(150, Math.max(60, (st.w || 80) * k)), par = T ? 0 : (st.par != null ? st.par : 85), hh = st.h || (T ? 200 : 130), y1 = fl - par * k, y0 = Math.max(top + 10, y1 - hh * k);
      g.fillStyle = col('--acc-soft'); g.fillRect(30, top, W - 60, fl - top); line(P2(20, fl), P2(W - 20, fl), ink, 4); line(P2(30, top), P2(W - 30, top), ink, 2);
      g.fillStyle = col('--panel'); g.fillRect(cx - ow / 2, y0, ow, y1 - y0); g.strokeStyle = T ? warn : acc; g.lineWidth = 3; g.strokeRect(cx - ow / 2, y0, ow, y1 - y0);
      g.fillStyle = col('--mute'); g.fillText('Boden', 58, fl + 13); g.fillText('Wand von vorne', cx, top - 11);
      const x = cx + ow / 2 + 18, a = st.step === 'par' ? fl : (T || st.hFloor ? fl : y1), b = st.step === 'par' ? y1 : y0;
      line(P2(x, a), P2(x, b), warn, 3, [7, 6]); dot(P2(x, a), warn, 5); dot(P2(x, b), warn, 5); tag(P2(x + 34, (a + b) / 2), '? cm', warn);
      if (st.step === 'h' && !T && st.par != null && !st.hFloor) { const x2 = cx - ow / 2 - 18; line(P2(x2, fl), P2(x2, y1), ink, 2); tag(P2(x2 - 24, (fl + y1) / 2), String(Math.round(st.par)), ink); }
      return; }
    g.beginPath(); sp.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fillStyle = col('--acc-soft'); g.fill();
    for (let i = 0; i < n; i++) line(sp[i], sp[(i + 1) % n], st.wall === i ? warn : ink, st.wall === i ? 7 : 5);
    // vorhandene Türen/Fenster als helle Stücke, damit man sieht, was schon da ist
    const along = (i, cm) => { const a = sp[i], b = sp[(i + 1) % n], t = cm / (r.walls[i].cm || 1); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; };
    for (const o of r.ops || []) line(along(o.wall, o.pos), along(o.wall, o.pos + o.w), o.type === 'T' ? col('--panel') : acc, 5);
    g.font = `600 13px ${mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (st.step === 'wall') { for (let i = 0; i < n; i++) { const m = along(i, r.walls[i].cm / 2); dot(m, col('--yellow') || '#f5c400', 13); g.fillStyle = '#16202a'; g.fillText(String(i + 1), m.x, m.y + 1); } return; }
    const i = st.wall, Lw = L(), a = sp[i], b = sp[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, inn = { x: -dy / len, y: dx / len }; // im Uhrzeigersinn gelaufen → rechts der Laufrichtung ist innen
    const off = (p, k) => ({ x: p.x + inn.x * k, y: p.y + inn.y * k }), corner = st.from === 'a' ? a : b, A0 = cm => along(i, st.from === 'a' ? cm : Lw - cm);
    const label = (p, t, c) => { const w = g.measureText(t).width + 10; g.fillStyle = col('--panel'); g.fillRect(p.x - w / 2, p.y - 10, w, 20); g.fillStyle = c; g.fillText(t, p.x, p.y + 1); };
    if (st.step === 'pos') { const e = A0(Math.min(Lw * 0.38, Lw - 5)); line(off(corner, 14), off(e, 14), warn, 3, [7, 6]); dot(off(e, 14), warn, 4); dot(corner, warn, 10); label(off(A0(Lw * 0.19), 30), '? cm', warn); return; }
    if (st.step === 'w') { const p0 = A0(st.d), p1 = A0(Math.min(Lw, st.d + Math.max(60, Lw * 0.25))); dot(corner, warn, 7); line(off(corner, 14), off(p0, 14), ink, 2); label(off(A0(st.d / 2), 30), `${Math.round(st.d)}`, ink);
      line(p0, p1, col('--panel'), 7); line(off(p0, 14), off(p1, 14), warn, 3, [7, 6]); line(off(p0, 4), off(p0, 24), warn, 3); label(off(A0(st.d + Math.max(60, Lw * 0.25) / 2), 46), '? cm', warn); return; }
    // fertig: Öffnung an ihrem Platz, Tür mit Blatt und Bogen
    const p0 = along(i, Math.max(0, pos())), p1 = along(i, Math.max(0, pos()) + st.w);
    dot(corner, warn, 7);
    if (!T) { line(p0, p1, col('--panel'), 9); line(p0, p1, acc, 3); line(off(p0, -4), off(p0, 4), acc, 3); line(off(p1, -4), off(p1, 4), acc, 3); return; }
    line(p0, p1, col('--panel'), 9); line(off(p0, -5), off(p0, 5), warn, 3); line(off(p1, -5), off(p1, 5), warn, 3); if (st.noLeaf) return;
    const hp = st.hinge === 'a' ? p0 : p1, fp = st.hinge === 'a' ? p1 : p0, wpx = Math.hypot(fp.x - hp.x, fp.y - hp.y), sgn = st.swing === 'in' ? 1 : -1, tip = { x: hp.x + inn.x * wpx * sgn, y: hp.y + inn.y * wpx * sgn };
    line(hp, tip, warn, 3); const a0 = Math.atan2(fp.y - hp.y, fp.x - hp.x), a1 = Math.atan2(tip.y - hp.y, tip.x - hp.x); let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    g.strokeStyle = warn; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); g.arc(hp.x, hp.y, wpx, a0, a1, d < 0); g.stroke(); g.setLineDash([]);
  }
  q('[data-cv]').addEventListener('click', e => { if (st.step !== 'wall' || !view) return; const b = e.currentTarget.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; let best = -1, bd = 40;
    for (let i = 0; i < view.length; i++) { const a = view[i], c = view[(i + 1) % view.length], dx = c.x - a.x, dy = c.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) pickWall(best); });
  q('[data-x]').onclick = close; q('[data-prev]').onclick = () => { const i = steps.indexOf(st.step); if (i > 0) go(steps[i - 1]); }; q('[data-next]').onclick = () => finish(false);
  P.wiz = { bg, value, st }; paint();
}
// Tür: in welchen Raum führt sie, und wie dick ist die Wand dort (an der Laibung messen)?
function doorTarget(o) {
  const others = P.plan.rooms.filter(x => x !== P.room), def = P.plan.wall || 15;
  const bg = sheet(`<h2>Wohin führt die Tür?</h2><div class="grgrid2" data-list></div><button class="ghost" data-none style="width:100%;margin-top:8px">Nach außen / noch offen</button>
    <label class="f">Anschlag (von diesem Raum aus gesehen)</label><div class="row2"><button class="ghost" data-h="a">◧ links</button><button class="ghost" data-h="b">rechts ◨</button></div>
    <label class="f">Die Tür geht auf</label><div class="row2"><button class="ghost" data-sw="in">in diesen Raum</button><button class="ghost" data-sw="out">hinaus</button></div>
    <label style="display:flex;gap:10px;align-items:center;margin:10px 0 0"><input type="checkbox" data-noleaf style="width:auto"> Durchgang ohne Tür (kein Türblatt)</label>
    <label class="f">Wandstärke an dieser Tür (cm)</label><div style="display:flex;gap:8px;align-items:center"><input data-th inputmode="decimal" value="${o.thick || ''}" placeholder="${def} (Standard)" style="flex:1"><span class="mute" style="font-size:13px;flex:2">An der Laibung messen – der Laserwert landet hier.</span></div>
    <button class="pri" data-ok style="width:100%;margin-top:12px">Fertig</button>`);
  P.thInput = bg.querySelector('[data-th]'); let to = o.to, hinge = o.hinge || 'a', swing = o.swing || 'in', touched = !!o.hinge;
  // Gibt es im Ziel-Raum schon das Gegenstück, ist dessen Angabe die Vorgabe (dieselbe Tür von der anderen Seite: Seite und Richtung gespiegelt)
  const fromPartner = () => { if (touched) return; const x = P.plan.rooms.find(q => q.id === to), pr = x && (x.ops || []).find(q => q.type === 'T' && q.to === P.room.id && q.hinge); if (pr) { hinge = pr.hinge === 'a' ? 'b' : 'a'; swing = pr.swing === 'out' ? 'in' : 'out'; } };
  const paint = () => { bg.querySelectorAll('[data-to]').forEach(b => b.classList.toggle('pri', b.dataset.to === to)); bg.querySelector('[data-none]').classList.toggle('pri', !to);
    bg.querySelectorAll('[data-h]').forEach(b => { b.classList.toggle('pri', b.dataset.h === hinge); b.classList.toggle('ghost', b.dataset.h !== hinge); }); bg.querySelectorAll('[data-sw]').forEach(b => { b.classList.toggle('pri', b.dataset.sw === swing); b.classList.toggle('ghost', b.dataset.sw !== swing); }); };
  bg.querySelector('[data-noleaf]').checked = !!o.noLeaf;
  bg.querySelectorAll('[data-h]').forEach(b => { b.onclick = () => { hinge = b.dataset.h; touched = true; paint(); }; }); bg.querySelectorAll('[data-sw]').forEach(b => { b.onclick = () => { swing = b.dataset.sw; touched = true; paint(); }; });
  for (const x of others) { const b = document.createElement('button'); b.className = 'ghost'; b.dataset.to = x.id; b.textContent = x.name; b.onclick = () => { to = x.id; fromPartner(); paint(); }; bg.querySelector('[data-list]').appendChild(b); }
  if (!others.length) bg.querySelector('[data-list]').innerHTML = '<p class="mute" style="margin:0 0 6px;font-size:14px">Noch kein anderer Raum angelegt – das Ziel kannst du später über die Tür unten in der Leiste setzen.</p>';
  bg.querySelector('[data-none]').onclick = () => { to = null; paint(); }; fromPartner(); paint();
  bg.querySelector('[data-ok]').onclick = async () => { const th = parseFloat(String(P.thInput.value).replace(',', '.')); o.to = to; o.hinge = hinge; o.swing = swing; if (bg.querySelector('[data-noleaf]').checked) o.noLeaf = true; else delete o.noLeaf; if (th > 0 && th < 200) o.thick = th; else delete o.thick;
    const pr = G.partnerOf(P.plan, P.room, o); if (pr) { pr.hinge = hinge === 'a' ? 'b' : 'a'; pr.swing = swing === 'out' ? 'in' : 'out'; if (o.noLeaf) pr.noLeaf = true; else delete pr.noLeaf; } // Gegenstück mitziehen, damit das Türblatt nur einmal und richtig herum erscheint
    P.thInput = null; bg.remove(); await save(); roomUi(); };
}
function editOp(o) {
  const r = P.room, kind = o.type === 'T' ? 'Tür' : 'Fenster';
  const bg = sheet(`<h2>${kind} an Wand ${o.wall + 1}</h2><p class="mute" style="margin:-4px 0 10px">Abstand von der Ecke ${Math.round(o.pos)} cm · Breite ${Math.round(o.w)} cm${o.h ? ` · Höhe ${Math.round(o.h)} cm` : ''}${o.par != null ? ` · Parapet ${Math.round(o.par)} cm` : ''}${o.thick ? ` · Wand ${Math.round(o.thick)} cm` : ''}</p>
    <div class="row2"><button class="ghost" data-pos>✎ Abstand</button><button class="ghost" data-w>✎ Breite</button></div>
    <div class="row2" style="margin-top:8px"><button class="ghost" data-h>✎ Höhe${o.h ? ' ' + Math.round(o.h) : ''}</button>${o.type === 'F' ? `<button class="ghost" data-par>✎ Parapet${o.par != null ? ' ' + Math.round(o.par) : ''}</button>` : '<span></span>'}</div>
    ${o.type === 'T' ? '<button class="ghost" data-to style="width:100%;margin-top:8px">Ziel-Raum / Wandstärke</button>' : `<button class="ghost" data-lb style="width:100%;margin-top:8px">✎ Laibungstiefe${o.thick ? ' ' + Math.round(o.thick) + ' cm' : ''}</button>`}
    <button class="danger" data-del style="width:100%;margin-top:8px">Löschen</button><button class="ghost" data-close style="width:100%;margin-top:8px">Schließen</button>`);
  const num = async (title, cur) => { const v = await A().promptBox(title, '', String(Math.round(cur))); if (v == null) return null; const cm = parseFloat(String(v).replace(',', '.')); return cm >= 0 && cm < 10000 ? cm : null; };
  bg.querySelector('[data-pos]').onclick = async () => { bg.remove(); const v = await num('Abstand von der Ecke in cm', o.pos); if (v == null) return; if (v + o.w > r.walls[o.wall].cm + 2) { A().toast('Passt nicht auf die Wand'); return; } o.pos = v; await save(); roomUi(); };
  bg.querySelector('[data-w]').onclick = async () => { bg.remove(); const v = await num('Breite in cm', o.w); if (!v) return; if (o.pos + v > r.walls[o.wall].cm + 2) { A().toast('Passt nicht auf die Wand'); return; } o.w = v; await save(); roomUi(); };
  const opt = async (title, key, lo, hi) => { bg.remove(); const v = await A().promptBox(title + ' (leer = keine Angabe)', '', o[key] != null ? String(Math.round(o[key])) : ''); if (v == null) return; if (!String(v).trim()) delete o[key]; else { const cm = parseFloat(String(v).replace(',', '.')); if (!(cm >= lo && cm <= hi)) { A().toast(`Bitte ${lo}–${hi} cm`); return; } o[key] = cm; } await save(); roomUi(); };
  bg.querySelector('[data-h]').onclick = () => opt(`Höhe ${o.type === 'T' ? 'der Tür' : 'des Fensters'} in cm`, 'h', 20, 350);
  if (o.type === 'F') { bg.querySelector('[data-par]').onclick = () => opt('Parapet in cm (Boden bis Fensterbank)', 'par', 0, 250); bg.querySelector('[data-lb]').onclick = () => opt('Laibungstiefe in cm', 'thick', 5, 150); }
  if (o.type === 'T') bg.querySelector('[data-to]').onclick = () => { bg.remove(); doorTarget(o); };
  bg.querySelector('[data-del]').onclick = async () => { bg.remove(); r.ops = r.ops.filter(x => x !== o); await save(); roomUi(); };
}
// Wand im Bild antippen: während „an welcher Wand?“ wählt es die Wand für Tür/Fenster, sonst öffnet es das Wand-Menü (ändern, neu messen, löschen)
$('#grCv').addEventListener('click', e => {
  if (!P.room || !P.view || P.rect || P.fan || (P.op && P.op.step !== 'wall')) return;
  const b = $('#grCv').getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, pts = P.view.pts, n = Math.min(P.room.walls.length, pts.length); let best = -1, bd = P.op ? 44 : 30;
  for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % pts.length], dx = c.x - a.x, dy = c.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy); if (d < bd) { bd = d; best = i; } }
  if (best < 0) return; if (P.op) opWall(best); else editWall(best);
});

// ---------- Stufe 2: ganze Wohnung ----------
function flatInfo() {
  const p = P.plan, res = G.placeRooms(p.rooms, p.wall || 15), name = id => (p.rooms.find(r => r.id === id) || {}).name || '?', msgs = [];
  for (const m of res.missing) msgs.push(m.why === 'offen' ? `„${name(m.to)}“ ist noch nicht fertig gemessen (Tür von „${name(m.from)}“ führt dorthin).` : `In „${name(m.to)}“ fehlt die Tür zu „${name(m.from)}“.`);
  for (let gi = 1; gi < (res.groups || 0); gi++) { const ids = p.rooms.filter(r => res.T.has(r.id) && res.T.get(r.id).g === gi).map(r => r.id);
    if (ids.length > 1) msgs.push(`${ids.map(i => `„${name(i)}“`).join(' und ')} hängen zusammen, aber noch nicht an der übrigen Wohnung – mit dem Finger an die richtige Wand schieben, sie docken von selbst an.`);
    else if (!res.missing.some(m => m.to === ids[0] || m.from === ids[0])) msgs.push(`„${name(ids[0])}“ hängt noch an keiner Tür – mit dem Finger an die richtige Wand schieben, der Raum dockt von selbst an.`); }
  for (const i of res.issues) msgs.push(`Zwischen „${name(i.a)}“ und „${name(i.b)}“ geht es nicht auf: ${Math.round(i.off)} cm Versatz – eine Türposition, Wandlänge oder Wandstärke stimmt nicht.`);
  const oks = []; if ((p.checks || []).length) { const lay = G.layout(p.rooms, p.wall || 15);
    for (const c of p.checks) { const d = G.checkDist(lay, c.a, c.wa, c.b, c.wb), nm = `Kontrollmaß ${name(c.a)} W${c.wa + 1} – ${name(c.b)} W${c.wb + 1}`;
      if (d == null) msgs.push(`${nm}: Räume sind noch nicht verbunden.`); else if (Math.abs(d - c.cm) > 3) msgs.push(`${nm}: gemessen ${Math.round(c.cm)} cm, im Plan ${Math.round(d)} cm – ${Math.round(Math.abs(d - c.cm))} cm Abweichung.`); else oks.push(`${nm}: ${Math.round(c.cm)} cm stimmt.`); } }
  return { res, msgs, oks };
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
  for (const ob of gf.objs || []) { g.strokeStyle = st.dim; g.lineWidth = 1.2;
    if (ob.quad) { path(ob.quad); g.fillStyle = ob.solid ? st.wall || st.dim : st.panel; g.fill(); g.stroke(); }
    if (ob.dashed) g.setLineDash([7, 5]); if (ob.solid) g.strokeStyle = st.panel;
    for (const l of ob.lines) { g.beginPath(); l.forEach((q, i) => i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))); g.stroke(); } g.setLineDash([]);
    if (ob.label) { let a = Math.atan2(ob.label.d.y, ob.label.d.x); if (a > Math.PI / 2 - 0.01 || a < -Math.PI / 2 - 0.01) a += Math.PI; g.fillStyle = st.dim; g.font = `11px ${st.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(X(ob.label.p), Y(ob.label.p)); g.rotate(a); g.fillText(ob.label.t, 0, 0); g.restore(); } }
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
const PRINT = { '--text': '#16202a', '--mute': '#6b7780', '--acc-soft': '#eef4f8', '--bg': '#ffffff', '--panel': '#ffffff', '--acc': '#0b7fc0', '--warn': '#b7791f' };
// exp = { px } zeichnet für die Bild-Ausgabe: weißer Grund, Druckfarben, lange Seite px Pixel
function drawFlat(cv, big, exp) {
  const p = P.plan; if (!p || !cv) return;
  const lay = G.layout(p.rooms, p.wall || 15); if (!lay.items.length && !exp) { const g0 = cv.getContext('2d'); g0.clearRect(0, 0, cv.width, cv.height); return; }
  const gfs = lay.items.map(it => ({ it, gf: G.gfx(p, it.room, it.poly, { chains: false }) })), bb = bboxOf(gfs.flatMap(x => x.gf.ext));
  let W, H, dpr;
  if (exp) { const ar = Math.max(0.2, Math.min(5, (bb.x1 - bb.x0) / Math.max(1, bb.y1 - bb.y0))); W = ar >= 1 ? 1600 : 1600 * ar; H = ar >= 1 ? 1600 / ar : 1600; W += 80; H += 80; dpr = Math.min(exp.px / Math.max(W, H), Math.sqrt(16e6 / (W * H))); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  else { const box = cv.parentElement.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = Math.max(50, box.width); H = Math.max(50, box.height); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); if (exp) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); }
  if (big && !exp && P.fv) { g.translate(W / 2 + P.fv.x, H / 2 + P.fv.y); g.scale(P.fv.z, P.fv.z); g.translate(-W / 2, -H / 2); }   // Zoomen und Verschieben mit den Fingern
  const pad = big ? 30 : 8; let sc = Math.min((W - 2 * pad) / Math.max(1, bb.x1 - bb.x0), (H - 2 * pad) / Math.max(1, bb.y1 - bb.y0)), ox = (W - (bb.x1 - bb.x0) * sc) / 2 - bb.x0 * sc, oy = (H - (bb.y1 - bb.y0) * sc) / 2 - bb.y0 * sc;
  if (big && !exp) { if (P.drag && P.drag.view) ({ sc, ox, oy } = P.drag.view); P.flat = { sc, ox, oy, W, H, lay }; } // beim Schieben eines Raums bleibt der Maßstab stehen
  const X = q => ox + q.x * sc, Y = q => oy + q.y * sc, css = getComputedStyle(document.documentElement), col = n => (exp ? PRINT[n] : css.getPropertyValue(n).trim()) || '#888', mono = css.getPropertyValue('--mono') || 'monospace', display = css.getPropertyValue('--display') || 'sans-serif';
  // 3.18: Wände auf eigener Ebene zeichnen und die Rauminnenflächen + Öffnungen herausschneiden (wie im PDF/DXF).
  // Sonst ragt die Außenwand eines Raums in den Nachbarraum, die Zwischenwand wirkt doppelt so dick und liegt quer über der Türöffnung.
  // Bild-Ausgabe (weißer Grund, sehr groß): direkt weiß übermalen statt zweiter Riesen-Ebene (Speicher am Tablet)
  const wl = exp ? null : document.createElement('canvas'); if (wl) { wl.width = cv.width; wl.height = cv.height; } const h = wl ? wl.getContext('2d') : g; if (wl) h.setTransform(g.getTransform());
  for (const x of gfs) gfxBand(h, x.gf, X, Y, x.it.loose ? col('--mute') : col('--text'));
  h.save(); if (wl) h.globalCompositeOperation = 'destination-out'; h.fillStyle = wl ? '#000' : '#ffffff';
  const hp = pl => { h.beginPath(); pl.forEach((q, i) => i ? h.lineTo(X(q), Y(q)) : h.moveTo(X(q), Y(q))); h.closePath(); h.fill(); };
  for (const x of gfs) { hp(x.gf.inner); for (const c of x.gf.cutsX) hp(c); }
  h.restore(); if (wl) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(wl, 0, 0); g.restore(); }
  for (const x of gfs) gfxRest(g, x.gf, X, Y, { fill: col('--acc-soft'), cut: col('--bg'), panel: col('--panel'), win: col('--acc'), door: col('--warn'), dim: col('--mute'), wall: col('--text'), mono });
  for (const { it } of gfs) { const pl = it.poly, n = pl.length, c = pl.reduce((s, q) => ({ x: s.x + X(q) / n, y: s.y + Y(q) / n }), { x: 0, y: 0 }), wpx = (Math.max(...pl.map(q => q.x)) - Math.min(...pl.map(q => q.x))) * sc;
    const fs = Math.min(big ? 15 : 10, (wpx - 8) / Math.max(3, it.room.name.length * 0.6)); if (fs < 6) continue; g.fillStyle = col('--text'); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (big && fs > 10) stamp(g, it.room, c.x, c.y, { ink: col('--text'), mute: col('--mute'), display, mono, size: fs, name: true, maxW: wpx - 6 }); else { g.font = `700 ${fs}px ${display}`; g.fillText(it.room.name, c.x, c.y); } }
  if (big && !exp && P.selSeed) for (const { it } of gfs) if (it.loose && lay.items.find(q => q.g === it.g).room.id === P.selSeed) { g.strokeStyle = col('--acc'); g.lineWidth = 3 / (P.fv ? P.fv.z : 1); g.setLineDash([8, 6]); g.beginPath(); it.poly.forEach((q, i) => i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q))); g.closePath(); g.stroke(); g.setLineDash([]); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (big && p.north != null) northArrow(g, W - 52, 60, p.north, col('--text'), mono);
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
  $('#grFlatSum').textContent = `${res.main} von ${n} fertigen Räumen verbunden · ${fmtA(planArea(p))} · Wände innen ${p.wall || 15} / außen ${p.wallOut || 30} cm`;
  const el = $('#grFlatMsgs'); el.innerHTML = '';
  if (!msgs.length && n > 1) el.innerHTML = '<p class="grok">✓ Alle Räume hängen zusammen und es geht auf.</p>';
  for (const m of flatInfo().oks) { const d = document.createElement('p'); d.className = 'grok'; d.textContent = '✓ ' + m; el.appendChild(d); }
  for (const m of msgs) { const d = document.createElement('p'); d.className = 'grwarn'; d.textContent = '⚠ ' + m; el.appendChild(d); }
  if ((p.checks || []).length) { const b = document.createElement('button'); b.className = 'ghost'; b.id = 'grCheckDel'; b.style.cssText = 'margin-top:6px;padding:7px 10px;font-size:13px'; b.textContent = `Kontrollmaße löschen (${p.checks.length})`;
    b.onclick = async () => { if (await A().confirmBox('Alle Kontrollmaße löschen?', 'Löschen')) { delete p.checks; await save(); flatUi(); } }; el.appendChild(b); }
  drawFlat($('#grFlatCv'), true);
  $('#grRot').style.display = P.selSeed && p.rooms.some(r => r.id === P.selSeed) ? '' : 'none';
}
// ---------- Lose Räume von Hand hinschieben; sie docken an der nächsten Wand an (Manuel 19.11.) ----------
// Die Lage steht am ersten Raum der Gruppe (room.at = Mitte in cm + Vierteldrehungen). Beim Loslassen nahe an einer Wand entsteht eine
// „Wand an Wand“-Verbindung (room.links) – ab dann hängt der Raum fest und wird wie jeder verbundene Raum gerechnet.
const flatCm = e => { const f = P.flat, b = $('#grFlatCv').getBoundingClientRect(), z = P.fv.z, x = (e.clientX - b.left - f.W / 2 - P.fv.x) / z + f.W / 2, y = (e.clientY - b.top - f.H / 2 - P.fv.y) / z + f.H / 2; return { x: (x - f.ox) / f.sc, y: (y - f.oy) / f.sc }; };
const inPoly = (q, pl) => { let c = false; for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) if ((pl[i].y > q.y) !== (pl[j].y > q.y) && q.x < (pl[j].x - pl[i].x) * (q.y - pl[i].y) / (pl[j].y - pl[i].y) + pl[i].x) c = !c; return c; };
function looseAt(e) { if (!P.flat) return null; const q = flatCm(e), it = P.flat.lay.items.find(i => i.loose && inPoly(q, i.poly)); if (!it) return null;
  const grp = P.flat.lay.items.filter(i => i.g === it.g), bb = bboxOf(grp.flatMap(i => i.poly)); return { seed: grp[0].room, g: it.g, c: { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 }, q }; }
async function dockDrop(seed) {
  const p = P.plan, lay = G.layout(p.rooms, p.wall || 15), me = lay.items.find(i => i.room === seed); if (!me) return;
  const hit = G.dockFind(lay, me.g, (p.wall || 15) + 75);
  if (hit) { (hit.room.links = hit.room.links || []).push({ id: uid(), wall: hit.wall, to: hit.to.id, toWall: hit.toWall, off: hit.off, thick: p.wall || 15, dock: true });
    for (const i of lay.items) if (i.g === me.g) delete i.room.at; P.selSeed = null; A().beep(true); A().toast(`„${hit.room.name}“ hängt jetzt an „${hit.to.name}“ (Wand ${hit.wall + 1} an Wand ${hit.toWall + 1})`, 3500); }
  await save(); flatUi();
}
$('#grRot').onclick = async () => { const p = P.plan, seed = p.rooms.find(r => r.id === P.selSeed); if (!seed || !P.flat) return; const grp = P.flat.lay.items.filter(i => i.g === (P.flat.lay.items.find(q => q.room === seed) || {}).g); if (!grp.length) return;
  const bb = bboxOf(grp.flatMap(i => i.poly)); seed.at = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, r: (((seed.at || {}).r || 0) + 1) % 4 }; await save(); flatUi(); };
$('#grFlatCard').onclick = () => { P.selSeed = null; P.drag = null; P.fv = { z: 1, x: 0, y: 0 }; A().show('planFlat'); A().keepAwake(true); flatUi(); };
$('#grFlatBack').onclick = () => A().goBack(false);
{ // zwei Finger = zoomen, ein Finger = verschieben, Doppeltipp = zurücksetzen
  const cv = $('#grFlatCv'), pt = new Map(); let last = 0, d0 = 0, z0 = 1;
  const redraw = () => drawFlat(cv, true), dist = () => { const [a, b] = [...pt.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  cv.addEventListener('pointerdown', e => { pt.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { cv.setPointerCapture(e.pointerId); } catch (x) { } if (pt.size === 2) { d0 = dist(); z0 = P.fv.z; if (P.drag) { P.drag = null; redraw(); } }
    if (pt.size === 1) { const h = looseAt(e); if (h) { P.drag = { seed: h.seed, q0: h.q, c0: h.c, r: (h.seed.at || {}).r || 0, view: { sc: P.flat.sc, ox: P.flat.ox, oy: P.flat.oy }, moved: false }; last = 0; return; } }
    if (pt.size === 1) { const t = Date.now(); if (t - last < 320) { P.fv = { z: 1, x: 0, y: 0 }; redraw(); } last = t; } });
  cv.addEventListener('pointermove', e => { const q = pt.get(e.pointerId); if (!q) return; const dx = e.clientX - q.x, dy = e.clientY - q.y; q.x = e.clientX; q.y = e.clientY;
    if (P.drag && pt.size === 1) { const q = flatCm(e), d = P.drag; if (!d.moved && Math.hypot(q.x - d.q0.x, q.y - d.q0.y) * d.view.sc * P.fv.z < 8) return; d.moved = true; d.seed.at = { x: d.c0.x + q.x - d.q0.x, y: d.c0.y + q.y - d.q0.y, r: d.r }; redraw(); return; }
    if (pt.size === 1) { P.fv.x += dx; P.fv.y += dy; } else if (pt.size === 2 && d0 > 0) P.fv.z = Math.max(1, Math.min(10, z0 * dist() / d0)); if (P.fv.z === 1 && pt.size === 2) { P.fv.x = 0; P.fv.y = 0; } redraw(); });
  for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, e => { pt.delete(e.pointerId); d0 = 0;
    if (P.drag) { const d = P.drag; P.drag = null; if (d.moved && ev === 'pointerup') dockDrop(d.seed); else { P.selSeed = P.selSeed === d.seed.id ? null : d.seed.id; flatUi(); } } });
  cv.addEventListener('wheel', e => { e.preventDefault(); P.fv.z = Math.max(1, Math.min(10, P.fv.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); if (P.fv.z === 1) { P.fv.x = 0; P.fv.y = 0; } redraw(); }, { passive: false });
}
// Nordpfeil: wohin zeigt Norden im Bild?
$('#grNorth').onclick = () => {
  const dirs = [[315, '↖'], [0, '↑'], [45, '↗'], [270, '←'], [null, '✕'], [90, '→'], [225, '↙'], [180, '↓'], [135, '↘']];
  const bg = sheet('<h2>Wohin zeigt Norden im Bild?</h2><p class="mute" style="margin:-4px 0 10px;font-size:14px">Pfeil antippen. ✕ = kein Nordpfeil.</p><div class="grcompass" data-c></div><button class="ghost" data-close style="width:100%;margin-top:10px">Schließen</button>');
  for (const [d, t] of dirs) { const b = document.createElement('button'); b.className = (P.plan.north == null ? d == null : P.plan.north === d) ? 'pri' : 'ghost'; b.textContent = t; b.dataset.n = d == null ? '' : d; b.onclick = async () => { if (d == null) delete P.plan.north; else P.plan.north = d; await save(); bg.remove(); flatUi(); }; bg.querySelector('[data-c]').appendChild(b); }
};
$('#grWallOut').addEventListener('input', () => { if (!P.plan) return; const v = parseFloat($('#grWallOut').value.replace(',', '.')); if (v > 0 && v < 200) P.plan.wallOut = v; else delete P.plan.wallOut; save(); renderPlan(); });
$('#grWall').addEventListener('input', () => { if (!P.plan) return; const v = parseFloat($('#grWall').value.replace(',', '.')); if (v > 0 && v < 200) P.plan.wall = v; else delete P.plan.wall; save(); renderPlan(); });

// ---------- 3.17: Objekte, Nachbarraum Wand an Wand, Kopie, Nische, Kontrollmaß ----------
$('#grMore').onclick = () => {
  const bg = sheet('<h2>Mehr im Raum</h2><label class="f">Einbauten und Ausstattung</label><div class="grgrid" data-objs></div><label class="f">Raum</label><div class="row2" style="margin-bottom:8px"><button class="ghost" data-photo>📷 Foto zum Raum</button><button class="ghost" data-note>📝 Notiz zum Raum</button></div><button class="ghost grpick" data-link><b>↔ Nachbarraum Wand an Wand</b><small>Räume ohne Tür dazwischen aneinanderhängen</small></button><button class="ghost grpick" data-niche><b>⊓ Nische oder Vorsprung</b><small>nachträglich in eine Wand einfügen</small></button><div class="row2"><button class="ghost" data-copy>⧉ Kopie</button><button class="ghost" data-mirror>⧉ Spiegelkopie</button></div><button class="ghost" data-close style="width:100%;margin-top:10px">Schließen</button>');
  for (const [k, v] of Object.entries(G.OBJ)) { const b = document.createElement('button'); b.className = 'ghost'; b.dataset.kind = k; b.innerHTML = `<b style="font-size:14px">${esc(v[0])}</b>`; b.onclick = () => { bg.remove(); objAdd(k); }; bg.querySelector('[data-objs]').appendChild(b); }
  bg.querySelector('[data-photo]').onclick = () => { bg.remove(); photoAdd(); }; bg.querySelector('[data-note]').onclick = () => { bg.remove(); noteEdit(); };
  bg.querySelector('[data-link]').onclick = () => { bg.remove(); linkAdd(); }; bg.querySelector('[data-niche]').onclick = () => { bg.remove(); nicheAdd(); };
  const cp = async m => { bg.remove(); const c = G.copyRoom(P.room, m, uid); let nm = P.room.name + (m ? ' (gespiegelt)' : ' 2'), i = 2; while (P.plan.rooms.some(x => x.name === nm)) nm = `${P.room.name} ${++i}`; c.name = nm; P.plan.rooms.push(c); await save(); A().toast(`„${nm}“ angelegt`, 2500); openRoom(c.id); };
  bg.querySelector('[data-copy]').onclick = () => cp(false); bg.querySelector('[data-mirror]').onclick = () => cp(true);
};
// ---------- Foto und Notiz je Raum (Manuel 19.11.) – liegen im Grundriss, kommen ins PDF ----------
// Bild wählen oder aufnehmen (Android zeigt Kamera/Dateien zur Wahl), verkleinert als Daten-URL zurück
function pickImage(max, type = 'image/jpeg', q = 0.82) {
  return new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none'; document.body.appendChild(inp);
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return res(null); const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); const g = c.getContext('2d'); if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res({ data: c.toDataURL(type, q), w: c.width, h: c.height }); };
      img.onerror = () => { URL.revokeObjectURL(url); res(null); }; img.src = url; };
    inp.click(); });
}
async function photoAdd(given) {
  const r = P.room; if (!r) return; if ((r.photos || []).length >= 12) { A().toast('Höchstens 12 Fotos je Raum'); return; }
  const im = given || await pickImage(1600); if (!im) return; (r.photos = r.photos || []).push({ id: uid(), data: im.data, w: im.w, h: im.h, t: Date.now() }); await save(); roomUi(); A().toast('Foto beim Raum gespeichert', 1800);
}
async function noteEdit() {
  const r = P.room; if (!r) return; const v = await A().promptBox(`Notiz zu „${r.name}“`, 'z. B. Boden Parkett, Wand feucht …', r.note || ''); if (v == null) return;
  if (String(v).trim()) r.note = String(v).trim().slice(0, 400); else delete r.note; await save(); roomUi();
}
function photoView(id) {
  const r = P.room, ph = (r.photos || []).find(x => x.id === id); if (!ph) return;
  const bg = sheet(`<img src="${ph.data}" alt="" style="width:100%;max-height:60vh;object-fit:contain;border-radius:6px;background:#000"><div class="row2" style="margin-top:10px"><button class="danger" data-del>🗑 Foto löschen</button><button class="ghost" data-close>Schließen</button></div>`);
  bg.querySelector('[data-del]').onclick = async () => { r.photos = r.photos.filter(x => x.id !== id); if (!r.photos.length) delete r.photos; await save(); bg.remove(); roomUi(); };
}
function extraUi() {
  const r = P.room, el = $('#grExtra'); if (!el) return; el.innerHTML = ''; if (!r || (!r.note && !(r.photos || []).length)) { el.style.display = 'none'; return; } el.style.display = '';
  for (const ph of r.photos || []) { const i = document.createElement('img'); i.src = ph.data; i.alt = 'Foto'; i.onclick = () => photoView(ph.id); el.appendChild(i); }
  if (r.note) { const b = document.createElement('button'); b.className = 'ghost grnote'; b.textContent = '📝 ' + r.note; b.onclick = noteEdit; el.appendChild(b); }
}
async function objAdd(kind, old) {
  const r = P.room, def = G.OBJ[kind], ds = kind === 'DS', o = old || { id: uid(), kind, wall: 0, pos: 0, w: def[1], d: def[2], gap: 0 };
  const rows = [{ k: 'wall', label: 'An welcher Wand?', type: 'sel', opts: wallOpts(r), val: o.wall }];
  if (ds) rows.push({ k: 'knee', label: 'Kniestockhöhe (cm)', val: o.knee || '' }, { k: 'd', label: 'Abstand von der Wand bis zur vollen Raumhöhe (cm)', val: old ? o.d : '' });
  else rows.push({ k: 'pos', label: 'Abstand von der Ecke (cm)', val: old ? o.pos : '' }, { k: 'w', label: 'Breite entlang der Wand (cm)', val: o.w, ph: String(def[1]) }, { k: 'd', label: 'Tiefe in den Raum (cm)', val: o.d, ph: String(def[2]) }, { k: 'gap', label: 'Abstand von der Wand (cm)', val: o.gap || 0 });
  const v = await formSheet(def[0], ds ? 'Die Schräge wird als gestrichelte Linie eingezeichnet.' : 'Die Ecke ist der Beginn der Wand in Laufrichtung. Der Laserwert landet im markierten Feld.', rows); if (!v) return;
  const wl = r.walls[+v.wall].cm; o.wall = +v.wall;
  if (ds) { if (!(v.d > 0)) { A().toast('Bitte den Abstand eingeben'); return; } o.d = v.d; if (v.knee > 0) o.knee = v.knee; else delete o.knee; o.pos = 0; o.w = wl; }
  else { if (!(v.pos >= 0) || !(v.w > 0) || !(v.d > 0)) { A().toast('Bitte Abstand, Breite und Tiefe eingeben'); return; } if (v.pos + v.w > wl + 2) { A().toast(`Passt nicht: die Wand ist nur ${Math.round(wl)} cm lang`, 3500); return; } o.pos = v.pos; o.w = v.w; o.d = v.d; o.gap = v.gap > 0 ? v.gap : 0; }
  if (!old) (r.objs = r.objs || []).push(o); await save(); roomUi();
}
function objEdit(o) {
  const bg = sheet(`<h2>${esc(G.OBJ[o.kind][0])} an Wand ${o.wall + 1}</h2><div class="row2"><button class="ghost" data-ed>✎ Ändern</button><button class="danger" data-del>Löschen</button></div><button class="ghost" data-close style="width:100%;margin-top:8px">Schließen</button>`);
  bg.querySelector('[data-ed]').onclick = () => { bg.remove(); objAdd(o.kind, o); }; bg.querySelector('[data-del]').onclick = async () => { bg.remove(); P.room.objs = P.room.objs.filter(x => x !== o); await save(); roomUi(); };
}
async function linkAdd() {
  const r = P.room, others = P.plan.rooms.filter(x => x !== r && x.closed); if (!others.length) { A().toast('Dafür muss ein zweiter Raum fertig gemessen sein'); return; }
  const v = await formSheet('Nachbarraum Wand an Wand', 'Die beiden Wände liegen Rücken an Rücken. Versatz 0 = der Beginn deiner Wand liegt genau gegenüber dem Ende der Nachbarwand.', [
    { k: 'wall', label: 'Meine Wand', type: 'sel', opts: wallOpts(r) }, { k: 'to', label: 'Nachbarraum', type: 'sel', opts: others.map(x => [x.id, x.name]), onchange: (id, bg) => { const e = bg.querySelector('[data-k="toWall"]'); e.innerHTML = ''; for (const [i, t] of wallOpts(P.plan.rooms.find(x => x.id === id))) { const o = document.createElement('option'); o.value = i; o.textContent = t; e.appendChild(o); } } },
    { k: 'toWall', label: 'Seine Wand', type: 'sel', opts: wallOpts(others[0]) }, { k: 'off', label: 'Versatz entlang der Wand (cm)', val: 0 }, { k: 'thick', label: 'Wandstärke dazwischen (cm)', ph: `${P.plan.wall || 15} (Standard)` }]);
  if (!v) return; const l = { id: uid(), wall: +v.wall, to: v.to, toWall: +v.toWall, off: v.off || 0 }; if (v.thick > 0 && v.thick < 200) l.thick = v.thick;
  (r.links = r.links || []).push(l); await save(); roomUi(); A().toast('Verbunden – in „Wohnung ansehen“ siehst du, ob es passt', 3000);
}
async function nicheAdd() {
  const r = P.room; const v = await formSheet('Nische oder Vorsprung', 'Nische: der Raum wird dort größer. Vorsprung: er wird kleiner (z. B. Kaminvorbau).', [
    { k: 'wall', label: 'In welcher Wand?', type: 'sel', opts: wallOpts(r) }, { k: 'kind', label: 'Art', type: 'sel', opts: [['n', 'Nische'], ['v', 'Vorsprung']] }, { k: 'a', label: 'Abstand von der Ecke (cm)' }, { k: 'b', label: 'Breite (cm)' }, { k: 't', label: 'Tiefe (cm)' }]);
  if (!v) return; const i = +v.wall;
  if ((r.ops || []).some(o => o.wall === i) || (r.objs || []).some(o => o.wall === i) || (r.links || []).some(o => o.wall === i)) { A().toast('An dieser Wand hängt schon etwas (Tür, Fenster, Objekt) – bitte zuerst entfernen', 4500); return; }
  if (!G.insertNiche(r, i, v.a, v.b, v.t, v.kind === 'v')) { A().toast('Passt nicht: Abstand + Breite müssen kürzer als die Wand sein', 4000); return; }
  delete r.diag; delete r.diags; r.adjust = 0; await save(); roomUi();
}
// Kontrollmaß quer durch die Wohnung: gemessener Abstand zweier gegenüberliegender Wände gegen den Plan
$('#grCheck').onclick = async () => {
  const p = P.plan, rs = p.rooms.filter(x => x.closed); if (!rs.length) return;
  const sw = (k, bg, id) => { const e = bg.querySelector(`[data-k="${k}"]`); e.innerHTML = ''; for (const [i, t] of wallOpts(p.rooms.find(x => x.id === id))) { const o = document.createElement('option'); o.value = i; o.textContent = t; e.appendChild(o); } };
  const v = await formSheet('Kontrollmaß', 'Ein langes Maß von einer Wand zur gegenüberliegenden, auch durch mehrere Räume. Die App vergleicht es mit dem Plan.', [
    { k: 'a', label: 'Von Raum', type: 'sel', opts: rs.map(x => [x.id, x.name]), onchange: (id, bg) => sw('wa', bg, id) }, { k: 'wa', label: 'Wand', type: 'sel', opts: wallOpts(rs[0]) },
    { k: 'b', label: 'Bis Raum', type: 'sel', opts: rs.map(x => [x.id, x.name]), onchange: (id, bg) => sw('wb', bg, id) }, { k: 'wb', label: 'Wand', type: 'sel', opts: wallOpts(rs[0]) }, { k: 'cm', label: 'Gemessen (cm)' }]);
  if (!v || !(v.cm > 0)) return; (p.checks = p.checks || []).push({ id: uid(), a: v.a, wa: +v.wa, b: v.b, wb: +v.wb, cm: v.cm }); await save(); flatUi();
};

// ---------- Stufe 3: PDF + DXF, Dropbox ----------
let fontBytes = null;
// Eigenes Logo im Schriftfeld des PDF (optional, je Gerät): PNG als Daten-URL in localStorage, Schalter mb_grLogoOn
const logoGet = () => { try { return localStorage.getItem('mb_grLogoOn') === '1' ? localStorage.getItem('mb_grLogo') : null; } catch (e) { return null; } };
async function planFiles() {
  if (!fontBytes) fontBytes = new Uint8Array(await (await fetch('vendor/NotoSans.woff')).arrayBuffer());
  const base = O.fileBase(P.plan), pdf = await O.buildPlanPdf(window.PDFLib, window.fontkit, fontBytes, P.plan, flatInfo().msgs, { logo: logoGet() }), dxf = O.buildDxf(P.plan);
  const cv = document.createElement('canvas'); drawFlat(cv, true, { px: 6400 }); const png = await new Promise(r => cv.toBlob(r, 'image/png'));   // höchste Auflösung, die Geräte sicher schaffen (max. 16 Mio. Bildpunkte)
  return { pdf: new File([pdf], base + '.pdf', { type: 'application/pdf' }), dxf: new File([dxf.text], base + '.dxf', { type: 'application/dxf' }), png: png ? new File([png], base + '.png', { type: 'image/png' }) : null, pngSize: [cv.width, cv.height] };
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
    <button class="pri" data-dbx style="width:100%">☁ PDF + DXF + Bild in die Dropbox</button><p class="mute" data-where style="margin:4px 0 10px;font-size:13px"></p>
    <div class="row2"><button class="ghost" data-pdf>PDF speichern</button><button class="ghost" data-dxf>DXF speichern</button></div><button class="ghost" data-png style="width:100%;margin-top:8px">Bild (PNG) speichern</button>
    <button class="ghost" data-share style="width:100%;margin-top:8px">Teilen …</button>
    <label style="display:flex;gap:10px;align-items:center;margin:12px 0 0;font-size:14px"><input type="checkbox" data-logoon style="width:auto"> Eigenes Logo im Schriftfeld (PDF)</label><div data-logobox style="display:none;align-items:center;gap:10px;margin-top:6px"><img data-logoimg alt="" style="max-height:34px;max-width:140px;background:#fff;border:1px solid var(--line);border-radius:4px;padding:2px"><button class="ghost" data-logopick style="padding:8px 12px">Logo wählen</button></div><button class="ghost" data-close style="width:100%;margin-top:8px">Schließen</button>`);
  { const on = bg.querySelector('[data-logoon]'), box = bg.querySelector('[data-logobox]'), img = bg.querySelector('[data-logoimg]'), ls = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const upd = () => { const d = ls('mb_grLogo'); on.checked = ls('mb_grLogoOn') === '1' && !!d; box.style.display = on.checked || d ? 'flex' : 'none'; img.style.display = d ? '' : 'none'; if (d) img.src = d; };
    const pick = async () => { const im = await pickImage(480, 'image/png'); if (!im) return false; try { localStorage.setItem('mb_grLogo', im.data); localStorage.setItem('mb_grLogoOn', '1'); } catch (e) { A().toast('Logo ist zu groß', 3000); return false; } return true; };
    on.onchange = async () => { if (on.checked && !ls('mb_grLogo')) { if (!await pick()) on.checked = false; } else { try { localStorage.setItem('mb_grLogoOn', on.checked ? '1' : '0'); } catch (e) { } } upd(); };
    bg.querySelector('[data-logopick]').onclick = async () => { await pick(); upd(); }; upd(); }
  bg.querySelector('[data-where]').textContent = dbx ? 'Ordner: ' + A().dropbox.pathFor(planSub()) : 'Dropbox ist nicht verbunden (⚙ → Dropbox).';
  bg.querySelector('[data-dbx]').disabled = !dbx;
  const make = async () => { A().toast('Grundriss wird erstellt …', 8000); return planFiles(); };
  bg.querySelector('[data-pdf]').onclick = async () => { const f = await make(); saveLocal(f.pdf); A().toast('PDF gespeichert: ' + f.pdf.name, 3000); };
  bg.querySelector('[data-dxf]').onclick = async () => { const f = await make(); saveLocal(f.dxf); A().toast('DXF gespeichert: ' + f.dxf.name, 3000); };
  bg.querySelector('[data-png]').onclick = async () => { const f = await make(); if (!f.png) { A().toast('Das Bild konnte nicht erzeugt werden'); return; } saveLocal(f.png); A().toast(`Bild gespeichert: ${f.pngSize[0]} × ${f.pngSize[1]} Bildpunkte`, 3500); };
  bg.querySelector('[data-share]').onclick = async () => { const f = await make(); if (!await shareFiles([f.pdf, f.dxf, f.png].filter(Boolean))) { saveLocal(f.pdf); saveLocal(f.dxf); if (f.png) saveLocal(f.png); A().toast('Teilen geht hier nicht – beide Dateien wurden gespeichert', 3500); } };
  bg.querySelector('[data-dbx]').onclick = async () => {
    const bt = bg.querySelector('[data-dbx]'); bt.disabled = true; bt.textContent = 'Wird hochgeladen …';
    try {
      const f = await planFiles(), sub = planSub();
      if (!navigator.onLine) { await A().queueAdd(f.pdf, sub); await A().queueAdd(f.dxf, sub); if (f.png) await A().queueAdd(f.png, sub); p.exports = [...(p.exports || []), { t: Date.now(), how: 'wartet auf Netz' }]; await save(); bg.remove(); A().toast('Kein Netz – PDF und DXF werden hochgeladen, sobald wieder Netz da ist', 4500); renderPlan(); return; }
      const a = await A().dbxUpload(f.pdf, sub), b = await A().dbxUpload(f.dxf, sub); if (f.png) await A().dbxUpload(f.png, sub);
      p.exports = [...(p.exports || []), { t: Date.now(), how: 'in Dropbox', path: a.path, dxf: b.path }].slice(-20); await save(); bg.remove(); A().beep(true); A().toast('In Dropbox gespeichert ✓ ' + a.path.split('/').slice(-3).join('/') + ' + DXF + Bild', 5000, 'ok'); renderPlan();
    } catch (e) { bt.disabled = false; bt.textContent = '☁ PDF + DXF + Bild in die Dropbox'; A().toast('Hochladen fehlgeschlagen: ' + e.message, 6000); }
  };
};

// Wand bearbeiten: Länge ändern, Ecke umdrehen
// ---------- Wandansicht: die Wand von innen gesehen, mit Tür, Fenster, Parapet, Raumhöhe und Dachschräge ----------
function drawElev(cv, e, wallNo) {
  const W = cv.clientWidth || 320, H = 240, dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim() || '#888', ink = col('--text'), mute = col('--mute'), acc = col('--acc'), warn = '#e8590c', mono = css.getPropertyValue('--mono') || 'monospace';
  const pl = 46, pr = 16, pt = 16, pb = 58, k = Math.min((W - pl - pr) / e.L, (H - pt - pb) / e.H), ox = pl + (W - pl - pr - e.L * k) / 2, oy = H - pb, X = x => ox + x * k, Y = y => oy - y * k;
  g.beginPath(); e.outline.forEach((q, i) => i ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y))); g.closePath(); g.fillStyle = col('--acc-soft'); g.fill(); g.strokeStyle = ink; g.lineWidth = 2.5; g.lineJoin = 'round'; g.stroke();
  g.font = `600 12px ${mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const txt = (t, x, y, c = ink, rot = 0) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = c; g.fillText(t, 0, 0); g.restore(); };
  for (const o of e.ops) { const T = o.type === 'T', c = T ? warn : acc; g.fillStyle = col('--panel'); g.fillRect(X(o.x), Y(o.y + o.h), o.w * k, o.h * k); g.strokeStyle = c; g.lineWidth = 2; g.setLineDash(o.guessH ? [5, 4] : []); g.strokeRect(X(o.x), Y(o.y + o.h), o.w * k, o.h * k); g.setLineDash([]);
    if (!T) { g.beginPath(); g.moveTo(X(o.x + o.w / 2), Y(o.y)); g.lineTo(X(o.x + o.w / 2), Y(o.y + o.h)); g.moveTo(X(o.x), Y(o.y + o.h / 2)); g.lineTo(X(o.x + o.w), Y(o.y + o.h / 2)); g.lineWidth = 1; g.stroke(); }
    if (o.w * k > 34) txt(`${Math.round(o.w)}/${o.guessH ? '?' : Math.round(o.h)}`, X(o.x + o.w / 2), Y(o.y + o.h / 2) + (T ? 0 : -9), c);
    if (!T && o.w * k > 34) txt(o.guessY ? 'P ?' : `P ${Math.round(o.y)}`, X(o.x + o.w / 2), Y(o.y / 2), mute); }
  // Maße: Länge unten, Höhe links, Kniestock
  g.strokeStyle = mute; g.lineWidth = 1; const dim = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  dim(X(0), oy + 16, X(e.L), oy + 16); dim(X(0), oy + 11, X(0), oy + 21); dim(X(e.L), oy + 11, X(e.L), oy + 21); txt(`${Math.round(e.L)} cm`, X(e.L / 2), oy + 30);
  const hl = e.top[0].y; dim(ox - 14, Y(0), ox - 14, Y(hl)); dim(ox - 19, Y(0), ox - 9, Y(0)); dim(ox - 19, Y(hl), ox - 9, Y(hl)); txt(e.hasRh || hl < e.H ? String(Math.round(hl)) : '?', ox - 28, Y(hl / 2), ink, -Math.PI / 2);
  if (e.slope && e.knee == null) { const hi = e.top.reduce((m, q) => Math.max(m, q.y), 0); const fl = e.top.filter(q => q.y >= hi - 1e-6), fx = (fl[0].x + fl[fl.length - 1].x) / 2; if (hi > hl + 1 || e.top[e.top.length - 1].y < hi - 1) txt(`${e.hasRh ? Math.round(hi) : '?'}`, X(fx), Y(hi) + 13, mute); }
  if (e.knee != null) txt('Kniestock – darüber Dachschräge', X(e.L / 2), Y(e.knee) - 10, mute);
  txt(`Wand ${wallNo} von innen`, W / 2, H - 6, mute);
}
function wallView(i) {
  const r = P.room, n = r.walls.length; let k = i;
  const bg = sheet(`<h2 data-t></h2><canvas data-cv style="width:100%;display:block;border:1px solid var(--line);border-radius:6px;background:var(--bg)"></canvas><p class="mute" data-info style="margin:8px 0 0;font-size:14px"></p>
    <div class="row2" style="margin-top:10px"><button class="ghost" data-prev>‹ Wand davor</button><button class="ghost" data-next>Wand danach ›</button></div><button class="ghost" data-close style="width:100%;margin-top:8px">Schließen</button>`);
  const show = () => { const e = G.elev(r, k); bg.querySelector('[data-t]').textContent = `Wandansicht · Wand ${k + 1} von ${n}`; drawElev(bg.querySelector('[data-cv]'), e, k + 1);
    const miss = [!r.rh && 'Raumhöhe fehlt (angenommen 2,50 m)', e.ops.some(o => o.guessH || o.guessY) && 'gestrichelt = Höhe noch nicht gemessen'].filter(Boolean);
    bg.querySelector('[data-info]').textContent = `Wandfläche ${fmtA(e.net / 10000)}${e.ops.length ? ` (ohne Abzug ${fmtA(e.gross / 10000)})` : ''}${miss.length ? ' · ' + miss.join(' · ') : ''}`; };
  bg.querySelector('[data-prev]').onclick = () => { k = (k - 1 + n) % n; show(); }; bg.querySelector('[data-next]').onclick = () => { k = (k + 1) % n; show(); }; show();
}
function editWall(i) {
  const r = P.room, w = r.walls[i];
  const bg = sheet(`<h2>Wand ${i + 1}: ${Math.round(w.cm)} cm</h2><div class="row2"><button class="ghost" data-len>✎ Länge ändern</button><button class="ghost" data-re>📏 Neu messen</button></div>
    <label class="f">Ecke nach dieser Wand</label><div class="row2"><button class="${w.turn != null && w.turn < 0 ? 'pri' : 'ghost'}" data-t="-90">↰ links</button><button class="${w.turn > 0 ? 'pri' : 'ghost'}" data-t="90">↱ rechts</button></div>
    ${r.closed ? '<button class="ghost" data-elev style="width:100%;margin-top:8px">▦ Wandansicht</button>' : ''}
    <button class="danger" data-delw style="width:100%;margin-top:14px">🗑 Wand löschen</button>
    <button class="ghost" data-close style="width:100%;margin-top:10px">Schließen</button>`);
  if (r.closed) bg.querySelector('[data-elev]').onclick = () => { bg.remove(); wallView(i); };
  const reclose = async () => { if (r.closed) { const g = G.gap(r.walls); r.adjust = g.len > 0.5 ? g.len : 0; delete r.diag; } await save(); roomUi(); };
  bg.querySelector('[data-len]').onclick = async () => { bg.remove(); const v = await A().promptBox(`Wand ${i + 1} in cm`, '', String(Math.round(w.cm))); if (v == null) return; const cm = parseFloat(String(v).replace(',', '.')); if (!(cm > 0 && cm < 10000)) return; w.cm = cm; delete w.calc; reclose(); };
  bg.querySelector('[data-delw]').onclick = () => { bg.remove(); deleteWall(i); };
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
  gfxRest(g, gf, X, Y, { fill: col('--acc-soft'), cut: col('--bg'), panel: col('--panel'), win: col('--acc'), door: col('--warn'), dim: col('--text'), wall: col('--text'), mono });
  if (P.op && P.op.wall != null) { const a = pts[P.op.wall], b = pts[(P.op.wall + 1) % n]; g.strokeStyle = col('--warn'); g.lineWidth = 6; g.beginPath(); g.moveTo(X(a), Y(a)); g.lineTo(X(b), Y(b)); g.stroke(); g.fillStyle = col('--warn'); g.beginPath(); g.arc(X(a), Y(a), 9, 0, 7); g.fill(); }
  if (P.fan && pts[P.fan.k]) { const q = pts[P.fan.k]; g.strokeStyle = col('--warn'); g.lineWidth = 2; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(X(pts[0]), Y(pts[0])); g.lineTo(X(q), Y(q)); g.stroke(); g.setLineDash([]); g.fillStyle = col('--warn'); g.beginPath(); g.arc(X(q), Y(q), 8, 0, 7); g.fill(); }
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
window.__planX = { photoAdd };
window.__plan = {
  // Messwert: nur wenn der Raum-Bildschirm offen ist; sonst bekommt ihn das Massblatt wie bisher
  measure(cm) {
    if ($('#planRoom').classList.contains('on') && P.room) {
      if (P.remeasure != null && P.room.walls[P.remeasure]) { const w = P.room.walls[P.remeasure]; w.cm = cm; delete w.calc; P.remeasure = null; if (P.room.closed) { const g = G.gap(P.room.walls); P.room.adjust = g.len > 0.5 ? g.len : 0; delete P.room.diag; } A().beep(true); save().then(roomUi); return true; }
      measure(cm); return true;
    }
    if ($('#planFlat').classList.contains('on')) { if (!fillInput(cm)) { A().toast(`${Math.round(cm)} cm gemessen – für ein Kontrollmaß oben 📏 antippen`, 2500); A().beep(false); } return true; }
    if ($('#plan').classList.contains('on')) { A().toast(`${Math.round(cm)} cm gemessen – erst einen Raum öffnen`, 2000); A().beep(false); return true; }
    return false;
  },
  // Zurück: Raum → Grundriss → Startseite (Reiter Grundriss)
  back(cur, viaPop) {
    if (cur === 'planFlat') { renderPlan(); A().show('plan', viaPop); A().keepAwake(true); return true; }
    if (cur === 'planRoom') { P.trash = []; P.room = null; P.hold = null; P.op = null; P.thInput = null; P.rect = null; P.fan = null; P.wantDiag = false; P.wantRh = false; P.remeasure = null; renderPlan(); A().show('plan', viaPop); A().keepAwake(true); return true; }
    if (cur === 'plan') { P.plan = null; A().show('home', viaPop); setTab('gr'); return true; }
    return false;
  },
  state: P, store, setTab, G, O,
};
