import { db, uid } from './db.js';
import { Laser } from './ble.js';
import { TEMPLATES, arrowsFromObjects, newArrow, drawArrows } from './arrows.js';
import { buildPdf } from './pdf.js';
import { detect, loadModel, modelState } from './detect.js';
import { PIN } from './pin.js';
import { dropbox } from './dropbox.js';

const VERSION = '2.2.3';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DEFAULT_ROOMS = [['Kz', 'Kinderz.'], ['Sz', 'Schlafz.'], ['Wz', 'Wohnz.'], ['Wk', 'Wohnküche'], ['Kü', 'Küche'], ['Bad', ''], ['WC', ''], ['Vr', 'Vorraum'],
  ['Ar', 'Abstellr.'], ['Lo', 'Loggia'], ['Eg', 'Eingang'], ['Rh', 'Raumhöhe']];

const S = { project: null, shots: [], room: null, shot: null, active: null, stream: null, ai: true, wake: null };
const laser = new Laser();

// ---------------- Hilfen ----------------
function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
function show(id) { $$('.screen').forEach(s => s.classList.toggle('on', s.id === id)); if (id !== 'cam') stopCam(); }
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
const blobToImg = b => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(b); });
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
  if (e.detail.state === 'verbunden') toast('Laser verbunden ✓');
  if (e.detail.state === 'getrennt') toast('Laser getrennt – verbinde neu …');
});
laser.addEventListener('measure', e => onMeasure(e.detail.cm));
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
let homeSort = 'neu';
try { homeSort = localStorage.getItem('mb_sort') || 'neu'; } catch (e) { }
$('#projSearch').addEventListener('input', () => renderHome());
$$('#sortChips button').forEach(b => b.onclick = () => { homeSort = b.dataset.sort; try { localStorage.setItem('mb_sort', homeSort); } catch (e) { } renderHome(); });
async function renderHome() {
  $$('#sortChips button').forEach(b => b.classList.toggle('sel', b.dataset.sort === homeSort));
  let list = await db.all('projects');
  const q = normStreet($('#projSearch').value);
  if (q) list = list.filter(p => normStreet([p.name, p.firma, p.str].join(' ')).includes(q));
  const dateOf = p => p.datum || new Date(p.created || 0).toISOString().slice(0, 10);
  const cmp = { neu: (a, b) => (b.updated || 0) - (a.updated || 0), datum: (a, b) => dateOf(b).localeCompare(dateOf(a)),
    strasse: (a, b) => (a.name || '').localeCompare(b.name || '', 'de', { numeric: true }), kunde: (a, b) => (a.firma || '').localeCompare(b.firma || '', 'de') || (a.name || '').localeCompare(b.name || '', 'de', { numeric: true }) };
  list.sort(cmp[homeSort] || cmp.neu);
  const el = $('#projList');
  if (!list.length) { el.innerHTML = q ? '<div class="empty">Nichts gefunden.</div>' : '<div class="empty">Noch kein Projekt.<br>Unten auf „+ Neues Projekt“ tippen.</div>'; return; }
  el.innerHTML = '';
  for (const p of list) {
    const n = (await db.shotsOf(p.id)).length;
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<div class="t"><b></b><small></small></div><span>›</span>`;
    c.querySelector('b').textContent = p.name || 'Ohne Namen';
    c.querySelector('small').textContent = `${p.firma || ''} · ${n} Foto${n === 1 ? '' : 's'} · ${new Date(p.datum || p.created).toLocaleDateString('de-AT')}`;
    c.onclick = () => openProject(p.id);
    el.appendChild(c);
  }
}

$('#btnNewProj').onclick = async () => {
  const all = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const last = all[0] || {};
  const p = { id: uid(), name: '', kundeId: last.kundeId || null, firma: last.firma || '', kontakt: '', strasse: '', ort: last.ort || '', land: last.land || '',
    telefon: '', datum: new Date().toISOString().slice(0, 10), kundenLogo: last.kundenLogo || null, created: Date.now(), updated: Date.now() };
  // zuletzt verwendeter Kunde mit allen Daten
  const lastC = last.kundeId && ((await db.setting('customers')) || []).find(x => x.id === last.kundeId);
  if (lastC) applyCustomerToProject(p, lastC); else p.kundeId = null;
  await db.put('projects', p);
  await openProject(p.id, true);
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
  $('#projDetails').open = isNew || !p.name;
  $('#projTitle').textContent = p.name || 'Neues Projekt';
  renderShots();
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
let remT = 0;
function rememberStreetSoon() {
  clearTimeout(remT);
  remT = setTimeout(async () => {
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
  const local = (await knownStreets()).filter(x => normStreet(x.street).includes(k)).sort((a, b) => (b.used || 0) - (a.used || 0)).slice(0, 5);
  autoOrt(local, k);
  showSug(local.map(x => ({ ...x, src: 'bekannt' })), []);
  clearTimeout(sugT);
  if (!navigator.onLine || local.length >= 3) return;
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
      if (my === sugReq && $('#pStr') === document.activeElement) showSug(local.map(x => ({ ...x, src: 'bekannt' })), web.slice(0, 5));
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
function showSug(local, web) {
  const box = $('#strSug'); box.innerHTML = '';
  const all = [...local, ...web];
  if (!all.length) { box.classList.remove('on'); return; }
  for (const x of all) {
    const b = document.createElement('button');
    b.innerHTML = '<span class="src"></span><b></b><small></small>';
    b.querySelector('b').textContent = x.street; b.querySelector('small').textContent = x.ort;
    b.querySelector('.src').textContent = x.src === 'bekannt' ? 'schon gehabt' : 'Karte';
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
$('#pStr').addEventListener('blur', () => setTimeout(() => $('#strSug').classList.remove('on'), 400));

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
  if (c.logo) { const i = document.createElement('img'); i.src = URL.createObjectURL(c.logo); b.appendChild(i); }
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
  renderCustChips();
}
function editCustomer(c) {
  return new Promise(res => {
    const sh = $('#custSheet'); let logo = c ? c.logo : null;
    $('#custTitle').textContent = c ? 'Kunde bearbeiten' : 'Neuer Kunde';
    CF.forEach(([, ck, , cid]) => { $('#' + cid).value = c ? (c[ck] || '') : ''; });
    const prev = () => { if (logo) { $('#cLogoPrev').src = URL.createObjectURL(logo); $('#cLogoPrev').hidden = false; } else $('#cLogoPrev').hidden = true; };
    prev(); $('#cLogo').value = '';
    $('#cDel').style.display = c ? '' : 'none';
    $('#cLogo').onchange = e => { const f = e.target.files[0]; if (f) { logo = f; prev(); } };
    const close = v => { sh.classList.remove('on'); res(v); };
    $('#cCancel').onclick = () => close(null);
    $('#cSave').onclick = async () => {
      const name = $('#cName').value.trim(); if (!name) { toast('Bitte einen Namen eingeben'); return; }
      const list = (await db.setting('customers')) || [];
      const obj = { id: c ? c.id : uid(), logo };
      CF.forEach(([, ck, , cid]) => { obj[ck] = $('#' + cid).value.trim(); });
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
    sh.classList.add('on');
    if (!c) setTimeout(() => $('#cName').focus(), 200);
  });
}
async function renderCustManage() {
  const el = $('#custManage'); el.innerHTML = '';
  for (const c of await customers()) {
    const b = custButton(c, false);
    b.onclick = async () => { await editCustomer(c); renderCustManage(); };
    el.appendChild(b);
  }
  const add = document.createElement('button'); add.textContent = '+ Neuer Kunde';
  add.onclick = async () => { await editCustomer(null); renderCustManage(); };
  el.appendChild(add);
}
$('#btnDelProj').onclick = async () => {
  if (!await confirmBox(`Projekt „${S.project.name || 'Ohne Namen'}“ mit allen Fotos löschen?`)) return;
  for (const s of S.shots) await db.del('shots', s.id);
  await db.del('projects', S.project.id);
  renderHome(); show('home');
};

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
function confirmBox(msg, yesLabel = 'Löschen', noLabel = 'Abbrechen', yesClass = 'danger', detail = '') {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg on';
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
  const el = $('#shotList'); el.innerHTML = '';
  if (!S.shots.length) { el.innerHTML = '<div class="empty">Noch keine Fotos.<br>Unten auf „📷 Foto“ tippen: Raum wählen, fotografieren, messen.</div>'; return; }
  S.shots.forEach((s, i) => {
    const wrap = document.createElement('div'); wrap.className = 'swipe';
    const c = document.createElement('div'); c.className = 'card shot'; wrap.appendChild(c);
    const vals = s.arrows.filter(a => a.cm != null).map(a => `${a.cm}`).join(' · ');
    const open = s.arrows.filter(a => a.cm == null).length;
    c.innerHTML = `<img><div class="t"><div class="room"></div><div class="vals"></div>${open ? `<div class="warn">${open} Pfeil${open > 1 ? 'e' : ''} ohne Maß</div>` : ''}</div><button class="del" aria-label="Foto löschen">🗑</button>`;
    c.querySelector('img').src = URL.createObjectURL(s.photo);
    c.querySelector('.room').textContent = `${i + 1}. ${s.room}`;
    c.querySelector('.vals').textContent = vals ? vals + ' cm' : '–';
    c.onclick = () => openEditor(s);
    c.querySelector('.del').onclick = e => { e.stopPropagation(); deleteShot(s); };
    swipeToDelete(c, () => deleteShot(s));
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
async function resolveRoom(r) {
  if (!r || r === 'Rh' || r === 'Eg') return r;
  const base = r.replace(/\d+$/, '');
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d*)$');
  const same = S.shots.filter(s => re.test(s.room));
  if (!same.length) return r;
  const last = same[same.length - 1].room;
  const yes = await confirmBox(`Handelt es sich um denselben Raum „${last}“?`, 'Ja, derselbe', 'Nein, neuer Raum', 'pri');
  if (yes) return last;
  const nums = same.map(s => parseInt(s.room.match(re)[1] || '1', 10));
  return base + (Math.max(...nums) + 1);
}
$('#btnShoot').onclick = async () => {
  askMotion();
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
async function openCam() {
  setCamRoom(S.room);
  show('cam');
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 3000 }, height: { ideal: 4000 } }, audio: false });
    $('#video').srcObject = S.stream;
    await $('#video').play().catch(() => { });
    camCaps();
  } catch (e) {
    toast('Kamera nicht verfügbar – System-Kamera wird geöffnet', 3000);
    $('#fileIn').click();
  }
}
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
$('#camBack').onclick = () => { renderShots(); show('proj'); };
$('#camGallery').onclick = () => $('#galIn').click();
$('#fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) newShotFromBlob(f); else show('proj'); };
$('#galIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) newShotFromBlob(f); };
let shooting = false;
$('#shutter').onclick = async () => {
  const v = $('#video');
  if (!v.videoWidth || shooting) return;
  shooting = true;
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
let photoImg = null, blinkT = 0, raf = 0;

async function openEditor(shot, fresh = false) {
  S.shot = shot;
  if (kb.on) setKb(false);
  $('#edTitle').textContent = shot.room;
  photoImg = await blobToImg(shot.photo);
  $('#lightA').classList.toggle('on', !!shot.orig);
  show('ed');
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
  const draw = (t) => {
    if (!$('#ed').classList.contains('on')) return;
    blinkT = (Math.sin(t / 180) + 1) / 2;
    ctx.drawImage(photoImg, 0, 0, cv.width, cv.height);
    drawArrows(ctx, cv.width, cv.height, S.shot.arrows, S.active, blinkT);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}

function buildChips() {
  const el = $('#tplTiles'); el.innerHTML = '';
  const items = ['KI erkennen', ...Object.keys(TEMPLATES)];
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
  if (act === 'room') { closeArr(); const r = await pickRoom(); if (r) { S.shot.room = r; S.room = r; $('#edTitle').textContent = r; } }
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
  arrs.forEach((a, i) => { if (old[i]) { a.cm = old[i].cm; a.time = old[i].time; } });
  S.shot.arrows = arrs; S.shot.tpl = tpl;
  S.active = firstOpen();
  saveShot(); buildChips(); updateCur();
}
function applyTemplate(k) { setArrows(TEMPLATES[k](), k); }

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
  v.textContent = a ? (kb.on ? (kb.buf || '…') + ' cm' : a.cm != null ? a.cm + ' cm' : laser.state === 'verbunden' ? 'Jetzt am Laser messen' : 'Laser verbinden oder ⌨') : '–';
}
async function saveShot() { await db.put('shots', S.shot); }

function setValue(cm) {
  let a = activeArrow();
  if (!a || a.cm != null) { const o = S.shot.arrows.find(x => x.cm == null); if (o) a = o; }
  if (!a) { // kein Pfeil offen → neuen anlegen
    if (!S.shot.arrows.length) { a = newArrow(); S.shot.arrows.push(a); } else { a = activeArrow() || S.shot.arrows[S.shot.arrows.length - 1]; }
  }
  a.cm = cm; a.time = new Date().toISOString();
  saveShot();
  beep(true);
  const next = S.shot.arrows.find(x => x.cm == null);
  if (opt.big) showBig(cm, a);
  if (opt.voice) say(`${cm}` + (next ? `. Nächster: ${arrowName(next)}` : '. Fertig'));
  if (next) { S.active = next.id; updateCur(); }
  else { S.active = a.id; updateCur(); finishShot(true); }
}
const arrowName = a => `${a.el === 'Maß' ? '' : a.el + ' '}${a.kind === 'H' ? 'Höhe' : 'Breite'}`;
// Test-Optionen: großer Messmodus, Sprachansage
const opt = { big: false, voice: false };
try { Object.assign(opt, JSON.parse(localStorage.getItem('mb_opt') || '{}')); } catch (e) { }
const saveOpt = () => { try { localStorage.setItem('mb_opt', JSON.stringify(opt)); } catch (e) { } document.body.classList.toggle('bigmode', !!opt.big); };
document.body.classList.toggle('bigmode', !!opt.big);
function showBig(cm, a) {
  const el = $('#bigVal'); el.innerHTML = `${cm} cm<small></small>`; el.querySelector('small').textContent = arrowName(a);
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

function onMeasure(cm) {
  if ($('#ed').classList.contains('on') && S.shot) { setValue(cm); return; }
  toast(`${cm} cm gemessen – erst ein Foto machen`, 2000); beep(false);
}

// Plausibilität: grobe Grenzen in cm (Türen wie im Maßblatt-Leser: H 180–245, B 50–145)
function checkArrow(a, room) {
  if (a.cm == null) return null;
  const v = a.cm, H = a.kind === 'H';
  if (a.el === 'Raumhöhe' || room === 'Rh') return v < 200 || v > 400 ? `Raumhöhe ${v} cm (üblich 200–400)` : null;
  if (a.el === 'Tür') {
    if (H && (v < 180 || v > 250)) return `Tür-Höhe ${v} cm (üblich 180–250)`;
    if (!H && (v < 50 || v > 150)) return `Tür-Breite ${v} cm (üblich 50–150)`;
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
  const door = shot.arrows.filter(a => a.el === 'Tür' && a.cm != null);
  const dh = door.find(a => a.kind === 'H'), dw = door.find(a => a.kind === 'B');
  if (dh && dw && dw.cm >= dh.cm) out.push({ a: dw, m: `Tür breiter (${dw.cm}) als hoch (${dh.cm}) – Höhe/Breite vertauscht?` });
  const open = shot.arrows.filter(a => a.cm == null);
  if (open.length) out.push({ a: open[0], m: `${open.length} Pfeil${open.length > 1 ? 'e' : ''} ohne Maß` });
  return out;
}
let finishing = 0;
async function finishShot(auto) {
  clearTimeout(finishing);
  const iss = shotIssues(S.shot);
  if (iss.length) {
    beep(false);
    const go2 = await confirmBox('Bitte prüfen', 'Trotzdem weiter', 'Korrigieren', 'ghost', iss.map(x => '• ' + x.m).join('\n'));
    if (!go2) { S.active = iss[0].a.id; updateCur(); return; }
    auto = false;
  }
  const go = async () => {
    await saveShot();
    if (S.wake) { S.wake.release().catch(() => { }); S.wake = null; }
    openCam();
  };
  if (auto) { toast(`${S.shot.room}: alle Maße da ✓ – nächstes Foto`, 1300); finishing = setTimeout(go, 1300); }
  else go();
}

$('#edDone').onclick = () => finishShot(false);
// zurück zum Projekt: sofort wechseln, Speichern läuft im Hintergrund
$('#edBack').onclick = () => {
  clearTimeout(finishing); if (kb.on) setKb(false);
  show('proj'); renderShots();
  saveShot().then(renderShots).catch(e => toast('Speichern fehlgeschlagen: ' + e.message, 4000));
};
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
      else if (k === 'OK') { const v = parseInt(kb.buf, 10); kb.buf = ''; if (v > 0) setValue(v); }
      else if (kb.buf.length < 4) kb.buf += k;
      updateCur();
    };
    el.appendChild(b);
  });
})();
function setKb(on) { kb.on = on; kb.buf = ''; $('#keypad').classList.toggle('on', on); $('#kbBtn').classList.toggle('on', on); updateCur(); }
$('#kbBtn').onclick = () => setKb(!kb.on);
// Aufhellen: automatische Tonwertkorrektur + Aufhellung dunkler Bereiche; Original bleibt für „zurück“ erhalten
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
  photoImg = await blobToImg(shot.photo);
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

// Pfeile ziehen: Endpunkt (Kreis) oder ganzer Pfeil; Tippen = aktiv
let drag = null;
cv.addEventListener('pointerdown', e => {
  e.preventDefault();
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
  if (!best) {
    for (const a of S.shot.arrows) {
      const d = segDist(x * rw, y * rh, a.x1 * rw, a.y1 * rh, a.x2 * rw, a.y2 * rh);
      if (d < 34 && d < bd) { bd = d; best = { a, k: 'all' }; }
    }
  }
  clearTimeout(finishing);
  if (!best) {
    // freie Stelle: neuen Pfeil mit dem Finger aufziehen
    const a = newArrow(); a.x1 = a.x2 = x; a.y1 = a.y2 = y;
    S.shot.arrows.push(a);
    best = { a, k: 'p2', isNew: true, prev: S.active };
  }
  S.active = best.a.id; kb.buf = ''; updateCur();
  drag = { ...best, x, y, o: { ...best.a } };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const dx = x - drag.x, dy = y - drag.y, a = drag.a, o = drag.o, cl = v => Math.min(1, Math.max(0, v));
  e.preventDefault();
  if (drag.k === 'p1') { a.x1 = cl(o.x1 + dx); a.y1 = cl(o.y1 + dy); }
  else if (drag.k === 'p2') { a.x2 = cl(o.x2 + dx); a.y2 = cl(o.y2 + dy); }
  else { a.x1 = cl(o.x1 + dx); a.y1 = cl(o.y1 + dy); a.x2 = cl(o.x2 + dx); a.y2 = cl(o.y2 + dy); }
  if (drag.isNew) { const k = Math.abs((a.y2 - a.y1) * r.height) > Math.abs((a.x2 - a.x1) * r.width) ? 'H' : 'B'; if (k !== a.kind) { a.kind = k; updateCur(); } }
  // Lupe über dem Finger (nur beim Ziehen eines Endpunkts)
  if (drag.k !== 'all') {
    const px = drag.k === 'p1' ? a.x1 : a.x2, py = drag.k === 'p1' ? a.y1 : a.y2;
    drawLoupe(px, py, r);
  }
});
const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null; $('#loupe').style.display = 'none';
  if (d.isNew) {
    const a = d.a, r = cv.getBoundingClientRect();
    const dx = (a.x2 - a.x1) * r.width, dy = (a.y2 - a.y1) * r.height;
    if (Math.hypot(dx, dy) < 25) { // nur getippt → kein Pfeil
      S.shot.arrows = S.shot.arrows.filter(x => x !== a); S.active = d.prev || firstOpen();
    } else {
      a.kind = Math.abs(dy) > Math.abs(dx) ? 'H' : 'B';
      // Pfeile von unten nach oben bzw. links nach rechts speichern
      if ((a.kind === 'H' && a.y1 < a.y2) || (a.kind === 'B' && a.x1 > a.x2)) [a.x1, a.y1, a.x2, a.y2] = [a.x2, a.y2, a.x1, a.y1];
      S.active = a.id;
    }
    updateCur();
  }
  saveShot();
};
// kein Scrollen/Zoomen der Seite im Editor
['touchstart', 'touchmove'].forEach(t => $('#stage').addEventListener(t, e => { if (e.target.closest('button')) return; if (e.touches.length < 2 || drag) e.preventDefault(); }, { passive: false }));

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
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

// ---------------- PDF ----------------
async function makePdfFile() {
  const fontBytes = new Uint8Array(await (await fetch('vendor/NotoSans.woff')).arrayBuffer());
  const shots = [];
  for (const s of S.shots) {
    const im = await blobToImg(s.photo);
    const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0, s.w, s.h);
    const measured = s.arrows.filter(a => a.cm != null);
    drawArrows(g, s.w, s.h, measured, null, 1, true);
    const jb = await canvasToBlob(c, 'image/jpeg', 0.85);
    shots.push({ room: s.room, jpg: new Uint8Array(await jb.arrayBuffer()), values: measured.map(a => ({ cm: a.cm, time: new Date(a.time) })) });
  }
  const p = S.project;
  const headLogo = await db.setting('headerLogo');
  const proj = { ...p, headerTitle: (await db.setting('headerTitle')) || 'Measuring Master',
    footer: (await db.setting('pdfFooter')) || '', overview: (await db.setting('pdfOverview')) !== false,
    overviewRows: S.shots.map(s => ({ room: s.room, items: s.arrows.filter(a => a.cm != null).map(a => ({ el: a.el, kind: a.kind, cm: a.cm })) })),
    headerLogo: headLogo ? await fileToImgBytes(headLogo) : null,
    kundenLogo: p.kundenLogo ? await fileToImgBytes(p.kundenLogo) : null };
  const bytes = await buildPdf(window.PDFLib, window.fontkit, fontBytes, proj, shots);
  return new File([bytes], fileBase(p) + '.pdf', { type: 'application/pdf' });
}
// Dateiname = Projektname (Straße + Hausnummer, Geschoß, WG), z. B. "Kopernikusstrasse 22, 1.OG, WG 12.pdf"
function fileBase(p) {
  const n = ((p.str || p.name || '').trim() || 'Wohnung').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n.slice(0, 120);
}
function openCount() { return S.shots.reduce((n, s) => n + s.arrows.filter(a => a.cm == null).length, 0); }
$('#btnPdf').onclick = async () => {
  if (!S.shots.length) { toast('Noch keine Fotos'); return; }
  const open = openCount();
  if (open) toast(`Hinweis: ${open} Pfeil(e) ohne Maß werden weggelassen`, 2500);
  const b = $('#btnPdf'); b.disabled = true; b.textContent = 'Erstelle …';
  try { await sharePdf(await makePdfFile()); }
  catch (e) { console.error(e); toast('PDF-Fehler: ' + e.message, 5000); }
  finally { b.disabled = false; b.textContent = 'PDF'; }
};
$('#btnDbx').onclick = async () => {
  if (!S.shots.length) { toast('Noch keine Fotos'); return; }
  if (!dropbox.connected) { toast('Dropbox zuerst in ⚙ Einstellungen verbinden', 3000); $('#btnSettings').click(); return; }
  const open = openCount();
  const ok = await confirmBox('PDF in Dropbox speichern?', 'Ja, hochladen', 'Abbrechen', 'pri',
    `Ordner: ${dropbox.cfg.folder || '/Maßblätter'}` + (open ? `\n${open} Pfeil(e) ohne Maß werden weggelassen.` : ''));
  if (!ok) return;
  const b = $('#btnDbx'); b.disabled = true;
  toast('Lade in Dropbox hoch …', 10000);
  try { const path = await dropbox.upload(await makePdfFile()); toast('In Dropbox gespeichert ✓ ' + path, 3500); beep(true); }
  catch (e) { console.error(e); toast('Dropbox-Fehler: ' + e.message, 6000); beep(false); }
  finally { b.disabled = false; }
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
  const n = { ...p, id: uid(), created: Date.now(), updated: Date.now(), datum: new Date().toISOString().slice(0, 10) };
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
  $('#dbxKey').value = c.appKey || ''; $('#dbxFolder').value = c.folder || '';
  $('#dbxState').textContent = dropbox.connected ? 'Verbunden ✓' : 'Nicht verbunden';
  $('#dbxSetup').style.display = dropbox.connected ? 'none' : '';
  $('#dbxOff').style.display = dropbox.connected ? '' : 'none';
  if (!dropbox.connected && c.appKey) { try { $('#dbxAuth').href = await dropbox.authUrl(); } catch (e) { } } else $('#dbxAuth').removeAttribute('href');
}
$('#dbxKey').onchange = () => { dropbox.setAppKey($('#dbxKey').value); dbxUi(); };
$('#dbxAuth').onclick = e => { if (!$('#dbxAuth').href) { e.preventDefault(); toast('Zuerst den App-Key eintragen'); } };
$('#dbxFolder').oninput = () => dropbox.setFolder($('#dbxFolder').value);
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
async function sharePdf(file) {
  const url = URL.createObjectURL(file);
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2>PDF fertig</h2><p class="mute"></p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="pri" data-share>Teilen (Mail, WhatsApp, Drive …)</button>
      <a data-dl style="display:block"><button class="ghost" style="width:100%">Am Handy speichern</button></a>
      <button class="ghost" data-open>Vorschau ansehen</button>
      <button class="ghost" data-close>Schließen</button></div></div>`;
  bg.querySelector('p').textContent = file.name;
  const a = bg.querySelector('[data-dl]'); a.href = url; a.download = file.name;
  const sb = bg.querySelector('[data-share]');
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) sb.style.display = 'none';
  sb.onclick = () => navigator.share({ files: [file], title: file.name }).catch(() => { });
  bg.querySelector('[data-open]').onclick = () => previewPdf(file);
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
}

