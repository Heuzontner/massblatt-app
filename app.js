import { db, uid } from './db.js';
import { Laser } from './ble.js';
import { TEMPLATES, arrowsFromObjects, newArrow, drawArrows, labelBoxes } from './arrows.js';
import { grayFromImage, magnetArrow } from './magnet.js';
import { buildPdf } from './pdf.js';
import { detect, loadModel, modelState } from './detect.js';
import { PIN } from './pin.js';
import { dropbox, DbxError } from './dropbox.js';
import { gcal, parseAddress } from './gcal.js';

const VERSION = '3.0.0';
// Neu in dieser Version – wird nach dem Update einmal angezeigt (Idee 15)
const NEWS = ['Heutige Termine stehen oben auf der Startseite – antippen legt das Projekt an, „Tag vorbereiten“ legt alle auf einmal an', 'Straßen offline: in ⚙ Kunden & Straßen Orte laden (z. B. Linz) → Straßen-Vorschläge mit PLZ/Ort auch ohne Netz', 'Google: Kalender auswählbar (z. B. nur „Aufmaß“)'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DEFAULT_ROOMS = [['Kz', 'Kinderz.'], ['Sz', 'Schlafz.'], ['Wz', 'Wohnz.'], ['Wk', 'Wohnküche'], ['Kü', 'Küche'], ['Bad', ''], ['WC', ''], ['Vr', 'Vorraum'],
  ['Ar', 'Abstellr.'], ['Lo', 'Loggia'], ['Eg', 'Eingang'], ['Rh', 'Raumhöhe']];

const S = { project: null, shots: [], room: null, shot: null, active: null, stream: null, ai: true, wake: null };
const laser = new Laser();

// ---------------- Protokoll (für den Fehlerbericht) ----------------
const LOG = [];
function log(...a) { const line = new Date().toISOString().slice(11, 19) + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); LOG.push(line); if (LOG.length > 300) LOG.shift(); }
function persistErr(kind, msg) {
  try { const e = JSON.parse(localStorage.getItem('mb_errs') || '[]'); e.push({ t: new Date().toISOString(), kind, msg: String(msg).slice(0, 400), v: VERSION }); localStorage.setItem('mb_errs', JSON.stringify(e.slice(-30))); } catch (e) { }
}
window.addEventListener('error', e => { log('FEHLER', e.message, e.filename ? e.filename.split('/').pop() + ':' + e.lineno : ''); persistErr('error', (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', e => { const m = e.reason && (e.reason.message || String(e.reason)); log('FEHLER (Promise)', m); persistErr('promise', m); });
// lokales Datum als JJJJ-MM-TT (nicht UTC – sonst stimmt das Datum nach Mitternacht nicht)
const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Objekt-URLs je Blob nur einmal anlegen (sonst wächst der Speicher mit jeder Liste)
const urlCache = new WeakMap();
const blobUrl = b => { let u = urlCache.get(b); if (!u) { u = URL.createObjectURL(b); urlCache.set(b, u); } return u; };

// ---------------- Hilfen ----------------
function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
// ---------------- Zurück-Taste (Android) / Browser-Verlauf ----------------
// Jeder tiefere Bildschirm und jedes offene Blatt bekommt einen Eintrag im Verlauf. „Zurück“ schließt dann
// das oberste Blatt bzw. geht einen Bildschirm zurück, statt die App zu verlassen. Zählung über history.state.mb.
const nav = { stack: ['home'], suppress: 0, pendingPush: 0, popClosing: 0, layers: [], lastDepth: 0 };
const curDepth = () => { try { return (history.state && history.state.mb) || 0; } catch (e) { return 0; } };
function navPushNow() { try { const d = curDepth() + 1; history.pushState({ mb: d }, '', location.href); nav.lastDepth = d; } catch (e) { } }
function navPush() { if (nav.suppress > 0) { nav.pendingPush++; return; } navPushNow(); } // während ein „zurück“ noch läuft: erst danach eintragen
function navBackN(n) {
  const d = curDepth(); n = Math.min(n, d); if (n <= 0) { nav.lastDepth = d; return; }
  nav.suppress++; nav.lastDepth = d - n;
  try { history.go(-n); } catch (e) { nav.suppress--; }
}
function show(id, viaPop = false) {
  const st = nav.stack, cur = st[st.length - 1];
  if (id !== cur) {
    const i = st.indexOf(id);
    if (i >= 0) { const n = st.length - 1 - i; st.length = i + 1; navBackN(viaPop ? n - 1 : n); }
    else if (id === 'cam' && cur === 'ed') st[st.length - 1] = 'cam'; // Foto fertig → Kamera ersetzt den Editor (kein neuer Eintrag)
    else { st.push(id); if (!viaPop) navPush(); }
  }
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id)); if (id !== 'cam') stopCam();
  offlineUi();
}
const isLayerEl = el => !!(el && el.nodeType === 1 && (el.classList.contains('sheet-bg') || el.id === 'pvw' || el.id === 'keypad'));
const layerOpen = new WeakSet();
new MutationObserver(recs => {
  let opens = 0, closes = 0;
  const seen = new Set();
  const check = el => {
    if (!isLayerEl(el) || seen.has(el)) return; seen.add(el);
    const on = el.isConnected && el.classList.contains('on');
    if (on && !layerOpen.has(el)) { layerOpen.add(el); nav.layers.push(el); opens++; }
    else if (!on && layerOpen.has(el)) { layerOpen.delete(el); nav.layers = nav.layers.filter(x => x !== el); closes++; }
  };
  for (const r of recs) { if (r.type === 'attributes') check(r.target); else { r.addedNodes.forEach(check); r.removedNodes.forEach(check); } }
  if (nav.popClosing) closes = 0; // vom Zurück-Druck ausgelöst: Eintrag hat der Browser schon entfernt
  const net = opens - closes;
  if (net > 0) for (let i = 0; i < net; i++) navPush(); else if (net < 0) navBackN(-net);
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
function closeLayer(el) {
  const byId = { setSheet: '#setClose', pvw: '#pvwClose', calSheet: '#calClose', statSheet: '#statClose', custSheet: '#cCancel' };
  if (el.id === 'keypad') return setKb(false);
  if (el.id === 'arrSheet') return closeArr();
  if (el.id === 'demo') return el.classList.remove('on');
  if (el.id === 'roomSheet') return el.dispatchEvent(new MouseEvent('click', { bubbles: true })); // Tipp daneben = abgebrochen
  if (byId[el.id]) { const b = $(byId[el.id]); if (b) return b.click(); }
  const b = el.querySelector('[data-close]') || el.querySelector('button.ghost'); // dynamische Blätter: „Schließen“ bzw. „Abbrechen“
  if (b) return b.click();
  el.classList.remove('on');
}
function goBack(viaPop) {
  const st = nav.stack, cur = st[st.length - 1];
  if (cur === 'home') return false;
  const prev = st[st.length - 2] || 'home';
  if (cur === 'ed') leaveEditor(prev, viaPop);
  else if (cur === 'cam') leaveCam(viaPop);
  else { renderHome(); show('home', viaPop); }
  return true;
}
window.addEventListener('popstate', () => {
  if (nav.suppress > 0) {
    nav.suppress--; nav.lastDepth = curDepth();
    if (nav.pendingPush) { const n = nav.pendingPush; nav.pendingPush = 0; for (let i = 0; i < n; i++) navPushNow(); }
    return;
  }
  const d = curDepth(); let diff = nav.lastDepth - d; nav.lastDepth = d;
  if (diff <= 0) return; // vorwärts oder nichts von uns → nichts tun
  nav.popClosing++;
  try {
    while (diff-- > 0) {
      const top = nav.layers[nav.layers.length - 1];
      if (top) closeLayer(top); else if (!goBack(true)) break;
    }
  } finally { setTimeout(() => nav.popClosing--, 80); }
});
nav.lastDepth = curDepth();
// Rückmeldung nur per Vibration (am iPhone erlaubt Apple Web-Apps keine Vibration)
function beep(ok = true) { try { if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]); } catch (e) { } }
// toBlob hängt auf manchen Geräten gelegentlich → Zeitlimit, dann toDataURL
function canvasToBlob(c, type = 'image/jpeg', q = 0.88) {
  return new Promise(res => {
    let done = false;
    const fb = () => { if (done) return; done = true; const d = c.toDataURL(type, q); const b = atob(d.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); res(new Blob([u], { type })); };
    const t = setTimeout(fb, 1500);
    try { c.toBlob(b => { if (done) return; if (!b) return fb(); done = true; clearTimeout(t); res(b); }, type, q); } catch (e) { fb(); }
  });
}
const blobToB64 = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const b64ToBlob = async d => (await fetch(d)).blob();
const blobToImg = b => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = blobUrl(b); });
async function fileToImgBytes(blob) {
  // beliebiges Bild → PNG-Bytes (für pdf-lib)
  const im = await blobToImg(blob);
  const c = document.createElement('canvas'); const sc = Math.min(1, 800 / Math.max(im.width, im.height));
  c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const b = await canvasToBlob(c, 'image/png');
  return { type: 'png', bytes: new Uint8Array(await b.arrayBuffer()) };
}

// ---------------- Laser ----------------
function laserUi() {
  const st = laser.state;
  $$('[data-laser]').forEach(el => {
    el.classList.toggle('ok', st === 'verbunden');
    el.classList.toggle('busy', st === 'suche' || st === 'verbinde' || st === 'getrennt');
    el.querySelector('span').textContent = st === 'verbunden' ? 'Laser ✓' : st === 'aus' ? 'Laser' : st === 'getrennt' ? 'Laser …' : 'Verbinde …';
  });
}
laser.addEventListener('state', e => {
  laserUi();
  if (e.detail.state === 'verbunden') { toast('Laser verbunden ✓'); laserHint(); }
  if (e.detail.state === 'getrennt') toast('Laser getrennt – verbinde neu …');
});
// Hinweis zum Messmodus (Idee 97): im Flächen-/Volumen-/indirekten Modus schickt der GLM Rechenwerte, keine Längen
function laserHint() {
  let off = false; try { off = localStorage.getItem('mb_laserHint') === '0'; } catch (e) { }
  if (off || $('#laserHintBox')) return;
  const bg = document.createElement('div'); bg.className = 'sheet-bg on'; bg.id = 'laserHintBox';
  bg.innerHTML = `<div class="sheet"><h2>Laser verbunden ✓</h2><ul class="news">
    <li>Am GLM <b>Einzelmessung (Länge)</b> einstellen – nicht Fläche, Volumen oder indirekt, sonst kommen Rechenwerte statt Maße.</li>
    <li><b>Referenz Hinterkante</b> (Gerät liegt an der Wand/Laibung an).</li>
    <li>Rote Taste = messen, der Wert springt in den blinkenden Pfeil.</li></ul>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="ghost" data-never style="flex:1">Nicht mehr zeigen</button><button class="pri" data-close style="flex:1">OK</button></div></div>`;
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  bg.querySelector('[data-never]').onclick = () => { try { localStorage.setItem('mb_laserHint', '0'); } catch (e) { } bg.remove(); };
  document.body.appendChild(bg);
}
laser.addEventListener('measure', e => onMeasure(e.detail.cm, Math.round(e.detail.meters * 1000)));
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-laser]');
  if (!el) return;
  if (laser.state === 'verbunden') { toast('Laser ist verbunden. Trennen in den Einstellungen.'); return; }
  try { await laser.connect(); }
  catch (err) {
    laserUi();
    if (err.name !== 'NotFoundError') toast('Laser: ' + err.message, 4000);
  }
});

// ---------------- Projekte ----------------
// Projekte ohne Papierkorb (gelöschte bleiben 30 Tage als p.deleted liegen)
const TRASH_DAYS = 30;
async function liveProjects() { return (await db.all('projects')).filter(p => !p.deleted); }
async function purgeTrash() {
  const lim = Date.now() - TRASH_DAYS * 864e5; let n = 0;
  for (const p of await db.all('projects')) if (p.deleted && p.deleted < lim) { for (const sh of await db.shotsOf(p.id)) await db.del('shots', sh.id); await db.del('projects', p.id); n++; }
  if (n) log('Papierkorb geleert', n);
}
let homeSort = 'neu', showArch = false, showTrash = false, selMode = false;
const selIds = new Set();
try { homeSort = localStorage.getItem('mb_sort') || 'neu'; } catch (e) { }
$('#projSearch').addEventListener('input', () => renderHome());
$$('#sortChips button[data-sort]').forEach(b => b.onclick = () => { homeSort = b.dataset.sort; try { localStorage.setItem('mb_sort', homeSort); } catch (e) { } renderHome(); });
$('#archChip').onclick = () => { showArch = !showArch; showTrash = false; renderHome(); };
$('#trashChip').onclick = () => { showTrash = !showTrash; showArch = false; renderHome(); };
function setSelMode(on) { selMode = on; selIds.clear(); $('.plist').classList.toggle('sel', on); $('#selChip').classList.toggle('sel', on); updateSelBar(); renderHome(); }
$('#selChip').onclick = () => setSelMode(!selMode);
$('#selCancel').onclick = () => setSelMode(false);
function updateSelBar() { $('#selPdf').textContent = `PDF aus ${selIds.size} Projekt${selIds.size === 1 ? '' : 'en'}`; $('#selPdf').disabled = !selIds.size; }
$('#selPdf').onclick = async () => {
  if (!selIds.size) return;
  const all = await liveProjects();
  const sel = all.filter(p => selIds.has(p.id)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de', { numeric: true }));
  const empty = [];
  for (const p of sel) if (!(await db.shotsOf(p.id)).length) empty.push(p.name || 'Ohne Namen');
  if (empty.length && !await confirmBox(`${empty.length} Projekt(e) ohne Fotos`, 'Trotzdem', 'Abbrechen', 'ghost', 'Ohne Fotos: ' + empty.join(', '))) return;
  const b = $('#selPdf'); b.disabled = true; b.textContent = 'Erstelle …';
  try {
    const file = await makeCombinedPdf(sel);
    const first = sel[0];
    const c = first && first.kundeId && ((await db.setting('customers')) || []).find(x => x.id === first.kundeId);
    await sharePdf(file, { title: `Sammel-PDF (${sel.length} Projekte)`, dbxSub: withYear(c ? (c.dbx || c.name) : (first && first.firma) || '', first),
      onLock: async how => { for (const p of sel) { p.locked = { at: Date.now(), how: how + ' (Sammel-PDF)' }; noteExport(p, how + ' (Sammel-PDF)'); await db.put('projects', p); } setSelMode(false); } });
  } catch (e) { console.error(e); toast('PDF-Fehler: ' + e.message, 5000); }
  finally { updateSelBar(); }
};
let allShotCounts = null;
async function renderHome() {
  todayBox();
  $$('#sortChips button[data-sort]').forEach(b => b.classList.toggle('sel', b.dataset.sort === homeSort));
  $('#archChip').classList.toggle('sel', showArch); $('#trashChip').classList.toggle('sel', showTrash);
  let list = await db.all('projects');
  const q = normStreet($('#projSearch').value);
  const trash = list.filter(p => p.deleted); list = list.filter(p => !p.deleted);
  const tc = $('#trashChip'); tc.style.display = trash.length ? '' : 'none'; tc.textContent = `🗑 Papierkorb (${trash.length})`;
  const archN = list.filter(p => p.archived).length;
  $('#archChip').textContent = `📦 Archiv${archN ? ' (' + archN + ')' : ''}`;
  if (showTrash) list = trash; else {
    if (q) list = list.filter(p => normStreet([p.name, p.firma, p.str].join(' ')).includes(q));
    list = list.filter(p => !!p.archived === showArch);
  }
  const inArch = q ? (await liveProjects()).filter(p => p.archived && normStreet([p.name, p.firma, p.str].join(' ')).includes(q)).length : 0;
  // Fotoanzahl und Ampel in einem Durchgang (statt einer Abfrage je Projekt)
  const counts = new Map(), byProj = new Map();
  for (const sh of await db.all('shots')) { counts.set(sh.projectId, (counts.get(sh.projectId) || 0) + 1); if (!byProj.has(sh.projectId)) byProj.set(sh.projectId, []); byProj.get(sh.projectId).push(sh); }
  const dateOf = p => p.datum || todayISO(new Date(p.created || 0));
  const cmp = { neu: (a, b) => (b.updated || 0) - (a.updated || 0), datum: (a, b) => dateOf(b).localeCompare(dateOf(a)),
    strasse: (a, b) => (a.name || '').localeCompare(b.name || '', 'de', { numeric: true }), kunde: (a, b) => (a.firma || '\uffff').localeCompare(b.firma || '\uffff', 'de') || (a.name || '').localeCompare(b.name || '', 'de', { numeric: true }) }; // ohne Kunde ganz unten
  const by = cmp[homeSort] || cmp.neu;
  list.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || by(a, b)); // angeheftete zuerst
  const el = $('#projList');
  if (!list.length) {
    el.innerHTML = showTrash ? '<div class="empty">Papierkorb ist leer.</div>' : showArch ? '<div class="empty">Archiv ist leer.</div>' : q ? `<div class="empty">Nichts gefunden.${inArch ? `<br><small>${inArch} Treffer im Archiv – oben „📦 Archiv“ antippen</small>` : ''}</div>` : '<div class="empty">Noch kein Projekt.<br>Unten auf „+ Neues Projekt“ tippen.</div>';
    return;
  }
  el.innerHTML = '';
  for (const p of list) {
    const n = counts.get(p.id) || 0;
    const c = document.createElement('div'); c.className = 'card' + (selIds.has(p.id) ? ' checked' : '');
    c.innerHTML = `<span class="cb">✓</span><div class="t"><b></b><small></small></div><span>›</span>`;
    c.querySelector('b').textContent = (p.pinned ? '📌 ' : '') + (p.locked ? '🔒 ' : '') + (p.name || 'Ohne Namen');
    const amp = n ? ampel(p, byProj.get(p.id) || []) : null;
    const days = p.deleted ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - p.deleted) / 864e5)) : 0;
    c.querySelector('small').textContent = `${statusIcons(p)}${p.firma || ''} · ${n} Foto${n === 1 ? '' : 's'} · ${new Date(p.datum || p.created).toLocaleDateString('de-AT')}${p.archived ? ' · 📦 archiviert' : ''}${p.deleted ? ` · 🗑 noch ${days} Tage` : ''}`;
    if (amp) { const d = document.createElement('i'); d.className = 'amp ' + amp.lvl; d.title = amp.text; c.querySelector('small').prepend(d); }
    c.onclick = () => {
      if (c._lp) { c._lp = false; return; } // Klick nach langem Drücken ignorieren
      if (p.deleted) { trashMenu(p); return; }
      if (selMode) { if (selIds.has(p.id)) selIds.delete(p.id); else selIds.add(p.id); c.classList.toggle('checked', selIds.has(p.id)); updateSelBar(); return; }
      openProject(p.id);
    };
    longPress(c, () => { if (!selMode) (p.deleted ? trashMenu(p) : projMenu(p)); });
    el.appendChild(c);
  }
}
// Symbole: was mit dem Projekt schon passiert ist (Idee 12)
function statusIcons(p) {
  const ex = p.exports || [];
  const has = re => ex.some(e => re.test(e.how || ''));
  const ic = [has(/dropbox/i) ? '☁' : '', has(/gemailt/i) ? '✉' : '', has(/geteilt|gespeichert/i) ? '📤' : ''].filter(Boolean).join(' ');
  return ic ? ic + ' · ' : '';
}
// langes Drücken (Idee 3): 550 ms ohne Bewegung → Aktion, der folgende Klick wird verschluckt
function longPress(el, fn) {
  let t = 0, x0 = 0, y0 = 0;
  const stop = () => { clearTimeout(t); t = 0; };
  el.addEventListener('pointerdown', e => { if (e.button !== 0 && e.pointerType === 'mouse') return; x0 = e.clientX; y0 = e.clientY; stop(); t = setTimeout(() => { t = 0; el._lp = true; try { navigator.vibrate && navigator.vibrate(20); } catch (err) { } fn(); }, 550); });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) stop(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, stop));
  el.addEventListener('contextmenu', e => e.preventDefault());
}
// Schnellmenü zu einem Projekt aus der Liste
async function projMenu(p) {
  p = (await db.get('projects', p.id)) || p;
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  const items = [
    ['📄 PDF erstellen', async () => { await openProject(p.id); $('#btnPdf').click(); }],
    ['✉ Per Mail senden', async () => { await openProject(p.id); $('#btnMail').click(); }],
    dropbox.connected ? ['☁ In Dropbox speichern', async () => { await openProject(p.id); $('#btnDbx').click(); }] : null,
    [p.pinned ? '📌 Nicht mehr anheften' : '📌 Oben anheften', async () => { p.pinned = !p.pinned; await db.put('projects', p); renderHome(); toast(p.pinned ? 'Angeheftet – bleibt oben in der Liste' : 'Nicht mehr angeheftet'); }],
    ['⧉ Duplizieren', async () => { await openProject(p.id); $('#btnDupProj').click(); }],
    [p.archived ? '📦 Aus Archiv holen' : '📦 Archivieren', async () => { p.archived = !p.archived; p.updated = Date.now(); await db.put('projects', p); renderHome(); toast(p.archived ? 'Ins Archiv verschoben' : 'Aus dem Archiv geholt'); }],
    ['🗑 Projekt löschen', async () => { await deleteProject(p); }, 'danger'],
  ].filter(Boolean);
  bg.innerHTML = `<div class="sheet"><h2></h2><p class="mute"></p><div class="menu"></div><button class="ghost" style="width:100%;margin-top:10px" data-close>Abbrechen</button></div>`;
  bg.querySelector('h2').textContent = p.name || 'Ohne Namen';
  bg.querySelector('p').textContent = [p.firma, p.plz && p.ortName ? p.plz + ' ' + p.ortName : (p.ortName || '')].filter(Boolean).join(' · ') || 'Schnellmenü';
  const m = bg.querySelector('.menu');
  for (const [label, fn, cls] of items) { const b = document.createElement('button'); b.textContent = label; b.className = cls || 'ghost'; b.onclick = () => { bg.remove(); fn(); }; m.appendChild(b); }
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  bg.onclick = e => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg);
}
// Ampel (Idee 44): grün = alles da, gelb = etwas fehlt (Rh, Eg, Kunde, Hausnummer, ungewöhnlicher Wert), rot = Pfeile ohne Maß
function issuesFor(p, shots) {
  const out = [];
  const has = r => shots.some(s => s.room === r && s.arrows.some(a => a.cm != null));
  if (!has('Rh') && !shots.some(s => s.arrows.some(a => a.el === 'Raumhöhe' && a.cm != null))) out.push('Raumhöhe (Rh) fehlt');
  if (!has('Eg')) out.push('Eingangstür (Eg) fehlt');
  if (!(p.firma || '').trim()) out.push('Kein Kunde gewählt (Deckblatt ohne Firma)');
  if ((p.str || '').trim() && !houseNo(p.str)) out.push('Keine Hausnummer im Projektnamen');
  for (const sh of shots) for (const x of shotIssues(sh)) out.push(`${sh.room}: ${x.m}`);
  return out;
}
function ampel(p, shots) {
  const iss = issuesFor(p, shots);
  if (!iss.length) return { lvl: 'ok', text: 'Vollständig' };
  const red = iss.some(x => /ohne Maß/.test(x));
  return { lvl: red ? 'fail' : 'warn', text: iss.join(' · ') };
}
function ampelUi() {
  const el = $('#ampel'); if (!S.project || !S.shots.length) { el.style.display = 'none'; return; }
  const a = ampel(S.project, S.shots);
  el.style.display = 'flex'; el.className = 'ampel ' + a.lvl; el.querySelector('span').textContent = a.lvl === 'ok' ? 'Vollständig – Rh, Eg, Kunde, Hausnummer und alle Maße da' : a.text;
}
async function deleteProject(p) {
  if (!await confirmBox(`Projekt „${p.name || 'Ohne Namen'}“ in den Papierkorb legen?`, 'In Papierkorb', 'Abbrechen', 'danger', `Bleibt ${TRASH_DAYS} Tage wiederherstellbar (Projektliste → 🗑 Papierkorb), danach wird es mit allen Fotos endgültig gelöscht.`)) return false;
  p.deleted = Date.now(); await db.put('projects', p);
  log('Projekt in Papierkorb', p.name);
  if (S.project && S.project.id === p.id) S.project = null;
  renderHome(); show('home');
  undoToast(`Projekt „${p.name || 'Ohne Namen'}“ im Papierkorb`, async () => { delete p.deleted; await db.put('projects', p); renderHome(); toast('Projekt wiederhergestellt'); });
  return true;
}
async function trashMenu(p) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2></h2><p class="mute"></p><div class="menu"><button class="pri" data-restore>↩ Wiederherstellen</button><button class="danger" data-purge>Endgültig löschen</button></div><button class="ghost" style="width:100%;margin-top:10px" data-close>Abbrechen</button></div>`;
  bg.querySelector('h2').textContent = p.name || 'Ohne Namen';
  bg.querySelector('p').textContent = `Gelöscht am ${new Date(p.deleted).toLocaleDateString('de-AT')} – wird in ${Math.max(0, TRASH_DAYS - Math.floor((Date.now() - p.deleted) / 864e5))} Tagen endgültig gelöscht.`;
  bg.querySelector('[data-restore]').onclick = async () => { bg.remove(); delete p.deleted; await db.put('projects', p); showTrash = false; renderHome(); toast('Wiederhergestellt'); };
  bg.querySelector('[data-purge]').onclick = async () => {
    bg.remove();
    if (!await confirmBox(`„${p.name || 'Ohne Namen'}“ jetzt endgültig löschen?`, 'Endgültig löschen')) return;
    for (const sh of await db.shotsOf(p.id)) await db.del('shots', sh.id); await db.del('projects', p.id); renderHome(); toast('Endgültig gelöscht');
  };
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  bg.onclick = e => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg);
}
$('#btnPin').onclick = async () => { const p = S.project; p.pinned = !p.pinned; await db.put('projects', p); pinUi(); toast(p.pinned ? 'Angeheftet – bleibt oben in der Liste' : 'Nicht mehr angeheftet'); };
function pinUi() { $('#btnPin').textContent = S.project && S.project.pinned ? '📌 Angeheftet' : '📌 Anheften'; }
// Archiv: Projekt ausblenden, bleibt aber erhalten (jederzeit wieder einblendbar)
$('#btnArchive').onclick = async () => {
  const p = S.project;
  p.archived = !p.archived; p.updated = Date.now(); await db.put('projects', p);
  log(p.archived ? 'archiviert' : 'aus Archiv', p.name);
  toast(p.archived ? 'Ins Archiv verschoben – in der Projektliste über „📦 Archiv“ zu finden' : 'Aus dem Archiv geholt', 3000);
  if (p.archived) { renderHome(); show('home'); } else archiveUi();
};
function archiveUi() { $('#btnArchive').textContent = S.project && S.project.archived ? 'Aus Archiv holen' : 'Archivieren'; }

$('#btnNewProj').onclick = async () => {
  // Android: Zwischenablage gleich lesen (muss im Tipp passieren); am iPhone würde jedes Mal ein Hinweis erscheinen → dort nur der 📋-Knopf
  const clipP = (!isIOS && clipOk) ? navigator.clipboard.readText().catch(() => '') : Promise.resolve('');
  const all = (await liveProjects()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const last = all[0] || {};
  const p = { id: uid(), name: '', kundeId: last.kundeId || null, firma: last.firma || '', kontakt: '', strasse: '', ort: last.ort || '', land: last.land || '',
    telefon: '', datum: todayISO(), kundenLogo: last.kundenLogo || null, created: Date.now(), updated: Date.now() };
  // zuletzt verwendeter Kunde mit allen Daten
  const custs = (await db.setting('customers')) || [];
  const lastC = (last.kundeId && custs.find(x => x.id === last.kundeId)) || (!all.length ? custs[custs.length - 1] : null); // erstes Projekt: zuletzt angelegter Kunde
  if (lastC) { applyCustomerToProject(p, lastC); p.kundeId = lastC.id; } else p.kundeId = null;
  await db.put('projects', p);
  await openProject(p.id, true);
  clipP.then(async t => { if (!t || !S.project || S.project.id !== p.id || S.project.str) return; const a = await clipAddress(t); if (a) offerClip(a); });
};

async function openProject(id, isNew = false) {
  S.project = await db.get('projects', id);
  S.shots = await db.shotsOf(id);
  const p = S.project;
  if (p.str === undefined) { p.str = p.name || ''; }
  // ältere Stände: "PLZ Ort" in einem Feld, Geschoß/WG eigenes Feld
  if (p.plz === undefined) {
    const m = (p.wort || '').trim().match(/^(\d{4,5})\s*(.*)$/);
    p.plz = m ? m[1] : ''; p.ortName = m ? m[2] : (p.wort || '').trim();
    if (p.top) p.str = [p.str, p.top].filter(Boolean).join(', ');
    delete p.wort; delete p.top;
  }
  S.autoOrt = false;
  $('#pStr').value = p.str; $('#pPlz').value = p.plz || ''; $('#pOrtName').value = p.ortName || ''; updateNamePrev();
  $('#pFirma').value = p.firma || ''; $('#pKontakt').value = p.kontakt || '';
  $('#pStrasse').value = p.strasse || ''; $('#pOrt').value = p.ort || ''; $('#pLand').value = p.land || '';
  $('#pTel').value = p.telefon || ''; $('#pDatum').value = (p.datum || '').slice(0, 10);
  renderCustChips();
  $('#projDetails').open = isNew || !p.name || wide();
  $('#projTitle').textContent = p.name || 'Neues Projekt';
  renderShots();
  lockUi(); navUi(); archiveUi(); pinUi(); ampelUi(); expUi();
  show('proj');
  if (isNew) setTimeout(() => $('#pStr').focus(), 200);
}

const fieldMap = { pStr: 'str', pPlz: 'plz', pOrtName: 'ortName', pFirma: 'firma', pKontakt: 'kontakt', pStrasse: 'strasse', pOrt: 'ort', pLand: 'land', pTel: 'telefon', pDatum: 'datum' };
const SS_FIELDS = ['pStr', 'pStrasse', 'cStrasse'];
function fixSz(el) {
  if (!el.value.includes('ß')) return;
  const pos = el.selectionStart, before = el.value.slice(0, pos);
  el.value = el.value.replace(/ß/g, 'ss');
  const np = before.replace(/ß/g, 'ss').length;
  try { el.setSelectionRange(np, np); } catch (e) { }
}
SS_FIELDS.forEach(id => $('#' + id).addEventListener('input', () => fixSz($('#' + id)), true));
Object.entries(fieldMap).forEach(([id, k]) => {
  $('#' + id).addEventListener('input', () => {
    S.project[k] = $('#' + id).value; S.project.updated = Date.now();
    if (['str', 'plz', 'ortName'].includes(k)) updateNamePrev();
    if (k === 'str') streetInput();
    if (['plz', 'ortName', 'str'].includes(k)) rememberStreetSoon();
    projectFieldToCustomer(k);
    if (['str', 'firma'].includes(k)) ampelUi();
    clearTimeout(S._saveT); S._saveT = setTimeout(() => db.put('projects', S.project), 300);
  });
});
// ---------------- Adresse / Straßen merken ----------------
// Projektname = "Straße Nr, PLZ Ort, Geschoß, WG" (so steht er am Deckblatt)
function updateNamePrev() {
  const p = S.project;
  // wie in Manuels Bosch-Maßblättern: Projekt = Straße + Hausnummer, Geschoß, WG (ohne PLZ/Ort)
  p.name = (p.str || '').split(',').map(x => x.trim()).filter(Boolean).join(', ');
  $('#pNamePrev').textContent = p.name ? 'Am PDF: ' + p.name : '';
  $('#projTitle').textContent = p.name || 'Neues Projekt';
}
const normStreet = s => (s || '').toLowerCase().replace(/ß/g, 'ss').replace(/stra?sse\b|str\.?(?=\s|$)/g, 'str').replace(/[^a-z0-9äöü]/g, '');
// "Haydnstrasse 8a/3" → "Haydnstrasse"
const streetOnly = s => (s || '').split(',')[0].trim().replace(/\s+\d+\s*[a-zA-Z]?([\/-].*)?$/, '').trim();
const houseNo = s => { const m = (s || '').split(',')[0].trim().match(/\s(\d+\s*[a-zA-Z]?([\/-].*)?)$/); return m ? m[1] : ''; };
async function knownStreets() { return (await db.setting('streets')) || []; }
// Straßen offline (Idee 53): je Ort ein Straßenverzeichnis aus OpenStreetMap (Overpass), in der Datenbank
let offlIdx = null; // [{street, ort, key}]
async function offlineIndex() {
  if (offlIdx) return offlIdx;
  const all = (await db.setting('offlineStreets')) || {}; const out = [], seen = new Set();
  for (const ort of Object.keys(all)) for (const line of all[ort].streets || []) {
    const [street, plz, city] = line.split('|'); const o = [plz, city || ort].filter(Boolean).join(' ');
    const key = normStreet(street) + '|' + o; if (seen.has(key)) continue; seen.add(key);
    out.push({ street, ort: o, key: normStreet(street) });
  }
  return offlIdx = out;
}
async function offlineMatches(k, limit = 6) {
  const idx = await offlineIndex(); if (!idx.length) return [];
  const pre = idx.filter(x => x.key.startsWith(k)), inn = idx.filter(x => !x.key.startsWith(k) && x.key.includes(k));
  return [...pre, ...inn].slice(0, limit).map(x => ({ street: x.street, ort: x.ort, src: 'offline' }));
}
const OVERPASS = 'https://overpass-api.de/api/interpreter';
async function loadOfflinePlace(ort) {
  // Adressen (addr:street + addr:postcode) innerhalb der Gemeindegrenze, als CSV (klein); Suchraum = Österreich
  const q = `[out:csv("addr:street","addr:postcode","addr:city";false;"|")][timeout:120][bbox:46.3,9.5,49.1,17.2];
