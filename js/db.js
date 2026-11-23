// Stockage 100 % local : IndexedDB du navigateur, sur ce téléphone uniquement.
const NAME = 'kayit';
const VERSION = 1;
let conn;

function open() {
  if (conn) return Promise.resolve(conn);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => { conn = req.result; resolve(conn); };
    req.onerror = () => reject(req.error);
  });
}

function run(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  all: () => run('items', 'readonly', s => s.getAll()),
  put: item => run('items', 'readwrite', s => s.put(item)),
  putMany: items => run('items', 'readwrite', s => { items.forEach(i => s.put(i)); }),
  del: id => run('items', 'readwrite', s => s.delete(id)),
  get: key => run('meta', 'readonly', s => s.get(key)),
  set: (key, value) => run('meta', 'readwrite', s => s.put(value, key)),
  async wipe() {
    await run('items', 'readwrite', s => s.clear());
    await run('meta', 'readwrite', s => s.clear());
  },
};
