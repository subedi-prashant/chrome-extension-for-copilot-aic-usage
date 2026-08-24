import { readState } from '../shared/storage.js';
import { PLAN_LABELS } from '../shared/constants.js';
import { renderHistory, initHistory } from './history.js';

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
  // BUT if we have scrape/page data, show that instead
  if (state.status === 'billing_unavailable') {
    if ((state.source !== 'scrape' && state.source !== 'page') || !state.used) {
      $('state-billing-unavailable').classList.remove('hidden');
      return;
    }
    // Fall through — show ok state with scrape/page data
  }

  // Generic error
  if (state.status === 'error') {
    $('error-message').textContent = state.errorMessage || 'Could not fetch usage data.';
    $('state-error').classList.remove('hidden');
    return;
  }

  // Normal display (status === 'ok' or still loading with cached data)
  $('state-ok').classList.remove('hidden');

  // Show data-source notice
  const scrapeNotice = $('scrape-notice');
  if (state.source === 'scrape') {
    scrapeNotice.textContent = '📋 Data read from your open GitHub tab. Auto-refreshed when you visit github.com/settings/copilot.';
    scrapeNotice.classList.remove('hidden');
  } else if (state.source === 'page') {
    scrapeNotice.textContent = '🔄 Data fetched in background from GitHub settings. Auto-refreshes every 30 min.';
    scrapeNotice.classList.remove('hidden');
  } else {
    scrapeNotice.classList.add('hidden');
  }

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

  if (state.cycleStart && state.resetDate) {
    // Show full cycle range like GitHub does: "August 1-31, 2026"
    const start = new Date(state.cycleStart);
    const end = new Date(state.resetDate);
    const now = new Date();
    const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    const startStr = start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    const endStr = end.toLocaleDateString(undefined, { day: 'numeric', year: 'numeric' });
    $('meta-reset').textContent = startStr + '-' + endStr + ' (' + daysLeft + 'd left)';
  } else if (state.resetDate) {
    const reset = new Date(state.resetDate);
    const now = new Date();
    const daysLeft = Math.ceil((reset - now) / (1000 * 60 * 60 * 24));
    const resetStr = reset.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    $('meta-reset').textContent = resetStr + ' (' + daysLeft + 'd)';
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

  // Auto-re-render when storage changes (e.g. background tab scrape completes)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') render();
  });

  // ── Tab switching ──────────────────────────────────────────────────────────
  const tabUsageBtn = $('tab-usage');
  const tabHistoryBtn = $('tab-history');
  const panelUsage = $('panel-usage');
  const panelHistory = $('panel-history');
  const usageFooter = $('usage-footer');

  function showTab(tab) {
    if (tab === 'history') {
      tabUsageBtn.classList.remove('active');
      tabUsageBtn.setAttribute('aria-selected', 'false');
      tabHistoryBtn.classList.add('active');
      tabHistoryBtn.setAttribute('aria-selected', 'true');
      panelUsage.classList.add('hidden');
      panelHistory.classList.remove('hidden');
      usageFooter.classList.add('hidden');
      // Always re-render history to pick up latest snapshots
      renderHistory();
    } else {
      tabHistoryBtn.classList.remove('active');
      tabHistoryBtn.setAttribute('aria-selected', 'false');
      tabUsageBtn.classList.add('active');
      tabUsageBtn.setAttribute('aria-selected', 'true');
      panelHistory.classList.add('hidden');
      panelUsage.classList.remove('hidden');
      usageFooter.classList.remove('hidden');
    }
  }

  tabUsageBtn.addEventListener('click', () => showTab('usage'));
  tabHistoryBtn.addEventListener('click', () => showTab('history'));

  initHistory();
});
