// Kleine IndexedDB-Hülle: Projekte, Fotos (mit Pfeilen), Einstellungen. Alles bleibt am Handy.
const DB = 'massblatt', VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('projects', { keyPath: 'id' });
      const s = d.createObjectStore('shots', { keyPath: 'id' });
      s.createIndex('project', 'projectId');
      d.createObjectStore('settings');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const st = t.objectStore(store);
    let out;
    const r = fn(st);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
}

export const db = {
  put: (store, v, key) => tx(store, 'readwrite', s => s.put(v, key)),
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  shotsOf: async (pid) => {
    const d = await open();
    return new Promise((res, rej) => {
      const r = d.transaction('shots').objectStore('shots').index('project').getAll(pid);
      r.onsuccess = () => res(r.result.sort((a, b) => a.order - b.order));
      r.onerror = () => rej(r.error);
    });
  },
  setting: async (k, v) => v === undefined ? tx('settings', 'readonly', s => s.get(k)) : tx('settings', 'readwrite', s => s.put(v, k)),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
