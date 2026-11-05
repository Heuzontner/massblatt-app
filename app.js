import { db, uid } from './db.js';
import { Laser } from './ble.js';
import { TEMPLATES, arrowsFromObjects, newArrow, drawArrows } from './arrows.js';
import { buildPdf } from './pdf.js';
import { detect, loadModel, modelState } from './detect.js';
import { PIN } from './pin.js';

const VERSION = '1.2.0';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ROOMS = [['Kz', 'Kinderz.'], ['Sz', 'Schlafz.'], ['Wz', 'Wohnz.'], ['Wk', 'Wohnküche'], ['Kü', 'Küche'], ['Bad', ''], ['WC', ''], ['Vr', 'Vorraum'],
  ['Ar', 'Abstellr.'], ['Lo', 'Loggia'], ['Eg', 'Eingang'], ['Rh', 'Raumhöhe']];

const S = { project: null, shots: [], room: null, shot: null, active: null, stream: null, ai: true, wake: null };
const laser = new Laser();

// ---------------- Hilfen ----------------
function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
function show(id) { $$('.screen').forEach(s => s.classList.toggle('on', s.id === id)); if (id !== 'cam') stopCam(); }
function beep(ok = true) {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = ok ? 1320 : 330; g.gain.value = 0.08; o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + 0.09);
  } catch (e) { }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 60, 60]);
}
// toBlob hängt auf manchen Geräten gelegentlich → Zeitlimit, dann toDataURL
function canvasToBlob(c, type = 'image/jpeg', q = 0.88) {
  return new Promise(res => {
    let done = false;
    const fb = () => { if (done) return; done = true; const d = c.toDataURL(type, q); const b = atob(d.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); res(new Blob([u], { type })); };
    const t = setTimeout(fb, 1500);
    try { c.toBlob(b => { if (done) return; if (!b) return fb(); done = true; clearTimeout(t); res(b); }, type, q); } catch (e) { fb(); }
  });
}
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
async function renderHome() {
  const list = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const el = $('#projList');
  if (!list.length) { el.innerHTML = '<div class="empty">Noch kein Projekt.<br>Unten auf „+ Neues Projekt“ tippen.</div>'; return; }
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
  await db.put('projects', p);
  await openProject(p.id, true);
};

async function openProject(id, isNew = false) {
  S.project = await db.get('projects', id);
  S.shots = await db.shotsOf(id);
  const p = S.project;
  $('#pName').value = p.name || ''; $('#pFirma').value = p.firma || ''; $('#pKontakt').value = p.kontakt || '';
  $('#pStrasse').value = p.strasse || ''; $('#pOrt').value = p.ort || ''; $('#pLand').value = p.land || '';
  $('#pTel').value = p.telefon || ''; $('#pDatum').value = (p.datum || '').slice(0, 10);
  renderCustChips();
  $('#projDetails').open = isNew || !p.name;
  $('#projTitle').textContent = p.name || 'Neues Projekt';
  renderShots();
  show('proj');
  if (isNew) setTimeout(() => $('#pName').focus(), 200);
}

