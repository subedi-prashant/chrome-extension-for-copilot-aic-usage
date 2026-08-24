/**
 * IndexedDB wrapper for persisting usage snapshots across billing cycles.
 *
 * DB name  : copilotUsageHistory
 * Store    : snapshots (auto-increment key)
 * Indexes  : fetchedAt, cycleStart
 */

const DB_NAME = 'copilotUsageHistory';
const DB_VERSION = 1;
const STORE = 'snapshots';

/** One snapshot per hour — dedup window in milliseconds */
const DEDUP_WINDOW_MS = 60 * 60 * 1000;

let _db = null;

/**
 * Open (or reuse) the IndexedDB connection.
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('fetchedAt', 'fetchedAt', { unique: false });
        store.createIndex('cycleStart', 'cycleStart', { unique: false });
      }
    };

    req.onsuccess = (event) => {
      _db = event.target.result;
      // Reset cached reference if the connection closes unexpectedly
      _db.onclose = () => { _db = null; };
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Append a usage snapshot to the store, skipping if a snapshot already exists
 * within DEDUP_WINDOW_MS of the given fetchedAt timestamp.
 *
 * @param {{
 *   fetchedAt: number,
 *   used: number,
 *   allowance: number|null,
 *   unitType: string,
 *   plan: string,
 *   cycleStart: string|null,
 *   cycleEnd: string|null,
 *   source: string,
 *   username: string,
 * }} snapshot
 * @returns {Promise<void>}
 */
export async function appendSnapshot(snapshot) {
  if (snapshot.used === null || snapshot.used === undefined) return;

  const db = await openDb();
  const windowStart = (snapshot.fetchedAt || Date.now()) - DEDUP_WINDOW_MS;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const idx = store.index('fetchedAt');

    // Check for a recent duplicate within the dedup window.
    // Using 'prev' (reverse) order ensures we check the most recent snapshot first.
    // If any snapshot exists within DEDUP_WINDOW_MS of the new timestamp, skip insertion.
    const range = IDBKeyRange.lowerBound(windowStart);
    const cursorReq = idx.openCursor(range, 'prev');

    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        // A snapshot exists within the window — skip
        resolve();
        return;
      }
      // No recent duplicate — insert
      const record = {
        fetchedAt: snapshot.fetchedAt || Date.now(),
        used: snapshot.used,
        allowance: snapshot.allowance ?? null,
        unitType: snapshot.unitType || 'credit',
        plan: snapshot.plan || 'unknown',
        cycleStart: snapshot.cycleStart || null,
        cycleEnd: snapshot.cycleEnd || snapshot.resetDate || null,
        source: snapshot.source || 'api',
        username: snapshot.username || '',
      };
      const addReq = store.add(record);
      addReq.onsuccess = () => resolve();
      addReq.onerror = () => reject(addReq.error);
    };

    cursorReq.onerror = () => reject(cursorReq.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieve snapshots ordered by fetchedAt descending.
 *
 * @param {number} [limit=500] Maximum number of records to return.
 * @returns {Promise<Array>}
 */
export async function getSnapshots(limit = 500) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const idx = store.index('fetchedAt');
    const results = [];

    const req = idx.openCursor(null, 'prev');
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Delete all stored snapshots.
 * @returns {Promise<void>}
 */
export async function clearSnapshots() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}