area["name"="${ort.replace(/"/g, '')}"]["boundary"="administrative"]->.a;
nwr(area.a)["addr:street"]["addr:postcode"];
out tags;`;
  const r = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error(r.status === 429 || r.status === 504 ? 'OpenStreetMap-Server ausgelastet – bitte in ein paar Minuten nochmal' : 'OpenStreetMap: ' + r.status);
  const txt = await r.text();
  const cnt = new Map();
  for (const line of txt.split('\n')) {
    const [street, plz, city] = line.split('|').map(x => (x || '').trim());
    if (!street || !/^\d{4}$/.test(plz)) continue;
    const key = street + '|' + plz + '|' + (city || ''); cnt.set(key, (cnt.get(key) || 0) + 1);
  }
  // je Straße+PLZ die häufigste Ortsschreibweise behalten
  const best = new Map();
  for (const [key, n] of cnt) { const [street, plz, city] = key.split('|'); const k2 = street + '|' + plz; if (!best.has(k2) || best.get(k2).n < n) best.set(k2, { street, plz, city, n }); }
  const streets = [...best.values()].sort((a, b) => a.street.localeCompare(b.street, 'de')).map(x => `${x.street}|${x.plz}|${x.city}`);
  if (!streets.length) throw new Error(`Keine Adressen für „${ort}“ gefunden – Schreibweise wie in OpenStreetMap (z. B. „Linz“, „Leonding“, „Sankt Florian“)`);
  const all = (await db.setting('offlineStreets')) || {};
  all[ort] = { t: Date.now(), streets, n: streets.length, bytes: txt.length };
  await db.setting('offlineStreets', all); offlIdx = null;
  return streets.length;
}
async function offlineUiList() {
  const el = $('#offlList'); if (!el) return;
  const all = (await db.setting('offlineStreets')) || {}; el.innerHTML = '';
  const orte = Object.keys(all).sort((a, b) => a.localeCompare(b, 'de'));
  if (!orte.length) { el.innerHTML = '<p class="mute" style="margin:4px 0">Noch kein Ort geladen.</p>'; return; }
  for (const o of orte) {
    const row = document.createElement('div'); row.className = 'dbxrow';
    row.innerHTML = '<div style="flex:1"><b></b><div class="mute"></div></div><button class="ghost" data-x style="width:auto;padding:6px 10px;height:auto">✕</button>';
    row.querySelector('b').textContent = o; row.querySelector('.mute').textContent = `${all[o].n} Straßen · geladen ${new Date(all[o].t).toLocaleDateString('de-AT')}`;
    row.querySelector('[data-x]').onclick = async () => { delete all[o]; await db.setting('offlineStreets', all); offlIdx = null; offlineUiList(); };
    el.appendChild(row);
  }
}
$('#offlLoad').onclick = async () => {
  const ort = $('#offlOrt').value.trim(); if (!ort) { toast('Ort eingeben, z. B. Linz'); return; }
  if (!navigator.onLine) { toast('Zum Laden wird Netz gebraucht'); return; }
  const b = $('#offlLoad'); b.disabled = true; b.textContent = 'Lade … (kann 1–2 Minuten dauern)';
  try { const n = await loadOfflinePlace(ort); toast(`${ort}: ${n} Straßen offline gespeichert`, 3500); $('#offlOrt').value = ''; offlineUiList(); }
  catch (e) { toast(e.message, 6000); }
  b.disabled = false; b.textContent = 'Laden';
};
$$('#offlChips button').forEach(bt => { bt.onclick = () => { $('#offlOrt').value = bt.textContent; $('#offlLoad').click(); }; });
let remT = 0;
function rememberStreetSoon() {
  clearTimeout(remT);
  remT = setTimeout(async () => {
    if (!S.project) return; // Projekt inzwischen geschlossen/gelöscht
    const st = streetOnly(S.project.str), ort = [S.project.plz, S.project.ortName].map(x => (x || '').trim()).filter(Boolean).join(' ');
    if (st.length < 3 || !/^\d{4}\s+\S/.test(ort)) return;
    const list = await knownStreets(); const k = normStreet(st);
    const i = list.findIndex(x => normStreet(x.street) === k && x.ort === ort);
    if (i >= 0) list[i].used = Date.now(); else list.push({ street: st, ort, used: Date.now() });
    await db.setting('streets', list);
  }, 1500);
}
let sugT = 0, sugReq = 0;
async function streetInput() {
  const v = $('#pStr').value, st = streetOnly(v), k = normStreet(st);
  const box = $('#strSug');
  if (k.length < 3) { box.classList.remove('on'); return; }
  const known = (await knownStreets()).filter(x => normStreet(x.street).includes(k)).sort((a, b) => (b.used || 0) - (a.used || 0)).slice(0, 5);
  const seenK = new Set(known.map(x => normStreet(x.street) + x.ort));
  const offl = (await offlineMatches(k, 6)).filter(x => !seenK.has(normStreet(x.street) + x.ort)).slice(0, Math.max(2, 6 - known.length));
  const local = [...known.map(x => ({ ...x, src: 'bekannt' })), ...offl];
  autoOrt(local, k);
  showSug(local, []);
  houseNoChips(st);
  clearTimeout(sugT);
  if (!navigator.onLine || known.length >= 3 || local.length >= 5) return;
  const my = ++sugReq;
  sugT = setTimeout(async () => {
    try {
      const u = 'https://photon.komoot.io/api/?lang=de&limit=8&osm_tag=highway&bbox=9.5,46.3,17.2,49.1&lat=48.1&lon=14.3&q=' + encodeURIComponent(st);
      const r = await fetch(u); if (!r.ok || my !== sugReq) return;
      const j = await r.json();
      const seen = new Set(local.map(x => normStreet(x.street) + x.ort));
      const web = [];
      for (const f of j.features || []) {
        const pr = f.properties || {};
        if (pr.countrycode && pr.countrycode !== 'AT') continue;
        const ort = [pr.postcode, pr.city || pr.town || pr.village || pr.locality || pr.district].filter(Boolean).join(' ');
        if (!pr.name || !pr.postcode) continue;
        const key = normStreet(pr.name) + ort; if (seen.has(key)) continue; seen.add(key);
        web.push({ street: pr.name, ort, src: 'Karte' });
      }
      if (my === sugReq && !autoOrt(local, k)) autoOrt(web, k);
      if (my === sugReq && $('#pStr') === document.activeElement) showSug(local, web.slice(0, 5));
    } catch (e) { /* offline oder Dienst nicht erreichbar */ }
  }, 450);
}
// Eindeutiger Vorschlag (nur ein Ort passt) → PLZ und Ort automatisch eintragen, ohne Antippen.
// Überschreibt nur leere Felder oder Werte, die die App selbst eingetragen hat – nie Eingetipptes.
function autoOrt(list, k) {
  const plzEmpty = !$('#pPlz').value.trim() && !$('#pOrtName').value.trim();
  if (!plzEmpty && !S.autoOrt) return false;
  const m = list.filter(x => normStreet(x.street).startsWith(k));
  if (!m.length) return false;
  const orte = [...new Set(m.map(x => x.ort))];
  if (orte.length !== 1) return false;
  if (k.length < 5 && !m.some(x => normStreet(x.street) === k)) return false; // zu kurz getippt
  const cur = [$('#pPlz').value.trim(), $('#pOrtName').value.trim()].filter(Boolean).join(' ');
  if (cur !== orte[0]) { setWOrt(orte[0], true); }
  S.autoOrt = true;
  return true;
}
['pPlz', 'pOrtName'].forEach(id => $('#' + id).addEventListener('input', () => { S.autoOrt = false; }));
// bekannte Straße ohne Hausnummer getippt → Hausnummern der bisherigen Projekte anbieten (Idee 40)
async function houseNoChips(st) {
  const box = $('#strSug'); const old = box.querySelector('.nrs'); if (old) old.remove();
  const k = normStreet(st); if (k.length < 3 || houseNo($('#pStr').value)) return;
  const my = ++houseNoChips.t; const seen = new Map();
  const projs = await liveProjects(); if (my !== houseNoChips.t) return;
  for (const p of projs) {
    if (normStreet(streetOnly(p.str)) !== k) continue;
    const no = houseNo(p.str); if (!no) continue;
    const key = no.replace(/\s+/g, '');
    if (!seen.has(key) || (p.updated || 0) > seen.get(key).updated) seen.set(key, { no, street: streetOnly(p.str), plz: p.plz || '', ort: p.ortName || '', updated: p.updated || 0 });
  }
  if (!seen.size) return;
  const old2 = box.querySelector('.nrs'); if (old2) old2.remove();
  const row = document.createElement('div'); row.className = 'nrs';
  const lbl = document.createElement('span'); lbl.textContent = 'Hausnr.:'; row.appendChild(lbl);
  const items = [...seen.values()].sort((a, b) => a.no.localeCompare(b.no, 'de', { numeric: true })).slice(0, 10);
  for (const it of items) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = it.no;
    let done = false;
    const pick = e => {
      if (e) e.preventDefault(); if (done) return; done = true;
      const el = $('#pStr'); el.value = it.street + ' ' + it.no + ', '; S.project.str = it.street + ' ' + it.no; updateNamePrev();
      if (it.plz || it.ort) setWOrt([it.plz, it.ort].filter(Boolean).join(' '), false); else db.put('projects', S.project);
      box.classList.remove('on'); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
      toast(`${it.street} ${it.no} – Geschoß/WG ergänzen`, 2000); ampelUi();
    };
    b.addEventListener('pointerdown', pick); b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', pick);
    row.appendChild(b);
  }
  box.prepend(row); box.classList.add('on');
}
houseNoChips.t = 0;
function showSug(local, web) {
  const box = $('#strSug'); const nrs = box.querySelector('.nrs'); box.innerHTML = ''; if (nrs) box.appendChild(nrs);
  const all = [...local, ...web];
  if (!all.length) { if (!nrs) box.classList.remove('on'); return; }
  for (const x of all) {
    const b = document.createElement('button');
    b.innerHTML = '<span class="src"></span><b></b><small></small>';
    b.querySelector('b').textContent = x.street.replace(/ß/g, 'ss'); b.querySelector('small').textContent = x.ort;
    b.querySelector('.src').textContent = x.src === 'bekannt' ? 'schon gehabt' : x.src === 'offline' ? 'offline' : 'Karte';
    // gleich beim Antippen übernehmen (am iPhone kommt der Klick sonst manchmal nicht an, weil das Feld vorher den Fokus verliert)
    let done = false;
    const choose = e => {
      if (e) e.preventDefault();
      if (done) return; done = true;
      const cur = $('#pStr').value, no = houseNo(cur), rest = cur.includes(',') ? cur.slice(cur.indexOf(',')) : '';
      $('#pStr').value = x.street.replace(/ß/g, 'ss') + ' ' + (no || '') + (no ? rest : '');
      S.project.str = $('#pStr').value.trimEnd();
      setWOrt(x.ort, false);
      box.classList.remove('on');
      $('#pStr').focus();
      const el = $('#pStr'); el.setSelectionRange(el.value.length, el.value.length);
      toast(`Übernommen: ${x.street.replace(/ß/g, 'ss')}, ${x.ort}`);
      if (!no) setTimeout(() => houseNoChips(x.street), 50);
    };
    b.addEventListener('pointerdown', choose);
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', choose);
    box.appendChild(b);
  }
  box.classList.add('on');
}
const capFirst = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
$('#pOrtName').addEventListener('change', () => { const v = capFirst($('#pOrtName').value.trim()); if (v !== $('#pOrtName').value) { $('#pOrtName').value = v; S.project.ortName = v; updateNamePrev(); db.put('projects', S.project); rememberStreetSoon(); } });
function setWOrt(ort, auto) {
  const m = (ort || '').match(/^(\d{4,5})\s*(.*)$/);
  S.project.plz = m ? m[1] : ''; S.project.ortName = capFirst(m ? m[2] : ort);
  $('#pPlz').value = S.project.plz; $('#pOrtName').value = S.project.ortName; updateNamePrev();
  db.put('projects', S.project); rememberStreetSoon();
  if (auto) toast('PLZ/Ort automatisch: ' + ort + ' (änderbar)');
}
// Vorschläge zuklappen, wenn das Feld den Fokus verliert – außer die Standort-Vorschläge (📍) wurden gerade erst eingeblendet
let sugShownAt = 0;
$('#pStr').addEventListener('blur', () => { const blurAt = Date.now(); setTimeout(() => { if (sugShownAt < blurAt) $('#strSug').classList.remove('on'); }, 400); });
document.addEventListener('pointerdown', e => { if (!e.target.closest('#strSug, #pStr, #gpsBtn, #clipBtn')) $('#strSug').classList.remove('on'); }, true);

// ---------------- Adresse per Standort (draußen und drinnen; drinnen hilft WLAN-Ortung) ----------------
$('#gpsBtn').onclick = () => {
  if (isLocked()) return;
  if (!navigator.geolocation) { toast('Standort wird hier nicht unterstützt'); return; }
  toast('Suche Standort …', 15000);
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: la, longitude: lo, accuracy: acc } = pos.coords;
    try {
      const r = await fetch(`https://photon.komoot.io/reverse?lat=${la}&lon=${lo}&lang=de&limit=8&radius=0.15`);
      const j = await r.json();
      const seen = new Set(), list = [];
      const distM = (lat2, lon2) => { const R = 6371000, dLa = (lat2 - la) * Math.PI / 180, dLo = (lon2 - lo) * Math.PI / 180; const a2 = Math.sin(dLa / 2) ** 2 + Math.cos(la * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a2)); };
      for (const f of j.features || []) {
        const pr = f.properties || {}; const st = pr.street || (pr.osm_key === 'highway' ? pr.name : '');
        if (!st || !pr.postcode) continue;
        const line = (st + (pr.housenumber ? ' ' + pr.housenumber : '')).replace(/ß/g, 'ss');
        const ort = [pr.postcode, pr.city || pr.town || pr.village || pr.locality || pr.district].filter(Boolean).join(' ');
        if (seen.has(line + ort)) continue; seen.add(line + ort);
        const c = f.geometry && f.geometry.coordinates;
        list.push({ line, ort, dist: c && c.length >= 2 ? Math.round(distM(c[1], c[0])) : null });
      }
      list.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
      if (!list.length) { toast('Keine Adresse gefunden – bitte eintippen', 3500); return; }
      toast(`Standort ± ${Math.round(acc)} m${acc > 60 ? ' (ungenau, bitte prüfen)' : ''}`, 3000);
      const box = $('#strSug'); box.innerHTML = '';
      for (const x of list.slice(0, 6)) {
        const b = document.createElement('button');
        b.innerHTML = '<span class="src">📍 hier</span><b></b><small></small>';
        b.querySelector('b').textContent = x.line; b.querySelector('small').textContent = x.ort + (x.dist != null ? ` · ${x.dist} m` : '');
        let done = false;
        const pick = e => {
          if (e) e.preventDefault(); if (done) return; done = true;
          const cur = $('#pStr').value, rest = cur.includes(',') ? cur.slice(cur.indexOf(',')) : ', ';
          $('#pStr').value = x.line + rest; S.project.str = $('#pStr').value;
          setWOrt(x.ort, false); S.autoOrt = true; box.classList.remove('on');
          const el = $('#pStr'); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
          toast('Übernommen – Geschoß/WG ergänzen');
        };
        b.addEventListener('pointerdown', pick); b.addEventListener('click', pick);
        box.appendChild(b);
      }
      box.classList.add('on'); sugShownAt = Date.now();
    } catch (e) { toast('Adresssuche braucht Internet', 3500); }
  }, err => toast(err.code === 1 ? 'Standort nicht erlaubt – in den Handy-Einstellungen freigeben' : 'Kein Standort gefunden', 4000),
  { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
};
// Adresse aus der Zwischenablage (Idee 63): 📋-Knopf; am Android zusätzlich beim Anlegen eines Projekts automatisch angeboten
const clipOk = !!(navigator.clipboard && navigator.clipboard.readText);
async function clipAddress(text) {
  const stop = ((await db.setting('customers')) || []).flatMap(c => (c.name || '').split(/\s+/)).filter(Boolean);
  const a = parseAddress(text, stop);
  return a && a.str ? a : null;
}
function applyClipAddress(a) {
  const el = $('#pStr'); el.value = a.str + (a.str.includes(',') ? '' : ', '); S.project.str = a.str; updateNamePrev();
  if (a.plz || a.ort) setWOrt([a.plz, a.ort].filter(Boolean).join(' '), false); else db.put('projects', S.project);
  $('#strSug').classList.remove('on'); rememberStreetSoon(); ampelUi();
  el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  toast('Adresse eingefügt – Geschoß/WG ergänzen', 2500);
}
$('#clipBtn').style.display = clipOk ? '' : 'none';
$('#clipBtn').onclick = async () => {
  if (isLocked()) return;
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch (e) { toast('Zwischenablage nicht erlaubt – bitte in den Handy-Einstellungen freigeben', 3500); return; }
  const a = await clipAddress(t);
  if (!a) { toast('Keine Adresse in der Zwischenablage gefunden', 3000); return; }
  applyClipAddress(a);
};
function offerClip(a) { // Vorschlag im Straßen-Feld, kein automatisches Einfügen
  const box = $('#strSug'); box.innerHTML = '';
  const b = document.createElement('button'); b.innerHTML = '<span class="src">📋 Zwischenablage</span><b></b><small></small>';
  b.querySelector('b').textContent = a.str; b.querySelector('small').textContent = [a.plz, a.ort].filter(Boolean).join(' ') || 'einfügen?';
  let done = false; const pick = e => { if (e) e.preventDefault(); if (done) return; done = true; applyClipAddress(a); };
  b.addEventListener('pointerdown', pick); b.addEventListener('mousedown', e => e.preventDefault()); b.addEventListener('click', pick);
  box.appendChild(b); box.classList.add('on'); sugShownAt = Date.now();
}
function navUi() {
  const p = S.project, a = $('#navBtn');
  const q = [p.str && streetOnly(p.str) + (houseNo(p.str) ? ' ' + houseNo(p.str) : ''), [p.plz, p.ortName].filter(Boolean).join(' '), 'Österreich'].filter(Boolean).join(', ');
  if (!opt.nav || !p.str) { a.style.display = 'none'; return; }
  a.style.display = '';
  a.href = opt.nav === 'apple' ? 'https://maps.apple.com/?daddr=' + encodeURIComponent(q) : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q);
}
['pStr', 'pPlz', 'pOrtName'].forEach(id => $('#' + id).addEventListener('change', () => navUi()));

