/**
 * Typed wrappers around chrome.storage.local.
 * All reads return null for missing keys rather than undefined.
 */

const STORAGE_KEY = 'copilotUsageMonitor';

/**
 * Read the entire extension state object.
 * @returns {Promise<Object>}
 */
export async function readState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      resolve(result[STORAGE_KEY] || {});
    });
  });
}

/**
 * Write a partial update to the state object (shallow merge).
 * @param {Object} partial
 * @returns {Promise<void>}
 */
export async function updateState(partial) {
  const current = await readState();
  const next = { ...current, ...partial };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: next }, resolve);
  });
}

/**
 * Clear all extension state (e.g. on token removal).
 * @returns {Promise<void>}
 */
export async function clearState() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(STORAGE_KEY, resolve);
  });
}

/**
 * Convenience: read a single key from state.
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function readStateKey(key) {
  const state = await readState();
  return state[key] ?? null;
}
