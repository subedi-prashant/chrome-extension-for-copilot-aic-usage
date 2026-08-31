import { readState, updateState, clearState } from '../shared/storage.js';
import { getAuthenticatedUser } from '../shared/api.js';
import { DEFAULT_POLL_INTERVAL_MINUTES } from '../shared/constants.js';
import { pruneToLastDailySnapshot } from '../shared/db.js';

const $ = (id) => document.getElementById(id);

// ── Load saved settings into form ────────────────────────────────────────────

async function loadSettings() {
  const state = await readState();

  if (state.pat) {
    $('pat-input').value = state.pat;
    if (state.username) {
      showStatus('ok', `✓ Authenticated as ${state.username}`);
    }
  }

  if (state.org) {
    $('org-input').value = state.org;
  }

  if (state.planOverride) {
    $('plan-select').value = state.planOverride;
  }

  const interval = state.pollIntervalMinutes || DEFAULT_POLL_INTERVAL_MINUTES;
  $('interval-select').value = String(interval);
}

// ── Connection status UI ──────────────────────────────────────────────────────

function showStatus(type, message) {
  const el = $('connection-status');
  el.className = `connection-status status-${type}`;
  el.textContent = message;
}

// ── Test Connection ───────────────────────────────────────────────────────────

async function testConnection() {
  const pat = $('pat-input').value.trim();
  if (!pat) {
    showStatus('error', '✗ Please enter a token first.');
    return;
  }

  const btn = $('btn-test');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  showStatus('loading', 'Connecting to GitHub…');
  $('pat-input').classList.remove('error', 'success');

  try {
    const user = await getAuthenticatedUser(pat);
    showStatus('ok', `✓ Authenticated as ${user.login}`);
    $('pat-input').classList.add('success');
    // Pre-save username so the service worker can use it
    await updateState({ username: user.login });
  } catch (err) {
    const msg = err.status === 401
      ? '✗ Invalid token — check your PAT and scopes.'
      : `✗ Error: ${err.message}`;
    showStatus('error', msg);
    $('pat-input').classList.add('error');
  }

  btn.disabled = false;
  btn.textContent = 'Test Connection';
}

// ── Save Settings ─────────────────────────────────────────────────────────────

async function saveSettings() {
  const pat = $('pat-input').value.trim();
  const org = $('org-input').value.trim() || null;
  const planOverride = $('plan-select').value || null;
  const pollIntervalMinutes = parseInt($('interval-select').value, 10);

  const updates = {
    pat: pat || null,
    org,
    planOverride,
    pollIntervalMinutes,
    // Clear cached usage when token changes so stale data isn't shown
    ...(pat ? {} : { status: 'idle', used: null, allowance: null, username: null }),
  };

  await updateState(updates);

  // Notify service worker to re-register alarm with new interval
  chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' });

  // If we have a PAT, trigger an immediate fetch
  if (pat) {
    chrome.runtime.sendMessage({ type: 'FORCE_FETCH' });
  }

  // Show save confirmation
  const feedback = $('save-feedback');
  feedback.classList.remove('hidden');
  setTimeout(() => feedback.classList.add('hidden'), 2500);
}

// ── Clear Token ───────────────────────────────────────────────────────────────

async function clearToken() {
  if (!confirm('Remove the saved token and clear all cached data?')) return;
  await clearState();
  $('pat-input').value = '';
  $('pat-input').classList.remove('error', 'success');
  $('plan-select').value = '';
  $('interval-select').value = String(DEFAULT_POLL_INTERVAL_MINUTES);
  showStatus('', '');
  chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' });
}

// ── Toggle token visibility ───────────────────────────────────────────────────

function toggleTokenVisibility() {
  const input = $('pat-input');
  const btn = $('btn-show-token');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

// ── Prune duplicate snapshots ─────────────────────────────────────────────────

async function pruneSnapshots() {
  const btn = $('btn-prune');
  const feedback = $('prune-feedback');
  btn.disabled = true;
  btn.textContent = 'Cleaning…';
  try {
    const deleted = await pruneToLastDailySnapshot();
    feedback.textContent = deleted > 0 ? `✓ Removed ${deleted} old snapshot(s)` : '✓ Nothing to clean up';
    feedback.classList.remove('hidden');
    setTimeout(() => feedback.classList.add('hidden'), 3000);
  } catch (err) {
    feedback.textContent = `✗ Error: ${err.message}`;
    feedback.classList.remove('hidden');
  }
  btn.disabled = false;
  btn.textContent = 'Clean Up Old Snapshots';
}

// ── Wire up ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();

  $('btn-test').addEventListener('click', testConnection);
  $('btn-save').addEventListener('click', saveSettings);
  $('btn-clear-token').addEventListener('click', clearToken);
  $('btn-show-token').addEventListener('click', toggleTokenVisibility);
  $('btn-prune').addEventListener('click', pruneSnapshots);
});