// Logo freistellen: unbunter Hintergrund, der mit dem Bildrand zusammenhängt, wird durchsichtig; danach zuschneiden
async function cutoutLogo(blob) {
  try {
    const im = await blobToImg(blob);
    const sc = Math.min(1, 800 / Math.max(im.width, im.height)); const W = Math.round(im.width * sc), H = Math.round(im.height * sc);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H);
    const id = g.getImageData(0, 0, W, H), d = id.data;
    const lum = i => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const sat = i => Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const seen = new Uint8Array(W * H), q = [];
    for (let x = 0; x < W; x++) for (const i of [x, (H - 1) * W + x]) if (!seen[i] && sat(i) < 40 && d[i * 4 + 3] > 0) { seen[i] = 1; q.push(i); }
    for (let y = 0; y < H; y++) for (const i of [y * W, y * W + W - 1]) if (!seen[i] && sat(i) < 40 && d[i * 4 + 3] > 0) { seen[i] = 1; q.push(i); }
    if (q.length < (W + H)) return blob; // Rand ist nicht überwiegend Hintergrund → unverändert
    let n = 0;
    while (q.length) {
      const i = q.pop(); n++; d[i * 4 + 3] = 0; const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || seen[j]) continue;
        if (sat(j) < 40 && Math.abs(lum(j) - lum(i)) < 10) { seen[j] = 1; q.push(j); }
      }
    }
    if (n > W * H * 0.97) return blob; // fast alles entfernt → lieber Original
    g.putImageData(id, 0, 0);
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    toast('Logo freigestellt');
    return await canvasToBlob(o, 'image/png');
  } catch (e) { return blob; }
}

// ---------------- Kunden ----------------
// Kunde = Name, Straße, PLZ Ort, Land, Kontakt, Telefon, Logo. Auswahl im Projekt übernimmt alles fürs Deckblatt;
// Änderungen an diesen Feldern im Projekt werden beim gewählten Kunden mitgespeichert.
// [Projektfeld, Kundenfeld, Eingabe im Projekt, Eingabe im Kundenformular]
const CF = [['firma', 'name', 'pFirma', 'cName'], ['strasse', 'strasse', 'pStrasse', 'cStrasse'], ['ort', 'ort', 'pOrt', 'cOrt'],
  ['land', 'land', 'pLand', 'cLand'], ['kontakt', 'kontakt', 'pKontakt', 'cKontakt'], ['telefon', 'telefon', 'pTel', 'cTel']];
function applyCustomerToProject(p, c) {
  CF.forEach(([pk, ck]) => { p[pk] = c ? (c[ck] || '') : ''; });
  p.kundenLogo = c ? (c.logo || null) : null;
}
let custSaveT = 0;
function projectFieldToCustomer(pk) {
  const p = S.project; if (!p || !p.kundeId) return;
  const f = CF.find(x => x[0] === pk); if (!f) return;
  clearTimeout(custSaveT);
  custSaveT = setTimeout(async () => {
    const list = (await db.setting('customers')) || [];
    const c = list.find(x => x.id === p.kundeId); if (!c) return;
    CF.forEach(([pk2, ck]) => { if (pk2 === 'firma' && !(p.firma || '').trim()) return; c[ck] = p[pk2] || ''; });
    await db.setting('customers', list);
    renderCustChips();
  }, 600);
}
async function customers() { return ((await db.setting('customers')) || []).sort((a, b) => a.name.localeCompare(b.name, 'de')); }
function custButton(c, sel) {
  const b = document.createElement('button'); if (sel) b.classList.add('sel');
  if (c.logo) { const i = document.createElement('img'); i.src = blobUrl(c.logo); b.appendChild(i); }
  const t = document.createElement('span'); t.innerHTML = '<b></b><small></small>';
  t.querySelector('b').textContent = c.name; t.querySelector('small').textContent = c.ort || '';
  b.appendChild(t); return b;
}
async function renderCustChips() {
  const el = $('#custChips'); el.innerHTML = '';
  for (const c of await customers()) {
    const b = custButton(c, S.project.kundeId === c.id);
    b.onclick = () => selectCustomer(S.project.kundeId === c.id ? null : c);
    el.appendChild(b);
  }
  const add = document.createElement('button'); add.textContent = '+ Neuer Kunde';
  add.onclick = async () => { const c = await editCustomer(null); if (c) selectCustomer(c); };
  el.appendChild(add);
}
async function selectCustomer(c) {
  const p = S.project;
  p.kundeId = c ? c.id : null;
  applyCustomerToProject(p, c);
  CF.forEach(([pk, , pid]) => { $('#' + pid).value = p[pk] || ''; });
  if (c) toast(`Kunde ${c.name} übernommen`);
  p.updated = Date.now(); await db.put('projects', p);
  renderCustChips(); ampelUi();
}
function editCustomer(c) {
  return new Promise(res => {
    const sh = $('#custSheet'); let logo = c ? c.logo : null;
    $('#custTitle').textContent = c ? 'Kunde bearbeiten' : 'Neuer Kunde';
    CF.forEach(([, ck, , cid]) => { $('#' + cid).value = c ? (c[ck] || '') : ''; });
    $('#cDbx').value = c ? (c.dbx || '') : ''; $('#cFotos').checked = !!(c && c.fotos);
    const prev = () => { if (logo) { $('#cLogoPrev').src = blobUrl(logo); $('#cLogoPrev').hidden = false; } else $('#cLogoPrev').hidden = true; };
    prev(); $('#cLogo').value = '';
    $('#cDel').style.display = c ? '' : 'none';
    $('#cLogo').onchange = async e => { const f = e.target.files[0]; if (!f) return; logo = $('#cCut').checked ? await cutoutLogo(f) : f; prev(); };
    const close = v => { sh.classList.remove('on'); res(v); };
    $('#cCancel').onclick = () => close(null);
    $('#cSave').onclick = async () => {
      const name = $('#cName').value.trim(); if (!name) { toast('Bitte einen Namen eingeben'); return; }
      const list = (await db.setting('customers')) || [];
      const obj = { id: c ? c.id : uid(), logo };
      CF.forEach(([, ck, , cid]) => { obj[ck] = $('#' + cid).value.trim(); });
      obj.dbx = $('#cDbx').value.trim(); obj.fotos = $('#cFotos').checked;
      const i = list.findIndex(x => x.id === obj.id);
      if (i >= 0) list[i] = obj; else list.push(obj);
      await db.setting('customers', list);
      // Projekte mit diesem Kunden aktualisieren
      for (const p of await db.all('projects')) if (p.kundeId === obj.id) {
        applyCustomerToProject(p, obj); await db.put('projects', p);
        if (S.project && S.project.id === p.id) { Object.assign(S.project, p); CF.forEach(([pk, , pid]) => { $('#' + pid).value = p[pk] || ''; }); }
      }
      close(obj);
    };
    $('#cDel').onclick = async () => {
      if (!await confirmBox(`Kunde „${c.name}“ löschen? (Bestehende Projekte behalten ihre Angaben.)`)) return;
      await db.setting('customers', ((await db.setting('customers')) || []).filter(x => x.id !== c.id));
      close(null);
    };
    // zusammenführen: Projekte dieses Kunden wandern zu einem anderen, dieser wird gelöscht (Idee 49)
    const mb = $('#cMerge'); mb.style.display = c ? '' : 'none';
    mb.onclick = async () => {
      const others = ((await db.setting('customers')) || []).filter(x => x.id !== c.id);
      if (!others.length) { toast('Kein zweiter Kunde vorhanden'); return; }
      const bg = document.createElement('div'); bg.className = 'sheet-bg on';
      bg.innerHTML = `<div class="sheet"><h2>„${c.name}“ zusammenführen mit …</h2><p class="mute">Alle Projekte von „${c.name}“ bekommen den gewählten Kunden; „${c.name}“ wird danach gelöscht.</p><div class="menu"></div><button class="ghost" style="width:100%;margin-top:10px" data-close>Abbrechen</button></div>`;
      const m = bg.querySelector('.menu');
      for (const o of others) { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = o.name + (o.ort ? ' · ' + o.ort : ''); b.onclick = async () => {
        bg.remove();
        if (!await confirmBox(`„${c.name}“ in „${o.name}“ aufgehen lassen?`, 'Zusammenführen', 'Abbrechen', 'pri')) return;
        let n = 0;
        for (const p of await db.all('projects')) if (p.kundeId === c.id || (!p.kundeId && (p.firma || '').trim() === (c.name || '').trim())) { p.kundeId = o.id; applyCustomerToProject(p, o); await db.put('projects', p); n++; if (S.project && S.project.id === p.id) { Object.assign(S.project, p); CF.forEach(([pk, , pid]) => { $('#' + pid).value = p[pk] || ''; }); ampelUi(); } }
        await db.setting('customers', ((await db.setting('customers')) || []).filter(x => x.id !== c.id));
        log('Kunden zusammengeführt', c.name, '→', o.name, n);
        toast(`${n} Projekt${n === 1 ? '' : 'e'} zu „${o.name}“ übernommen, „${c.name}“ gelöscht`, 3500);
        close(o);
      }; m.appendChild(b); }
      bg.querySelector('[data-close]').onclick = () => bg.remove();
      document.body.appendChild(bg);
    };
    document.body.appendChild(sh); // ans Ende → liegt über den Einstellungen
    sh.classList.add('on');
    if (!c) setTimeout(() => $('#cName').focus(), 200);
  });
}
async function renderCustManage() {
  const el = $('#custList'); el.innerHTML = '';
  const list = await customers();
  if (!list.length) el.innerHTML = '<p class="mute">Noch keine Kunden. Unten „+ Neuer Kunde“.</p>';
  for (const c of list) {
    const row = document.createElement('div'); row.className = 'custrow';
    row.innerHTML = '<img alt=""><div class="t"><b></b><small></small><small></small><small></small></div><span>›</span>';
    const img = row.querySelector('img'); if (c.logo) img.src = blobUrl(c.logo); else img.style.visibility = 'hidden';
    const sm = row.querySelectorAll('small');
    row.querySelector('b').textContent = c.name;
    sm[0].textContent = [c.strasse, c.ort, c.land].filter(Boolean).join(' · ') || 'keine Adresse';
    sm[1].textContent = [c.kontakt, c.telefon].filter(Boolean).join(' · ') || 'kein Kontakt';
    sm[2].textContent = 'Dropbox-Ordner: ' + (c.dbx || c.name);
    row.onclick = async () => { await editCustomer(c); renderCustManage(); if (S.project) renderCustChips(); };
    el.appendChild(row);
  }
}
$('#custNew').onclick = async () => { await editCustomer(null); renderCustManage(); if (S.project) renderCustChips(); };
$('#btnDelProj').onclick = () => deleteProject(S.project);

// Hinweis mit „Rückgängig“-Knopf (6 s)
function undoToast(msg, undo) {
  let bar = $('#undoBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'undoBar'; document.body.appendChild(bar); }
  bar.innerHTML = '<span></span><button>Rückgängig</button>';
  bar.querySelector('span').textContent = msg;
  bar.classList.add('on');
  clearTimeout(undoToast._t);
  undoToast._t = setTimeout(() => bar.classList.remove('on'), 6000);
  bar.querySelector('button').onclick = async () => { bar.classList.remove('on'); clearTimeout(undoToast._t); await undo(); };
}
let lastConfirm = null; // zuletzt geöffnete Rückfrage (um sie bei Bedarf wieder zu schließen)
function confirmBox(msg, yesLabel = 'Löschen', noLabel = 'Abbrechen', yesClass = 'danger', detail = '') {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg on'; lastConfirm = bg;
    bg.innerHTML = `<div class="sheet"><h2></h2><p class="mute" style="white-space:pre-line;font-size:15px"></p><div style="display:flex;gap:8px"><button class="ghost" style="flex:1"></button><button style="flex:1"></button></div></div>`;
    bg.querySelector('h2').textContent = msg;
    const pd = bg.querySelector('p'); if (detail) pd.textContent = detail; else pd.remove();
    const [no, yes] = bg.querySelectorAll('button');
    no.textContent = noLabel; yes.textContent = yesLabel; yes.className = yesClass;
    no.onclick = () => { bg.remove(); res(false); }; yes.onclick = () => { bg.remove(); res(true); };
    document.body.appendChild(bg);
  });
}

