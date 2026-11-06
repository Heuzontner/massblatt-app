// Google Kalender: Termine lesen (nur lesen), um daraus Projekte mit Adresse anzulegen.
// Anmeldung über den „impliziten“ OAuth-Ablauf: Weiterleitung zu Google, zurück mit Zugangs-Token im #Hash
// (gültig ca. 1 Stunde; danach einfach neu anmelden – Google fragt dann nicht mehr nach).
const KEY = 'mb_gcal';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const save = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } };

export const gcal = {
  get cfg() { return load(); },
  setClientId(id) { const c = load(); c.clientId = id.trim(); save(c); },
  get configured() { return !!load().clientId; },
  get connected() { const c = load(); return !!(c.token && c.exp > Date.now()); },
  get everConnected() { return !!load().ever; },
  logout() { const c = load(); delete c.token; delete c.exp; save(c); },

  redirectUri() { return location.origin + location.pathname; },

  login() {
    const c = load(); if (!c.clientId) throw new Error('Keine Google Client-ID eingetragen');
    const state = Math.random().toString(36).slice(2); c.state = state; save(c);
    const u = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: c.clientId, redirect_uri: this.redirectUri(), response_type: 'token', scope: SCOPE,
      include_granted_scopes: 'true', state, prompt: c.ever ? 'none' : 'consent',
    });
    location.href = u;
  },

  // beim Start aufrufen: Token aus der Rücksprung-Adresse übernehmen
  handleRedirect() {
    const h = location.hash || '';
    if (!h.includes('access_token=')) {
      if (h.includes('error=')) { const p = new URLSearchParams(h.slice(1)); this._err = p.get('error'); history.replaceState(null, '', location.pathname + location.search); return 'error'; }
      return false;
    }
    const p = new URLSearchParams(h.slice(1));
    const c = load();
    if (c.state && p.get('state') && p.get('state') !== c.state) { history.replaceState(null, '', location.pathname + location.search); return 'error'; }
    c.token = p.get('access_token'); c.exp = Date.now() + (parseInt(p.get('expires_in') || '3600', 10) - 60) * 1000; c.ever = true; delete c.state;
    save(c);
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  },

  async _get(url) {
    const c = load();
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + c.token } });
    if (r.status === 401) { this.logout(); throw new Error('Google-Anmeldung abgelaufen – bitte neu anmelden'); }
    if (!r.ok) throw new Error('Google: ' + r.status);
    return r.json();
  },

  // Termine von heute bis in `days` Tagen aus allen ausgewählten Kalendern
  async events(days = 7) {
    const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from.getTime() + days * 864e5);
    const list = await this._get('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=50');
    const cals = (list.items || []).filter(c => c.selected !== false).slice(0, 12);
    const out = [];
    await Promise.all(cals.map(async cal => {
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
      const j = await this._get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
      for (const e of j.items || []) {
        if (e.status === 'cancelled') continue;
        const start = e.start && (e.start.dateTime || e.start.date);
        out.push({ id: e.id, cal: cal.summary, summary: e.summary || '(ohne Titel)', location: e.location || '', description: e.description || '',
          start, allDay: !!(e.start && e.start.date && !e.start.dateTime) });
      }
    }));
    out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return out;
  },
};

