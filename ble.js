// Laser-Entfernungsmesser über Web Bluetooth (BLE) – mehrere Hersteller („Multi-Tool“).
// Jeder Hersteller hat ein Profil: Dienst-UUID, Namensanfänge fürs Auswahlfenster und einen Decoder für die Messwerte.
// Quellen: Bosch – ketan/bosch-glm50c-rangefinder; Leica/Mileseey/Stanley – CaveSurvey (lz1asl, Apache 2.0) und öffentliche Protokollnotizen.
// Getestet ist bisher nur der Bosch-Weg am Gerät; die anderen Profile folgen den öffentlichen Nachbauten und brauchen eine Probe am echten Gerät.
const u16 = n => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const hex = b => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(' ');
const txt = b => { try { return new TextDecoder().decode(b); } catch (e) { return ''; } };

export const PROFILES = [
  {
    id: 'bosch', name: 'Bosch GLM / PLR (C-Modelle)', names: ['GLM', 'Bosch', 'PLR'], svc: '02a6c0d0-0451-4000-b000-fb3210111989',
    hint: 'Bluetooth am GLM einschalten (Taste gedrückt halten bis das Symbol blinkt).',
    async open(svc, L) {
      const chr = await svc.getCharacteristic('02a6c0d1-0451-4000-b000-fb3210111989');
      chr.addEventListener('characteristicvaluechanged', e => {
        const b = L._bytes(e.target.value);
        if (b.length >= 11 && b[0] === 0xc0 && b[1] === 0x55 && b[2] === 0x10 && b[3] === 0x06) L._measure(new DataView(b.buffer, b.byteOffset + 7, 4).getFloat32(0, true));
      });
      await chr.startNotifications();
      await L._write(chr, new Uint8Array([0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a])); // Messwerte automatisch schicken
    },
  },
  {
    id: 'leica', name: 'Leica DISTO (D1, D2, D110, D510, D810, X3, X4, X6)', names: ['DISTO', 'Disto'], svc: '3ab10100-f831-4395-b29d-570977d5bf94',
    hint: 'Am DISTO Bluetooth einschalten; Einheit auf Meter stellen.',
    async open(svc, L) {
      // ältere Generation: 3ab10101 = Distanz (float32, Meter), 3ab10102 = Einheit; neuere (X3/X4): 3ab1010d = Messung, erste 4 Byte float32 Meter.
      // Sicherheitshalber alle meldefähigen Kennungen abonnieren – die Geräte schicken den Wert nur, wenn abonniert ist.
      const chars = await svc.getCharacteristics();
      let unitWarned = false;
      for (const c of chars) {
        const id = c.uuid.slice(4, 8);
        if (id === '0102') { try { const u = (await c.readValue()).getUint16(0, true); L._log('Einheit ' + u); if (u > 3 && !unitWarned) { unitWarned = true; L._warn('DISTO bitte auf Meter stellen'); } } catch (e) { } }
        if (!c.properties.notify && !c.properties.indicate) continue;
        c.addEventListener('characteristicvaluechanged', e => {
          const dv = e.target.value, cid = e.target.uuid.slice(4, 8);
          if ((cid === '0101' || cid === '010d') && dv.byteLength >= 4) L._measure(dv.getFloat32(0, true));
        });
        try { await c.startNotifications(); } catch (e) { L._log('kein Abo ' + id + ': ' + e.message); }
      }
    },
  },
  {
    id: 'mileseey', name: 'Mileseey / Hersch / Suaoki (dTape, P7, T7, M120, LEM50)', names: ['Mileseey', 'MILESEEY', 'M120', 'Laser Distance Meter', 'Suaoki', 'Hersch'], svc: u16(0xffb0),
    hint: 'Am Gerät Bluetooth einschalten, Modus „A“ (schickt jede Messung automatisch); Einheit Meter.',
    async open(svc, L) {
      const chr = await svc.getCharacteristic(u16(0xffb2));
      chr.addEventListener('characteristicvaluechanged', e => {
        const s = txt(L._bytes(e.target.value)).trim(); // z. B. „1.234m“, „3.45ft“
        const m = s.match(/(-?\d+(?:[.,]\d+)?)\s*(m|cm|mm|ft|in)\b/i);
        if (!m) { L._log('unbekannt: ' + s); return; }
        const v = parseFloat(m[1].replace(',', '.')), u = m[2].toLowerCase();
        const f = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 }[u];
        if (u !== 'm') L._warn('Laser bitte auf Meter stellen (kam in ' + u + ')');
        L._measure(v * f);
      });
      await chr.startNotifications();
    },
  },
  {
    id: 'stanley', name: 'Stanley TLM99s', names: ['tlm99s', 'TLM99', 'SUB0001'], svc: u16(0xfff0),
    hint: 'Bluetooth am TLM99s einschalten; Wert kommt nach jeder Messung.',
    async open(svc, L) {
      const chr = await svc.getCharacteristic(u16(0xfff1));
      chr.addEventListener('characteristicvaluechanged', e => {
        let s = txt(L._bytes(e.target.value)).trim().replace(/^\[|\]$/g, '');
        if (!s.startsWith('10010002') || s.length < 12) { L._log('unbekannt: ' + s); return; }
        const v = s.slice(8, 12); const mm = parseInt(v.slice(2, 4) + v.slice(0, 2), 16); // 16 Bit, Bytes vertauscht, Millimeter
        if (isFinite(mm)) L._measure(mm / 1000);
      });
      await chr.startNotifications();
    },
  },
];
const BATTERY = u16(0x180f), BATTERY_LEVEL = u16(0x2a19);

