// Dropbox: PDF direkt in einen Ordner hochladen.
// Anmeldung per PKCE ohne Weiterleitung: Dropbox zeigt einen Code, der in der App eingefügt wird
// (funktioniert auch in der installierten iPhone-/Android-App, wo eine Weiterleitung nicht zurückkommt).
const KEY = 'mb_dropbox';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const save = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } };

export const dropbox = {
  get cfg() { return load(); },
  setAppKey(k) { const c = load(); c.appKey = k.trim(); save(c); },
  setFolder(f) { const c = load(); c.folder = f.trim(); save(c); },
  get connected() { return !!load().refresh; },
  disconnect() { const c = load(); delete c.refresh; delete c.access; delete c.exp; delete c.verifier; save(c); },

  async authUrl() {
    const c = load(); if (!c.appKey) throw new Error('Kein Dropbox App-Key eingetragen');
    const rnd = crypto.getRandomValues(new Uint8Array(48));
    const verifier = b64url(rnd);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    c.verifier = verifier; save(c);
    return 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
      client_id: c.appKey, response_type: 'code', code_challenge: b64url(hash), code_challenge_method: 'S256', token_access_type: 'offline',
    });
  },

  async finishAuth(code) {
    const c = load();
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: code.trim(), grant_type: 'authorization_code', client_id: c.appKey, code_verifier: c.verifier || '' }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'Anmeldung fehlgeschlagen');
    c.refresh = j.refresh_token; c.access = j.access_token; c.exp = Date.now() + (j.expires_in - 60) * 1000; delete c.verifier;
    save(c);
  },

  async token() {
    const c = load();
    if (c.access && c.exp > Date.now()) return c.access;
    if (!c.refresh) throw new Error('Dropbox nicht verbunden');
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: c.appKey }),
    });
    const j = await r.json();
    if (!r.ok) { if (j.error === 'invalid_grant') this.disconnect(); throw new Error(j.error_description || j.error || 'Dropbox-Anmeldung abgelaufen'); }
    c.access = j.access_token; c.exp = Date.now() + (j.expires_in - 60) * 1000; save(c);
    return c.access;
  },

  // lädt die Datei hoch; gleicher Name → Dropbox hängt (1), (2) … an
  async upload(file, sub = '') {
    const c = load();
    let folder = (c.folder || '/Maßblätter').replace(/\/+$/, ''); if (!folder.startsWith('/')) folder = '/' + folder;
    sub = (sub || '').replace(/[\\:*?"<>|]+/g, ' ').replace(/^\/+|\/+$/g, '').trim();
    const path = folder + (sub ? '/' + sub : '') + '/' + file.name;
    const arg = JSON.stringify({ path, mode: 'add', autorename: true, mute: false });
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': asciiJson(arg) },
      body: file,
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t.slice(0, 200));
    return JSON.parse(t).path_display;
  },
};

function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
// HTTP-Header dürfen nur ASCII enthalten → Umlaute als \uXXXX (so verlangt es Dropbox)
function asciiJson(s) { return s.replace(/[\u007f-￿]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')); }