// ---------------- Einstellungen ----------------
$('#btnSettings').onclick = async () => {
  $('#sTitle').value = (await db.setting('headerTitle')) || '';
  const lg = await db.setting('headerLogo');
  if (lg) { $('#sLogoPrev').src = URL.createObjectURL(lg); $('#sLogoPrev').hidden = false; } else $('#sLogoPrev').hidden = true;
  $('#sAi').value = S.ai ? '1' : '0';
  dbxUi();
  renderCustManage();
  $('#sAiState').textContent = 'KI-Modell: ' + modelState();
  $('#sLog').textContent = laser.log.join('\n') || '–';
  $('#ver').textContent = VERSION;
  $('#sFooter').value = (await db.setting('pdfFooter')) || '';
  $('#sBig').checked = !!opt.big; $('#sVoice').checked = !!opt.voice;
  const kl = laser.known; $('#sLasers').textContent = kl.length ? 'Gemerkt: ' + kl.map(k => `${k.name} (${new Date(k.last).toLocaleDateString('de-AT')})`).join(', ') : 'Noch kein Laser verbunden.';
  $('#sOverview').value = (await db.setting('pdfOverview')) === false ? '0' : '1';
  $('#sRooms').value = (await rooms()).map(([k, t]) => t ? `${k} = ${t}` : k).join('\n');
  $('#sZoom').value = String((await db.setting('zoom')) || 1);
  showStorage();
  $('#setSheet').classList.add('on');
};
$('#sBig').onchange = () => { opt.big = $('#sBig').checked; saveOpt(); if (opt.big) showBig(199, { el: 'Tür', kind: 'H' }); };
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
$('#sFooter').oninput = () => db.setting('pdfFooter', $('#sFooter').value);
$('#sOverview').onchange = () => db.setting('pdfOverview', $('#sOverview').value === '1');
$('#sRooms').oninput = () => {
  const list = $('#sRooms').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [k, ...t] = l.split('='); return [k.trim(), t.join('=').trim()]; }).filter(x => x[0]);
  db.setting('rooms', list);
};
$('#sRoomsReset').onclick = async () => { await db.setting('rooms', null); $('#sRooms').value = DEFAULT_ROOMS.map(([k, t]) => t ? `${k} = ${t}` : k).join('\n'); };
// Schriftgröße: nur Listen/Formulare vergrößern (nicht Foto-Bildschirm/Kamera, dort zählen Fingerpositionen)
function applyZoom(z) { ['home', 'proj'].forEach(id => { $('#' + id).style.zoom = z; }); $$('.sheet').forEach(e => { e.style.zoom = z; }); }
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
$('#sLogo').onchange = async e => { const f = e.target.files[0]; if (!f) return; await db.setting('headerLogo', f); $('#sLogoPrev').src = URL.createObjectURL(f); $('#sLogoPrev').hidden = false; };
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
$$('[data-back]').forEach(b => b.onclick = () => { renderHome(); show(b.dataset.back); });

