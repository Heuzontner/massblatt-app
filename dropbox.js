// Dropbox: PDF (und auf Wunsch Fotos) direkt in einen Ordner hochladen.
// Anmeldung per PKCE ohne Weiterleitung: Dropbox zeigt einen Code, der in der App eingefügt wird
// (funktioniert auch in der installierten iPhone-/Android-App, wo eine Weiterleitung nicht zurückkommt).
const KEY = 'mb_dropbox';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const save = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } };

export class DbxError extends Error {
  constructor(msg, summary = '', status = 0) { super(msg); this.summary = summary; this.status = status; }
  get missingScope() { return /missing_scope/.test(this.summary); }
  get notFound() { return /not_found/.test(this.summary); }
  get conflict() { return /conflict/.test(this.summary); }
}

export const dropbox = {
  get cfg() { return load(); },
  setAppKey(k) { const c = load(); c.appKey = k.trim(); save(c); },
  setFolder(f) { const c = load(); c.folder = f.trim(); save(c); },
  setYear(on) { const c = load(); c.year = !!on; save(c); },
  get connected() { return !!load().refresh; },
  disconnect() { const c = load(); delete c.refresh; delete c.access; delete c.exp; delete c.verifier; save(c); },

  // Basisordner (immer mit führendem /, ohne / am Ende)
  get base() { let f = (load().folder || '/Maßblätter').replace(/\/+$/, ''); if (!f.startsWith('/')) f = '/' + f; return f; },
  cleanSub(sub) { return (sub || '').replace(/[\\:*?"<>|]+/g, ' ').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').trim(); },
  pathFor(sub, name) { sub = this.cleanSub(sub); return this.base + (sub ? '/' + sub : '') + (name ? '/' + name : ''); },

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

  // RPC-Aufruf (JSON rein, JSON raus); Fehler werden mit Dropbox-Kurzcode weitergereicht
  async api(ep, arg) {
    const r = await fetch('https://api.dropboxapi.com/2/' + ep, {
      method: 'POST', headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/json' }, body: JSON.stringify(arg),
    });
    const t = await r.text();
    if (!r.ok) throw apiError(t, r.status);
    return t ? JSON.parse(t) : {};
  },

  // Unterordner + Dateien eines Ordners ('' oder '/' = Hauptordner der App)
  async listFolder(path) {
    path = path === '/' ? '' : (path || '');
    const folders = [], files = [];
    let j = await this.api('files/list_folder', { path, recursive: false, include_non_downloadable_files: false, limit: 500 });
    for (;;) {
      for (const e of j.entries || []) {
        if (e['.tag'] === 'folder') folders.push({ name: e.name, path: e.path_display });
        else if (e['.tag'] === 'file') files.push({ name: e.name, path: e.path_display, size: e.size, modified: e.client_modified });
      }
      if (!j.has_more) break;
      j = await this.api('files/list_folder/continue', { cursor: j.cursor });
    }
    const by = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });
    return { folders: folders.sort(by), files: files.sort(by) };
  },
  async createFolder(path) { return (await this.api('files/create_folder_v2', { path, autorename: false })).metadata; },
  // Ordner/Datei vorhanden? → Metadaten oder null
  async exists(path) {
    try { return await this.api('files/get_metadata', { path }); }
    catch (e) { if (e instanceof DbxError && e.notFound) return null; throw e; }
  },

  // nächster freier Name: „Name.pdf“ → „Name_v2.pdf“, „Name_v3.pdf“ … (statt Dropbox' „Name (1).pdf“)
  async freeName(folder, name) {
    let taken;
    try { const l = await this.listFolder(folder); taken = new Set([...l.files, ...l.folders].map(x => x.name.toLowerCase())); }
    catch (e) { return null; } // Ordner gibt es noch nicht oder keine Leserechte → Dropbox entscheidet beim Hochladen
    if (!taken.has(name.toLowerCase())) return name;
    const m = name.match(/^(.*?)(\.[^.]+)?$/); const stem = m[1], ext = m[2] || '';
    for (let v = 2; v < 500; v++) { const n = `${stem}_v${v}${ext}`; if (!taken.has(n.toLowerCase())) return n; }
    return null;
  },

  // lädt die Datei hoch; gleicher Name → _v2, _v3 … (opts.overwrite: gleiche Datei ersetzen, z. B. Fotos)
  async upload(file, sub = '', opts = {}) {
    const name = (opts.name || file.name).replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const folder = this.pathFor(sub);
    const put = async (n, mode) => {
      const arg = JSON.stringify({ path: folder + '/' + n, mode, autorename: false, mute: false });
      const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': asciiJson(arg) },
        body: file,
      });
      const t = await r.text();
      if (!r.ok) throw apiError(t, r.status);
      return JSON.parse(t);
    };
    if (opts.overwrite) return (await put(name, 'overwrite')).path_display;
    const m = name.match(/^(.*?)(\.[^.]+)?$/); const stem = m[1], ext = m[2] || '';
    // erst nachsehen, welcher Name frei ist (spart Hochladeversuche); ohne Leserechte oder wenn
    // inzwischen jemand anderer hochgeladen hat, bei Namenskonflikt selbst weiterzählen
    let start = 1; const n0 = await this.freeName(folder, name);
    if (n0 && n0 !== name) { const mv = n0.match(/_v(\d+)(?:\.[^.]+)?$/); if (mv) start = parseInt(mv[1], 10); }
    for (let v = start; v < start + 100; v++) {
      const cand = v === 1 ? name : `${stem}_v${v}${ext}`;
      try { return (await put(cand, 'add')).path_display; }
      catch (e) { if (!(e instanceof DbxError && e.conflict)) throw e; }
    }
    throw new DbxError('Kein freier Dateiname gefunden');
  },
};

function apiError(text, status) {
  let summary = '', msg = text.slice(0, 200);
  try { const j = JSON.parse(text); summary = j.error_summary || ''; msg = j.error_summary || j.error_description || j.error || msg; } catch (e) { }
  if (/missing_scope/.test(summary)) msg = 'Dropbox-Berechtigung fehlt (in der Dropbox-App-Konsole „files.metadata.read“ und „files.content.write“ aktivieren, dann in ⚙ Cloud trennen und neu verbinden)';
  else if (/insufficient_space/.test(summary)) msg = 'Dropbox ist voll';
  else if (/not_found/.test(summary)) msg = 'Ordner oder Datei in Dropbox nicht gefunden';
  else if (/expired_access_token|invalid_access_token/.test(summary)) msg = 'Dropbox-Anmeldung abgelaufen – bitte neu verbinden';
  return new DbxError(msg, summary, status);
}
function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
// HTTP-Header dürfen nur ASCII enthalten → Umlaute als \uXXXX (so verlangt es Dropbox)
function asciiJson(s) { return s.replace(/[\u007f-￿]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')); }