// „Kopernikusstraße 22, 4020 Linz, Österreich“ → { str: 'Kopernikusstrasse 22', plz: '4020', ort: 'Linz' }
// Adresse aus freiem Text (Ort-Feld, Titel oder Beschreibung eines Termins) herauslesen.
// Liefert { str, plz, ort } oder null. ß wird zu ss (wie überall in der App).
const STOP = /^(aufma(ß|ss)|aufnahme|ma(ß|ss)aufnahme|ma(ß|ss)blatt|termin|besichtigung|vermessung|messung|messen|übergabe|wohnungsübergabe|abnahme|objekt|adresse|wohnung|whg\.?|bei|mit|für|fuer|kunde|kundin|neu|alt|fenster|türen|tür|tueren|tuer|sanierung|tausch|fam\.?|familie|hr\.?|herr|fr\.?|frau|.*:)$/i;
const CAPS = /^[A-ZÄÖÜ]{2,6}$/; // Kundenkürzel wie WAG, GWG, LAWOG
const SUFFIX = /(stra(ß|ss)e|str\.?|gasse|weg|platz|allee|ring|zeile|promenade|ufer|steig|hof|markt|siedlung|gang|leiten|graben|damm|kai|lände|laende|au|berg|bühel|buehel|feld|wiese|park|dorf|rain|straßl|strassl|gstätten|gstaetten)$/i;
const SUFFIX_ALONE = /^(stra(ß|ss)e|str\.?|gasse|weg|platz|allee|ring|zeile|promenade|ufer|steig|hof|markt|siedlung|damm|kai|lände|laende|au|park|rain)$/i; // "Wiener Straße", "Neuer Markt"
const PREFIX = /^(am|an|im|in|auf|zur|zum|ober|unter|obere|oberer|untere|unterer|alte|alter|neue|neuer|hintere|hinterer|vordere|vorderer|gro(ß|ss)e|gro(ß|ss)er|kleine|kleiner|lange|langer|kurze|hohe|hoher|dr\.|st\.|sankt|linzer|wiener|welser|steyrer|grazer|salzburger|enns(er)?|urfahrer|leondinger|trauner|ansfeldner)$/i;
const HNR = /^\d{1,4}[a-zA-Z]?(?:\s*[\/\-]\s*\d+[a-zA-Z]?)*$/;
const UNIT = /^((\d+\.\s?)?(EG|OG|DG|KG|UG|Erdgeschoss|Erdgescho(ß|ss)|Dachgeschoss|Souterrain|Parterre)|(WG|Whg\.?|Wohnung|Top|Tür|Tuer|Stg\.?|Stiege|Haus|Block|Objekt|Nr\.?)\s*\d+[a-zA-Z]?)$/i;
export function parseAddress(text, stopWords = []) {
  let t = (text || '').replace(/\s+/g, ' ').replace(/ß/g, 'ss').trim();
  if (!t) return null;
  t = t.replace(/,?\s*(Österreich|Oesterreich|Austria|AT)\s*$/i, '').trim();
  let str = '', plz = '', ort = '', before = t;
  // PLZ + Ort irgendwo im Text ("4020 Linz", "A-4400 Steyr", "4490 St. Florian", "4531 Kematen an der Krems")
  const pm = t.match(/(?:^|[\s,])(?:A-)?(\d{4})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöü.\-]*(?:\s(?:am|an|im|in|bei|ob|der|a\.d\.|i\.M\.)(?:\sder)?\s[A-ZÄÖÜ][A-Za-zÄÖÜäöü.\-]*|\s[A-ZÄÖÜ][A-Za-zÄÖÜäöü.\-]*){0,2})/);
  if (pm) { plz = pm[1]; ort = pm[2].replace(/[,.]+$/, '').trim(); before = t.slice(0, pm.index).trim(); }
  const extra = stopWords.map(x => String(x).toLowerCase());
  const isStop = w0 => STOP.test(w0) || CAPS.test(w0) || extra.includes(w0.toLowerCase()) || /^\d{1,2}[:.]\d{2}$/.test(w0) || /^\d{1,2}\.\d{1,2}\.?(\d{2,4})?$/.test(w0) || /^[\d+\/ \-()]{6,}$/.test(w0);
  // Komma-Teile vor der PLZ: Straßen-Teil = erster Teil mit Straßen-Wort, sonst erster Teil mit Buchstaben + Hausnummer (keine Einheit wie "WG 1")
  const parts = before.split(',').map(x => x.trim()).filter(Boolean);
  const hasSuffix = p => p.split(' ').some(w => SUFFIX.test(w));
  let ci = parts.findIndex(p => /\d/.test(p) && hasSuffix(p));
  if (ci < 0) ci = parts.findIndex(p => /\d/.test(p) && /[A-Za-zÄÖÜäöü]/.test(p) && !UNIT.test(p));
  if (ci < 0) ci = parts.findIndex(p => hasSuffix(p));
  if (ci >= 0) {
    let w = parts[ci].replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
    while (w.length > 1 && isStop(w[0])) w.shift(); // führende Füllwörter / Kundenkürzel ("Aufmaß", "WAG", "Termin:") weg
    // Hausnummer: letzte Zahl, vor der ein Wort steht (nicht Telefonnummern wie "0664 123456")
    let end = -1;
    for (let i = 1; i < w.length; i++) if (HNR.test(w[i]) && /[A-Za-zÄÖÜäöü]/.test(w[i - 1])) end = i;
    if (end < 0) for (let i = 0; i < w.length; i++) if (SUFFIX.test(w[i])) end = i; // keine Hausnummer: bis zum Straßen-Wort
    // Anfang: letztes Wort mit Straßen-Endung vor der Hausnummer, davor gehörende Wörter ("Untere", "Wiener", "Am")
    let startI = 0;
    if (end > 0) { for (let i = end - 1; i >= 0; i--) if (SUFFIX.test(w[i])) { startI = i; break; } }
    if (startI > 0 && (SUFFIX_ALONE.test(w[startI]) || PREFIX.test(w[startI - 1]))) startI--;
    if (startI > 0 && PREFIX.test(w[startI - 1])) startI--;
    str = (end >= 0 ? w.slice(startI, end + 1) : w.slice(startI)).join(' ');
    str = str.replace(/\s*([\/\-])\s*/g, '$1').replace(/^[\-–:]+|[,;:\-–]+$/g, '').trim();
    // Geschoß / Wohnung aus den folgenden Teilen übernehmen ("Haydnstrasse 8, EG, WG 1")
    const units = []; for (let i = ci + 1; i < parts.length && UNIT.test(parts[i]); i++) units.push(parts[i]);
    if (units.length) str += ', ' + units.join(', ');
  }
  if (!str && !plz) return null;
  return { str, plz, ort };
}