function renderShots() {
  ampelUi();
  const el = $('#shotList'); el.innerHTML = '';
  if (!S.shots.length) { el.innerHTML = '<div class="empty">Noch keine Fotos.<br>Unten auf „📷 Foto“ tippen: Raum wählen, fotografieren, messen.</div>'; return; }
  S.shots.forEach((s, i) => {
    const wrap = document.createElement('div'); wrap.className = 'swipe';
    const c = document.createElement('div'); c.className = 'card shot'; wrap.appendChild(c);
    const vals = s.arrows.filter(a => a.cm != null).map(a => opt.mm ? `${a.mm != null ? a.mm : a.cm * 10}` : `${a.cm}`).join(' · ');
    const open = s.arrows.filter(a => a.cm == null).length;
    c.innerHTML = `<img><div class="t"><div class="room"></div><div class="vals"></div>${open ? `<div class="warn">${open} Pfeil${open > 1 ? 'e' : ''} ohne Maß</div>` : ''}</div><button class="del" aria-label="Foto löschen">🗑</button>`;
    c.querySelector('img').src = blobUrl(s.photo);
    c.querySelector('.room').textContent = `${i + 1}. ${s.room}`;
    c.querySelector('.vals').textContent = vals ? vals + (opt.mm ? ' mm' : ' cm') : '–';
    c.onclick = () => { if (!isLocked()) openEditor(s); };
    c.querySelector('.del').onclick = e => { e.stopPropagation(); if (!isLocked()) deleteShot(s); };
    swipeToDelete(c, () => isLocked() ? false : deleteShot(s));
    el.appendChild(wrap);
  });
}
// Nach links wischen → Löschen (mit Rückfrage)
function swipeToDelete(el, onDelete) {
  let sx = 0, sy = 0, dx = 0, on = false, horiz = null;
  el.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; dx = 0; on = true; horiz = null; });
  el.addEventListener('pointermove', e => {
    if (!on) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (horiz === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { horiz = Math.abs(mx) > Math.abs(my); if (horiz) { el.setPointerCapture(e.pointerId); el.classList.add('drag'); } }
    if (!horiz) return;
    dx = Math.min(0, mx); el.style.transform = `translateX(${dx}px)`;
  });
  const end = async () => {
    if (!on) return; on = false; el.classList.remove('drag');
    if (horiz) { el.dataset.swiped = '1'; setTimeout(() => delete el.dataset.swiped, 400); }
    if (horiz && dx < -el.offsetWidth * 0.35) {
      el.style.transform = `translateX(${-el.offsetWidth}px)`;
      const ok = await onDelete();
      if (!ok) el.style.transform = '';
    } else el.style.transform = '';
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('click', e => { if (el.dataset.swiped) { e.stopPropagation(); e.preventDefault(); } }, true);
}
async function deleteShot(shot) {
  if (!await confirmBox(`Foto ${S.shots.indexOf(shot) + 1} (${shot.room}) mit allen Maßen löschen?`)) return false;
  const idx = S.shots.indexOf(shot), pid = S.project.id;
  await db.del('shots', shot.id);
  S.shots = S.shots.filter(x => x.id !== shot.id);
  for (let k = 0; k < S.shots.length; k++) { S.shots[k].order = k; await db.put('shots', S.shots[k]); }
  renderShots();
  undoToast(`Foto ${shot.room} gelöscht`, async () => {
    if (!S.project || S.project.id !== pid) return;
    S.shots.splice(idx, 0, shot);
    for (let k = 0; k < S.shots.length; k++) { S.shots[k].order = k; await db.put('shots', S.shots[k]); }
    renderShots(); toast('Foto wiederhergestellt');
  });
  return true;
}
async function moveShot(i, d) {
  const j = i + d; if (j < 0 || j >= S.shots.length) return;
  [S.shots[i], S.shots[j]] = [S.shots[j], S.shots[i]];
  for (let k = 0; k < S.shots.length; k++) { S.shots[k].order = k; await db.put('shots', S.shots[k]); }
  renderShots();
}

// ---------------- Raumwahl ----------------
async function rooms() { const r = await db.setting('rooms'); return Array.isArray(r) && r.length ? r : DEFAULT_ROOMS; }
function pickRoom() {
  return new Promise(async res => {
    const sh = $('#roomSheet'); const g = $('#roomGrid'); g.innerHTML = '';
    (await rooms()).forEach(([k, t]) => {
      const b = document.createElement('button'); b.innerHTML = `${k}<small>${t}</small>`;
      b.onclick = () => { sh.classList.remove('on'); res(k); }; g.appendChild(b);
    });
    $('#roomCustom').value = '';
    $('#roomOk').onclick = () => { const v = $('#roomCustom').value.trim(); if (!v) return; sh.classList.remove('on'); res(v); };
    sh.onclick = e => { if (e.target === sh) { sh.classList.remove('on'); res(null); } };
    sh.classList.add('on');
  });
}

// ---------------- Kamera ----------------
// Raum schon im Projekt? → fragen: selber Raum oder neuer (Kz → Kz2, Kz3 …)
async function resolveRoom(r, except = null) {
  if (!r || r === 'Rh' || r === 'Eg') return r;
  const base = r.replace(/\d+$/, '');
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d*)$');
  const same = S.shots.filter(s => s !== except && re.test(s.room));
  if (!same.length) return r;
  const last = same[same.length - 1].room;
  const yes = await confirmBox(`Handelt es sich um denselben Raum „${last}“?`, 'Ja, derselbe', 'Nein, neuer Raum', 'pri');
  if (yes) return last;
  // neuer Raum gleicher Art: wie in den alten Maßblättern – aus „Kz“ wird Kz1, der neue heißt Kz2 (Kz3 …)
  const nums = same.map(s => parseInt(s.room.match(re)[1] || '1', 10));
  const plain = same.filter(s => s.room === base);
  if (plain.length) { for (const s of plain) { s.room = base + '1'; await db.put('shots', s); } renderShots(); toast(`Bisheriger Raum heißt jetzt ${base}1`, 2500); }
  return base + (Math.max(...nums) + 1);
}
$('#btnShoot').onclick = async () => {
  askMotion();
  if (isLocked()) return;
  const r = await resolveRoom(await pickRoom()); if (!r) return;
  S.room = r; openCam();
};
// Waagrechter Strich wie bei der iPhone-Kamera: gelb, wenn das Handy gerade gehalten wird
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let motionAsked = false;
function askMotion() { // muss direkt in einem Tipp passieren (iPhone)
  if (motionAsked) return; motionAsked = true;
  try { if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) DeviceMotionEvent.requestPermission().catch(() => { }); } catch (e) { }
}
let roll = 0;
window.addEventListener('devicemotion', e => {
  const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
  const t = isIOS ? Math.atan2(g.x, -g.y) : Math.atan2(-g.x, g.y);
  roll = roll * 0.7 + (t * 180 / Math.PI) * 0.3;
  if (!$('#cam').classList.contains('on')) return;
  const h = $('#horizon'); h.classList.add('on');
  const lvl = Math.abs(roll) < 1;
  h.classList.toggle('level', lvl);
  h.querySelector('.line').style.transform = `rotate(${lvl ? 0 : -roll}deg)`;
  h.style.opacity = Math.abs(roll) > 30 ? 0 : 1;
});
// Raum + Hinweis immer gemeinsam setzen (Raumhöhe ↔ Türen/Fenster)
function setCamRoom(r) {
  S.room = r;
  $('#camRoom').textContent = r;
  $('#camHint').textContent = r === 'Rh' ? 'Wand von Boden bis Decke ins Bild nehmen' : 'Tür und Fenster ganz ins Bild nehmen';
}
async function openCam(viaPop = false) {
  setCamRoom(S.room);
  $('#camFallback').style.display = 'none';
  show('cam', viaPop);
  try {
    const base = { width: { ideal: 3000 }, height: { ideal: 4000 } };
    if (opt.cam) {
      try { S.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: opt.cam }, ...base }, audio: false }); }
      catch (e) { log('gewählte Kamera nicht verfügbar', e.name); toast('Gewählte Kamera nicht verfügbar – nehme Rückkamera', 2500); }
    }
    if (!S.stream) S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', ...base }, audio: false });
    $('#video').srcObject = S.stream;
    await $('#video').play().catch(() => { });
    camCaps();
  } catch (e) {
    log('Kamera', e.name, e.message);
    $('#camFallback').style.display = 'flex';
    toast(e.name === 'NotAllowedError' ? 'Kamera nicht erlaubt – bitte in den Handy-Einstellungen freigeben' : 'Kamera nicht verfügbar', 4000);
  }
}
$('#camFallbackBtn').onclick = () => $('#fileIn').click();
function stopCam() {
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
}
// Blitz (Taschenlampe) und HDR light – nur wo der Browser es erlaubt (Android/Chrome)
const camOpt = { torch: false, hdr: false };
try { Object.assign(camOpt, JSON.parse(localStorage.getItem('mb_cam') || '{}')); } catch (e) { }
const saveCamOpt = () => { try { localStorage.setItem('mb_cam', JSON.stringify(camOpt)); } catch (e) { } };
let caps = {};
function camTrack() { return S.stream && S.stream.getVideoTracks()[0]; }
async function camCaps() {
  const t = camTrack(); caps = {};
  try { caps = t.getCapabilities ? t.getCapabilities() : {}; } catch (e) { }
  // manche Geräte melden Fähigkeiten erst nach kurzer Zeit
  if (!caps.torch && !caps.exposureCompensation) { await new Promise(r => setTimeout(r, 500)); try { caps = t.getCapabilities ? t.getCapabilities() : {}; } catch (e) { } }
  if (camOpt.torch && caps.torch) await setTorch(true);
  camUi();
}
function camUi() {
  const tb = $('#torchBtn'), hb = $('#hdrBtn');
  tb.classList.toggle('on', !!(camOpt.torch && caps.torch)); tb.classList.toggle('off', !caps.torch);
  hb.classList.toggle('on', !!(camOpt.hdr && caps.exposureCompensation)); hb.classList.toggle('off', !caps.exposureCompensation);
  hb.querySelector('small').textContent = camOpt.hdr && caps.exposureCompensation ? 'an' : 'aus';
}
async function setTorch(on) {
  try { await camTrack().applyConstraints({ advanced: [{ torch: on }] }); return true; } catch (e) { return false; }
}
$('#torchBtn').onclick = async () => {
  if (!caps.torch) { toast('Blitz geht hier nicht (am iPhone sperrt Apple ihn für Web-Apps; am Android in Chrome geht er)', 3500); return; }
  camOpt.torch = !camOpt.torch; await setTorch(camOpt.torch); saveCamOpt(); camUi();
};
$('#hdrBtn').onclick = () => {
  if (!caps.exposureCompensation) { toast('HDR geht hier nicht (nur am Android in Chrome)', 3000); return; }
  camOpt.hdr = !camOpt.hdr; saveCamOpt(); camUi();
  toast(camOpt.hdr ? 'HDR an: beim Auslösen ca. 1 s ruhig halten' : 'HDR aus');
};
function grabFrame() {
  const v = $('#video'); const c = document.createElement('canvas');
  const sc = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); return c;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function setEv(ev) {
  const r = caps.exposureCompensation; const v = Math.max(r.min, Math.min(r.max, ev));
  try { await camTrack().applyConstraints({ advanced: [{ exposureMode: 'continuous', exposureCompensation: v }] }); } catch (e) { }
}
// 3 Bilder (dunkel/normal/hell) gewichtet nach "gut belichtet" zusammenrechnen (vereinfachte Belichtungsfusion)
async function captureHdr() {
  const r = caps.exposureCompensation; const step = Math.min(2, r.max, -r.min);
  const frames = [];
  for (const ev of [-step, 0, step]) { await setEv(ev); await sleep(450); frames.push(grabFrame()); }
  await setEv(0);
  const W = frames[0].width, H = frames[0].height;
  const px = frames.map(f => f.getContext('2d').getImageData(0, 0, W, H).data);
  // Gewichte auf kleinem, weichgezeichnetem Bild (verhindert Flecken)
  const sw = Math.max(8, Math.round(W / 16)), sh = Math.max(8, Math.round(H / 16));
  const wts = frames.map(f => {
    const c = document.createElement('canvas'); c.width = sw; c.height = sh; const g = c.getContext('2d');
    g.filter = 'blur(1px)'; g.drawImage(f, 0, 0, sw, sh);
    const d = g.getImageData(0, 0, sw, sh).data; const w = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) { const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255; w[i] = Math.exp(-((l - 0.5) ** 2) / 0.08) + 1e-4; }
    return w;
  });
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const og = out.getContext('2d'); const od = og.createImageData(W, H); const o = od.data;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1.001, (y + 0.5) * sh / H - 0.5 < 0 ? 0 : (y + 0.5) * sh / H - 0.5); const y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(sw - 1.001, Math.max(0, (x + 0.5) * sw / W - 0.5)); const x0 = Math.floor(fx), tx = fx - x0;
      const i00 = y0 * sw + x0, i10 = i00 + 1, i01 = i00 + sw, i11 = i01 + 1;
      let ws = 0, rr = 0, gg = 0, bb = 0; const p = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const w = wts[k]; const wk = (w[i00] * (1 - tx) + w[i10] * tx) * (1 - ty) + (w[i01] * (1 - tx) + w[i11] * tx) * ty;
        ws += wk; rr += wk * px[k][p]; gg += wk * px[k][p + 1]; bb += wk * px[k][p + 2];
      }
      o[p] = rr / ws; o[p + 1] = gg / ws; o[p + 2] = bb / ws; o[p + 3] = 255;
    }
  }
  og.putImageData(od, 0, 0);
  return out;
}
$('#camRoom').onclick = async () => { const r = await resolveRoom(await pickRoom()); if (r) setCamRoom(r); };
// Tipp ins Kamerabild: Belichtung/Fokus auf diese Stelle (Android/Chrome, wo die Kamera es kann)
let poiWarned = false;
$('#video').addEventListener('click', async e => {
  const t = camTrack(); if (!t) return;
  const v = $('#video'), r = v.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  const m = $('#poi'); m.style.left = (e.clientX - r.left) + 'px'; m.style.top = (e.clientY - r.top) + 'px'; m.classList.add('on'); clearTimeout(poiT); poiT = setTimeout(() => m.classList.remove('on'), 900);
  const can = (caps.focusMode && caps.focusMode.length) || (caps.exposureMode && caps.exposureMode.length);
  if (!can) { if (!poiWarned) { poiWarned = true; toast('Belichtung antippen kann diese Kamera nicht (Android + Chrome nötig)', 3000); } return; }
  const adv = { pointsOfInterest: [{ x, y }] };
  if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
  if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
  try { await t.applyConstraints({ advanced: [adv] }); } catch (err) { log('pointsOfInterest', err.name); }
});
let poiT = 0;
function leaveCam(viaPop) { renderShots(); if (S.shots.length && !wide()) $('#projDetails').open = false; show('proj', viaPop); } // Fotos sichtbar, Projektdaten eingeklappt
$('#camBack').onclick = () => leaveCam();
$('#camGallery').onclick = () => $('#galIn').click();
$('#fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) newShotFromBlob(f); else show('proj'); };
$('#galIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) newShotFromBlob(f); };
let shooting = false;
$('#shutter').onclick = async () => {
  const v = $('#video');
  if (!v.videoWidth || shooting) return;
  shooting = true; const sb = $('#shutter'); sb.disabled = true; setTimeout(() => { sb.disabled = false; }, 1000); // Serienschutz: 1 s kein zweites Foto
  try {
    let blob = null;
    if (camOpt.hdr && caps.exposureCompensation) {
      $('#capBusy').classList.add('on');
      try { blob = await canvasToBlob(await captureHdr(), 'image/jpeg', 0.92); } catch (e) { blob = null; }
      $('#capBusy').classList.remove('on');
    } else if (!(camOpt.torch && caps.torch)) {
      // ohne Blitz: volle Auflösung über ImageCapture (wo verfügbar)
      try { if (window.ImageCapture) blob = await new ImageCapture(camTrack()).takePhoto(); } catch (e) { blob = null; }
    }
    if (!blob) blob = await canvasToBlob(grabFrame(), 'image/jpeg', 0.92); // mit Blitz: Videobild, damit das Licht anbleibt
    beep(true);
    await newShotFromBlob(blob);
  } finally { shooting = false; }
};

async function newShotFromBlob(blob) {
  // auf 1600 px (lange Seite) verkleinern, wie im Bosch-Export
  const im = await blobToImg(blob); // <img> berücksichtigt die EXIF-Drehung
  const sc = Math.min(1, 1600 / Math.max(im.width, im.height));
  const c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const photo = await canvasToBlob(c, 'image/jpeg', 0.88);
  const shot = { id: uid(), projectId: S.project.id, order: S.shots.length, room: S.room, photo, w: c.width, h: c.height, arrows: [], tpl: null, created: Date.now() };
  S.shots.push(shot);
  await db.put('shots', shot);
  S.project.updated = Date.now(); db.put('projects', S.project);
  await openEditor(shot, true);
}

// ---------------- Editor ----------------
const cv = $('#cv'), ctx = cv.getContext('2d');
let photoImg = null, blinkT = 0, raf = 0, grayImg = null;
const grayOf = () => grayImg || (grayImg = grayFromImage(photoImg, 1000));

async function openEditor(shot, fresh = false) {
  S.shot = shot;
  if (kb.on) setKb(false);
  $('#edTitle').textContent = shot.room;
  photoImg = await blobToImg(shot.photo); grayImg = null; S.hideArrows = false; $('#eyeA').classList.remove('on');
  $('#lightA').classList.toggle('on', !!shot.orig);
  show('ed');
  resetView(); ptrs.clear(); pinch = null; drag = null;
  fitCanvas();
  buildChips();
  S.active = firstOpen();
  updateCur();
  loop();
  if (navigator.wakeLock && !S.wake) navigator.wakeLock.request('screen').then(w => { S.wake = w; w.onrelease = () => { S.wake = null; }; }).catch(() => { });
  if (fresh) {
    if (shot.room === 'Rh') applyTemplate('Raumhöhe');
    else if (S.ai) runDetect();
    else applyTemplate('Tür');
  }
}

function fitCanvas() {
  const st = $('#stage').getBoundingClientRect();
  const sc = Math.min(st.width / S.shot.w, st.height / S.shot.h);
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = Math.round(S.shot.w * sc) + 'px'; cv.style.height = Math.round(S.shot.h * sc) + 'px';
  cv.width = Math.round(S.shot.w * sc * dpr); cv.height = Math.round(S.shot.h * sc * dpr);
}
window.addEventListener('resize', () => { if ($('#ed').classList.contains('on')) fitCanvas(); });

function loop() {
  cancelAnimationFrame(raf);
  let last = 0;
  const draw = (t) => {
    if (!$('#ed').classList.contains('on')) return;
    if (t - last < 45 && !drag) { raf = requestAnimationFrame(draw); return; } // ~20 Bilder/s reichen, schont den Akku
    last = t;
    blinkT = (Math.sin(t / 180) + 1) / 2;
    ctx.drawImage(photoImg, 0, 0, cv.width, cv.height);
    if (!S.hideArrows) drawArrows(ctx, cv.width, cv.height, S.shot.arrows, S.active, blinkT, false, fmtVal, { dash: opt.dash });
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}

function buildChips() {
  const el = $('#tplTiles'); el.innerHTML = '';
  const items = [...(S.ai ? ['KI erkennen'] : []), ...Object.keys(TEMPLATES)]; // KI-Knopf nur, wenn die KI in ⚙ eingeschaltet ist
  items.forEach(k => {
    const b = document.createElement('button'); b.textContent = k === 'KI erkennen' ? '✨ KI erkennen' : k;
    b.classList.toggle('sel', S.shot.tpl === k);
    b.onclick = () => { closeArr(); k === 'KI erkennen' ? runDetect() : applyTemplate(k); };
    el.appendChild(b);
  });
}
const closeArr = () => $('#arrSheet').classList.remove('on');
$('#arrowsBtn').onclick = () => { clearTimeout(finishing); buildChips(); $('#arrSheet').classList.add('on'); };
$('#arrSheet').onclick = async e => {
  if (e.target.id === 'arrSheet') return closeArr();
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  const a = activeArrow();
  if (act === 'close') return closeArr();
  if (act === 'add') { const n = newArrow(); S.shot.arrows.push(n); S.active = n.id; }
  if (act === 'flip' && a) a.kind = a.kind === 'H' ? 'B' : 'H';
  if (act === 'clear' && a) { a.cm = null; a.time = null; }
  if (act === 'del' && a) { S.shot.arrows = S.shot.arrows.filter(x => x !== a); S.active = firstOpen(); }
  if (act === 'room') { closeArr(); const r = await resolveRoom(await pickRoom(), S.shot); if (r) { S.shot.room = r; S.room = r; $('#edTitle').textContent = r; } }
  if (act === 'up' || act === 'down') {
    const i = S.shots.findIndex(x => x.id === S.shot.id);
    await moveShot(i, act === 'up' ? -1 : 1);
    toast(`Foto ist jetzt Nr. ${S.shots.findIndex(x => x.id === S.shot.id) + 1}`);
  }
  if (act === 'delshot') {
    closeArr();
    if (await deleteShot(S.shot)) show('proj'); return;
  }
  if (['add', 'flip', 'clear', 'del'].includes(act)) closeArr();
  saveShot(); updateCur();
};

function setArrows(arrs, tpl) {
  // bereits gemessene Werte in gleicher Reihenfolge übernehmen
  const old = S.shot.arrows.filter(a => a.cm != null);
  const used = new Set();
  // zuerst gleiche Art (Tür-Höhe → Tür-Höhe), dann der Reihe nach
  arrs.forEach(a => { const o = old.find(x => !used.has(x) && x.el === a.el && x.kind === a.kind); if (o) { used.add(o); a.cm = o.cm; a.mm = o.mm; a.time = o.time; } });
  arrs.forEach(a => { if (a.cm != null) return; const o = old.find(x => !used.has(x) && x.kind === a.kind); if (o) { used.add(o); a.cm = o.cm; a.mm = o.mm; a.time = o.time; } });
  S.shot.arrows = arrs; S.shot.tpl = tpl;
  S.active = firstOpen();
  saveShot(); buildChips(); updateCur();
}
async function learnedTemplate(k) {
  const arrs = TEMPLATES[k]();
  if (opt.learn === false) return arrs;
  const L = (await db.setting('tplLearn')) || {}; const samples = L[k] || [];
  if (samples.length < 3) return arrs;
  // Median je Koordinate über die letzten Fotos → Pfeile liegen dort, wo du sie meist hinschiebst
  const med = v => { const a = [...v].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  arrs.forEach((a, i) => {
    const pts = samples.map(sm => sm[i]).filter(Boolean);
    if (pts.length < 3) return;
    a.x1 = med(pts.map(p => p[0])); a.y1 = med(pts.map(p => p[1])); a.x2 = med(pts.map(p => p[2])); a.y2 = med(pts.map(p => p[3]));
  });
  return arrs;
}
async function applyTemplate(k) { setArrows(await learnedTemplate(k), k); }
// nach einem fertig gemessenen Foto die Pfeil-Lage je Vorlage merken
async function learnFromShot(shot) {
  if (opt.learn === false || !shot || !TEMPLATES[shot.tpl]) return;
  const ref = TEMPLATES[shot.tpl]();
  if (shot.arrows.length !== ref.length || shot.arrows.some((a, i) => a.el !== ref[i].el || a.kind !== ref[i].kind || a.cm == null)) return;
  const L = (await db.setting('tplLearn')) || {};
  const list = L[shot.tpl] || [];
  list.push(shot.arrows.map(a => [a.x1, a.y1, a.x2, a.y2].map(v => Math.round(v * 1000) / 1000)));
  L[shot.tpl] = list.slice(-20);
  await db.setting('tplLearn', L);
}

async function runDetect() {
  const busy = $('#busy'); busy.classList.add('on');
  const first = modelState() !== 'bereit';
  $('#busyTxt').textContent = first ? 'KI-Modell wird geladen (nur beim ersten Mal, ~150 MB) …' : 'Erkenne Tür/Fenster …';
  $('#busyBar').style.width = '0';
  try {
    const c = document.createElement('canvas'); const sc = Math.min(1, 768 / Math.max(S.shot.w, S.shot.h));
    c.width = Math.round(S.shot.w * sc); c.height = Math.round(S.shot.h * sc);
    c.getContext('2d').drawImage(photoImg, 0, 0, c.width, c.height);
    const objs = await detect(c, (f, l, t) => {
      $('#busyBar').style.width = Math.round(f * 100) + '%';
      $('#busyTxt').textContent = `KI-Modell wird geladen … ${Math.round(l / 1048576)} / ${Math.round(t / 1048576)} MB`;
      if (f >= 1) $('#busyTxt').textContent = 'Erkenne Tür/Fenster …';
    });
    if (!objs.length) { toast('Nichts erkannt – Vorlage „Tür“ gesetzt, Pfeile verschiebbar', 2800); applyTemplate('Tür'); }
    else {
      setArrows(arrowsFromObjects(objs), 'KI erkennen');
      const nd = objs.filter(o => o.type === 'door').length, nw = objs.length - nd;
      toast(`Erkannt: ${nd ? 'Tür' : ''}${nd && nw ? ' + ' : ''}${nw ? nw + ' Fenster' : ''}`);
    }
  } catch (e) {
    console.error(e);
    toast(navigator.onLine ? 'KI gerade nicht verfügbar – Vorlage gesetzt' : 'Offline und KI noch nicht geladen – Vorlage gesetzt', 3000);
    if (!S.shot.arrows.length) applyTemplate('Tür');
  } finally { busy.classList.remove('on'); }
}

function firstOpen() { const a = S.shot.arrows.find(a => a.cm == null); return a ? a.id : (S.shot.arrows[0] || {}).id || null; }
function activeArrow() { return S.shot.arrows.find(a => a.id === S.active); }
function updateCur() {
  const a = activeArrow();
  const i = S.shot.arrows.indexOf(a);
  $('#curLbl').textContent = a ? `${a.el} · ${a.kind === 'H' ? 'Höhe' : 'Breite'}   (${i + 1} von ${S.shot.arrows.length})` : 'Kein Pfeil – oben „Pfeile“ antippen';
  const v = $('#curVal');
  const num = a && (kb.on || a.cm != null);
  v.classList.toggle('hint', !num);
  v.textContent = a ? (kb.on ? (kb.buf || '…') + (opt.mm ? ' mm' : ' cm') : a.cm != null ? fmtVal(a) : laser.state === 'verbunden' ? 'Jetzt am Laser messen' : 'Laser verbinden oder ⌨') : '–';
}
async function saveShot() { await db.put('shots', S.shot); }

// Anzeige in cm oder mm (nur App; gespeichert wird cm wie bei Bosch, mm zusätzlich wenn vom Laser bekannt)
const fmtVal = a => opt.mm ? `${a.mm != null ? a.mm : a.cm * 10} mm` : `${a.cm} cm`;
function setValue(cm, mm) {
  if (S.hideArrows) { S.hideArrows = false; $('#eyeA').classList.remove('on'); }
  let a = activeArrow();
  // Hat der Nutzer einen Pfeil selbst angetippt, bekommt genau dieser den Wert (auch zum Neu-Messen).
  // Sonst der nächste offene Pfeil.
  if (!a || (a.cm != null && !S.manualPick)) {
    const o = S.shot.arrows.find(x => x.cm == null);
    if (o) a = o;
    else if (S.shot.arrows.length) { // alles gemessen: ein weiterer Wert überschreibt nichts unbemerkt
      beep(false); toast('Alle Pfeile haben ein Maß – zum Neu-Messen Pfeil antippen', 2500); return false;
    }
  }
  S.manualPick = false;
  if (!a) { a = newArrow(); S.shot.arrows.push(a); } // noch gar kein Pfeil → neuen anlegen
  a.cm = cm; a.mm = mm != null ? mm : cm * 10; a.time = new Date().toISOString();
  saveShot();
  beep(true);
  const next = S.shot.arrows.find(x => x.cm == null);
  if (opt.big) showBig(a);
  if (opt.voice) say(`${opt.mm ? a.mm : cm}` + (next ? `. Nächster: ${arrowName(next)}` : '. Fertig'));
  if (next) { S.active = next.id; updateCur(); }
  else { S.active = a.id; updateCur(); finishShot(true); }
}
const arrowName = a => `${a.el === 'Maß' ? '' : a.el + ' '}${a.kind === 'H' ? 'Höhe' : 'Breite'}`;
// Test-Optionen: großer Messmodus, Sprachansage
const opt = { big: false, voice: false, mm: false, nav: '', glove: false, learn: true, left: false, magnet: true, dash: false, cam: '', shrink: false, remind: true };
try { Object.assign(opt, JSON.parse(localStorage.getItem('mb_opt') || '{}')); } catch (e) { }
const applyOptClasses = () => { document.body.classList.toggle('bigmode', !!opt.big); document.body.classList.toggle('glove', !!opt.glove); document.body.classList.toggle('lefty', !!opt.left); };
const saveOpt = () => { try { localStorage.setItem('mb_opt', JSON.stringify(opt)); } catch (e) { } applyOptClasses(); };
applyOptClasses();
// breite Ansicht (Tablet / Querformat): Projektdaten und Fotoliste nebeneinander
const wide = () => window.matchMedia('(min-width: 820px)').matches;
// Offline-Hinweis (Idee 13): schmaler Balken, solange kein Netz da ist
async function offlineUi() {
  const el = $('#offline'); if (!el) return;
  const off = navigator.onLine === false;
  const scr = nav.stack[nav.stack.length - 1];
  el.classList.toggle('on', off && (scr === 'home' || scr === 'proj'));
  if (off) { let qn = 0; try { qn = ((await db.setting('dbxQueue')) || []).length; } catch (e) { } el.textContent = 'Kein Netz – Adress-Vorschläge und Dropbox warten' + (qn ? ` · ${qn} PDF${qn > 1 ? 's' : ''} in der Warteschlange` : ''); }
}
window.addEventListener('online', () => { offlineUi(); toast('Wieder online'); });
window.addEventListener('offline', offlineUi);
function showBig(a) {
  const el = $('#bigVal'); el.innerHTML = `${fmtVal(a)}<small></small>`; el.querySelector('small').textContent = arrowName(a);
  el.classList.add('on'); clearTimeout(showBig._t); showBig._t = setTimeout(() => el.classList.remove('on'), 1400);
}
function say(t) {
  try {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang = 'de-AT'; u.rate = 1.05;
    const v = speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('de')); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { }
}

function onMeasure(cm, mm) {
  if ($('#ed').classList.contains('on') && S.shot) { if (S.project && S.project.locked) { toast('Projekt gesperrt – zuerst entsperren'); return; } setValue(cm, mm); return; }
  toast(`${cm} cm gemessen – erst ein Foto machen`, 2000); beep(false);
}

// Plausibilität: grobe Grenzen in cm (Türen wie im Maßblatt-Leser: H 180–245, B 50–145)
function checkArrow(a, room) {
  if (a.cm == null) return null;
  const v = a.cm, H = a.kind === 'H';
  if (a.el === 'Raumhöhe' || room === 'Rh') return v < 200 || v > 400 ? `Raumhöhe ${v} cm (üblich 200–400)` : null;
  if (a.el === 'Tür' || a.el === 'Balkontür') {
    const maxH = a.el === 'Balkontür' ? 270 : 250;
    if (H && (v < 180 || v > maxH)) return `${a.el}-Höhe ${v} cm (üblich 180–${maxH})`;
    if (!H && (v < 50 || v > 150)) return `${a.el}-Breite ${v} cm (üblich 50–150)`;
    return null;
  }
  if (a.el.startsWith('Fenster')) {
    if (H && (v < 30 || v > 300)) return `Fenster-Höhe ${v} cm (üblich 30–300)`;
    if (!H && (v < 30 || v > 400)) return `Fenster-Breite ${v} cm (üblich 30–400)`;
    return null;
  }
  return v < 10 || v > 600 ? `${H ? 'Höhe' : 'Breite'} ${v} cm ungewöhnlich` : null;
}
function shotIssues(shot) {
  const out = [];
  shot.arrows.forEach(a => { const m = checkArrow(a, shot.room); if (m) out.push({ a, m }); });
  const door = shot.arrows.filter(a => (a.el === 'Tür' || a.el === 'Balkontür') && a.cm != null);
  const dh = door.find(a => a.kind === 'H'), dw = door.find(a => a.kind === 'B');
  if (dh && dw && dw.cm >= dh.cm) out.push({ a: dw, m: `Tür breiter (${dw.cm}) als hoch (${dh.cm}) – Höhe/Breite vertauscht?` });
  const open = shot.arrows.filter(a => a.cm == null);
  if (open.length) out.push({ a: open[0], m: `${open.length} Pfeil${open.length > 1 ? 'e' : ''} ohne Maß` });
  return out;
}
let finishing = 0, checkDlg = null;
async function finishShot(auto) {
  clearTimeout(finishing);
  // eine noch offene „Bitte prüfen“-Rückfrage schließen (z. B. wenn inzwischen neu gemessen wurde) – es gibt immer nur eine
  if (checkDlg) { checkDlg.remove(); checkDlg = null; }
  const iss = shotIssues(S.shot);
  if (iss.length) {
    beep(false);
    const pr = confirmBox('Bitte prüfen', 'Trotzdem weiter', 'Korrigieren', 'ghost', iss.map(x => '• ' + x.m).join('\n'));
    const mine = checkDlg = lastConfirm;
    const go2 = await pr;
    if (checkDlg === mine) checkDlg = null;
    if (!go2) { S.active = iss[0].a.id; S.manualPick = true; updateCur(); return; }
    auto = false;
  }
  const go = async () => {
    await saveShot();
    learnFromShot(S.shot).catch(() => { });
    if (S.wake) { S.wake.release().catch(() => { }); S.wake = null; }
    openCam();
  };
  if (auto) { toast(`${S.shot.room}: alle Maße da ✓ – nächstes Foto`, 1300); finishing = setTimeout(go, 1300); }
  else go();
}

$('#edDone').onclick = () => finishShot(false);
// zurück zum Projekt: sofort wechseln, Speichern läuft im Hintergrund
function leaveEditor(target = 'proj', viaPop = false) {
  clearTimeout(finishing); if (kb.on) setKb(false);
  if (S.wake) { S.wake.release().catch(() => { }); S.wake = null; }
  if (target === 'cam') openCam(viaPop); else show(target, viaPop);
  renderShots();
  saveShot().then(renderShots).catch(e => toast('Speichern fehlgeschlagen: ' + e.message, 4000));
}
$('#edBack').onclick = () => leaveEditor('proj');
function stepActive(d) {
  clearTimeout(finishing);
  const arr = S.shot.arrows; if (!arr.length) return;
  const i = Math.max(0, arr.findIndex(a => a.id === S.active));
  S.active = arr[(i + d + arr.length) % arr.length].id; kb.buf = ''; updateCur();
}

// Ziffernblock
const kb = { on: false, buf: '' };
(function buildKeypad() {
  const el = $('#keypad');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'OK', '0', '⌫'].forEach(k => {
    const b = document.createElement('button'); b.textContent = k; if (!k) b.style.visibility = 'hidden';
    if (k === 'OK') b.className = 'pri';
    b.onclick = () => {
      if (k === '⌫') kb.buf = kb.buf.slice(0, -1);
      else if (k === 'C') kb.buf = '';
      else if (k === 'OK') { const v = parseInt(kb.buf, 10); kb.buf = ''; if (v > 0) { if (opt.mm) setValue(Math.round(v / 10), v); else setValue(v); if (!S.shot.arrows.some(x => x.cm == null)) setKb(false); } } // letzter Wert: Tastatur zu, Wert bleibt sichtbar
      else if (kb.buf.length < (opt.mm ? 5 : 4)) kb.buf += k;
      updateCur();
    };
    el.appendChild(b);
  });
})();
function setKb(on) { kb.on = on; kb.buf = ''; $('#keypad').classList.toggle('on', on); $('#kbBtn').classList.toggle('on', on); updateCur(); }
$('#kbBtn').onclick = () => setKb(!kb.on);
// Aufhellen: automatische Tonwertkorrektur + Aufhellung dunkler Bereiche; Original bleibt für „zurück“ erhalten
$('#eyeA').onclick = () => { S.hideArrows = !S.hideArrows; $('#eyeA').classList.toggle('on', S.hideArrows); if (S.hideArrows) toast('Pfeile ausgeblendet – nochmal tippen zeigt sie wieder', 1500); };
$('#lightA').onclick = async () => {
  clearTimeout(finishing);
  const shot = S.shot;
  if (shot.orig) { shot.photo = shot.orig; delete shot.orig; toast('Original-Foto'); }
  else {
    const c = document.createElement('canvas'); c.width = shot.w; c.height = shot.h;
    const g = c.getContext('2d'); g.drawImage(photoImg, 0, 0, shot.w, shot.h);
    const id = g.getImageData(0, 0, shot.w, shot.h), d = id.data;
    const hist = new Uint32Array(256); let sum = 0;
    for (let i = 0; i < d.length; i += 16) { const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; hist[l]++; sum += l; }
    const tot = d.length / 16; let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > tot * 0.01) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > tot * 0.01) { hi = v; break; } }
    const mean = sum / tot, gam = mean < 70 ? 0.55 : mean < 110 ? 0.7 : 0.85;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / Math.max(1, hi - lo))), gam);
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    g.putImageData(id, 0, 0);
    shot.orig = shot.photo; shot.photo = await canvasToBlob(c, 'image/jpeg', 0.9);
    toast('Aufgehellt – nochmal ☀ = Original');
  }
  photoImg = await blobToImg(shot.photo); grayImg = null;
  $('#lightA').classList.toggle('on', !!shot.orig);
  saveShot();
};
$('#trashA').onclick = () => {
  const a = activeArrow(); if (!a) { toast('Kein Pfeil ausgewählt'); return; }
  clearTimeout(finishing);
  const shot = S.shot, idx = shot.arrows.indexOf(a);
  shot.arrows = shot.arrows.filter(x => x !== a);
  S.active = firstOpen(); saveShot(); updateCur();
  undoToast(`Pfeil gelöscht (${a.kind === 'H' ? 'Höhe' : 'Breite'}${a.cm != null ? ', ' + a.cm + ' cm' : ''})`, () => {
    shot.arrows.splice(idx, 0, a); db.put('shots', shot);
    if (S.shot === shot) { S.active = a.id; updateCur(); }
  });
};

// ---------------- Pfeile ziehen, Zoom (zwei Finger), Einrasten ----------------
// Ansicht: Zoomfaktor + Verschiebung als CSS-Transform auf dem Canvas (Pfeil-Koordinaten bleiben normiert 0..1)
const view = { s: 1, tx: 0, ty: 0 };
function applyView() { cv.style.transform = `translate(-50%,-50%) translate(${view.tx}px,${view.ty}px) scale(${view.s})`; }
function resetView() { view.s = 1; view.tx = 0; view.ty = 0; applyView(); }
function clampView() {
  const st = $('#stage').getBoundingClientRect(), w = cv.offsetWidth * view.s, h = cv.offsetHeight * view.s;
  const mx = Math.max(0, (w - st.width) / 2) + 40, my = Math.max(0, (h - st.height) / 2) + 40;
  view.tx = Math.max(-mx, Math.min(mx, view.tx)); view.ty = Math.max(-my, Math.min(my, view.ty));
}
let drag = null, pinch = null;
const ptrs = new Map();
let lastTap = { t: 0, x: 0, y: 0 };
const stage = $('#stage');
const inStage = e => { const s2 = stage.getBoundingClientRect(); return { x: e.clientX - s2.left - s2.width / 2, y: e.clientY - s2.top - s2.height / 2 }; };

