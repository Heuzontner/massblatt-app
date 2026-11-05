// Bosch GLM 50-27 C (und verwandte "C"-Modelle) über Web Bluetooth (BLE).
// Dienst/Kennung und Startbefehl aus öffentlichen Nachbauten (ketan/bosch-glm50c-rangefinder).
const SVC = '02a6c0d0-0451-4000-b000-fb3210111989';
const CHR = '02a6c0d1-0451-4000-b000-fb3210111989';
const START = new Uint8Array([0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a]);

export class Laser extends EventTarget {
  constructor() { super(); this.device = null; this.chr = null; this.state = 'aus'; this.last = { v: null, t: 0 }; this.log = []; }

  get supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }

  _set(state, msg) { this.state = state; this.dispatchEvent(new CustomEvent('state', { detail: { state, msg } })); }
  _log(s) { this.log.push(new Date().toLocaleTimeString() + ' ' + s); if (this.log.length > 200) this.log.shift(); }

  // gemerkte Laser (Name, ID, zuletzt verbunden)
  get known() { try { return JSON.parse(localStorage.getItem('mb_lasers') || '[]'); } catch (e) { return []; } }
  _remember(d) {
    const list = this.known.filter(x => x.id !== d.id);
    list.unshift({ id: d.id, name: d.name || 'Laser', last: Date.now() });
    try { localStorage.setItem('mb_lasers', JSON.stringify(list.slice(0, 5))); } catch (e) { }
  }
  async connect() {
    if (!this.supported) throw new Error('Dieses Gerät/dieser Browser kann kein Web-Bluetooth. Bitte Chrome auf Android verwenden.');
    this._set('suche');
    // schon bekannter Laser? → ohne Auswahlfenster verbinden (wo der Browser das erlaubt)
    if (navigator.bluetooth.getDevices) {
      try {
        const devs = await navigator.bluetooth.getDevices();
        for (const k of this.known) {
          const d = devs.find(x => x.id === k.id);
          if (!d) continue;
          try {
            this.device = d;
            d.addEventListener('gattserverdisconnected', () => this._onDisconnect());
            await this._open(); return;
          } catch (e) { this._log('bekannter Laser nicht erreichbar: ' + e.message); this.device = null; }
        }
      } catch (e) { }
    }
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'GLM' }, { namePrefix: 'Bosch' }, { services: [SVC] }],
      optionalServices: [SVC],
    });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnect());
    await this._open();
  }

  async _open() {
    this._set('verbinde');
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SVC);
    this.chr = await svc.getCharacteristic(CHR);
    this.chr.addEventListener('characteristicvaluechanged', e => this._onData(e.target.value));
    await this.chr.startNotifications();
    await this._write(START);
    this._log('verbunden: ' + (this.device.name || '?'));
    this._remember(this.device);
    this._set('verbunden', this.device.name || 'Laser');
  }

  async _write(bytes) {
    if (this.chr.writeValueWithResponse) { try { return await this.chr.writeValueWithResponse(bytes); } catch (e) { /* fallback */ } }
    if (this.chr.writeValueWithoutResponse) return await this.chr.writeValueWithoutResponse(bytes);
    return await this.chr.writeValue(bytes);
  }

  async _onDisconnect() {
    this._set('getrennt');
    this._log('getrennt');
    for (let i = 0; i < 5 && this.device; i++) {
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      try { await this._open(); return; } catch (e) { this._log('Neuverbindung fehlgeschlagen: ' + e.message); }
    }
  }

  disconnect() { const d = this.device; this.device = null; if (d && d.gatt.connected) d.gatt.disconnect(); this._set('aus'); }

  _onData(dv) {
    const b = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    this._log('daten ' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(' '));
    if (b.length >= 11 && b[0] === 0xc0 && b[1] === 0x55 && b[2] === 0x10 && b[3] === 0x06) {
      const m = new DataView(b.buffer, b.byteOffset + 7, 4).getFloat32(0, true);
      if (!isFinite(m) || m <= 0 || m > 300) return;
      const now = Date.now();
      // gleiche Meldung doppelt (z. B. nach Neuverbindung) ignorieren
      if (this.last.v === m && now - this.last.t < 1200) return;
      this.last = { v: m, t: now };
      this.dispatchEvent(new CustomEvent('measure', { detail: { meters: m, cm: Math.round(m * 100) } }));
    }
  }
}
