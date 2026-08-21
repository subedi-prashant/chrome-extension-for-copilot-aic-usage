import { readState } from '../shared/storage.js';
import { PLAN_LABELS } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);

async function render() {
  const state = await readState();

  // Hide all states first
  ['state-no-token', 'state-auth-error', 'state-billing-unavailable', 'state-error', 'state-ok'].forEach((id) => {
    $(id).classList.add('hidden');
  });

  // No token stored
  if (!state.pat) {
    $('state-no-token').classList.remove('hidden');
    return;
  }

  // Auth error (401 / 403)
  if (state.status === 'auth_error') {
    $('state-auth-error').classList.remove('hidden');
    return;
  }

  // Billing API unavailable (enhanced billing platform / not org admin)
  if (state.status === 'billing_unavailable') {
    $('state-billing-unavailable').classList.remove('hidden');
    return;
  }

  // Generic error
  if (state.status === 'error') {
    $('error-message').textContent = state.errorMessage || 'Could not fetch usage data.';
    $('state-error').classList.remove('hidden');
    return;
  }

  // Normal display (status === 'ok' or still loading with cached data)
  $('state-ok').classList.remove('hidden');

  const used = state.used ?? 0;
  const allowance = state.allowance;           // null = unlimited
  const unitType = state.unitType || 'request';
  const isCredits = unitType === 'credit';
  const isUnlimited = allowance === null || allowance === undefined;

  // Update the section label
  $('usage-label').textContent = isCredits ? 'AI Credits Used This Cycle' : 'Premium Requests Used';

  $('usage-used').textContent = used.toLocaleString();

  if (isUnlimited) {
    // No cap — hide the "/ allowance" and progress bar, show a note instead
    $('usage-sep').classList.add('hidden');
    $('usage-allowance').classList.add('hidden');
    $('progress-track').classList.add('hidden');
    $('usage-pct').textContent = isCredits ? 'No monthly limit set' : 'Unlimited';
  } else {
    $('usage-sep').classList.remove('hidden');
    $('usage-allowance').classList.remove('hidden');
    $('progress-track').classList.remove('hidden');

    const pct = allowance > 0 ? Math.min(1, used / allowance) : 0;
    const pctDisplay = Math.round(pct * 100);

    $('usage-allowance').textContent = allowance.toLocaleString();
    $('usage-pct').textContent = `${pctDisplay}% used`;

    const fill = $('progress-fill');
    fill.style.width = `${pctDisplay}%`;
    fill.classList.remove('warn', 'high', 'max');
    if (pct >= 1.0)      fill.classList.add('max');
    else if (pct >= 0.8) fill.classList.add('high');
    else if (pct >= 0.5) fill.classList.add('warn');

    $('progress-track').setAttribute('aria-valuenow', pctDisplay);
  }

  $('meta-plan').textContent = PLAN_LABELS[state.plan] || 'Unknown Plan';

  if (state.resetDate) {
    const reset = new Date(state.resetDate);
    const now = new Date();
    const daysLeft = Math.ceil((reset - now) / (1000 * 60 * 60 * 24));
    const resetStr = reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    $('meta-reset').textContent = `${resetStr} (${daysLeft}d)`;
  } else {
    $('meta-reset').textContent = '–';
  }

  if (state.fetchedAt) {
    const age = Math.round((Date.now() - state.fetchedAt) / 60000);
    $('meta-updated').textContent = age < 1 ? 'just now' : `${age} min ago`;
  } else {
    $('meta-updated').textContent = '–';
  }

  // Org-managed warning: ok status but zero usage items and zero used, and no org configured
  const orgWarning = $('org-managed-warning');
  if (state.status === 'ok' && used === 0 && (!state.usageItems || state.usageItems.length === 0) && !state.org) {
    orgWarning.classList.remove('hidden');
  } else {
    orgWarning.classList.add('hidden');
  }
}

// ── Refresh button ───────────────────────────────────────────────────────────

async function triggerRefresh() {
  const btn = $('btn-refresh');
  btn.textContent = '…';
  btn.disabled = true;

  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FORCE_FETCH' }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response?.success) resolve();
        else reject(new Error(response?.error || 'Unknown error'));
      });
    });
  } catch {
    // Silently continue — render() will show the error state
  }

  btn.textContent = '↻ Refresh';
  btn.disabled = false;
  await render();
}

// ── Wire up buttons ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await render();

  $('btn-refresh').addEventListener('click', triggerRefresh);
  $('btn-refresh-error').addEventListener('click', triggerRefresh);
  $('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-open-options-no-token').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-open-options-auth-error').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Link in org-managed warning banner
  const orgLink = $('org-settings-link');
  if (orgLink) orgLink.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
});