stage.addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  e.preventDefault();
  try { stage.setPointerCapture(e.pointerId); } catch (err) { }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    // zweiter Finger: laufendes Ziehen abbrechen, Zoom/Verschieben beginnen
    if (drag) { const a = drag.a; if (drag.isNew) { S.shot.arrows = S.shot.arrows.filter(x => x !== a); S.active = drag.prev || firstOpen(); } else Object.assign(a, drag.o); drag = null; $('#loupe').style.display = 'none'; updateCur(); }
    const [p1, p2] = [...ptrs.values()];
    const m = inStage({ clientX: (p1.x + p2.x) / 2, clientY: (p1.y + p2.y) / 2 });
    pinch = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), m0: m, s0: view.s, tx0: view.tx, ty0: view.ty };
    return;
  }
  if (ptrs.size > 2 || pinch) return;
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const rw = r.width, rh = r.height;
  let best = null, bd = 1e9;
  for (const a of S.shot.arrows) {
    for (const [k, px, py] of [['p1', a.x1, a.y1], ['p2', a.x2, a.y2]]) {
      const d = Math.hypot((px - x) * rw, (py - y) * rh);
      if (d < 48 && d < bd) { bd = d; best = { a, k }; }
    }
  }
  // Etikett des gewählten Pfeils: hat Vorrang, außer man tippt direkt (< 24 px) auf ein Pfeilende
  const act = activeArrow(), albx = act && labelBoxes.get(act.id);
  if (albx && x >= albx.x && x <= albx.x + albx.w && y >= albx.y && y <= albx.y + albx.h && !(best && bd < 24)) best = { a: act, k: 'all' };
  if (!best) {
    for (const a of S.shot.arrows) {
      const d = segDist(x * rw, y * rh, a.x1 * rw, a.y1 * rh, a.x2 * rw, a.y2 * rh);
      if (d < 34 && d < bd) { bd = d; best = { a, k: 'all' }; }
    }
  }
  clearTimeout(finishing);
  if (!best) {
    if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return; // neben dem Foto
    // freie Stelle: neuen Pfeil mit dem Finger aufziehen
    const a = newArrow(); a.x1 = a.x2 = Math.min(1, Math.max(0, x)); a.y1 = a.y2 = Math.min(1, Math.max(0, y));
    S.shot.arrows.push(a);
    best = { a, k: 'p2', isNew: true, prev: S.active };
  }
  const wasActive = S.active === best.a.id;
  S.active = best.a.id; S.manualPick = !best.isNew; kb.buf = ''; updateCur();
  drag = { ...best, x, y, o: { ...best.a }, sx: e.clientX, sy: e.clientY, moved: false, wasActive };
});
stage.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  e.preventDefault();
  if (pinch && ptrs.size >= 2) {
    const [p1, p2] = [...ptrs.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    const m = inStage({ clientX: (p1.x + p2.x) / 2, clientY: (p1.y + p2.y) / 2 });
    const s1 = Math.max(1, Math.min(6, pinch.s0 * d / Math.max(1, pinch.d0)));
    // Punkt unter der Fingermitte bleibt stehen
    view.tx = m.x - (pinch.m0.x - pinch.tx0) * (s1 / pinch.s0);
    view.ty = m.y - (pinch.m0.y - pinch.ty0) * (s1 / pinch.s0);
    view.s = s1; if (s1 === 1) { view.tx = 0; view.ty = 0; }
    clampView(); applyView();
    return;
  }
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const dx = x - drag.x, dy = y - drag.y, a = drag.a, o = drag.o, cl = v => Math.min(1, Math.max(0, v));
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
  if (drag.k === 'p1') { a.x1 = cl(o.x1 + dx); a.y1 = cl(o.y1 + dy); }
  else if (drag.k === 'p2') { a.x2 = cl(o.x2 + dx); a.y2 = cl(o.y2 + dy); }
  else { a.x1 = cl(o.x1 + dx); a.y1 = cl(o.y1 + dy); a.x2 = cl(o.x2 + dx); a.y2 = cl(o.y2 + dy); }
  if (drag.isNew) { const k = Math.abs((a.y2 - a.y1) * r.height) > Math.abs((a.x2 - a.x1) * r.width) ? 'H' : 'B'; if (k !== a.kind) { a.kind = k; updateCur(); } }
  if (drag.k !== 'all') {
    const px = drag.k === 'p1' ? a.x1 : a.x2, py = drag.k === 'p1' ? a.y1 : a.y2;
    drawLoupe(px, py, r);
  }
});
// Kanten-Magnet (Idee 16): losgelassenes Pfeilende rastet an der nächsten klaren Bildkante ein (quer zum Pfeil gesucht)
function magnet(a, which) {
  if (!opt.magnet || !photoImg) return;
  try {
    const g = grayOf(), r = cv.getBoundingClientRect();
    const radius = Math.max(4, Math.round(10 * g.w / r.width)); // ≈ 10 Bildschirm-Pixel, beim Zoomen entsprechend feiner
    const res = magnetArrow(g, a, which, { radius, minContrast: 12, k: 2, lateral: 3 });
    if (res.moved.length) { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { } }
  } catch (e) { log('Magnet', e.message); }
}
// Einrasten: fast senkrecht/waagrecht (±3°) wird exakt senkrecht/waagrecht
function snapArrow(a, movedEnd) {
  const r = cv.getBoundingClientRect();
  const dx = (a.x2 - a.x1) * r.width, dy = (a.y2 - a.y1) * r.height;
  if (Math.hypot(dx, dy) < 20) return;
  const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI); // 0 = waagrecht, 90 = senkrecht
  if (Math.abs(ang - 90) <= 3) { if (movedEnd === 'p1') a.x1 = a.x2; else a.x2 = a.x1; }
  else if (ang <= 3 || ang >= 177) { if (movedEnd === 'p1') a.y1 = a.y2; else a.y2 = a.y1; }
}
const endDrag = e => {
  if (e && ptrs.has(e.pointerId)) ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) pinch = null; return; }
  if (!drag) return;
  const d = drag; drag = null; $('#loupe').style.display = 'none';
  const a = d.a;
  if (d.isNew) {
    const r = cv.getBoundingClientRect();
    const dx = (a.x2 - a.x1) * r.width, dy = (a.y2 - a.y1) * r.height;
    if (Math.hypot(dx, dy) < 25) { // nur getippt → kein Pfeil; Doppeltipp = Zoom rein/raus
      S.shot.arrows = S.shot.arrows.filter(x => x !== a); S.active = d.prev || firstOpen();
      const now = Date.now();
      if (e && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        if (view.s > 1) resetView();
        else { const m = inStage(e); view.s = 2.5; view.tx = -m.x * 1.5; view.ty = -m.y * 1.5; clampView(); applyView(); }
        lastTap = { t: 0, x: 0, y: 0 };
      } else lastTap = { t: now, x: e ? e.clientX : 0, y: e ? e.clientY : 0 };
    } else {
      a.kind = Math.abs(dy) > Math.abs(dx) ? 'H' : 'B';
      snapArrow(a, 'p2'); magnet(a, 'both');
      // Pfeile von unten nach oben bzw. links nach rechts speichern
      if ((a.kind === 'H' && a.y1 < a.y2) || (a.kind === 'B' && a.x1 > a.x2)) [a.x1, a.y1, a.x2, a.y2] = [a.x2, a.y2, a.x1, a.y1];
      S.active = a.id;
    }
    updateCur();
  } else if (d.k !== 'all' && d.moved) { snapArrow(a, d.k); magnet(a, d.k); }
  else if (d.k === 'all' && !d.moved && d.wasActive) { // schon gewählter Pfeil nochmal angetippt: war es das Etikett? → Lage wechseln (Mitte → Anfang → Ende)
    const lb = labelBoxes.get(a.id);
    if (lb && e && hitLabel(lb, e)) { a.lab = ((a.lab || 0) + 1) % 3; toast(['Etikett in der Mitte', 'Etikett am Anfang', 'Etikett am Ende'][a.lab], 1200); }
  }
  saveShot();
};
stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
// kein Scrollen/Zoomen der Seite im Editor (Zoom macht die App selbst)
['touchstart', 'touchmove'].forEach(t => stage.addEventListener(t, e => { if (e.target.closest('button')) return; e.preventDefault(); }, { passive: false }));