const fieldMap = { pName: 'name', pFirma: 'firma', pKontakt: 'kontakt', pStrasse: 'strasse', pOrt: 'ort', pLand: 'land', pTel: 'telefon', pDatum: 'datum' };
Object.entries(fieldMap).forEach(([id, k]) => {
  $('#' + id).addEventListener('input', () => {
    S.project[k] = $('#' + id).value; S.project.updated = Date.now();
    if (k === 'name') $('#projTitle').textContent = S.project.name || 'Neues Projekt';
    clearTimeout(S._saveT); S._saveT = setTimeout(() => db.put('projects', S.project), 300);
  });
});
// ---------------- Kunden ----------------
// Kunde = Name + PLZ Ort + Logo. Auswahl im Projekt übernimmt alles fürs Deckblatt.
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
  p.firma = c ? c.name : ''; p.ort = c ? (c.ort || '') : ''; p.kundenLogo = c ? (c.logo || null) : null;
  $('#pFirma').value = p.firma; $('#pOrt').value = p.ort;
  p.updated = Date.now(); await db.put('projects', p);
  renderCustChips();
}
function editCustomer(c) {
  return new Promise(res => {
    const sh = $('#custSheet'); let logo = c ? c.logo : null;
    $('#custTitle').textContent = c ? 'Kunde bearbeiten' : 'Neuer Kunde';
    $('#cName').value = c ? c.name : ''; $('#cOrt').value = c ? (c.ort || '') : '';
    const prev = () => { if (logo) { $('#cLogoPrev').src = URL.createObjectURL(logo); $('#cLogoPrev').hidden = false; } else $('#cLogoPrev').hidden = true; };
    prev(); $('#cLogo').value = '';
    $('#cDel').style.display = c ? '' : 'none';
    $('#cLogo').onchange = e => { const f = e.target.files[0]; if (f) { logo = f; prev(); } };
    const close = v => { sh.classList.remove('on'); res(v); };
    $('#cCancel').onclick = () => close(null);
    $('#cSave').onclick = async () => {
      const name = $('#cName').value.trim(); if (!name) { toast('Bitte einen Namen eingeben'); return; }
      const list = (await db.setting('customers')) || [];
      const obj = { id: c ? c.id : uid(), name, ort: $('#cOrt').value.trim(), logo };
      const i = list.findIndex(x => x.id === obj.id);
      if (i >= 0) list[i] = obj; else list.push(obj);
      await db.setting('customers', list);
      // Projekte mit diesem Kunden aktualisieren
      for (const p of await db.all('projects')) if (p.kundeId === obj.id) { p.firma = obj.name; p.ort = obj.ort; p.kundenLogo = obj.logo; await db.put('projects', p); if (S.project && S.project.id === p.id) Object.assign(S.project, p); }
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

function confirmBox(msg) {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'sheet-bg on';
    bg.innerHTML = `<div class="sheet"><h2></h2><div style="display:flex;gap:8px"><button class="ghost" style="flex:1">Abbrechen</button><button class="danger" style="flex:1">Löschen</button></div></div>`;
    bg.querySelector('h2').textContent = msg;
    const [no, yes] = bg.querySelectorAll('button');
    no.onclick = () => { bg.remove(); res(false); }; yes.onclick = () => { bg.remove(); res(true); };
    document.body.appendChild(bg);
  });
}

function renderShots() {
  const el = $('#shotList'); el.innerHTML = '';
  if (!S.shots.length) { el.innerHTML = '<div class="empty">Noch keine Fotos.<br>Unten auf „📷 Foto“ tippen: Raum wählen, fotografieren, messen.</div>'; return; }
  S.shots.forEach((s, i) => {
    const c = document.createElement('div'); c.className = 'card shot';
    const vals = s.arrows.filter(a => a.cm != null).map(a => `${a.cm}`).join(' · ');
    const open = s.arrows.filter(a => a.cm == null).length;
    c.innerHTML = `<img><div class="t"><div class="room"></div><div class="vals"></div>${open ? `<div class="warn">${open} Pfeil${open > 1 ? 'e' : ''} ohne Maß</div>` : ''}</div><span style="align-self:center;color:var(--mute);font-size:22px">›</span>`;
    c.querySelector('img').src = URL.createObjectURL(s.photo);
    c.querySelector('.room').textContent = `${i + 1}. ${s.room}`;
    c.querySelector('.vals').textContent = vals ? vals + ' cm' : '–';
    c.onclick = () => openEditor(s);
    el.appendChild(c);
  });
}
async function moveShot(i, d) {
  const j = i + d; if (j < 0 || j >= S.shots.length) return;
  [S.shots[i], S.shots[j]] = [S.shots[j], S.shots[i]];
  for (let k = 0; k < S.shots.length; k++) { S.shots[k].order = k; await db.put('shots', S.shots[k]); }
  renderShots();
}

// ---------------- Raumwahl ----------------
function pickRoom() {
  return new Promise(res => {
    const sh = $('#roomSheet'); const g = $('#roomGrid'); g.innerHTML = '';
    ROOMS.forEach(([k, t]) => {
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
$('#btnShoot').onclick = async () => {
  const r = await pickRoom(); if (!r) return;
  S.room = r; openCam();
};
async function openCam() {
  $('#camRoom').textContent = S.room;
  $('#camHint').textContent = S.room === 'Rh' ? 'Wand von Boden bis Decke ins Bild nehmen' : 'Tür und Fenster ganz ins Bild nehmen';
  show('cam');
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 3000 }, height: { ideal: 4000 } }, audio: false });
    $('#video').srcObject = S.stream;
    await $('#video').play().catch(() => { });
  } catch (e) {
    toast('Kamera nicht verfügbar – System-Kamera wird geöffnet', 3000);
    $('#fileIn').click();
  }
}
function stopCam() {
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
}
$('#camRoom').onclick = async () => { const r = await pickRoom(); if (r) { S.room = r; $('#camRoom').textContent = r; } };
$('#camBack').onclick = () => { renderShots(); show('proj'); };
$('#camGallery').onclick = () => $('#galIn').click();
$('#fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) newShotFromBlob(f); else show('proj'); };
$('#galIn').onchange = e => {  const f = e.target.files[0]; e.target.value = ''; if (f) newShotFromBlob(f); };
$('#shutter').onclick = async () => {
  const v = $('#video');
  if (!v.videoWidth) return;
  let blob = null;
  try {
    const track = S.stream.getVideoTracks()[0];
    if (window.ImageCapture) blob = await new ImageCapture(track).takePhoto();
  } catch (e) { blob = null; }
  if (!blob) {
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    blob = await canvasToBlob(c, 'image/jpeg', 0.92);
  }
  beep(true);
  newShotFromBlob(blob);
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
  $('#edTitle').textContent = shot.room;
  photoImg = await blobToImg(shot.photo);
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
    if (!await confirmBox(`Dieses Foto (${S.shot.room}) mit allen Maßen löschen?`)) return;
    await db.del('shots', S.shot.id);
    S.shots = S.shots.filter(x => x.id !== S.shot.id);
    for (let k = 0; k < S.shots.length; k++) { S.shots[k].order = k; await db.put('shots', S.shots[k]); }
    renderShots(); show('proj'); return;
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
  v.textContent = a ? (kb.on ? (kb.buf || '…') + ' cm' : a.cm != null ? a.cm + ' cm' : laser.state === 'verbunden' ? 'Jetzt am Laser messen' : 'Laser verbinden (oben) oder tippen') : '–';
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
  if (next) { S.active = next.id; updateCur(); }
  else { S.active = a.id; updateCur(); finishShot(true); }
}

function onMeasure(cm) {
  if ($('#ed').classList.contains('on') && S.shot) { setValue(cm); return; }
  toast(`${cm} cm gemessen – erst ein Foto machen`, 2000); beep(false);
}

let finishing = 0;
function finishShot(auto) {
  clearTimeout(finishing);
  const go = async () => {
    await saveShot();
    if (S.wake) { S.wake.release().catch(() => { }); S.wake = null; }
    openCam();
  };
  if (auto) { toast(`${S.shot.room}: alle Maße da ✓ – nächstes Foto`, 1300); finishing = setTimeout(go, 1300); }
  else go();
}

$('#edDone').onclick = () => finishShot(false);
$('#edBack').onclick = async () => { clearTimeout(finishing); await saveShot(); renderShots(); show('proj'); };
$('#prevA').onclick = () => stepActive(-1);
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
  ['1', '2', '3', '⌫', '4', '5', '6', 'C', '7', '8', '9', '', '', '0', '', 'OK'].forEach(k => {
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
$('#kbBtn').onclick = () => { kb.on = !kb.on; kb.buf = ''; $('#keypad').classList.toggle('on', kb.on); $('#kbBtn').textContent = kb.on ? '✕ Tastatur' : '⌨ Tippen'; setTimeout(fitCanvas, 30); updateCur(); };

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
  if (!best) return;
  clearTimeout(finishing);
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
  // Lupe über dem Finger (nur beim Ziehen eines Endpunkts)
  if (drag.k !== 'all') {
    const px = drag.k === 'p1' ? a.x1 : a.x2, py = drag.k === 'p1' ? a.y1 : a.y2;
    drawLoupe(px, py, r);
  }
});
const endDrag = () => { if (drag) { drag = null; $('#loupe').style.display = 'none'; saveShot(); } };
// kein Scrollen/Zoomen der Seite im Editor
['touchstart', 'touchmove'].forEach(t => $('#stage').addEventListener(t, e => { if (e.touches.length < 2 || drag) e.preventDefault(); }, { passive: false }));

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
$('#btnPdf').onclick = async () => {
  if (!S.shots.length) { toast('Noch keine Fotos'); return; }
  const open = S.shots.reduce((n, s) => n + s.arrows.filter(a => a.cm == null).length, 0);
  if (open) toast(`Hinweis: ${open} Pfeil(e) ohne Maß werden weggelassen`, 2500);
  const b = $('#btnPdf'); b.disabled = true; b.textContent = 'Erstelle …';
  try {
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
      headerLogo: headLogo ? await fileToImgBytes(headLogo) : null,
      kundenLogo: p.kundenLogo ? await fileToImgBytes(p.kundenLogo) : null };
    const bytes = await buildPdf(window.PDFLib, window.fontkit, fontBytes, proj, shots);
    const name = 'Massblatt_' + (p.name || 'Wohnung').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80) + '.pdf';
    const file = new File([bytes], name, { type: 'application/pdf' });
    await sharePdf(file);
  } catch (e) { console.error(e); toast('PDF-Fehler: ' + e.message, 5000); }
  finally { b.disabled = false; b.textContent = 'PDF'; }
};
async function sharePdf(file) {
  const url = URL.createObjectURL(file);
  const bg = document.createElement('div'); bg.className = 'sheet-bg on';
  bg.innerHTML = `<div class="sheet"><h2>PDF fertig</h2><p class="mute"></p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="pri" data-share>Teilen (Mail, WhatsApp, Drive …)</button>
      <a data-dl style="display:block"><button class="ghost" style="width:100%">Am Handy speichern</button></a>
      <button class="ghost" data-open>Ansehen</button>
      <button class="ghost" data-close>Schließen</button></div></div>`;
  bg.querySelector('p').textContent = file.name;
  const a = bg.querySelector('[data-dl]'); a.href = url; a.download = file.name;
  const sb = bg.querySelector('[data-share]');
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) sb.style.display = 'none';
  sb.onclick = () => navigator.share({ files: [file], title: file.name }).catch(() => { });
  bg.querySelector('[data-open]').onclick = () => window.open(url, '_blank');
  bg.querySelector('[data-close]').onclick = () => bg.remove();
  document.body.appendChild(bg);
}

// ---------------- Einstellungen ----------------
$('#btnSettings').onclick = async () => {
  $('#sTitle').value = (await db.setting('headerTitle')) || '';
  const lg = await db.setting('headerLogo');
  if (lg) { $('#sLogoPrev').src = URL.createObjectURL(lg); $('#sLogoPrev').hidden = false; } else $('#sLogoPrev').hidden = true;
  $('#sAi').value = S.ai ? '1' : '0';
  renderCustManage();
  $('#sAiState').textContent = 'KI-Modell: ' + modelState();
  $('#sLog').textContent = laser.log.join('\n') || '–';
  $('#ver').textContent = VERSION;
  $('#setSheet').classList.add('on');
};
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
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].forEach(k => {
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
  laserUi();
  renderHome();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__mb = { S, laser, onMeasure, applyTemplate, setArrows, arrowsFromObjects }; // für Tests
})();
