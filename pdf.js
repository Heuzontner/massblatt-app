// Maßblatt-PDF im Aufbau des Bosch "Measuring Master"-Exports.
// Wird im Browser (window.PDFLib / window.fontkit) und im Node-Test verwendet.
// shots: [{ room, jpg: Uint8Array (Foto mit eingebrannten Pfeilen), w, h,
//           values: [{ cm, time: Date }] }]

const BORDER = [0.835, 0.874, 0.910]; // hellblau-grau wie Bosch
const BLUE = [0.165, 0.365, 0.561];
const PAGE_W = 842, PAGE_H = 595;

export function fmtDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
export function fmtDateTime(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function buildPdf(PDFLib, fontkit, fontBytes, project, shots, opts = {}) {
  const { PDFDocument, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setProducer('VIEWPORT 360 Massblatt');
  doc.setTitle('Aufmaß ' + (project.name || ''));
  const font = await doc.embedFont(fontBytes, { subset: true });
  const c = a => rgb(a[0], a[1], a[2]);
  const black = rgb(0, 0, 0);

  // y von oben gemessen (wie im Layout gedacht)
  const box = (page, x, yTop, w, h, lw = 3) => {
    page.drawRectangle({ x: x + lw / 2, y: PAGE_H - yTop - h + lw / 2, width: w - lw, height: h - lw,
      borderColor: c(BORDER), borderWidth: lw, color: rgb(1, 1, 1) });
  };
  const text = (page, s, x, yTop, size, color = black) => {
    page.drawText(String(s), { x, y: PAGE_H - yTop - size * 0.8, size, font, color });
  };
  // Schrift als Vektor-Umrisse zeichnen (steht nicht im Text des PDFs)
  const outline = (page, s, x, yTop, size, color = black) => {
    const fk = font.embedder.font, sc = size / fk.unitsPerEm, run = fk.layout(String(s)); let cx = x;
    run.glyphs.forEach((g, i) => {
      const d = g.path.scale(sc, -sc).toSVG();
      if (d) page.drawSvgPath(d, { x: cx, y: PAGE_H - yTop - size * 0.8, color, borderWidth: 0 });
      cx += (run.positions[i] ? run.positions[i].xAdvance : g.advanceWidth) * sc;
    });
  };
  const fit = (s, size, maxW) => {
    s = String(s || '');
    if (font.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + ' ...', size) > maxW) s = s.slice(0, -1);
    return s.trimEnd() + ' ...';
  };
  const embedImg = async (img) => {
    if (!img) return null;
    try { return img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes); }
    catch (e) { return null; }
  };
  const drawContain = (page, im, x, yTop, w, h, align = 'center') => {
    const s = Math.min(w / im.width, h / im.height);
    const dw = im.width * s, dh = im.height * s;
    const dx = align === 'right' ? x + w - dw : align === 'left' ? x : x + (w - dw) / 2;
    page.drawImage(im, { x: dx, y: PAGE_H - yTop - (h + dh) / 2, width: dw, height: dh });
  };

  // Seitennummern: Deckblatt ohne Nummer, Fotoseiten ab 1
  // Übersicht: je Foto eine Zeile, Höhe × Breite paarweise in Pfeil-Reihenfolge (ohne Tür-/Fenster-Bezeichnung, Manuel 09.11.)
  const ovRows = [];
  if (project.overview && project.overviewRows) {
    for (const r of project.overviewRows) {
      const parts = [];
      const rh = r.items.filter(x => x.el === 'Raumhöhe');
      if (rh.length) parts.push(`Raumhöhe ${rh.map(x => x.cm).join('/')} cm`);
      const its = r.items.filter(x => x.el !== 'Raumhöhe');
      for (let i = 0; i < its.length;) {
        const a = its[i], b = its[i + 1];
        if (b && a.kind !== b.kind) { const h = a.kind === 'H' ? a : b, w = a.kind === 'H' ? b : a; parts.push(`${h.cm} × ${w.cm}`); i += 2; }
        else { parts.push(`${a.kind === 'H' ? 'H' : 'B'} ${a.cm}`); i += 1; }
      }
      ovRows.push([r.room, parts.join('   ·   ') || '–']);
    }
  }
  const OV_ROWS = 24;
  const ovPages = ovRows.length ? Math.ceil(ovRows.length / OV_ROWS) : 0;
  const ovStart = shots.length + 1; // Messliste entfällt (Manuel 05.11.)

  // ---------- Deckblatt ----------
  const p0 = doc.addPage([PAGE_W, PAGE_H]);
  box(p0, 20, 20, 801, 50);
  const headLogo = await embedImg(project.headerLogo);
  { // Kopfzeile: Titel + Projektname (ohne Klammer); lange Namen kleiner, notfalls gekürzt. Das Einlesen wertet nur „Aufmaß : <Raum>“ aus.
    const ht = (project.headerTitle || 'Measuring Master') + (project.name ? ' ' + project.name : ''), maxW = headLogo ? 545 : 770;
    let hs = 14; while (hs > 9 && font.widthOfTextAtSize(ht, hs) > maxW) hs -= 0.5;
    text(p0, fit(ht, hs, maxW), 34, 38 + (14 - hs) / 2, hs, c(BLUE));
  }
  if (headLogo) drawContain(p0, headLogo, 600, 28, 205, 34, 'right');

  box(p0, 20, 95, 801, 160);
  const L = 46, R = 400, top = 117, lh = 17;
  text(p0, 'Projekt: ' + fit(project.name, 13, 300), L, top, 13);
  text(p0, 'Kontakt: ' + (project.kontakt || ''), L, top + lh, 13);
  text(p0, project.firma || '', L, top + 2 * lh, 13);
  text(p0, project.strasse || '', L, top + 3 * lh, 13);
  text(p0, project.ort || '', L, top + 4 * lh, 13);
  text(p0, 'Datum: ' + fmtDate(project.datum ? new Date(project.datum) : new Date()), R, top, 13);
  text(p0, 'Land: ' + (project.land || ''), R, top + lh, 13);
  text(p0, 'Telefon: ' + (project.telefon || ''), R, top + 2 * lh, 13);
  if (project.note) text(p0, 'Notiz: ' + fit(project.note, 10, 200), R, top + 4 * lh, 10, rgb(0.3, 0.3, 0.3));
  const custLogo = await embedImg(project.kundenLogo);
  if (custLogo) drawContain(p0, custLogo, 615, 112, 110, 118);

  box(p0, 20, 279, 801, 280);
  text(p0, 'Inhaltsverzeichnis', 46, 296, 13);
  const uw = font.widthOfTextAtSize('Inhaltsverzeichnis', 13);
  p0.drawLine({ start: { x: 46, y: PAGE_H - 312 }, end: { x: 46 + uw, y: PAGE_H - 312 }, thickness: 0.8, color: black });
  let ty = 318;
  const tl = 11.5, ts = 10.5;
  // bei vielen Fotos: zwei Spalten, bei sehr vielen zusätzlich kleiner
  const tocLines = shots.length + 2;
  const twoCol = tocLines > 20;
  const perCol = twoCol ? Math.ceil(tocLines / 2) : tocLines;
  const tScale = perCol > 20 ? Math.max(0.55, 20 / perCol) : 1;
  const colX = [[46, 82, twoCol ? 400 : 795], [430, 466, 795]];
  let line = 0;
  const tocRow = (label, num, indent) => {
    const col = twoCol && line >= perCol ? 1 : 0;
    const yy = 318 + (line - col * perCol) * tl * tScale;
    text(p0, label, indent ? colX[col][1] : colX[col][0], yy, ts * tScale);
    if (num != null) { const n = String(num); text(p0, n, colX[col][2] - font.widthOfTextAtSize(n, ts * tScale), yy, ts * tScale); }
    line++;
  };
  tocRow('1. Aufmaß', null, false);
  shots.forEach((s, i) => tocRow(`1.${i + 1} ${s.room}`, i + 1, true));
  if (ovPages) tocRow('2. Übersicht', ovStart, false);

  // ---------- Fotoseiten ----------
  const pageNo = (page, n) => {
    const s = String(n);
    text(page, s, 818 - font.widthOfTextAtSize(s, 10), 578, 10);
  };
  const row = (page, x, yTop, cols, cells, size = 7.5, icon = -1, rh = 18) => {
    // cols: [[x, w], ...]
    cols.forEach(([cx, cw], k) => {
      page.drawRectangle({ x: cx + 1, y: PAGE_H - yTop - rh + 1, width: cw - 2, height: rh - 2,
        borderColor: c(BORDER), borderWidth: Math.min(2, rh / 9), color: rgb(1, 1, 1) });
      const pad = k === 0 && icon >= 0 ? 24 : 12;
      text(page, cells[k], cx + pad, yTop + (rh - size * 1.2) / 2 + 0.5, size);
    });
    if (icon >= 0 && rh >= 12) drawIcon(page, cols[0][0] + 10, PAGE_H - yTop - rh + 4, icon);
  };
  const ICON_COLS = [[0.85, 0.2, 0.2], [0.2, 0.55, 0.85], [0.3, 0.65, 0.3], [0.85, 0.55, 0.1]];
  const drawIcon = (page, x, y, i) => {
    page.drawLine({ start: { x, y }, end: { x, y: y + 10 }, thickness: 0.8, color: rgb(0.45, 0.45, 0.45) });
    page.drawLine({ start: { x: x + 3, y }, end: { x: x + 3, y: y + 10 }, thickness: 0.8, color: c(ICON_COLS[i % 4]) });
    page.drawLine({ start: { x: x - 1, y: y + 10 }, end: { x: x + 4, y: y + 10 }, thickness: 0.6, color: rgb(0.45, 0.45, 0.45) });
  };

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const pg = doc.addPage([PAGE_W, PAGE_H]);
    box(pg, 20, 18, 801, 40);
    text(pg, 'Aufmaß :', 32, 32, 11, c(BLUE));
    const rx = 32 + font.widthOfTextAtSize('Aufmaß :', 11) + 6;
    text(pg, s.room, rx, 32, 11);
    { // mehrere Fotos im selben Raum: Zusatz „-2“ als GEZEICHNETE Umrisse hinter dem Namen (kein Text → RBEM/Einlesen sieht nur „Kz1“)
      const same = shots.filter(x => x.room === s.room);
      if (same.length > 1) outline(pg, '-' + (same.indexOf(s) + 1), rx + font.widthOfTextAtSize(String(s.room), 11) + 0.6, 32, 11);
    }
    if (s.jpg) {
      const im = await doc.embedJpg(s.jpg);
      const maxW = 373, maxH = 494;
      const sc = Math.min(maxW / im.width, maxH / im.height);
      pg.drawImage(im, { x: 19, y: PAGE_H - 79 - im.height * sc, width: im.width * sc, height: im.height * sc });
    }
    const cols = [[418, 150], [568, 136], [704, 117]];
    let y = 81;
    const rh = Math.min(18, Math.floor(490 / Math.max(1, s.values.length))); // passt auch bei sehr vielen Werten
    // Rahmen um die Tabelle (Bosch: dicker Außenrand)
    if (s.values.length) {
      pg.drawRectangle({ x: 417, y: PAGE_H - 81 - s.values.length * rh - 2, width: 405, height: s.values.length * rh + 3,
        borderColor: c(BORDER), borderWidth: 2.5 });
    }
    s.values.forEach((v, k) => {
      row(pg, 418, y, cols, [`${v.cm} cm`, 'Länge', fmtDateTime(v.time)], Math.min(7.5, rh * 0.42), k, rh);
      y += rh;
    });
    if (s.note) text(pg, 'Notiz: ' + fit(s.note, 8, 390), 418, Math.max(y + 14, 556), 8, rgb(0.3, 0.3, 0.3));
    pageNo(pg, i + 1);
  }

  for (let m = 0; m < ovPages; m++) {
    const pg = doc.addPage([PAGE_W, PAGE_H]);
    box(pg, 20, 18, 801, 40);
    text(pg, 'Übersicht :', 32, 32, 11, c(BLUE));
    text(pg, project.name || '', 32 + font.widthOfTextAtSize('Übersicht :', 11) + 6, 32, 11);
    text(pg, 'Maße in cm, Höhe × Breite', 600, 34, 8, rgb(0.4, 0.4, 0.4));
    let y = 81;
    for (const [room, txt] of ovRows.slice(m * OV_ROWS, (m + 1) * OV_ROWS)) {
      const cols = [[20, 110], [130, 691]];
      row(pg, 20, y, cols, [room, fit(txt, 8, 670)], 8);
      y += 19;
    }
    pageNo(pg, ovStart + m);
  }
  if (project.footer) {
    for (const pg of doc.getPages()) pg.drawText(fit(project.footer, 7.5, 700), { x: 22, y: 9, size: 7.5, font, color: rgb(0.45, 0.45, 0.45) });
  }
  return await doc.save();
}