// ---------------- PIN-Sperre ----------------
// Einfache Sperre gegen fremde Nutzung (kein echter Schutz: der Code ist öffentlich).
// Nach richtiger Eingabe bleibt das Gerät 30 Tage entsperrt.
async function pinHash(pin) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(PIN.salt), iterations: PIN.iter, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function unlocked() { try { return Number(localStorage.getItem('mb_unlock') || 0) > Date.now(); } catch (e) { return false; } }
function askPin() {
  return new Promise(res => {
    const lock = $('#lock'), pad = $('#lockPad'); let buf = ''; let tries = 0;
    lock.style.display = 'flex';
    const dots = () => { $('#lockDots').textContent = '•'.repeat(buf.length); };
    pad.innerHTML = '';
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'OK', '0', '⌫'].forEach(k => {
      const b = document.createElement('button'); b.textContent = k; if (k === 'OK') b.className = 'pri';
      b.onclick = async () => {
        if (k === '⌫') buf = buf.slice(0, -1);
        else if (k === 'OK') {
          if (!buf) return;
          $('#lockMsg').textContent = 'Prüfe …';
          const ok = (await pinHash(buf)) === PIN.hash;
          buf = '';
          if (ok) {
            try { localStorage.setItem('mb_unlock', String(Date.now() + 30 * 864e5)); } catch (e) { }
            lock.style.display = 'none'; res(); return;
          }
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

// ---------------- Start ----------------
(async () => {
  if (!unlocked()) await askPin();
  const ai = await db.setting('ai'); S.ai = ai !== false;
  applyZoom((await db.setting('zoom')) || 1);
  laserUi();
  renderHome();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => { });
    // neue Version übernommen → einmal neu laden
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  window.__mb = { S, laser, onMeasure, applyTemplate, setArrows, arrowsFromObjects, hdrTest: async () => { caps.exposureCompensation = { min: -2, max: 2 }; const t0 = performance.now(); const c = await captureHdr(); return [c.width, c.height, Math.round(performance.now() - t0), c.toDataURL('image/jpeg', 0.7)]; } }; // für Tests
})();