function hitLabel(lb, e) {
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  return x >= lb.x && x <= lb.x + lb.w && y >= lb.y && y <= lb.y + lb.h;
}
function drawLoupe(px, py, r) {
  const L = $('#loupe'), lc = L.getContext('2d'), Z = 3;
  const sr = $('#stage').getBoundingClientRect();
  const fx = r.left - sr.left + px * r.width, fy = r.top - sr.top + py * r.height;
  // über dem Finger; wenn oben kein Platz, daneben
  let lx = fx - 75, ly = fy - 190;
  if (ly < 4) { ly = Math.max(4, fy - 75); lx = fx > sr.width / 2 ? fx - 230 : fx + 80; }
  lx = Math.max(4, Math.min(sr.width - 154, lx));
  L.style.left = lx + 'px'; L.style.top = ly + 'px'; L.style.display = 'block';
  const W = L.width, H = L.height;
  // Ausschnitt aus dem Arbeits-Canvas (enthält Foto + Pfeile)
  const sx = px * cv.width, sy = py * cv.height, sw = (W / Z) * (cv.width / r.width) / 2;
  lc.fillStyle = '#000'; lc.fillRect(0, 0, W, H);
  lc.drawImage(cv, sx - sw, sy - sw, sw * 2, sw * 2, 0, 0, W, H);
  lc.strokeStyle = '#ff2d2d'; lc.lineWidth = 3;
  lc.beginPath(); lc.moveTo(W / 2, H / 2 - 30); lc.lineTo(W / 2, H / 2 + 30); lc.moveTo(W / 2 - 30, H / 2); lc.lineTo(W / 2 + 30, H / 2); lc.stroke();
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

// ---------------- PDF ----------------
async function makePdfFile() { return makePdfFileFor(S.project, S.shots); }
let fontBytesCache = null;
async function pdfBytesFor(p, allShots) {
  const fontBytes = fontBytesCache || (fontBytesCache = new Uint8Array(await (await fetch('vendor/NotoSans.woff')).arrayBuffer()));
  const shots = [];
  for (const s of allShots) {
    const im = await blobToImg(s.photo);
    const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0, s.w, s.h);
    const measured = s.arrows.filter(a => a.cm != null);
    drawArrows(g, s.w, s.h, measured, null, 1, true);
    const jb = await canvasToBlob(c, 'image/jpeg', 0.85);
    shots.push({ room: s.room, jpg: new Uint8Array(await jb.arrayBuffer()), values: measured.map(a => ({ cm: a.cm, time: new Date(a.time) })) });
  }
  const headLogo = await db.setting('headerLogo');
  const proj = { ...p, headerTitle: (await db.setting('headerTitle')) || 'Measuring Master',
    footer: (await db.setting('pdfFooter')) || '', overview: (await db.setting('pdfOverview')) !== false,
    overviewRows: allShots.map(s => ({ room: s.room, items: s.arrows.filter(a => a.cm != null).map(a => ({ el: a.el, kind: a.kind, cm: a.cm })) })),
    headerLogo: headLogo ? await fileToImgBytes(headLogo) : null,
    kundenLogo: p.kundenLogo ? await fileToImgBytes(p.kundenLogo) : null };
  return buildPdf(window.PDFLib, window.fontkit, fontBytes, proj, shots);
}
async function makePdfFileFor(p, allShots) {
  const bytes = await pdfBytesFor(p, allShots);
  log('PDF erstellt', p.name, allShots.length + ' Fotos', Math.round(bytes.length / 1024) + ' KB');
  return new File([bytes], fileBase(p) + '.pdf', { type: 'application/pdf' });
}
// Mehrere Projekte → ein PDF (z. B. ganzes Haus): die einzelnen Maßblätter hintereinander
async function makeCombinedPdf(projects) {
  const { PDFDocument } = window.PDFLib;
  const merged = await PDFDocument.create();
  merged.setProducer('VIEWPORT 360 Massblatt'); merged.setTitle('Maßblätter');
  for (const p of projects) {
    const shots = await db.shotsOf(p.id);
    const src = await PDFDocument.load(await pdfBytesFor(p, shots));
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(pg => merged.addPage(pg));
  }
  const streets = [...new Set(projects.map(p => streetOnly(p.str) + (houseNo(p.str) ? ' ' + houseNo(p.str) : '')))];
  const base = streets.length === 1 ? `${streets[0]} – ${projects.length} Wohnungen` : `Maßblätter – ${projects.length} Projekte`;
  return new File([await merged.save()], fileBase({ str: base }) + '.pdf', { type: 'application/pdf' });
}
// Dateiname = Projektname (Straße + Hausnummer, Geschoß, WG), z. B. "Kopernikusstrasse 22, 1.OG, WG 12.pdf"
function fileBase(p) {
  const n = ((p.str || p.name || '').trim() || 'Wohnung').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n.slice(0, 120);
}
function openCount() { return S.shots.reduce((n, s) => n + s.arrows.filter(a => a.cm == null).length, 0); }
// Projekt-Check vor PDF/Dropbox/Mail: Raumhöhe, Eingangstür, unplausible oder fehlende Maße
function projectIssues() { return issuesFor(S.project, S.shots); }
async function preExport(what) {
  if (!S.shots.length) { toast('Noch keine Fotos'); return false; }
  const iss = projectIssues();
  if (!iss.length) return true;
  return await confirmBox(`Vor dem ${what} bitte prüfen`, 'Trotzdem', 'Abbrechen', 'ghost', iss.map(x => '• ' + x).join('\n'));
}
// nach dem Export sperren (gegen versehentliche Änderungen)
function noteExport(p, how, extra = {}) { p.exports = [...(p.exports || []), { t: Date.now(), how, ...extra }].slice(-50); }
async function lockProject(how, extra = {}) {
  S.project.locked = { at: Date.now(), how }; noteExport(S.project, how, extra); await db.put('projects', S.project); lockUi(); expUi();
  if (opt.shrink) setTimeout(() => shrinkShots(S.shots).then(n => { if (n > 0) toast(`Fotos verkleinert – ${fmtSize(n)} gespart`, 2500); renderShots(); }).catch(e => log('verkleinern', e.message)), 1500);
}
// Fotos exportierter Projekte verkleinern (Idee 90): 1100 px lange Seite, JPEG 74 % – fürs PDF (≈ 200 dpi) reicht das
async function shrinkShot(s, max = 1100, q = 0.74) {
  if (s.shrunk || !s.photo) return 0;
  const im = await blobToImg(s.photo); const sc = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement('canvas'); c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const b = await canvasToBlob(c, 'image/jpeg', q);
  const saved = s.photo.size + (s.orig ? s.orig.size : 0) - b.size;
  if (b.size < s.photo.size) { s.photo = b; s.w = c.width; s.h = c.height; }
  delete s.orig; s.shrunk = true; await db.put('shots', s);
  return Math.max(0, saved);
}
async function shrinkShots(shots) { let n = 0; for (const s of shots) n += await shrinkShot(s); return n; }
// Export-Verlauf (Idee 73): Zeile unter der Ampel, Tipp → ganze Liste
const fmtSize = n => n >= 1048576 ? (n / 1048576).toLocaleString('de-AT', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const fmtWhen = t => new Date(t).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + new Date(t).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
function expUi() {
  const el = $('#expRow'); const ex = S.project && S.project.exports || [];
  if (!ex.length) { el.style.display = 'none'; return; }
  const last = ex[ex.length - 1];
  el.style.display = 'flex'; el.querySelector('span').textContent = `${ex.length} Export${ex.length === 1 ? '' : 'e'} · zuletzt ${last.how} ${fmtWhen(last.t)}`;
}
$('#expRow').onclick = () => {
  const ex = [...(S.project.exports || [])].reverse();
  const lines = ex.map(e => `${fmtWhen(e.t)} · ${e.how}${e.size ? ' · ' + fmtSize(e.size) : ''}${e.path ? '\n   ' + e.path : ''}${e.fotos ? ` (+ ${e.fotos} Foto${e.fotos === 1 ? '' : 's'})` : ''}`);
  infoBox('Export-Verlauf', lines);
};
function lockUi() {
  const l = S.project && S.project.locked;
  $('#proj').classList.toggle('locked', !!l);
  $('#lockBar').style.display = l ? 'flex' : 'none';
  if (l) $('#lockTxt').textContent = `🔒 Gesperrt – ${l.how} am ${new Date(l.at).toLocaleDateString('de-AT')} ${new Date(l.at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}`;
  $$('#projDetails input, #projDetails button, #custChips button').forEach(e => { if (!['btnExpProj', 'btnDupProj', 'btnArchive'].includes(e.id) && !e.closest('#navBtn')) e.disabled = !!l; });
}
$('#unlockBtn').onclick = async () => { delete S.project.locked; await db.put('projects', S.project); lockUi(); toast('Entsperrt'); };
const isLocked = () => { if (S.project && S.project.locked) { toast('Projekt ist gesperrt (exportiert) – oben „Entsperren“'); return true; } return false; };

$('#btnPdf').onclick = async () => {
  if (!await preExport('PDF')) return;
  const b = $('#btnPdf'); b.disabled = true; b.textContent = 'Erstelle …';
  try { await sharePdf(await makePdfFile(), { projectId: S.project.id }); }
  catch (e) { console.error(e); toast('PDF-Fehler: ' + e.message, 5000); }
  finally { b.disabled = false; b.textContent = 'PDF'; }
};
$('#btnMail').onclick = async () => {
  if (!await preExport('Mailen')) return;
  const b = $('#btnMail'); b.disabled = true;
  try {
    const file = await makePdfFile();
    const subject = 'Massblatt ' + (S.project.name || fileBase(S.project));
    if (file.size > 10 * 1048576) toast(`Achtung: PDF hat ${fmtSize(file.size)} – für Mail evtl. zu groß`, 4000);
    const doShare = () => navigator.share({ files: [file], title: subject, text: subject }).then(() => lockProject('gemailt', { size: file.size }));
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await doShare(); }
      catch (e) {
        if (e.name === 'AbortError') return;
        // Berührung „verbraucht“ (iPhone): Dialog mit eigenem Knopf, der sofort teilt
        const bg = document.createElement('div'); bg.className = 'sheet-bg on';
        bg.innerHTML = `<div class="sheet"><h2>✉ Mail senden</h2><p class="mute"></p><div style="display:flex;flex-direction:column;gap:8px"><button class="pri" data-go>Mail-Programm öffnen</button><button class="ghost" data-close>Abbrechen</button></div></div>`;
        bg.querySelector('p').textContent = `Betreff: ${subject} · ${fmtSize(file.size)}`;
        bg.querySelector('[data-go]').onclick = () => { bg.remove(); doShare().catch(err => { if (err.name !== 'AbortError') toast('Teilen nicht möglich: ' + err.message, 4000); }); };
        bg.querySelector('[data-close]').onclick = () => bg.remove();
        document.body.appendChild(bg);
      }
    } else {
      const a = document.createElement('a'); a.href = blobUrl(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      location.href = 'mailto:?subject=' + encodeURIComponent(subject);
      toast('PDF gespeichert – im Mail bitte anhängen', 4000);
    }
  } catch (e) { toast('Mail-Fehler: ' + e.message, 5000); }
  finally { b.disabled = false; }
};
// Dropbox: Unterordner je Kunde (+ Jahresordner, Idee 82), ohne Netz in die Warteschlange
async function customerOf(p) { return p && p.kundeId && ((await db.setting('customers')) || []).find(x => x.id === p.kundeId) || null; }
function withYear(sub, p) {
  if (!dropbox.cfg.year) return sub;
  const d = p && p.datum ? new Date(p.datum) : new Date(); const y = isNaN(d) ? new Date().getFullYear() : d.getFullYear();
  return (sub ? sub + '/' : '') + y;
}
async function custFolderFor(p) { const c = await customerOf(p); return withYear(c ? (c.dbx || c.name || '') : (p.firma || ''), p); }
async function custFolder() { return custFolderFor(S.project); }
// Fotos mit hochladen (Idee 83): nur wenn beim Kunden eingeschaltet – Originale (ohne Pfeile), nummeriert nach Raum
async function photosFor(p, shots) {
  const c = await customerOf(p); if (!c || !c.fotos) return [];
  return shots.map((s, i) => ({ name: `${String(i + 1).padStart(2, '0')} ${s.room}.jpg`.replace(/[\\/:*?"<>|]+/g, ' '), blob: s.orig || s.photo }));
}
// Dropbox-Verlauf (Idee 80)
async function dbxLogAdd(e) { const l = ((await db.setting('dbxLog')) || []).slice(-99); l.push({ t: Date.now(), ...e }); await db.setting('dbxLog', l); }
// Hochladen mit Verlauf und Fotos; meta = { projectId, photos:[{name, blob}] } → { path, fotos }
async function dbxUpload(file, sub, meta = {}) {
  let path;
  try { path = await dropbox.upload(file, sub); }
  catch (e) { await dbxLogAdd({ name: file.name, sub, size: file.size, ok: false, err: e.message, projectId: meta.projectId || null }); throw e; }
  let fotos = 0, ferr = '';
  if (meta.photos && meta.photos.length) {
    const fsub = (dropbox.cleanSub(sub) ? dropbox.cleanSub(sub) + '/' : '') + path.split('/').pop().replace(/\.pdf$/i, '') + ' – Fotos';
    for (const ph of meta.photos) {
      toast(`Foto ${fotos + 1}/${meta.photos.length} in Dropbox …`, 10000);
      try { await dropbox.upload(new File([ph.blob], ph.name, { type: 'image/jpeg' }), fsub, { overwrite: true }); fotos++; }
      catch (e) { ferr = e.message; break; }
    }
  }
  await dbxLogAdd({ name: file.name, sub, size: file.size, ok: true, path, fotos, err: ferr ? `Fotos: ${ferr}` : '', projectId: meta.projectId || null });
  if (ferr) toast(`PDF hochgeladen, aber Fotos abgebrochen: ${ferr}`, 6000);
  return { path, fotos };
}
async function queueAdd(file, sub, meta = {}) {
  const q = (await db.setting('dbxQueue')) || [];
  q.push({ name: file.name, blob: file, sub, time: Date.now(), projectId: meta.projectId || null, photos: meta.photos || [] });
  await db.setting('dbxQueue', q);
}
let queueBusy = false;
async function processQueue() {
  if (queueBusy || !navigator.onLine || !dropbox.connected) return;
  const q = (await db.setting('dbxQueue')) || []; if (!q.length) return;
  queueBusy = true; let ok = 0;
  const rest = [];
  for (const it of q) {
    try {
      const r = await dbxUpload(new File([it.blob], it.name, { type: 'application/pdf' }), it.sub, { projectId: it.projectId, photos: it.photos });
      ok++;
      if (it.projectId) { const p = await db.get('projects', it.projectId); if (p) { noteExport(p, 'in Dropbox', { path: r.path, size: it.blob.size, fotos: r.fotos }); await db.put('projects', p); if (S.project && S.project.id === p.id) { S.project.exports = p.exports; expUi(); } } }
    } catch (e) { rest.push(it); }
  }
  await db.setting('dbxQueue', rest); queueBusy = false;
  if (ok) toast(`${ok} wartende PDF${ok > 1 ? 's' : ''} in Dropbox hochgeladen ✓`, 3500);
}
window.addEventListener('online', () => setTimeout(processQueue, 1500));
$('#btnDbx').onclick = async () => {
  if (!dropbox.connected) { toast('Dropbox zuerst in ⚙ Einstellungen verbinden', 3000); $('#btnSettings').click(); return; }
  if (!await preExport('Hochladen')) return;
  const sub = await custFolder();
  const photos = await photosFor(S.project, S.shots);
  const ok = await confirmBox('PDF in Dropbox speichern?', 'Ja, hochladen', 'Abbrechen', 'pri', `Ordner: ${dropbox.pathFor(sub)}${photos.length ? `\n+ ${photos.length} Original-Foto${photos.length === 1 ? '' : 's'} (beim Kunden eingeschaltet)` : ''}`);
  if (!ok) return;
  const b = $('#btnDbx'); b.disabled = true;
  let file;
  try {
    file = await makePdfFile();
    if (!navigator.onLine) throw new TypeError('offline');
    toast('Lade in Dropbox hoch …', 10000);
    const r = await dbxUpload(file, sub, { projectId: S.project.id, photos }); toast('In Dropbox gespeichert ✓ ' + r.path, 3500); beep(true);
    await lockProject('in Dropbox', { path: r.path, size: file.size, fotos: r.fotos });
  } catch (e) {
    if (!(e instanceof TypeError)) console.error(e);
    if (file && (e instanceof TypeError || !navigator.onLine)) { await queueAdd(file, sub, { projectId: S.project.id, photos }); await lockProject('in Dropbox (wartet auf Netz)', { size: file.size }); toast('Kein Netz – wird automatisch hochgeladen, sobald wieder Netz da ist', 4500); }
    else { toast('Dropbox-Fehler: ' + e.message, 6000); beep(false); }
  } finally { b.disabled = false; }
};

// ---------------- Projekt exportieren / importieren (inkl. Fotos) ----------------
$('#btnExpProj').onclick = async () => {
  const p = S.project;
  const data = { app: 'massblatt-projekt', version: 1, exported: new Date().toISOString(),
    project: { ...p, kundenLogo: p.kundenLogo ? await blobToB64(p.kundenLogo) : null },
    shots: await Promise.all(S.shots.map(async s => { const o = { ...s, photo: await blobToB64(s.photo) }; delete o.orig; return o; })) };
  const name = fileBase(p) + ' (Projekt).json';
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
};
$('#btnDupProj').onclick = async () => {
  const p = S.project;
  if (!await confirmBox('Projekt duplizieren?', 'Duplizieren', 'Abbrechen', 'pri', 'Kunde, Straße, PLZ und Ort werden übernommen, Fotos nicht – z. B. für eine weitere Wohnung im selben Haus.')) return;
  const n = { ...p, id: uid(), created: Date.now(), updated: Date.now(), datum: todayISO() }; delete n.locked; delete n.archived;
  n.str = streetOnly(p.str) + (houseNo(p.str) ? ' ' + houseNo(p.str) : '') + ', ';
  await db.put('projects', n);
  await openProject(n.id, true);
  const el = $('#pStr'); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  toast('Kopie angelegt – Geschoß/WG ergänzen');
};
$('#imProjBtn').onclick = () => $('#imProjFile').click();
$('#imProjFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'massblatt-projekt') throw new Error('keine Projekt-Datei (Kunden-Dateien unter „Kunden & Straßen“ importieren)');
    const old = await db.get('projects', data.project.id);
    const p = { ...data.project, kundenLogo: data.project.kundenLogo ? await b64ToBlob(data.project.kundenLogo) : null, updated: Date.now() };
    if (old) { // schon vorhanden → als Kopie anlegen
      if (!await confirmBox(`Projekt „${p.name}“ gibt es schon. Als Kopie importieren?`, 'Als Kopie', 'Abbrechen', 'pri')) return;
      p.id = uid(); p.name = (p.name || '') + ' (Kopie)'; p.str = (p.str || '') + ' (Kopie)';
    }
    await db.put('projects', p);
    for (const s of data.shots) await db.put('shots', { ...s, id: old ? uid() : s.id, projectId: p.id, photo: await b64ToBlob(s.photo) });
    $('#setSheet').classList.remove('on');
    toast(`Projekt importiert: ${data.shots.length} Fotos`, 3000);
    renderHome(); openProject(p.id);
  } catch (err) { toast('Import fehlgeschlagen: ' + err.message, 5000); }
};

// ---------------- Dropbox einrichten (⚙) ----------------
async function dbxUi() {
  const c = dropbox.cfg;
  $('#dbxKey').value = c.appKey || ''; $('#dbxFolder').value = c.folder || ''; $('#dbxYear').checked = !!c.year;
  const qn = ((await db.setting('dbxQueue')) || []).length;
  $('#dbxState').textContent = (dropbox.connected ? 'Verbunden ✓' : 'Nicht verbunden') + (qn ? ` · ${qn} PDF wartet auf Netz` : '');
  $('#dbxSetup').style.display = dropbox.connected ? 'none' : '';
  $('#dbxOff').style.display = dropbox.connected ? '' : 'none';
  $('#dbxBrowse').disabled = !dropbox.connected;
  const log = (await db.setting('dbxLog')) || []; const bad = log.filter(e => !e.ok).length;
  $('#dbxLogBtn').textContent = `Verlauf (${log.length}${bad ? `, ${bad} fehlgeschlagen` : ''})`; $('#dbxLogBtn').style.display = log.length ? '' : 'none';
  $('#dbxYearHint').textContent = `z. B. ${dropbox.pathFor(withYear('WAG', null))}/Kopernikusstrasse 22, EG.pdf`;
  if (!dropbox.connected && c.appKey) { try { $('#dbxAuth').href = await dropbox.authUrl(); } catch (e) { } } else $('#dbxAuth').removeAttribute('href');
  checkDbxFolder();
}
// Prüfung, ob der eingetragene Ordner existiert (Idee 79)
let dbxChkT = 0;
function checkDbxFolder() {
  clearTimeout(dbxChkT); const st = $('#dbxFolderState');
  if (!dropbox.connected) { st.textContent = ''; return; }
  st.textContent = 'prüfe …';
  dbxChkT = setTimeout(async () => {
    try { const m = await dropbox.exists(dropbox.base); st.textContent = m ? (m['.tag'] === 'folder' ? `✓ Ordner vorhanden (${m.path_display})` : '✗ Das ist eine Datei, kein Ordner') : '○ Ordner gibt es noch nicht – wird beim ersten Hochladen angelegt'; }
    catch (e) { st.textContent = (e instanceof DbxError && e.missingScope) ? '? Keine Leserechte – Berechtigung files.metadata.read in der Dropbox-App-Konsole aktivieren' : '? Prüfung nicht möglich: ' + e.message; }
  }, 600);
}
$('#dbxYear').onchange = () => { dropbox.setYear($('#dbxYear').checked); dbxUi(); };
// Ordner aus Liste wählen (Idee 79): durch die Dropbox blättern, neuen Ordner anlegen, übernehmen
$('#dbxBrowse').onclick = () => dbxBrowser(dropbox.base);
async function dbxBrowser(start) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2>Dropbox-Ordner wählen</h2><p class="mute" data-path style="word-break:break-all"></p>
    <div class="menu" data-list style="max-height:45vh;overflow:auto"></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="ghost" data-up style="flex:1">↑ Eine Ebene höher</button><button class="ghost" data-new style="flex:1">＋ Neuer Ordner</button></div>
    <div style="display:flex;gap:8px;margin-top:8px"><button class="ghost" data-close style="flex:1">Abbrechen</button><button class="pri" data-use style="flex:2">✓ Diesen Ordner verwenden</button></div></div>`;
  let cur = start || '';
  const list = bg.querySelector('[data-list]'), pathEl = bg.querySelector('[data-path]');
  const show = async path => {
    cur = path === '/' ? '' : path; pathEl.textContent = cur || '/ (Hauptordner)'; list.innerHTML = '<p class="mute">Lade …</p>';
    try {
      const l = await dropbox.listFolder(cur);
      list.innerHTML = '';
      if (!l.folders.length) { const p = document.createElement('p'); p.className = 'mute'; p.textContent = l.files.length ? `Keine Unterordner (${l.files.length} Datei${l.files.length === 1 ? '' : 'en'})` : 'Leerer Ordner'; list.appendChild(p); }
      for (const f of l.folders) { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = '📁 ' + f.name; b.onclick = () => show(f.path); list.appendChild(b); }
    } catch (e) {
      if (e instanceof DbxError && e.notFound && cur) { toast('Ordner gibt es noch nicht'); return show(cur.split('/').slice(0, -1).join('/')); }
      list.innerHTML = ''; const p = document.createElement('p'); p.className = 'mute'; p.textContent = 'Fehler: ' + e.message; list.appendChild(p);
    }
  };
  bg.querySelector('[data-up]').onclick = () => show(cur.split('/').slice(0, -1).join('/'));
  bg.querySelector('[data-new]').onclick = async () => {
    const name = await promptBox('Neuer Ordner in ' + (cur || '/'), 'z. B. Maßblätter'); if (!name) return;
    try { const m = await dropbox.createFolder((cur || '') + '/' + name.replace(/[\\/:*?"<>|]+/g, ' ').trim()); toast('Ordner angelegt'); show(m.path_display); }
    catch (e) { toast('Anlegen fehlgeschlagen: ' + e.message, 5000); }
  };
  bg.querySelector('[data-use]').onclick = () => { if (!cur) { toast('Bitte einen Ordner wählen (nicht den Hauptordner)'); return; } dropbox.setFolder(cur); $('#dbxFolder').value = cur; bg.remove(); toast('Dropbox-Ordner: ' + cur, 2500); checkDbxFolder(); };
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
  show(cur);
}
// kleine Texteingabe als Blatt
function promptBox(title, placeholder = '', value = '') {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg on';
    bg.innerHTML = `<div class="sheet"><h2></h2><input data-in><div style="display:flex;gap:8px;margin-top:12px"><button class="ghost" data-close style="flex:1">Abbrechen</button><button class="pri" data-ok style="flex:1">OK</button></div></div>`;
    bg.querySelector('h2').textContent = title; const inp = bg.querySelector('[data-in]'); inp.placeholder = placeholder; inp.value = value;
    const fin = v => { bg.remove(); res(v); };
    bg.querySelector('[data-ok]').onclick = () => fin(inp.value.trim() || null); bg.querySelector('[data-close]').onclick = () => fin(null);
    inp.onkeydown = e => { if (e.key === 'Enter') fin(inp.value.trim() || null); };
    document.body.appendChild(bg); setTimeout(() => inp.focus(), 50);
  });
}
// Dropbox-Verlauf (Idee 80) mit „nochmal“ für fehlgeschlagene Uploads
$('#dbxLogBtn').onclick = () => dbxLogSheet();
async function dbxLogSheet() {
  const log = [...((await db.setting('dbxLog')) || [])].reverse();
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2>Dropbox-Verlauf</h2><div data-list style="max-height:60vh;overflow:auto;font-size:14px"></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="ghost" data-clear style="flex:1">Verlauf leeren</button><button class="pri" data-close style="flex:1">Schließen</button></div></div>`;
  const list = bg.querySelector('[data-list]');
  for (const e of log) {
    const row = document.createElement('div'); row.className = 'dbxrow';
    row.innerHTML = `<div style="flex:1;min-width:0"><b></b><div class="mute" data-sub></div></div>`;
    row.querySelector('b').textContent = `${e.ok ? '✓' : '✗'} ${e.name}`;
    row.querySelector('[data-sub]').textContent = `${fmtWhen(e.t)} · ${e.size ? fmtSize(e.size) + ' · ' : ''}${e.ok ? (e.path || '') + (e.fotos ? ` + ${e.fotos} Foto${e.fotos === 1 ? '' : 's'}` : '') : 'fehlgeschlagen: ' + (e.err || '?')}${e.ok && e.err ? ' · ' + e.err : ''}`;
    if (e.redone) { const s2 = document.createElement('span'); s2.className = 'mute'; s2.textContent = '↻ nachgeholt'; row.appendChild(s2); }
    if (e.projectId && (!e.ok || e.err) && !e.redone) {
      const b = document.createElement('button'); b.className = 'ghost'; b.textContent = 'nochmal'; b.style.cssText = 'width:auto;padding:6px 10px;height:auto';
      b.onclick = async () => {
        b.disabled = true; b.textContent = '…';
        try {
          const p = await db.get('projects', e.projectId); if (!p) throw new Error('Projekt gibt es nicht mehr');
          const shots = await db.shotsOf(p.id);
          const file = await makePdfFileFor(p, shots);
          const r = await dbxUpload(file, e.sub || await custFolderFor(p), { projectId: p.id, photos: await photosFor(p, shots) });
          noteExport(p, 'in Dropbox', { path: r.path, size: file.size, fotos: r.fotos }); await db.put('projects', p);
          if (S.project && S.project.id === p.id) { S.project.exports = p.exports; expUi(); }
          const l2 = (await db.setting('dbxLog')) || []; const old = l2.find(x => x.t === e.t); if (old) { old.redone = Date.now(); await db.setting('dbxLog', l2); }
          toast('Hochgeladen ✓ ' + r.path, 3500); bg.remove(); dbxLogSheet(); dbxUi();
        } catch (err) { toast('Fehler: ' + err.message, 5000); b.disabled = false; b.textContent = 'nochmal'; }
      };
      row.appendChild(b);
    }
    list.appendChild(row);
  }
  if (!log.length) list.innerHTML = '<p class="mute">Noch keine Uploads.</p>';
  bg.querySelector('[data-clear]').onclick = async () => { await db.setting('dbxLog', []); bg.remove(); dbxUi(); };
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
}
$('#dbxKey').onchange = () => { dropbox.setAppKey($('#dbxKey').value); dbxUi(); };
$('#dbxAuth').onclick = e => { if (!$('#dbxAuth').href) { e.preventDefault(); toast('Zuerst den App-Key eintragen'); } };
$('#dbxFolder').oninput = () => { dropbox.setFolder($('#dbxFolder').value); checkDbxFolder(); };
$('#dbxOk').onclick = async () => {
  try { await dropbox.finishAuth($('#dbxCode').value); $('#dbxCode').value = ''; toast('Dropbox verbunden ✓'); }
  catch (e) { toast('Dropbox: ' + e.message, 5000); }
  dbxUi();
};
$('#dbxOff').onclick = () => { dropbox.disconnect(); dbxUi(); };

async function previewPdf(file) {
  const v = $('#pvw'), pages = $('#pvwPages'); pages.innerHTML = '<p class="mute" style="color:#ddd">Lade Vorschau …</p>';
  $('#pvwTitle').textContent = file.name; v.classList.add('on');
  try {
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    pages.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: Math.min(2, (window.innerWidth * (window.devicePixelRatio || 1)) / 842) });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; pages.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) { pages.innerHTML = ''; const p = document.createElement('p'); p.style.color = '#fff'; p.textContent = 'Vorschau nicht möglich: ' + e.message; pages.appendChild(p); }
}
$('#pvwClose').onclick = () => { $('#pvw').classList.remove('on'); $('#pvwPages').innerHTML = ''; };
// Drucken (Idee 74): PDF-Seiten werden als Bilder in eine Druckansicht gelegt – geht am Android (kein PDF im Rahmen) und am iPhone gleich
let printBusy = false;
async function printPdf(file) {
  if (printBusy) return; printBusy = true;
  toast('Bereite Druck vor …', 8000);
  try {
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const old = $('#printBox'); if (old) old.remove();
    const box = document.createElement('div'); box.id = 'printBox';
    let landscape = true;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp0 = page.getViewport({ scale: 1 }); if (i === 1) landscape = vp0.width >= vp0.height;
      const vp = page.getViewport({ scale: 2.4 }); // ≈ 170 dpi auf A4
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const img = document.createElement('img'); img.src = c.toDataURL('image/jpeg', 0.9); img.className = 'pp'; box.appendChild(img);
      c.width = c.height = 0;
    }
    let st = $('#printStyle'); if (!st) { st = document.createElement('style'); st.id = 'printStyle'; document.head.appendChild(st); }
    st.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
    document.body.appendChild(box);
    await Promise.all([...box.querySelectorAll('img')].map(im => im.decode().catch(() => { })));
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); box.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 120000); }, 50);
  } finally { printBusy = false; }
}
// opts: { onLock(how) – was nach Teilen/Speichern passieren soll, dbxSub – Dropbox-Unterordner, title }
async function sharePdf(file, opts = {}) {
  const url = blobUrl(file);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const onLock = opts.onLock || ((how, extra) => lockProject(how, extra));
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2></h2><p class="mute"></p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="pri" data-share>Teilen (Mail, WhatsApp, Drive …)</button>
      <button class="ghost" data-dbx>In Dropbox speichern</button>
      <a data-dl style="display:block"><button class="ghost" style="width:100%">Am Handy speichern</button></a>
      <button class="ghost" data-files>In „Dateien“ sichern</button>
      <button class="ghost" data-open>Vorschau ansehen</button>
      <button class="ghost" data-print>🖨 Drucken</button>
      <button class="ghost" data-close>Schließen</button></div></div>`;
  bg.querySelector('h2').textContent = opts.title || 'PDF fertig';
  bg.querySelector('p').textContent = `${file.name} · ${fmtSize(file.size)}${file.size > 10 * 1048576 ? ' – für Mail evtl. zu groß' : ''}`;
  const a = bg.querySelector('[data-dl]'); a.href = url; a.download = file.name;
  a.addEventListener('click', () => onLock('gespeichert', { size: file.size }));
  const sb = bg.querySelector('[data-share]');
  if (!canShare) sb.style.display = 'none';
  sb.onclick = () => navigator.share({ files: [file], title: file.name }).then(() => onLock('geteilt', { size: file.size })).catch(() => { });
  bg.querySelector('[data-print]').onclick = () => printPdf(file).then(() => onLock('gedruckt', { size: file.size })).catch(e => toast('Drucken nicht möglich: ' + e.message, 4000));
  // iPhone: ein Download-Link würde das PDF in der App öffnen (ohne Zurück) → stattdessen Teilen-Menü („In Dateien sichern“)
  const fb = bg.querySelector('[data-files]');
  if (isIOS && canShare) { a.style.display = 'none'; fb.onclick = sb.onclick; } else fb.style.display = 'none';
  const dbx = bg.querySelector('[data-dbx]');
  if (!dropbox.connected) dbx.style.display = 'none';
  dbx.onclick = async () => {
    dbx.disabled = true; dbx.textContent = 'Lade hoch …';
    const sub = opts.dbxSub != null ? opts.dbxSub : await custFolder();
    const meta = { projectId: opts.projectId || null, photos: opts.projectId && S.project && S.project.id === opts.projectId ? await photosFor(S.project, S.shots) : [] };
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const r = await dbxUpload(file, sub, meta);
      toast('In Dropbox gespeichert ✓ ' + r.path, 3500); beep(true); await onLock('in Dropbox', { path: r.path, size: file.size, fotos: r.fotos }); bg.remove();
    } catch (e) {
      if (e instanceof TypeError || !navigator.onLine) { await queueAdd(file, sub, meta); await onLock('in Dropbox (wartet auf Netz)', { size: file.size }); toast('Kein Netz – wird automatisch hochgeladen, sobald wieder Netz da ist', 4500); bg.remove(); }
      else { toast('Dropbox-Fehler: ' + e.message, 6000); dbx.disabled = false; dbx.textContent = 'In Dropbox speichern'; }
    }
  };
  bg.querySelector('[data-open]').onclick = () => previewPdf(file);
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
}

// ---------------- Einstellungen ----------------
$$('#setTabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(t) {
  $$('#setTabs button').forEach(b => b.classList.toggle('sel', b.dataset.tab === t));
  $$('#setSheet .tab').forEach(e => e.classList.toggle('on', e.dataset.tab === t));
  try { localStorage.setItem('mb_tab', t); } catch (e) { }
  if (t === 'system') { runSelfTest(); showStorage(); }
}
$('#btnSettings').onclick = async () => {
  let t = 'allg'; try { t = localStorage.getItem('mb_tab') || 'allg'; } catch (e) { }
  showTab(t);
  $('#sGlove').checked = !!opt.glove; $('#sLearn').checked = opt.learn !== false; $('#sLeft').checked = !!opt.left;
  $('#sMagnet').checked = opt.magnet !== false; $('#sDash').checked = !!opt.dash; fillCamList();
  $('#sShrink').checked = !!opt.shrink; $('#sRemind').checked = opt.remind !== false; $('#sLockDays').value = String(lockDays()); bioUi(); backupUi(); offlineUiList();
  learnState();
  gcalUi();
  $('#sTitle').value = (await db.setting('headerTitle')) || '';
  const lg = await db.setting('headerLogo');
  if (lg) { $('#sLogoPrev').src = blobUrl(lg); $('#sLogoPrev').hidden = false; } else $('#sLogoPrev').hidden = true;
  $('#sAi').value = S.ai ? '1' : '0';
  dbxUi();
  renderCustManage();
  $('#sAiState').textContent = 'KI-Modell: ' + modelState();
  $('#sLog').textContent = laser.log.join('\n') || '–';
  $('#ver').textContent = VERSION;
  $('#sFooter').value = (await db.setting('pdfFooter')) || '';
  $('#sBig').checked = !!opt.big; $('#sVoice').checked = !!opt.voice;
  $('#sNav').value = opt.nav || ''; $('#sUnit').value = opt.mm ? 'mm' : 'cm';
  const kl = laser.known; $('#sLasers').textContent = kl.length ? 'Gemerkt: ' + kl.map(k => `${k.name} (${new Date(k.last).toLocaleDateString('de-AT')})`).join(', ') : 'Noch kein Laser verbunden.';
  $('#sOverview').value = (await db.setting('pdfOverview')) === false ? '0' : '1';
  $('#sRooms').value = (await rooms()).map(([k, t]) => t ? `${k} = ${t}` : k).join('\n');
  $('#sZoom').value = String((await db.setting('zoom')) || 1);
  showStorage();
  $('#setSheet').classList.add('on');
};
$('#sGlove').onchange = () => { opt.glove = $('#sGlove').checked; saveOpt(); };
$('#sLeft').onchange = () => { opt.left = $('#sLeft').checked; saveOpt(); };
$('#sMagnet').onchange = () => { opt.magnet = $('#sMagnet').checked; saveOpt(); };
$('#sShrink').onchange = () => { opt.shrink = $('#sShrink').checked; saveOpt(); };
$('#sRemind').onchange = () => { opt.remind = $('#sRemind').checked; saveOpt(); backupBar(); };
$('#sLockDays').onchange = () => { try { localStorage.setItem('mb_lockDays', $('#sLockDays').value); } catch (e) { } toast(`PIN wird ${$('#sLockDays').value === '1' ? 'täglich' : 'alle ' + $('#sLockDays').value + ' Tage'} verlangt`); };
// Fotos aller exportierten Projekte jetzt verkleinern
$('#sShrinkNow').onclick = async () => {
  const b = $('#sShrinkNow'); b.disabled = true;
  try {
    const projs = (await liveProjects()).filter(p => p.locked || (p.exports && p.exports.length));
    let saved = 0, n = 0;
    for (const p of projs) for (const sh of await db.shotsOf(p.id)) { if (sh.shrunk) continue; saved += await shrinkShot(sh); n++; b.textContent = `Verkleinere … ${n}`; }
    toast(n ? `${n} Fotos verkleinert – ${fmtSize(saved)} gespart` : 'Nichts zu verkleinern (alle exportierten Fotos sind schon klein)', 4000);
    if (S.project) { S.shots = await db.shotsOf(S.project.id); }
    showStorage();
  } catch (e) { toast('Fehler: ' + e.message, 4000); }
  b.disabled = false; b.textContent = 'Jetzt alle exportierten Projekte verkleinern';
};
// Fingerabdruck/Face-ID einrichten (Idee 93)
async function bioUi() {
  const st = $('#sBioState'), on = $('#sBioOn'), off = $('#sBioOff');
  const avail = await bio.available(); const c = bio.cred;
  on.style.display = !c && avail ? '' : 'none'; off.style.display = c ? '' : 'none';
  st.textContent = c ? (bio.usable ? `Eingerichtet auf diesem Gerät (seit ${new Date(c.at).toLocaleDateString('de-AT')})` : 'Eingerichtet – nach der PIN-Änderung einmal PIN eingeben, dann gilt es wieder')
    : avail ? 'Noch nicht eingerichtet' : 'Auf diesem Gerät/Browser nicht verfügbar (am iPhone: App zum Home-Bildschirm hinzufügen, Face-ID aktiv)';
}
$('#sBioOn').onclick = async () => {
  try { await bio.register(); toast('Eingerichtet – beim nächsten Sperren reicht Fingerabdruck/Face-ID', 3500); }
  catch (e) { toast('Nicht eingerichtet: ' + (e.name === 'NotAllowedError' ? 'abgebrochen oder nicht erlaubt' : e.message), 5000); }
  bioUi();
};
$('#sBioOff').onclick = () => { bio.remove(); toast('Entfernt – es gilt wieder nur die PIN'); bioUi(); };

// ---------------- Gesamt-Sicherung (Idee 88/89) ----------------
// Blobs (Fotos, Logos) werden als Daten-URL eingepackt, beim Einspielen wieder ausgepackt
async function packBlobs(v) {
  if (v instanceof Blob) return { __b64: await blobToB64(v) };
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await packBlobs(x)); return out; }
  if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v)) out[k] = await packBlobs(v[k]); return out; }
  return v;
}
async function unpackBlobs(v) {
  if (v && typeof v === 'object' && typeof v.__b64 === 'string' && Object.keys(v).length === 1) return b64ToBlob(v.__b64);
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await unpackBlobs(x)); return out; }
  if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v)) out[k] = await unpackBlobs(v[k]); return out; }
  return v;
}
const BK_LOCAL = ['mb_opt', 'mb_sort', 'mb_cam', 'mb_lasers', 'mb_dropbox', 'mb_gcal', 'mb_lockDays', 'mb_laserHint', 'mb_pincfg'];
const BK_SKIP_SETTINGS = ['dbxQueue'];
async function backupStats() {
  const projs = (await db.all('projects')).filter(p => !p.deleted); const ids = new Set(projs.map(p => p.id));
  let n = 0, bytes = 0; for (const sh of await db.all('shots')) if (ids.has(sh.projectId)) { n++; bytes += sh.photo ? sh.photo.size : 0; }
  return { projects: projs.length, shots: n, bytes: Math.round(bytes * 1.37) + projs.length * 2000 };
}
async function makeBackup() {
  const projs = (await db.all('projects')).filter(p => !p.deleted); const ids = new Set(projs.map(p => p.id));
  const settings = {};
  for (const k of await db.settingKeys()) if (!BK_SKIP_SETTINGS.includes(k)) settings[k] = await packBlobs(await db.setting(k));
  const local = {}; for (const k of BK_LOCAL) { try { const v = localStorage.getItem(k); if (v != null) local[k] = v; } catch (e) { } }
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const head = { app: 'massblatt-sicherung', version: 1, appVersion: VERSION, exported: d.toISOString(), device: navigator.userAgent.slice(0, 80), settings, local, projects: await packBlobs(projs) };
  // Fotos stückweise anhängen, damit nicht ein riesiger Text auf einmal entsteht
  const parts = [JSON.stringify(head).slice(0, -1), ',"shots":['];
  let first = true, n = 0;
  for (const sh of await db.all('shots')) {
    if (!ids.has(sh.projectId)) continue;
    const o = { ...sh }; delete o.orig;
    parts.push((first ? '' : ',') + JSON.stringify(await packBlobs(o))); first = false; n++;
  }
  parts.push(']}');
  const file = new File(parts, `massblatt-sicherung_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`, { type: 'application/json' });
  return { file, projects: projs.length, shots: n };
}
async function backupUi() {
  const st = await backupStats(); const last = await db.setting('lastBackup');
  $('#sBackupInfo').textContent = `${st.projects} Projekte, ${st.shots} Fotos, Datei ca. ${fmtSize(st.bytes)} · ${last ? 'zuletzt gesichert ' + fmtWhen(last) : 'noch nie gesichert'}`;
}
$('#sBackup').onclick = async () => {
  const b = $('#sBackup'); b.disabled = true; b.textContent = 'Erstelle Sicherung …';
  try {
    const { file, projects, shots } = await makeBackup();
    let done = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: file.name }); done = true; } catch (e) { if (e.name === 'AbortError') { b.disabled = false; b.textContent = '💾 Gesamt-Sicherung erstellen'; return; } } }
    if (!done) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); }
    await db.setting('lastBackup', Date.now()); try { localStorage.removeItem('mb_bkSnooze'); } catch (e) { }
    log('Sicherung', projects, shots, file.size);
    toast(`Sicherung erstellt: ${projects} Projekte, ${shots} Fotos (${fmtSize(file.size)})`, 4000);
    backupUi(); backupBar();
  } catch (e) { toast('Sicherung fehlgeschlagen: ' + e.message, 5000); }
  b.disabled = false; b.textContent = '💾 Gesamt-Sicherung erstellen';
};
$('#sRestore').onclick = () => $('#sRestoreFile').click();
$('#sRestoreFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    toast('Lese Sicherung …', 5000);
    const data = JSON.parse(await f.text());
    if (data.app !== 'massblatt-sicherung') throw new Error('keine Gesamt-Sicherung (Projekt- und Kundendateien haben eigene Import-Knöpfe)');
    const nP = (data.projects || []).length, nS = (data.shots || []).length;
    const cur = await backupStats();
    const mode = await new Promise(res => {
      const bg = document.createElement('div'); bg.className = 'sheet-bg on';
      bg.innerHTML = `<div class="sheet"><h2>Sicherung einspielen</h2><p class="mute"></p><div class="menu"><button class="pri" data-m="merge">Zusammenführen (Vorhandenes bleibt)</button><button class="danger" data-m="replace">Alles ersetzen (${cur.projects} Projekte hier werden gelöscht)</button></div><button class="ghost" style="width:100%;margin-top:10px" data-close>Abbrechen</button></div>`;
      bg.querySelector('p').textContent = `Datei vom ${fmtWhen(Date.parse(data.exported) || Date.now())} (App ${data.appVersion || '?'}): ${nP} Projekte, ${nS} Fotos, ${Object.keys(data.settings || {}).length} Einstellungen.`;
      bg.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => { bg.remove(); res(b.dataset.m); }; });
      bg.querySelector('[data-close]').onclick = () => { bg.remove(); res(null); };
      document.body.appendChild(bg);
    });
    if (!mode) return;
    if (mode === 'replace' && !await confirmBox('Wirklich alles auf diesem Handy ersetzen?', 'Ja, ersetzen', 'Abbrechen', 'danger')) return;
    await restoreBackup(data, mode);
    toast(`Eingespielt: ${nP} Projekte, ${nS} Fotos – App startet neu`, 4000);
    setTimeout(() => location.reload(), 1500);
  } catch (err) { toast('Einspielen fehlgeschlagen: ' + err.message, 6000); }
};
async function restoreBackup(data, mode) {
  if (mode === 'replace') { await db.clear('shots'); await db.clear('projects'); await db.clear('settings'); }
  for (const p of data.projects || []) await db.put('projects', await unpackBlobs(p));
  for (const sh of data.shots || []) await db.put('shots', await unpackBlobs(sh));
  const st = data.settings || {};
  for (const k of Object.keys(st)) {
    const v = await unpackBlobs(st[k]);
    if (mode === 'replace') { await db.setting(k, v); continue; }
    const have = await db.setting(k);
    if (k === 'customers') { // nach Namen zusammenführen
      const cs = have || []; for (const c of v || []) { const i = cs.findIndex(x => (x.name || '').toLowerCase() === (c.name || '').toLowerCase()); if (i >= 0) cs[i] = { ...c, id: cs[i].id }; else cs.push(c); } await db.setting(k, cs);
    } else if (k === 'streets') { const l = have || []; for (const x of v || []) if (!l.some(y => normStreet(y.street) === normStreet(x.street) && y.ort === x.ort)) l.push(x); await db.setting(k, l); }
    else if (have === undefined || have === null) await db.setting(k, v);
  }
  for (const k of Object.keys(data.local || {})) { try { if (mode === 'replace' || localStorage.getItem(k) == null) localStorage.setItem(k, data.local[k]); } catch (e) { } }
  await db.setting('lastBackup', Date.now());
  log('Sicherung eingespielt', mode, (data.projects || []).length, (data.shots || []).length);
}
// Erinnerung (Idee 89): Leiste auf der Startseite, wenn die letzte Sicherung älter als 14 Tage ist
const BK_DAYS = 14;
async function backupBar() {
  const bar = $('#bkBar'); if (!bar) return;
  let snooze = 0; try { snooze = Number(localStorage.getItem('mb_bkSnooze') || 0); } catch (e) { }
  if (opt.remind === false || snooze > Date.now()) { bar.style.display = 'none'; return; }
  const last = await db.setting('lastBackup');
  const projs = (await liveProjects()); const shots = await db.all('shots');
  const withPhotos = projs.filter(p => shots.some(s => s.projectId === p.id));
  const oldest = Math.min(...withPhotos.map(p => p.created || Date.now()));
  const due = withPhotos.length >= 3 && (last ? last < Date.now() - BK_DAYS * 864e5 : oldest < Date.now() - BK_DAYS * 864e5);
  bar.style.display = due ? 'flex' : 'none';
  if (due) bar.querySelector('span').textContent = last ? `Zuletzt gesichert vor ${Math.floor((Date.now() - last) / 864e5)} Tagen` : 'Noch keine Gesamt-Sicherung';
}
$('#bkNow').onclick = async () => { await $('#btnSettings').onclick(); showTab('system'); setTimeout(() => $('#sBackup').scrollIntoView({ block: 'center' }), 100); };
$('#bkLater').onclick = () => { try { localStorage.setItem('mb_bkSnooze', String(Date.now() + 3 * 864e5)); } catch (e) { } $('#bkBar').style.display = 'none'; };

// ---------------- Alles löschen (Idee 95) ----------------
$('#sWipe').onclick = async () => {
  const st = await backupStats();
  if (!await confirmBox('Alles auf diesem Handy löschen?', 'Weiter', 'Abbrechen', 'danger', `${st.projects} Projekte mit ${st.shots} Fotos, Kunden, Einstellungen, Dropbox- und Google-Anmeldung werden entfernt. Tipp: vorher „Gesamt-Sicherung erstellen“.`)) return;
  const word = await promptBox('Zur Bestätigung LÖSCHEN eingeben', 'LÖSCHEN');
  if ((word || '').trim().toUpperCase() !== 'LÖSCHEN') { toast('Abgebrochen – nichts gelöscht'); return; }
  try {
    await db.clear('shots'); await db.clear('projects'); await db.clear('settings');
    try { localStorage.clear(); } catch (e) { }
    try { for (const k of await caches.keys()) if (!k.startsWith('mb-') && !k.startsWith('mblib')) await caches.delete(k); } catch (e) { }
    toast('Alles gelöscht – App startet neu', 3000);
    setTimeout(() => location.reload(), 1200);
  } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, 5000); }
};
// Aufräumen (Idee 46): exportierte Projekte, die älter als n Monate sind, ins Archiv
$('#sCleanup').onclick = async () => {
  const months = Math.max(1, parseInt($('#sCleanMonths').value, 10) || 3);
  const lim = Date.now() - months * 30 * 864e5;
  const cand = (await liveProjects()).filter(p => !p.archived && (p.locked || (p.exports && p.exports.length)) && Math.max(p.updated || 0, p.locked ? p.locked.at : 0) < lim);
  if (!cand.length) { toast(`Nichts zu archivieren (keine exportierten Projekte älter als ${months} Monate)`, 3500); return; }
  if (!await confirmBox(`${cand.length} Projekt${cand.length > 1 ? 'e' : ''} ins Archiv verschieben?`, 'Archivieren', 'Abbrechen', 'pri', cand.slice(0, 8).map(p => '• ' + (p.name || 'Ohne Namen')).join('\n') + (cand.length > 8 ? `\n… und ${cand.length - 8} weitere` : ''))) return;
  for (const p of cand) { p.archived = true; await db.put('projects', p); }
  log('Sammel-Archiv', cand.length); renderHome(); toast(`${cand.length} Projekt${cand.length > 1 ? 'e' : ''} archiviert – über „📦 Archiv“ weiterhin erreichbar`, 3500);
};
$('#sDash').onchange = () => { opt.dash = $('#sDash').checked; saveOpt(); };
$('#sCam').onchange = () => { opt.cam = $('#sCam').value; saveOpt(); };
// Kameraliste (Namen gibt es erst, wenn die Kamera einmal erlaubt wurde)
async function fillCamList() {
  const sel = $('#sCam'); const cur = opt.cam || '';
  let devs = [];
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) { }
  sel.innerHTML = '<option value="">Automatisch (Rückkamera)</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${d.label ? d.label.replace(/\(.*?\)/, '').trim() : 'Kamera ' + (i + 1)}</option>`).join('');
  sel.value = devs.some(d => d.deviceId === cur) ? cur : '';
  $('#sCamHint').textContent = devs.length ? (devs.some(d => d.label) ? 'Bei verzerrtem Bild (Weitwinkel) hier die Hauptkamera wählen.' : 'Namen erscheinen, sobald die Kamera einmal benutzt wurde.') : 'Keine Kamera gefunden.';
}
$('#sLearn').onchange = () => { opt.learn = $('#sLearn').checked; saveOpt(); };
$('#sLearnReset').onclick = async () => { await db.setting('tplLearn', null); learnState(); toast('Gelernte Pfeil-Positionen gelöscht'); };
async function learnState() {
  const L = (await db.setting('tplLearn')) || {};
  const parts = Object.entries(L).map(([k, v]) => `${k}: ${v.length}`);
  $('#sLearnState').textContent = parts.length ? 'Gelernt aus Fotos – ' + parts.join(', ') : 'Noch nichts gelernt (ab 3 fertigen Fotos je Vorlage).';
}
$('#sBig').onchange = () => { opt.big = $('#sBig').checked; saveOpt(); if (opt.big) showBig({ el: 'Tür', kind: 'H', cm: 199, mm: 1990 }); };
$('#sVoice').onchange = () => { opt.voice = $('#sVoice').checked; saveOpt(); if (opt.voice) say('Sprachansage ist an. Tür Höhe, 199'); };
const DEMO = [
  ['📁', 'Projekt anlegen', 'Unten „+ Neues Projekt“. Straße + Hausnummer (+ Geschoß, WG), PLZ und Ort eintragen – bekannte Straßen füllen PLZ/Ort selbst aus. Kunde antippen.'],
  ['📷', 'Raum wählen & fotografieren', '„📷 Foto“ → Raum antippen (Kz, Sz, Wz …). Tür bzw. Fenster ganz ins Bild nehmen. Der waagrechte Strich wird gelb, wenn das Handy gerade ist.'],
  ['↕️', 'Pfeile setzen', 'Mit dem Finger über das Foto ziehen: senkrecht = Höhe, waagrecht = Breite. Enden verschieben (Lupe hilft), 🗑 löscht den ausgewählten Pfeil. Vorlagen unter „Pfeile“.'],
  ['📏', 'Messen', 'Oben „Laser“ verbinden (Android + Chrome) und am Laser messen – der Wert springt in den blinkenden Pfeil, dann zum nächsten. Ohne Laser: ⌨ antippen und eintippen.'],
  ['✅', 'Prüfen & weiter', 'Nach dem letzten Pfeil prüft die App die Maße und öffnet die Kamera fürs nächste Foto. „‹ Projekt“ führt zurück zur Fotoliste.'],
  ['📄', 'PDF & Dropbox', 'In der Fotoliste „PDF“ (Vorschau, Teilen, Speichern) oder das Dropbox-Symbol – das PDF heißt wie das Projekt.'],
];
let demoI = 0;
function demoShow() {
  const [ic, h, t] = DEMO[demoI];
  $('#demoSlide').innerHTML = '<div class="slide"><div class="ic"></div><h3></h3><p></p></div>';
  $('#demoSlide .ic').textContent = ic; $('#demoSlide h3').textContent = `${demoI + 1}. ${h}`; $('#demoSlide p').textContent = t;
  $('#demoDots').textContent = DEMO.map((_, i) => i === demoI ? '●' : '○').join('');
  $('#demoPrev').disabled = demoI === 0; $('#demoNext').textContent = demoI === DEMO.length - 1 ? 'Fertig ✓' : 'Weiter ›';
}
$('#sDemo').onclick = () => { $('#setSheet').classList.remove('on'); demoI = 0; demoShow(); $('#demo').classList.add('on'); };
$('#demoPrev').onclick = () => { if (demoI > 0) { demoI--; demoShow(); } };
$('#demoNext').onclick = () => { if (demoI < DEMO.length - 1) { demoI++; demoShow(); } else $('#demo').classList.remove('on'); };
// Update-Knopf: vorbereitet, Funktion wird erst zum Schluss freigegeben (Manuel 05.11.)
$('#sUpdate').onclick = () => toast('Noch nicht aktiv – Updates kommen derzeit automatisch', 2500);
$('#sNav').onchange = () => { opt.nav = $('#sNav').value; saveOpt(); };
$('#sUnit').onchange = () => { opt.mm = $('#sUnit').value === 'mm'; saveOpt(); };
// ---------------- Funktionstest ----------------
const fmtB = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
let lastCheck = [];
async function selfTest() {
  const res = [];
  try { const e = await navigator.storage.estimate(); const pct = e.quota ? e.usage / e.quota : 0; res.push({ k: 'Speicher', lvl: pct > 0.9 ? 'fail' : pct > 0.7 ? 'warn' : 'ok', v: `${fmtB(e.usage || 0)} belegt` + (e.quota ? ` (${Math.round(pct * 100)} % von ${fmtB(e.quota)})` : '') }); }
  catch (e) { res.push({ k: 'Speicher', lvl: 'warn', v: 'keine Angabe' }); }
  try { const pr = await db.all('projects'); const sh = await db.all('shots'); res.push({ k: 'Datenbank', lvl: 'ok', v: `${pr.length} Projekte, ${sh.length} Fotos` }); }
  catch (e) { res.push({ k: 'Datenbank', lvl: 'fail', v: 'Fehler: ' + e.message }); }
  try { const devs = await navigator.mediaDevices.enumerateDevices(); const cams = devs.filter(d => d.kind === 'videoinput'); res.push({ k: 'Kamera', lvl: cams.length ? 'ok' : 'fail', v: cams.length ? `${cams.length} gefunden` : 'keine Kamera gefunden' }); }
  catch (e) { res.push({ k: 'Kamera', lvl: 'fail', v: 'nicht verfügbar' }); }
  res.push({ k: 'Bluetooth (Laser)', lvl: navigator.bluetooth ? 'ok' : 'warn', v: navigator.bluetooth ? (laser.state === 'verbunden' ? 'Laser verbunden' : 'verfügbar') : isIOS ? 'am iPhone nicht möglich (Apple) – Android nötig' : 'nicht verfügbar – Chrome auf Android nötig' });
  try { const reg = await navigator.serviceWorker.getRegistration(); const c = await caches.keys(); res.push({ k: 'Offline-Betrieb', lvl: reg && reg.active ? 'ok' : 'warn', v: reg && reg.active ? `bereit (${c.length} Caches)` : 'noch nicht eingerichtet' }); }
  catch (e) { res.push({ k: 'Offline-Betrieb', lvl: 'warn', v: 'nicht verfügbar' }); }
  res.push({ k: 'Internet', lvl: navigator.onLine ? 'ok' : 'warn', v: navigator.onLine ? 'online' : 'offline' });
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  res.push({ k: 'Als App installiert', lvl: standalone ? 'ok' : 'warn', v: standalone ? 'ja' : 'nein – im Browser-Menü „Zum Home-Bildschirm“ / „App installieren“' });
  res.push({ k: 'Dropbox', lvl: dropbox.connected ? 'ok' : 'warn', v: dropbox.connected ? 'verbunden' : 'nicht verbunden' });
  let errs = []; try { errs = JSON.parse(localStorage.getItem('mb_errs') || '[]'); } catch (e) { }
  const recent = errs.filter(x => Date.now() - new Date(x.t).getTime() < 7 * 864e5);
  res.push({ k: 'Fehlermeldungen', lvl: recent.length ? 'warn' : 'ok', v: recent.length ? `${recent.length} in den letzten 7 Tagen (im Fehlerbericht)` : 'keine in den letzten 7 Tagen' });
  lastCheck = res;
  $('#btnSettings .badge').classList.toggle('on', res.some(x => x.lvl === 'fail'));
  return res;
}
async function runSelfTest() {
  const el = $('#checkList'); el.innerHTML = '<p class="mute">Prüfe …</p>';
  const res = await selfTest();
  el.innerHTML = '';
  for (const x of res) { const d = document.createElement('div'); d.className = 'check'; d.innerHTML = '<span class="dot"></span><span class="k"></span><span class="v"></span>'; d.querySelector('.dot').classList.add(x.lvl); d.querySelector('.k').textContent = x.k; d.querySelector('.v').textContent = x.v; el.appendChild(d); }
}
$('#sCheck').onclick = runSelfTest;

