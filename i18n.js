// Oberfläche auf Englisch (3.9). Das PDF bleibt deutsch. Deutsche Texte bleiben die Quelle;
// hier werden sichtbare Texte nachträglich ersetzt – was nicht in der Liste steht, bleibt deutsch.
const D = {
  'Projekt': 'Project', 'Projektdaten': 'Project data', '+ Neues Projekt': '+ New project', 'Sortieren:': 'Sort:', 'Zuletzt': 'Recent', 'Datum': 'Date', 'Straße': 'Street', 'Kunde': 'Customer',
  '📦 Archiv': '📦 Archive', '🗑 Papierkorb': '🗑 Bin', '☑ Auswählen': '☑ Select', '📅 Heute': '📅 Today', '📅 Termine': '📅 Appointments', 'Später': 'Later', 'Jetzt sichern': 'Back up now',
  '🔒 Gesperrt': '🔒 Locked', 'Entsperren': 'Unlock', 'Straße + Hausnummer (+ Geschoß, WG)': 'Street + number (+ floor, flat)', 'PLZ': 'Postcode', 'Ort': 'Town', 'Notiz': 'Note',
  'Kundendaten fürs Deckblatt': 'Customer data for the cover page', 'Firma': 'Company', 'Straße + Hausnummer': 'Street + number', 'PLZ Ort': 'Postcode, town', 'Land': 'Country', 'Kontakt': 'Contact', 'Telefon': 'Phone',
  'Exportieren': 'Export', 'Duplizieren': 'Duplicate', 'Archivieren': 'Archive', '📌 Anheften': '📌 Pin', 'Projekt löschen': 'Delete project', '📷 Foto': '📷 Photo', '‹ Fertig': '‹ Done',
  'Laser verbinden': 'Connect laser', 'Raum': 'Room', 'Blitz': 'Flash', 'aus': 'off', 'an': 'on', 'Welcher Raum?': 'Which room?', '✓ Wohnung fertig': '✓ Flat finished',
  '3 Sekunden halten → PDF in die Dropbox, neues Projekt': 'Hold 3 seconds → PDF to Dropbox, new project', 'Galerie': 'Gallery', 'HDR: ruhig halten …': 'HDR: hold still …',
  'Die Kamera-Vorschau ist hier nicht verfügbar.': 'Camera preview is not available here.', '📷 Handy-Kamera öffnen': '📷 Open phone camera', '+ Pfeil': '+ Arrow', '✓ Fertig': '✓ Done',
  'Ausgewählter Pfeil': 'Selected arrow', '+ Pfeil dazu': '+ Add arrow', 'Höhe ⇄ Breite': 'Height ⇄ width', 'Maß löschen': 'Clear value', 'Pfeil löschen': 'Delete arrow', 'Foto': 'Photo',
  'Raum ändern': 'Change room', '▲ nach vorne': '▲ move up', '▼ nach hinten': '▼ move down', 'Foto löschen': 'Delete photo', 'Schließen': 'Close', 'Raum wählen': 'Choose room',
  'Neuer Kunde': 'New customer', '+ Neuer Kunde': '+ New customer', 'Löschen': 'Delete', 'Abbrechen': 'Cancel', 'Speichern': 'Save', 'Kunden': 'Customers', 'Normal': 'Normal', 'Groß': 'Large', 'Sehr groß': 'Very large',
  'Schriftgröße der App': 'App text size', 'Handschuh-Modus (alle Knöpfe extra groß)': 'Glove mode (extra large buttons)', 'Maße in der App anzeigen in': 'Show measurements in',
  'Das PDF bleibt in cm wie bei Bosch.': 'The PDF stays in cm, like Bosch.', 'Raum-Knöpfe': 'Room buttons', '＋ Raum hinzufügen': '＋ Add room', 'Standard-Räume': 'Default rooms',
  'Aufräumen': 'Clean up', 'Pfeile im Foto': 'Arrows in the photo', 'Größe der Maßzahlen im Foto': 'Size of the numbers in the photo', 'klein': 'small', 'mittel': 'medium', 'groß': 'large',
  'Kamera': 'Camera', 'Pfeile im neuen Foto': 'Arrows in a new photo', 'Keine Pfeile – selbst ziehen': 'No arrows – draw them yourself', 'Zwei Pfeile vorgeben (Höhe + Breite)': 'Start with two arrows (height + width)',
  'Sicherung': 'Backup', '💾 Gesamt-Sicherung erstellen': '💾 Create full backup', '♻ Sicherung einspielen': '♻ Restore backup', 'Speicher': 'Storage', 'Einführung': 'Introduction',
  '▶ Kurze Demo ansehen': '▶ Watch short demo', '🎓 Übungsprojekt mit Anleitung starten': '🎓 Start guided practice project', 'Das PDF bleibt immer deutsch.': 'The PDF always stays German.',
  '🔒 Einstellungen mit PIN schützen': '🔒 Protect settings with PIN', '🔓 Schutz der Einstellungen aufheben': '🔓 Remove settings protection', 'Updates': 'Updates', '📋 Was ist neu in dieser Version': '📋 What is new in this version',
  'PIN eingeben': 'Enter PIN', '‹ Zurück': '‹ Back', 'Weiter ›': 'Next ›', 'Vorschau': 'Preview', 'Los geht’s ✓': 'Let’s go ✓', 'Einstellungen': 'Settings', 'Foto & Pfeile': 'Photo & arrows',
  'Dropbox trennen': 'Disconnect Dropbox', 'Laser trennen': 'Disconnect laser', 'Verlauf': 'History', 'Mehr': 'More', 'Erweitert': 'Advanced', 'Höhe': 'Height', 'Breite': 'Width',
  'Tablet im Querformat verwenden': 'Use tablet in landscape', 'Bei Google anmelden': 'Sign in with Google', 'Abmelden': 'Sign out', 'Importieren': 'Import', 'Fehlerbericht': 'Error report',
  'Foto neu aufnehmen?': 'Retake photo?', 'Neu aufnehmen': 'Retake', 'Behalten': 'Keep', 'Hochgeladen ✓': 'Uploaded ✓', 'Kein Netz – wird später hochgeladen': 'Offline – will upload later',
};
const PH = { 'Notiz zum Projekt …': 'Project note …', '🔍 Suchen (Straße, Kunde)': '🔍 Search (street, customer)', 'Raumname, z. B. Kinderzimmer 3': 'Room name, e.g. Bedroom 3', 'Kürzel, z. B. Kz3': 'Short code, e.g. Kz3' };
let on = false, obs = null;
const tr = s => { const k = s.trim(); const v = D[k]; return v == null ? null : s.replace(k, v); };
function walk(n) {
  if (n.nodeType === 3) { const v = tr(n.nodeValue); if (v != null) n.nodeValue = v; return; }
  if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEXTAREA|INPUT|CANVAS)$/.test(n.tagName)) { if (n.nodeType === 1 && n.placeholder && PH[n.placeholder]) n.placeholder = PH[n.placeholder]; return; }
  for (const c of n.childNodes) walk(c);
}
export const lang = () => { try { return localStorage.getItem('mb_lang') || 'de'; } catch (e) { return 'de'; } };
export function setLang(l) { try { localStorage.setItem('mb_lang', l); } catch (e) { } location.reload(); }
export function initLang() {
  if (lang() !== 'en' || on) return; on = true; document.documentElement.lang = 'en';
  walk(document.body);
  obs = new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') walk(m.target); else m.addedNodes.forEach(walk); } });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
}
export const t = s => (lang() === 'en' && D[s]) || s;
