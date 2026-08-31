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

/** Returns the Unix timestamp for midnight UTC on the day of `ts`. */
function startOfUtcDay(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

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
 * Upsert a daily usage snapshot. Updates today's existing record if present,
 * otherwise inserts a new one.
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
  const now = snapshot.fetchedAt || Date.now();
  const dayStart = startOfUtcDay(now);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const idx = store.index('fetchedAt');

    // Find the latest snapshot from today (fetchedAt >= start of today UTC).
    const range = IDBKeyRange.lowerBound(dayStart);
    const cursorReq = idx.openCursor(range, 'prev');

    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      const fields = {
        fetchedAt: now,
        used: snapshot.used,
        allowance: snapshot.allowance ?? null,
        unitType: snapshot.unitType || 'credit',
        plan: snapshot.plan || 'unknown',
        cycleStart: snapshot.cycleStart || null,
        cycleEnd: snapshot.cycleEnd || snapshot.resetDate || null,
        source: snapshot.source || 'api',
        username: snapshot.username || '',
      };

      if (cursor) {
        // Today's snapshot exists — update it in-place
        const putReq = cursor.update({ ...cursor.value, ...fields });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
        return;
      }
      // No snapshot for today yet — insert
      const addReq = store.add(fields);
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
 * Remove duplicate hourly snapshots, keeping only the latest record per UTC day.
 * Returns the number of records deleted.
 * @returns {Promise<number>}
 */
export async function pruneToLastDailySnapshot() {
  const db = await openDb();

  // Collect all records (id + fetchedAt is enough to decide what to delete)
  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });

  // Group by UTC day; track the id of the latest snapshot per day
  const latestIdByDay = new Map();
  for (const row of all) {
    const day = startOfUtcDay(row.fetchedAt);
    const current = latestIdByDay.get(day);
    if (current === undefined || row.fetchedAt > current.fetchedAt) {
      latestIdByDay.set(day, { id: row.id, fetchedAt: row.fetchedAt });
    }
  }

  const keepIds = new Set([...latestIdByDay.values()].map(v => v.id));
  const toDelete = all.map(r => r.id).filter(id => !keepIds.has(id));

  if (toDelete.length === 0) return 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let pending = toDelete.length;
    for (const id of toDelete) {
      const req = store.delete(id);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { if (--pending === 0) resolve(); };
    }
    tx.onerror = () => reject(tx.error);
  });

  return toDelete.length;
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