// ---------------- Fehlerbericht ----------------
async function buildReport() {
  const res = lastCheck.length ? lastCheck : await selfTest();
  let errs = []; try { errs = JSON.parse(localStorage.getItem('mb_errs') || '[]'); } catch (e) { }
  const sw = await navigator.serviceWorker.getRegistration().catch(() => null);
  const lines = [
    `Maßblatt-App Fehlerbericht – ${new Date().toLocaleString('de-AT')}`,
    `Version: ${VERSION} · Service Worker: ${sw && sw.active ? 'aktiv' : 'keiner'}`,
    `Gerät: ${navigator.userAgent}`,
    `Bildschirm: ${screen.width}×${screen.height} @${devicePixelRatio} · Fenster ${innerWidth}×${innerHeight} · ${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'installiert (standalone)' : 'im Browser'} · ${matchMedia('(prefers-color-scheme: light)').matches ? 'hell' : 'dunkel'}`,
    `Sprache: ${navigator.language} · online: ${navigator.onLine} · Bluetooth-API: ${!!navigator.bluetooth} · Vibration: ${!!navigator.vibrate} · Teilen: ${!!navigator.share}`,
    `Einstellungen: ${JSON.stringify({ ...opt, ai: S.ai, cam: camOpt, zoom: await db.setting('zoom'), mmEinheit: opt.mm, dropbox: dropbox.connected, dbxOrdner: dropbox.cfg.folder || '', gcal: gcal.configured ? (gcal.connected ? 'verbunden' : 'eingerichtet') : 'aus', pin: unlocked() })}`,
    '', '== Funktionstest ==', ...res.map(x => `${x.lvl === 'ok' ? '✓' : x.lvl === 'warn' ? '!' : '✗'} ${x.k}: ${x.v}`),
    '', `== Gespeicherte Fehler (${errs.length}) ==`, ...errs.slice(-30).map(e => `${e.t} [${e.v}] ${e.kind}: ${e.msg}`),
    '', '== Bluetooth-Protokoll ==', ...(laser.log.length ? laser.log.slice(-80) : ['–']),
    '', '== App-Protokoll (diese Sitzung) ==', ...LOG.slice(-150),
  ];
  return lines.join('\n');
}
$('#sReport').onclick = async () => {
  const txt = await buildReport();
  const name = `Massblatt-Fehlerbericht_${todayISO()}.txt`;
  const file = new File([txt], name, { type: 'text/plain' });
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2>🛠 Fehlerbericht</h2><p class="mute">Schick ihn Claude im Chat – als Datei oder eingefügten Text.</p>
    <div style="display:flex;flex-direction:column;gap:8px"><button class="pri" data-share>Als Datei teilen</button><button class="ghost" data-copy>Text kopieren</button><button class="ghost" data-close>Schließen</button></div>
    <textarea readonly style="width:100%;height:160px;margin-top:10px;font:11px monospace;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px"></textarea></div>`;
  bg.querySelector('textarea').value = txt;
  const sb = bg.querySelector('[data-share]');
  if (navigator.canShare && navigator.canShare({ files: [file] })) sb.onclick = () => navigator.share({ files: [file], title: name }).catch(() => { });
  else sb.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  bg.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(txt); toast('Kopiert – im Chat einfügen'); } catch (e) { bg.querySelector('textarea').select(); toast('Bitte Text markieren und kopieren', 3000); } };
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
};

// ---------------- Google Kalender ----------------
function gcalUi() {
  $('#gcalId').value = gcal.cfg.clientId || '';
  $('#gcalState').textContent = !gcal.configured ? 'Nicht eingerichtet (Client-ID eintragen).' : gcal.connected ? 'Angemeldet ✓' : gcal.everConnected ? 'Anmeldung abgelaufen – beim nächsten Öffnen der Termine neu anmelden.' : 'Eingerichtet, noch nicht angemeldet.';
  $('#gcalOff').style.display = gcal.everConnected ? '' : 'none';
  $('#btnCal').style.display = gcal.configured ? '' : 'none';
  $('#gcalCals').style.display = gcal.everConnected ? '' : 'none';
  const ch = gcal.chosenCals; $('#gcalCalsState').textContent = ch ? `${ch.length} Kalender gewählt` : 'Alle in Google sichtbaren Kalender';
}
$('#gcalId').onchange = () => { gcal.setClientId($('#gcalId').value); gcalUi(); };
$('#gcalLogin').onclick = () => { try { gcal.login(); } catch (e) { toast(e.message, 3000); } };
$('#gcalOff').onclick = () => { gcal.logout(); const c = gcal.cfg; delete c.ever; localStorage.setItem('mb_gcal', JSON.stringify(c)); gcalUi(); toast('Von Google abgemeldet'); };
$('#calClose').onclick = () => { $('#calSheet').classList.remove('on'); todayBox(); };
$('#btnCal').onclick = async () => {
  if (!gcal.connected) {
    if (await confirmBox('Bei Google anmelden?', 'Anmelden', 'Abbrechen', 'pri', 'Du wirst kurz zu Google weitergeleitet und kommst automatisch zurück. Die App liest Termine nur, ändert nichts.')) { try { gcal.login(); } catch (e) { toast(e.message, 3000); } }
    return;
  }
  const body = $('#calBody'); body.innerHTML = '<p class="mute">Lade Termine …</p>'; $('#calSheet').classList.add('on');
  try {
    const evs = await gcal.events(7);
    body.innerHTML = '';
    if (!evs.length) { body.innerHTML = '<p class="mute">Keine Termine in den nächsten 7 Tagen.</p>'; return; }
    const todayK = todayISO();
    const todays = evs.filter(ev => (ev.allDay ? ev.start : todayISO(new Date(ev.start))) === todayK);
    if (todays.length >= 2) { const pb = document.createElement('button'); pb.className = 'pri'; pb.style.cssText = 'width:100%;margin:0 0 10px'; pb.textContent = `Tag vorbereiten: heutige Termine anlegen (${todays.length})`; pb.onclick = () => { $('#calSheet').classList.remove('on'); prepareDay(todays); }; body.appendChild(pb); }
    const stop = ((await db.setting('customers')) || []).flatMap(c => (c.name || '').split(/\s+/)).filter(Boolean); // Kundennamen sind keine Straßen
    for (const ev of evs) {
      const d = new Date(ev.start); const dk = ev.allDay ? ev.start : todayISO(d);
      const addr = parseAddress(ev.location, stop) || parseAddress(ev.summary, stop) || parseAddress(ev.description, stop);
      const row = document.createElement('div'); row.className = 'evrow';
      row.innerHTML = '<div class="d"><b></b><span></span></div><div class="t"><b></b><small></small><small></small></div><span>›</span>';
      row.querySelector('.d b').textContent = dk === todayK ? 'Heute' : d.toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit' });
      row.querySelector('.d span').textContent = ev.allDay ? 'ganztägig' : d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
      row.querySelector('.t b').textContent = ev.summary;
      const sm = row.querySelectorAll('.t small');
      sm[0].textContent = ev.location || '(kein Ort im Termin)';
      sm[1].textContent = addr ? `→ ${addr.str || '?'}${addr.plz ? ', ' + addr.plz + ' ' + addr.ort : ''}` : '→ keine Adresse erkannt (Projekt wird ohne Adresse angelegt)';
      row.onclick = () => createFromEvent(ev, addr);
      body.appendChild(row);
    }
  } catch (e) { body.innerHTML = ''; const pEl = document.createElement('p'); pEl.className = 'mute'; pEl.textContent = 'Termine konnten nicht geladen werden: ' + e.message; body.appendChild(pEl); gcalUi(); }
};
// Adresse eines Termins herauslesen (Ort-Feld, Titel, Beschreibung); Kundennamen sind keine Straßen
async function eventAddress(ev, stop = null) {
  if (!stop) stop = ((await db.setting('customers')) || []).flatMap(c => (c.name || '').split(/\s+/)).filter(Boolean);
  return parseAddress(ev.location, stop) || parseAddress(ev.summary, stop) || parseAddress(ev.description, stop);
}
// Projekt aus Termin anlegen (ohne es zu öffnen); Kunde: im Termin-Text erwähnt, sonst der zuletzt verwendete
async function projectFromEvent(ev, addr, all, cs) {
  const d = new Date(ev.start);
  const last = [...all].sort((a, b) => (b.updated || 0) - (a.updated || 0))[0] || {};
  const txt = (ev.summary + ' ' + ev.description + ' ' + ev.location).toLowerCase();
  const byName = cs.find(c => c.name && txt.includes(c.name.toLowerCase()));
  const cust = byName || (last.kundeId && cs.find(c => c.id === last.kundeId)) || null;
  const p = { id: uid(), name: '', str: addr ? addr.str : '', plz: addr ? addr.plz : '', ortName: addr ? addr.ort : '', kundeId: cust ? cust.id : null,
    datum: todayISO(isNaN(d) ? new Date() : d), created: Date.now(), updated: Date.now(), gcalId: ev.id, notizTermin: ev.summary };
  applyCustomerToProject(p, cust);
  if (addr && addr.str) p.name = [addr.str].filter(Boolean).join(', ');
  await db.put('projects', p);
  log('Projekt aus Termin', ev.summary);
  return p;
}
async function createFromEvent(ev, addr) {
  $('#calSheet').classList.remove('on');
  const all = await liveProjects();
  const dup = all.find(p => p.gcalId === ev.id);
  if (dup) { toast('Für diesen Termin gibt es schon ein Projekt – wird geöffnet'); return openProject(dup.id); }
  const p = await projectFromEvent(ev, addr, all, (await db.setting('customers')) || []);
  await openProject(p.id, true);
  if (addr && addr.str) { const el = $('#pStr'); el.value = addr.str + (addr.str.includes(',') ? '' : ', '); S.project.str = el.value; updateNamePrev(); db.put('projects', S.project); el.setSelectionRange(el.value.length, el.value.length); rememberStreetSoon(); }
  toast(addr ? 'Aus Termin übernommen – Geschoß/WG ergänzen' : 'Projekt angelegt – Adresse bitte eintragen', 3000);
}
// Tag vorbereiten (Idee 55): alle heutigen Termine mit Adresse auf einmal als Projekte anlegen
async function prepareDay(evs) {
  const all = await liveProjects(); const cs = (await db.setting('customers')) || [];
  const stop = cs.flatMap(c => (c.name || '').split(/\s+/)).filter(Boolean);
  const todo = [];
  for (const ev of evs) { if (all.some(p => p.gcalId === ev.id)) continue; todo.push([ev, await eventAddress(ev, stop)]); }
  const usable = a => a && a.str && /\d/.test(a.str); // nur Adressen mit Hausnummer automatisch anlegen
  const withAddr = todo.filter(x => usable(x[1])), without = todo.length - withAddr.length;
  if (!withAddr.length) { toast(todo.length ? `Keine Adresse in den ${todo.length} offenen Terminen erkannt – bitte einzeln antippen` : 'Alle heutigen Termine haben schon ein Projekt', 3500); return 0; }
  const ok = await confirmBox(`${withAddr.length} Projekt${withAddr.length > 1 ? 'e' : ''} anlegen?`, 'Anlegen', 'Abbrechen', 'pri',
    withAddr.map(([ev, a]) => `• ${a.str}${a.plz ? ', ' + a.plz + ' ' + a.ort : ''}`).join('\n') + (without ? `\n(${without} Termin${without > 1 ? 'e' : ''} ohne erkannte Adresse ${without > 1 ? 'bleiben' : 'bleibt'} offen – einzeln antippen)` : ''));
  if (!ok) return 0;
  for (const [ev, a] of withAddr) await projectFromEvent(ev, a, all, cs);
  log('Tag vorbereitet', withAddr.length);
  renderHome(); todayBox();
  toast(`${withAddr.length} Projekt${withAddr.length > 1 ? 'e' : ''} angelegt – Geschoß/WG beim Öffnen ergänzen`, 4000);
  return withAddr.length;
}
// Heutige Termine auf der Startseite (Idee 54): Zwischenspeicher, damit die Box sofort und auch offline da ist
let todayBusy = false;
async function todayBox(force = false) {
  const box = $('#todayBox'); if (!box) return;
  if (!gcal.configured || !gcal.everConnected) { box.style.display = 'none'; return; }
  const cache = (await db.setting('gcalCache')) || null;
  const fresh = cache && Date.now() - cache.t < 10 * 60000 && cache.day === todayISO();
  if (cache && cache.day === todayISO()) renderToday(cache.evs, cache.t);
  if (!gcal.connected) { if (!cache || cache.day !== todayISO()) renderToday(null, 0, 'Google-Anmeldung abgelaufen – antippen zum Anmelden'); return; }
  if ((fresh && !force) || todayBusy || !navigator.onLine) return;
  todayBusy = true;
  try {
    const evs = (await gcal.events(1)).map(e => ({ id: e.id, summary: e.summary, location: e.location, description: e.description, start: e.start, allDay: e.allDay, cal: e.cal }));
    await db.setting('gcalCache', { t: Date.now(), day: todayISO(), evs });
    renderToday(evs, Date.now());
  } catch (e) { log('Termine heute', e.message); if (!cache) renderToday(null, 0, 'Termine nicht ladbar: ' + e.message); }
  todayBusy = false;
}
let todaySeq = 0;
async function renderToday(evs, t, msg = '') {
  const my = ++todaySeq;
  const box = $('#todayBox'), list = box.querySelector('.tlist'); list.innerHTML = '';
  box.style.display = '';
  box.querySelector('b').textContent = msg ? '📅 Termine' : `📅 Heute: ${evs.length ? evs.length + ' Termin' + (evs.length > 1 ? 'e' : '') : 'keine Termine'}`;
  box.querySelector('small').textContent = msg || (t ? 'Stand ' + new Date(t).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) : '');
  box.querySelector('[data-prep]').style.display = 'none';
  if (msg) { box.onclick = () => { box.onclick = null; $('#btnCal').click(); }; return; }
  box.onclick = null;
  if (!evs.length) return;
  const all = await liveProjects();
  const stop = ((await db.setting('customers')) || []).flatMap(c => (c.name || '').split(/\s+/)).filter(Boolean);
  if (my !== todaySeq) return; // inzwischen neu gezeichnet
  const frag = document.createDocumentFragment();
  let open = 0;
  for (const ev of evs.slice(0, 6)) {
    const have = all.find(p => p.gcalId === ev.id);
    const addr = await eventAddress(ev, stop);
    const row = document.createElement('div'); row.className = 'trow';
    row.innerHTML = '<span class="tt"></span><span class="tx"><b></b><small></small></span><span class="st"></span>';
    row.querySelector('.tt').textContent = ev.allDay ? 'ganztags' : new Date(ev.start).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    row.querySelector('b').textContent = ev.summary;
    row.querySelector('small').textContent = have ? have.name || 'Projekt angelegt' : addr && addr.str ? `→ ${addr.str}` : (ev.location || 'keine Adresse erkannt');
    row.querySelector('.st').textContent = have ? '✓' : '＋';
    if (!have && addr && addr.str && /\d/.test(addr.str)) open++;
    row.onclick = () => have ? openProject(have.id) : createFromEvent(ev, addr);
    frag.appendChild(row);
  }
  if (evs.length > 6) { const more = document.createElement('div'); more.className = 'mute'; more.style.fontSize = '12px'; more.textContent = `… und ${evs.length - 6} weitere (📅 antippen)`; frag.appendChild(more); }
  if (my !== todaySeq) return;
  list.innerHTML = ''; list.appendChild(frag);
  const prep = box.querySelector('[data-prep]'); prep.style.display = open >= 2 ? '' : 'none'; prep.textContent = `Tag vorbereiten: ${open} Projekte anlegen`;
  prep.onclick = e => { e.stopPropagation(); prepareDay(evs); };
}
// Kalender auswählen (Idee 58)
$('#gcalCals').onclick = async () => {
  if (!gcal.connected) { toast('Bitte zuerst bei Google anmelden'); return; }
  let cals; try { cals = await gcal.calendars(); } catch (e) { toast('Kalender nicht ladbar: ' + e.message, 4000); return; }
  const chosen = gcal.chosenCals;
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2>Kalender für Termine</h2><p class="mute">Nur angehakte Kalender werden gelesen.</p><div data-list style="max-height:50vh;overflow:auto"></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="ghost" data-close style="flex:1">Abbrechen</button><button class="pri" data-ok style="flex:1">Übernehmen</button></div></div>`;
  const list = bg.querySelector('[data-list]');
  for (const c of cals) {
    const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:15px';
    l.innerHTML = '<input type="checkbox" style="width:auto"><i style="width:12px;height:12px;border-radius:50%;flex:none"></i><span style="flex:1"></span>';
    l.querySelector('input').checked = chosen ? chosen.includes(c.id) : c.selected; l.querySelector('input').value = c.id;
    l.querySelector('i').style.background = c.color || 'var(--line)'; l.querySelector('span').textContent = c.name + (c.primary ? ' (Hauptkalender)' : '');
    list.appendChild(l);
  }
  bg.querySelector('[data-ok]').onclick = async () => {
    const ids = [...list.querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) { toast('Mindestens einen Kalender anhaken'); return; }
    gcal.setChosenCals(ids.length === cals.length ? null : ids); bg.remove(); gcalUi();
    await db.setting('gcalCache', null); todayBox(true);
    toast(ids.length === cals.length ? 'Alle Kalender' : `${ids.length} Kalender gewählt`);
  };
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
};

