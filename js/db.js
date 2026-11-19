// Stockage local (IndexedDB) : tout reste sur l'appareil, aucun serveur.
const DB_NAME = 'controle-chantier';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: 'id' }); // fichiers des plans (Blob)
        db.createObjectStore('settings', { keyPath: 'key' });
        const plans = db.createObjectStore('plans', { keyPath: 'id' });
        plans.createIndex('projectId', 'projectId');
        const points = db.createObjectStore('points', { keyPath: 'id' });
        points.createIndex('projectId', 'projectId');
        points.createIndex('planId', 'planId');
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('pointId', 'pointId');
        photos.createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const asPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function get(store, key) {
  const db = await open();
  return asPromise(db.transaction(store).objectStore(store).get(key));
}

export async function all(store) {
  const db = await open();
  return asPromise(db.transaction(store).objectStore(store).getAll());
}

export async function byIndex(store, index, value) {
  const db = await open();
  return asPromise(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function countByIndex(store, index, value) {
  const db = await open();
  return asPromise(db.transaction(store).objectStore(store).index(index).count(value));
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return txDone(tx);
}

export async function putMany(store, values) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  return txDone(tx);
}

export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return txDone(tx);
}

export async function delByIndex(store, index, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const keys = await asPromise(os.index(index).getAllKeys(value));
  for (const k of keys) os.delete(k);
  return txDone(tx);
}

export async function getSettings() {
  const s = await get('settings', 'main');
  return { author: '', tol: 10, ...(s ? s.value : {}) };
}

export async function saveSettings(value) {
  return put('settings', { key: 'main', value });
}

// Suppressions en cascade
export async function deletePoint(pointId) {
  await delByIndex('photos', 'pointId', pointId);
  await del('points', pointId);
}

export async function deletePlan(plan) {
  const points = await byIndex('points', 'planId', plan.id);
  for (const p of points) await deletePoint(p.id);
  await del('files', plan.fileId);
  await del('plans', plan.id);
}

export async function deleteProject(projectId) {
  const plans = await byIndex('plans', 'projectId', projectId);
  for (const pl of plans) await deletePlan(pl);
  await delByIndex('points', 'projectId', projectId);
  await delByIndex('photos', 'projectId', projectId);
  await del('projects', projectId);
}

export async function touchProject(projectId) {
  const p = await get('projects', projectId);
  if (p) {
    p.updatedAt = Date.now();
    await put('projects', p);
  }
}