export class Laser extends EventTarget {
  constructor() { super(); this.device = null; this.profile = null; this.state = 'aus'; this.last = { v: null, t: 0 }; this.log = []; this.battery = null; this._abort = null; }

  get supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }

  _set(state, msg) { this.state = state; this.dispatchEvent(new CustomEvent('state', { detail: { state, msg } })); }
  _log(s) { this.log.push(new Date().toLocaleTimeString() + ' ' + s); if (this.log.length > 200) this.log.shift(); }
  _warn(msg) { this._log('Hinweis: ' + msg); this.dispatchEvent(new CustomEvent('hint', { detail: { msg } })); }
  _bytes(dv) { const b = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength); this._log('daten ' + hex(b)); return b; }
  _measure(m) {
    if (!isFinite(m) || m <= 0 || m > 300) return;
    const now = Date.now();
    if (this.last.v === m && now - this.last.t < 1200) return; // gleiche Meldung doppelt (z. B. nach Neuverbindung)
    this.last = { v: m, t: now };
    this.dispatchEvent(new CustomEvent('measure', { detail: { meters: m, cm: Math.round(m * 100) } }));
  }

  // gemerkte Laser (Name, ID, Hersteller-Profil, zuletzt verbunden) – mehrere Geräte, z. B. eigener + Kollege
  get known() { try { return JSON.parse(localStorage.getItem('mb_lasers') || '[]'); } catch (e) { return []; } }
  _remember(d) {
    const list = this.known.filter(x => x.id !== d.id);
    list.unshift({ id: d.id, name: d.name || 'Laser', profile: this.profile ? this.profile.id : null, last: Date.now() });
    try { localStorage.setItem('mb_lasers', JSON.stringify(list.slice(0, 5))); } catch (e) { }
  }
  forget(id) { try { localStorage.setItem('mb_lasers', JSON.stringify(this.known.filter(x => x.id !== id))); } catch (e) { } }

  // Auswahlfenster: alle bekannten Hersteller
  async connect() {
    if (!this.supported) throw new Error('Dieses Gerät/dieser Browser kann kein Web-Bluetooth. Bitte Chrome auf Android verwenden.');
    this._set('suche');
    if (await this._tryKnown()) return;
    this.device = await navigator.bluetooth.requestDevice({
      filters: [...PROFILES.flatMap(p => p.names.map(n => ({ namePrefix: n }))), ...PROFILES.map(p => ({ services: [p.svc] }))],
      optionalServices: [...PROFILES.map(p => p.svc), BATTERY],
    });
    this._attach(this.device);
    await this._open();
  }
  // bestimmten gemerkten Laser verbinden (⚙ Liste)
  async connectKnown(id) {
    this._set('suche');
    if (!(await this._tryKnown(id))) { this._set('aus'); throw new Error('Gemerkter Laser nicht erreichbar – einschalten und nochmal, oder neu auswählen'); }
  }
  async _tryKnown(onlyId = null) {
    if (!navigator.bluetooth.getDevices) return false;
    try {
      const devs = await navigator.bluetooth.getDevices();
      for (const k of this.known) {
        if (onlyId && k.id !== onlyId) continue;
        const d = devs.find(x => x.id === k.id); if (!d) continue;
        try { this.device = d; this._attach(d); await this._open(); return true; }
        catch (e) { this._log('bekannter Laser nicht erreichbar: ' + e.message); this.device = null; }
      }
    } catch (e) { }
    return false;
  }
  // beim App-Start ohne Antippen: auf Funksignale der gemerkten Laser warten (Chrome/Android), dann verbinden
  async autoConnect(timeoutMs = 25000) {
    if (!this.supported || !navigator.bluetooth.getDevices || !this.known.length || this.device) return false;
    let devs = []; try { devs = await navigator.bluetooth.getDevices(); } catch (e) { return false; }
    const mine = this.known.map(k => devs.find(x => x.id === k.id)).filter(Boolean);
    if (!mine.length) return false;
    if (await this._tryKnown()) return true; // direkt erreichbar
    if (!mine[0].watchAdvertisements) return false;
    this._abort = new AbortController();
    const done = new Promise(res => {
      const t = setTimeout(() => { this._abort.abort(); res(false); }, timeoutMs);
      for (const d of mine) {
        d.addEventListener('advertisementreceived', async () => {
          if (this.device) return; clearTimeout(t); this._abort.abort();
          try { this.device = d; this._attach(d); await this._open(); res(true); } catch (e) { this._log('Auto-Verbindung: ' + e.message); this.device = null; res(false); }
        }, { once: true });
        d.watchAdvertisements({ signal: this._abort.signal }).catch(e => this._log('watch: ' + e.message));
      }
    });
    return done;
  }
  _attach(d) { if (d._mbAttached) return; d._mbAttached = true; d.addEventListener('gattserverdisconnected', () => { if (this.device === d) this._onDisconnect(); }); }

  async _open() {
    this._set('verbinde');
    const server = await this.device.gatt.connect();
    // Hersteller am Dienst erkennen
    this.profile = null;
    for (const p of PROFILES) {
      let svc = null; try { svc = await server.getPrimaryService(p.svc); } catch (e) { }
      if (svc) { await p.open(svc, this); this.profile = p; break; }
    }
    if (!this.profile) { try { this.device.gatt.disconnect(); } catch (e) { } throw new Error(`„${this.device.name || 'Gerät'}“ ist kein bekannter Laser (unterstützt: ${PROFILES.map(p => p.name.split(' (')[0]).join(', ')})`); }
    this._remember(this.device);
    this._log('verbunden: ' + (this.device.name || '?') + ' (' + this.profile.name + ')');
    this._set('verbunden', this.device.name || 'Laser');
    this._battery(server).catch(() => { });
  }
  // Akkustand (Standard-Dienst, wenn das Gerät ihn hat)
  async _battery(server) {
    this.battery = null;
    const svc = await server.getPrimaryService(BATTERY);
    const c = await svc.getCharacteristic(BATTERY_LEVEL);
    const v = await c.readValue(); this.battery = v.getUint8(0); this._log('Akku ' + this.battery + ' %');
    this.dispatchEvent(new CustomEvent('battery', { detail: { level: this.battery } }));
    try { c.addEventListener('characteristicvaluechanged', e => { this.battery = e.target.value.getUint8(0); this.dispatchEvent(new CustomEvent('battery', { detail: { level: this.battery } })); }); await c.startNotifications(); } catch (e) { }
  }

  async _write(chr, bytes) {
    if (chr.writeValueWithResponse) { try { return await chr.writeValueWithResponse(bytes); } catch (e) { /* fallback */ } }
    if (chr.writeValueWithoutResponse) return await chr.writeValueWithoutResponse(bytes);
    return await chr.writeValue(bytes);
  }

  async _onDisconnect() {
    this._set('getrennt');
    this._log('getrennt');
    for (let i = 0; i < 5 && this.device; i++) {
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      if (!this.device) return;
      try { await this._open(); return; } catch (e) { this._log('Neuverbindung fehlgeschlagen: ' + e.message); }
    }
    if (this.device) { this.device = null; this._set('aus'); }
  }

  // Lernmodus: beliebiges BLE-Gerät verbinden, alle meldenden Kennungen abonnieren, Rohdaten protokollieren (für neue Hersteller)
  async learn() {
    const cand = [...PROFILES.map(p => p.svc), BATTERY, u16(0x180a)];
    for (let n = 0xff00; n <= 0xffff; n += 0x10) cand.push(u16(n)); // häufige Hersteller-Dienste 0xFFx0
    for (const n of [0xffe1, 0xffe4, 0xffe5, 0xfff1, 0xfff2, 0xffb1, 0xffb2, 0xfe59, 0xfee7]) cand.push(u16(n));
    const d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [...new Set(cand)] });
    this._log('LERNMODUS ' + (d.name || '?') + ' ' + d.id);
    const server = await d.gatt.connect();
    const svcs = await server.getPrimaryServices();
    let subs = 0;
    for (const sv of svcs) {
      this._log('Dienst ' + sv.uuid);
      let chars = []; try { chars = await sv.getCharacteristics(); } catch (e) { continue; }
      for (const ch of chars) {
        const pr = Object.entries(ch.properties).filter(([, v]) => v).map(([k]) => k).join(',');
        this._log('  Kennung ' + ch.uuid + ' [' + pr + ']');
        if (ch.properties.read) { try { const v = await ch.readValue(); const b = new Uint8Array(v.buffer); this._log('    gelesen ' + hex(b) + ' „' + txt(b).replace(/[^\x20-\x7e]/g, '.') + '“'); } catch (e) { } }
        if (ch.properties.notify || ch.properties.indicate) {
          ch.addEventListener('characteristicvaluechanged', e => { const b = new Uint8Array(e.target.value.buffer); this._log('MELDUNG ' + e.target.uuid + ' ' + hex(b) + ' „' + txt(b).replace(/[^\x20-\x7e]/g, '.') + '“'); });
          try { await ch.startNotifications(); subs++; } catch (e) { this._log('    kein Abo: ' + e.message); }
        }
      }
    }
    this._learnDev = d;
    return svcs.length ? `Lernmodus: ${svcs.length} Dienste, ${subs} Meldungen abonniert – jetzt messen, dann Fehlerbericht schicken` : 'Lernmodus: der Browser gibt keinen Dienst dieses Geräts frei – bitte mit „nRF Connect“ die Dienste-Liste fotografieren';
  }
  disconnect() { if (this._learnDev) { try { this._learnDev.gatt.disconnect(); } catch (e) { } this._learnDev = null; } const d = this.device; this.device = null; this.profile = null; this.battery = null; if (this._abort) this._abort.abort(); if (d && d.gatt.connected) d.gatt.disconnect(); this._set('aus'); }
}