// ---------------- Statistik ----------------
$('#sStats').onclick = async () => {
  const now = new Date(), ym = todayISO(now).slice(0, 7), y = String(now.getFullYear());
  const rows = new Map(); const tot = { m: 0, y: 0, g: 0 };
  for (const p of await liveProjects()) {
    if (!(await db.shotsOf(p.id)).length) continue; // nur Projekte mit Fotos zählen
    const d = (p.datum || todayISO(new Date(p.created || 0))).slice(0, 10), k = p.firma || 'ohne Kunde';
    if (!rows.has(k)) rows.set(k, { m: 0, y: 0, g: 0 });
    const r = rows.get(k);
    r.g++; tot.g++;
    if (d.startsWith(y)) { r.y++; tot.y++; }
    if (d.startsWith(ym)) { r.m++; tot.m++; }
  }
  const mon = now.toLocaleDateString('de-AT', { month: 'long' });
  let h = `<table class="stat"><tr><th>Wohnungen</th><th>${mon}</th><th>${y}</th><th>Gesamt</th></tr><tr><td><b>Alle</b></td><td><b>${tot.m}</b></td><td><b>${tot.y}</b></td><td><b>${tot.g}</b></td></tr></table>`;
  h += `<table class="stat"><tr><th>Pro Kunde</th><th>${mon}</th><th>${y}</th><th>Gesamt</th></tr>`;
  [...rows.entries()].sort((a, b) => b[1].g - a[1].g).forEach(([k, r]) => { h += `<tr><td></td><td>${r.m}</td><td>${r.y}</td><td>${r.g}</td></tr>`.replace('<td></td>', '<td>' + k.replace(/[<>&]/g, '') + '</td>'); });
  h += '</table><p class="mute">Gezählt werden Projekte mit mindestens einem Foto, nach Projektdatum. Nur auf diesem Handy.</p>';
  $('#statBody').innerHTML = h;
  $('#setSheet').classList.remove('on'); $('#statSheet').classList.add('on');
};
$('#statClose').onclick = () => $('#statSheet').classList.remove('on');
$('#sFooter').oninput = () => db.setting('pdfFooter', $('#sFooter').value);
$('#sOverview').onchange = () => db.setting('pdfOverview', $('#sOverview').value === '1');
$('#sRooms').oninput = () => {
  const list = $('#sRooms').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [k, ...t] = l.split('='); return [k.trim(), t.join('=').trim()]; }).filter(x => x[0]);
  db.setting('rooms', list);
};
$('#sRoomsReset').onclick = async () => { await db.setting('rooms', null); $('#sRooms').value = DEFAULT_ROOMS.map(([k, t]) => t ? `${k} = ${t}` : k).join('\n'); };
// Schriftgröße: nur Listen/Formulare vergrößern (nicht Foto-Bildschirm/Kamera, dort zählen Fingerpositionen)
function applyZoom(z) { document.documentElement.style.setProperty('--z', z); }
$('#sZoom').onchange = async () => { const z = parseFloat($('#sZoom').value); await db.setting('zoom', z); applyZoom(z); };
async function showStorage() {
  const fmt = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  let photos = 0, n = 0;
  for (const s of await db.all('shots')) { photos += s.photo ? s.photo.size : 0; n++; }
  let txt = `Fotos: ${n} Stück, ${fmt(photos)}`;
  try { const e = await navigator.storage.estimate(); txt += ` · App gesamt: ${fmt(e.usage || 0)}` + (e.quota ? ` von ca. ${fmt(e.quota)} verfügbar` : ''); } catch (e) { }
  $('#sStorage').textContent = txt;
}
$('#setClose').onclick = () => $('#setSheet').classList.remove('on');
$('#sTitle').oninput = () => db.setting('headerTitle', $('#sTitle').value);
$('#sLogo').onchange = async e => { let f = e.target.files[0]; if (!f) return; f = await cutoutLogo(f); await db.setting('headerLogo', f); $('#sLogoPrev').src = blobUrl(f); $('#sLogoPrev').hidden = false; };
$('#sLogoDel').onclick = async () => { await db.setting('headerLogo', null); $('#sLogoPrev').hidden = true; };
$('#sAi').onchange = async () => { S.ai = $('#sAi').value === '1'; await db.setting('ai', S.ai); };
$('#sAiLoad').onclick = async () => {
  const b = $('#sAiLoad'); b.disabled = true;
  try {
    await loadModel((f, l, t) => { $('#sAiState').textContent = `Lade … ${Math.round(l / 1048576)} / ${Math.round(t / 1048576)} MB`; });
    $('#sAiState').textContent = 'KI-Modell: bereit (offline verfügbar)';
  } catch (e) { $('#sAiState').textContent = 'Fehler: ' + e.message; }
  b.disabled = false;
};
// Export/Import: Kunden (mit Logo) + gemerkte Straßen als JSON-Datei
$('#exBtn').onclick = async () => {
  const cs = (await db.setting('customers')) || [];
  const data = { app: 'massblatt', version: 1, exported: new Date().toISOString(),
    headerTitle: (await db.setting('headerTitle')) || '',
    customers: await Promise.all(cs.map(async c => ({ ...c, logo: c.logo ? await blobToB64(c.logo) : null }))),
    streets: (await db.setting('streets')) || [] };
  const hl = await db.setting('headerLogo'); if (hl) data.headerLogo = await blobToB64(hl);
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const file = new File([JSON.stringify(data)], `massblatt-daten_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  toast(`Exportiert: ${data.customers.length} Kunden, ${data.streets.length} Straßen`);
};
$('#imBtn').onclick = () => $('#imFile').click();
$('#imFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'massblatt') throw new Error('keine Maßblatt-Datei');
    const cs = (await db.setting('customers')) || [];
    let nC = 0, nS = 0;
    for (const c of data.customers || []) {
      const obj = { ...c, id: c.id || uid(), logo: c.logo ? await b64ToBlob(c.logo) : null };
      const i = cs.findIndex(x => x.name.toLowerCase() === obj.name.toLowerCase());
      if (i >= 0) cs[i] = { ...obj, id: cs[i].id }; else { cs.push(obj); } nC++;
    }
    await db.setting('customers', cs);
    const st = (await db.setting('streets')) || [];
    for (const x of data.streets || []) {
      if (!st.some(y => normStreet(y.street) === normStreet(x.street) && y.ort === x.ort)) { st.push(x); nS++; }
    }
    await db.setting('streets', st);
    if (data.headerLogo && !(await db.setting('headerLogo'))) await db.setting('headerLogo', await b64ToBlob(data.headerLogo));
    if (data.headerTitle && !(await db.setting('headerTitle'))) await db.setting('headerTitle', data.headerTitle);
    renderCustManage();
    toast(`Importiert: ${nC} Kunden, ${nS} neue Straßen`, 3000);
  } catch (err) { toast('Import fehlgeschlagen: ' + err.message, 4000); }
};
$('#sLaserOff').onclick = () => { laser.disconnect(); laserUi(); };
// PIN ändern: neue Prüfsumme erzeugen → Text für pin.json (gilt dann auf allen Geräten)
$('#sPin').onclick = () => {
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2>PIN ändern (alle Geräte)</h2>
    <p class="mute">Die PIN gilt auf allen Handys. Neue PIN eingeben → den erzeugten Text in die Datei <b>pin.json</b> im GitHub-Repo kopieren (Inhalt komplett ersetzen, „Commit changes“). Ab dann verlangt jedes Gerät beim nächsten Start mit Netz die neue PIN. Alternativ: die neue PIN Claude im Chat schreiben.</p>
    <label class="f">Neue PIN (4–12 Ziffern)</label><input id="pinNew" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="off">
    <label class="f">Nochmal</label><input id="pinNew2" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="off">
    <label style="display:flex;gap:10px;align-items:center;margin:10px 0 4px"><input type="checkbox" id="pinLock" style="width:auto"> App sofort für alle sperren (gesperrt = true)</label>
    <button class="pri" style="width:100%;margin-top:8px" data-make>Text erzeugen</button>
    <textarea id="pinOut" readonly style="display:none;width:100%;height:120px;margin-top:10px;font:12px monospace;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px"></textarea>
    <div id="pinActs" style="display:none;flex-direction:column;gap:8px;margin-top:8px"><button class="ghost" data-copy>Text kopieren</button><a href="https://github.com/Heuzontner/massblatt-app/edit/main/pin.json" target="_blank" rel="noopener"><button class="ghost" style="width:100%">pin.json auf GitHub bearbeiten</button></a></div>
    <button class="ghost" style="width:100%;margin-top:10px" data-close>Schließen</button></div>`;
  bg.querySelector('[data-make]').onclick = async () => {
    const a = bg.querySelector('#pinNew').value.trim(), b = bg.querySelector('#pinNew2').value.trim();
    if (!/^\d{4,12}$/.test(a)) return toast('PIN: 4 bis 12 Ziffern');
    if (a !== b) return toast('Die beiden Eingaben sind verschieden');
    const salt = [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('');
    const cfg = { salt, iter: 200000, hash: await pinHash(a, { salt, iter: 200000 }), gesperrt: bg.querySelector('#pinLock').checked, hinweis: '' };
    const out = bg.querySelector('#pinOut'); out.value = JSON.stringify(cfg, null, 2); out.style.display = 'block'; bg.querySelector('#pinActs').style.display = 'flex';
    toast('Text erzeugt – kopieren und in pin.json einfügen', 3000);
  };
  bg.querySelector('[data-copy]').onclick = async () => { const t = bg.querySelector('#pinOut').value; try { await navigator.clipboard.writeText(t); toast('Kopiert'); } catch (e) { bg.querySelector('#pinOut').select(); toast('Bitte Text markieren und kopieren', 3000); } };
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
};
$$('[data-back]').forEach(b => b.onclick = () => { renderHome(); show(b.dataset.back); });

// ---------------- PIN-Sperre ----------------
// Einfache Sperre gegen fremde Nutzung (kein echter Schutz: der Code ist öffentlich).
// Die gültige PIN steht als Prüfsumme in pin.json im Repo und gilt damit auf allen Geräten: wird sie dort geändert
// (oder „gesperrt“ gesetzt), verlangt jedes Handy beim nächsten Start mit Netz die neue PIN. Ohne Netz gilt der letzte Stand.
let pinCfg = { ...PIN, gesperrt: false };
try { const c = JSON.parse(localStorage.getItem('mb_pincfg') || 'null'); if (c && c.hash) pinCfg = c; } catch (e) { }
async function fetchPinCfg() {
  const r = await fetch('pin.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('pin.json ' + r.status);
  const c = await r.json(); if (!c || !/^[0-9a-f]{64}$/.test(c.hash || '')) throw new Error('pin.json ungültig');
  return { salt: c.salt || PIN.salt, iter: c.iter || PIN.iter, hash: c.hash, gesperrt: !!c.gesperrt, hinweis: c.hinweis || '' };
}
async function pinHash(pin, cfg = pinCfg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(cfg.salt), iterations: cfg.iter, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const pinId = cfg => (cfg.hash || '').slice(0, 12);
// Sperrdauer (Idee 94): nach so vielen Tagen wird die PIN wieder verlangt
const lockDays = () => { let v = 30; try { v = parseInt(localStorage.getItem('mb_lockDays') || '30', 10); } catch (e) { } return [1, 7, 30].includes(v) ? v : 30; };
function markUnlocked() { try { localStorage.setItem('mb_unlock', JSON.stringify({ at: Date.now(), until: Date.now() + lockDays() * 864e5, h: pinId(pinCfg) })); } catch (e) { } }
function unlocked() {
  try {
    const raw = localStorage.getItem('mb_unlock'); if (!raw) return false;
    const u = raw.startsWith('{') ? JSON.parse(raw) : { until: Number(raw), h: pinId(PIN) }; // alter Stand: nur Ablaufzeit (= eingebaute PIN)
    const until = u.at ? u.at + lockDays() * 864e5 : u.until;
    return until > Date.now() && u.h === pinId(pinCfg) && !pinCfg.gesperrt;
  } catch (e) { return false; }
}
// Fingerabdruck/Face-ID (Idee 93): Handy-eigene Entsperrung über WebAuthn, nur auf diesem Gerät; nach PIN-Änderung einmal PIN nötig
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const bio = {
  get cred() { try { return JSON.parse(localStorage.getItem('mb_bio') || 'null'); } catch (e) { return null; } },
  get usable() { const c = this.cred; return !!(c && c.h === pinId(pinCfg) && window.PublicKeyCredential); },
  async available() { try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } },
  async register() {
    const c = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Maßblatt', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'massblatt', displayName: 'Maßblatt' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000, attestation: 'none' } });
    localStorage.setItem('mb_bio', JSON.stringify({ id: b64u(c.rawId), h: pinId(pinCfg), at: Date.now() }));
  },
  async verify() {
    const c = this.cred; if (!c) return false;
    const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ id: unb64u(c.id), type: 'public-key', transports: ['internal'] }], userVerification: 'required', rpId: location.hostname, timeout: 60000 } });
    return !!a;
  },
  remove() { try { localStorage.removeItem('mb_bio'); } catch (e) { } },
};
function applyPinCfg(c) {
  const changed = c.hash !== pinCfg.hash || !!c.gesperrt !== !!pinCfg.gesperrt;
  pinCfg = c; try { localStorage.setItem('mb_pincfg', JSON.stringify(c)); } catch (e) { }
  if (changed && !unlocked() && $('#lock').style.display === 'none') { log('PIN geändert/gesperrt → neu sperren'); askPin(); }
}
async function pinStart() {
  // pin.json holen, aber höchstens kurz warten (sonst startet die App ohne Netz nie)
  const net = fetchPinCfg().then(applyPinCfg).catch(e => log('pin.json nicht erreichbar', e.message));
  await Promise.race([net, new Promise(r => setTimeout(r, 2500))]);
  if (!unlocked()) await askPin(); else $('#lock').style.display = 'none';
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fetchPinCfg().then(applyPinCfg).catch(() => { }); });
}
function askPin() {
  return new Promise(res => {
    const lock = $('#lock'), pad = $('#lockPad'); let buf = ''; let tries = 0;
    lock.style.display = 'flex';
    if (pinCfg.gesperrt) { // zentral gesperrt: keine PIN möglich, regelmäßig nachsehen, ob die Sperre aufgehoben wurde
      $('#lockMsg').textContent = 'App gesperrt' + (pinCfg.hinweis ? ' – ' + pinCfg.hinweis : ''); pad.innerHTML = ''; $('#lockDots').textContent = '';
      const iv = setInterval(async () => { try { const c = await fetchPinCfg(); if (!c.gesperrt) { clearInterval(iv); applyPinCfg(c); lock.style.display = 'none'; askPin().then(res); } } catch (e) { } }, 30000);
      return;
    }
    $('#lockMsg').textContent = 'PIN eingeben';
    const dots = () => { $('#lockDots').textContent = '•'.repeat(buf.length); };
    pad.innerHTML = '';
    // Fingerabdruck/Face-ID: Knopf über dem Ziffernblock, einmal automatisch versuchen
    const bb = $('#lockBio'); bb.style.display = bio.usable ? '' : 'none';
    const tryBio = async () => { try { if (await bio.verify()) { markUnlocked(); lock.style.display = 'none'; res(); return true; } } catch (e) { log('Biometrie', e.name, e.message); } return false; };
    bb.onclick = tryBio;
    if (bio.usable) setTimeout(() => { if (lock.style.display !== 'none') tryBio(); }, 400);
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'OK', '0', '⌫'].forEach(k => {
      const b = document.createElement('button'); b.textContent = k; if (k === 'OK') b.className = 'pri';
      b.onclick = async () => {
        if (k === '⌫') buf = buf.slice(0, -1);
        else if (k === 'OK') {
          if (!buf) return;
          $('#lockMsg').textContent = 'Prüfe …';
          const ok = (await pinHash(buf)) === pinCfg.hash;
          buf = '';
          if (ok) { markUnlocked(); lock.style.display = 'none'; res(); return; }
          tries++; beep(false);
          $('#lockMsg').textContent = 'Falsche PIN' + (tries >= 3 ? ' – bitte warten' : '');
          if (tries >= 3) { pad.style.pointerEvents = 'none'; setTimeout(() => { pad.style.pointerEvents = ''; $('#lockMsg').textContent = 'PIN eingeben'; }, 5000 * (tries - 2)); }
        } else if (buf.length < 12) buf += k;
        dots();
      };
      pad.appendChild(b);
    });
    dots();
  });
}

function infoBox(title, lines, btn = 'OK') {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg on';
    bg.innerHTML = `<div class="sheet"><h2></h2><ul class="news"></ul><button class="pri" style="width:100%;margin-top:12px" data-close></button></div>`;
    bg.querySelector('h2').textContent = title;
    const ul = bg.querySelector('ul'); for (const l of lines) { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); }
    const b = bg.querySelector('[data-close]'); b.textContent = btn; b.onclick = () => { bg.remove(); res(true); };
    document.body.appendChild(bg);
  });
}
function whatsNew() {
  let seen = null, installed = false;
  try { seen = localStorage.getItem('mb_seenV'); installed = !!localStorage.getItem('mb_unlock'); localStorage.setItem('mb_seenV', VERSION); } catch (e) { return; }
  if (seen === VERSION) return;
  if (!seen && !installed) return; // Erstinstallation: nichts anzeigen
  setTimeout(() => infoBox('Neu in Version ' + VERSION, NEWS, 'Alles klar'), 900);
}

// ---------------- Start ----------------
(async () => {
  await pinStart();
  const ai = await db.setting('ai'); S.ai = ai === true; // KI vorerst aus, bis das Modell zuverlässig läuft
  applyZoom((await db.setting('zoom')) || 1);
  setTimeout(processQueue, 3000);
  const back = gcal.handleRedirect();
  if (back === true) { toast('Bei Google angemeldet ✓'); setTimeout(() => $('#btnCal').click(), 400); }
  else if (back === 'error') toast('Google-Anmeldung abgebrochen', 3000);
  gcalUi();
  setTimeout(async () => { const res = await selfTest(); const bad = res.filter(x => x.lvl === 'fail'); if (bad.length) toast('Funktionstest: ' + bad.map(x => x.k).join(', ') + ' – Details in ⚙ System', 5000); }, 2500);
  laserUi();
  await purgeTrash();
  renderHome();
  offlineUi();
  whatsNew();
  backupBar();
  todayBox();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => { });
    // neue Version übernommen → einmal neu laden
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  window.__mb = { S, laser, view, nav, onMeasure, magnet, labelBoxes, grayOf: () => grayOf(), applyTemplate, setArrows, arrowsFromObjects, hdrTest: async () => { caps.exposureCompensation = { min: -2, max: 2 }; const t0 = performance.now(); const c = await captureHdr(); return [c.width, c.height, Math.round(performance.now() - t0), c.toDataURL('image/jpeg', 0.7)]; } }; // für Tests
})();
