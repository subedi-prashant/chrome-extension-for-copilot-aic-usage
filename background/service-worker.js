import { readState, updateState } from '../shared/storage.js';
import {
  getAuthenticatedUser, getCopilotPlan, getUserCopilotUsage,
  getPremiumRequestUsage, getAiCreditUsage, getGeneralUsageFallback,
  getOrgAiCreditUsage, getOrgPremiumRequestUsage,
  scrapeSettingsPageViaFetch,
} from '../shared/api.js';
import {
  ALARM_NAME,
  DEFAULT_POLL_INTERVAL_MINUTES,
  BADGE_COLORS,
  PLAN_ALLOWANCES,
} from '../shared/constants.js';

// ── Alarm registration ──────────────────────────────────────────────────────

async function registerAlarm() {
  const state = await readState();
  const periodInMinutes = state.pollIntervalMinutes || DEFAULT_POLL_INTERVAL_MINUTES;

  // Remove existing alarm before re-creating to handle interval changes
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: periodInMinutes, periodInMinutes });
}

chrome.runtime.onInstalled.addListener(async () => {
  await registerAlarm();
  await fetchAndCache(); // fetch immediately on install
});

chrome.runtime.onStartup.addListener(async () => {
  await registerAlarm();
});

// ── Alarm handler ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await fetchAndCache();
  }
});

// ── Auto-tab tracking (module-level, survives within one SW instance) ────────
var _autoTabId = null;

// ── Message handler (from popup / options / content script) ─────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FORCE_FETCH') {
    fetchAndCache()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'SETTINGS_CHANGED') {
    registerAlarm()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'SCRAPE_RESULT') {
    var d = message.data;
    if (d && d.used !== null && d.used !== undefined) {
      var tabId = _sender && _sender.tab ? _sender.tab.id : null;

      updateState({
        status: 'ok',
        used: d.used,
        unitType: d.unitType || 'credit',
        allowance: d.allowance || null,
        cycleStart: d.cycleStart || null,
        resetDate: d.cycleEnd || null,
        fetchedAt: d.scrapedAt || Date.now(),
        source: 'scrape',
        errorMessage: null,
      }).then(function() {
        return updateBadge({ status: 'ok', used: d.used, allowance: d.allowance || null });
      }).then(function() {
        // Close the auto-opened background tab if this result came from it
        if (tabId !== null && tabId === _autoTabId) {
          _autoTabId = null;
          chrome.tabs.remove(tabId).catch(function() {});
        }
      }).catch(function() {});
    }
    sendResponse({ received: true });
    return false;
  }
});

// ── Core fetch logic ────────────────────────────────────────────────────────

export async function fetchAndCache() {
  const state = await readState();
  const pat = state.pat;

  if (!pat) {
    await updateBadge({ status: 'idle' });
    return;
  }

  try {
    // Resolve username if not cached
    let username = state.username;
    if (!username) {
      const user = await getAuthenticatedUser(pat);
      username = user.login;
      await updateState({ username });
    }

    // Determine plan — use stored plan if user manually selected one
    let plan = state.planOverride || null;
    if (!plan) {
      const copilotData = await getCopilotPlan(pat, username);
      plan = normalizePlan(copilotData?.plan?.name || copilotData?.sku_type || '');
    }

    // Current billing month
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const org = state.org || null;
    let usageResult;

    // ── Step 0: Fetch the settings page HTML directly (works for all plan types
    //   including org-managed users). Falls back to billing API cascade if it fails.
    try {
      var pageResult = await scrapeSettingsPageViaFetch(pat);
      if (pageResult && pageResult.used !== null && pageResult.used !== undefined) {
        usageResult = {
          totalUsed: pageResult.used,
          usageItems: [],
          unitType: pageResult.unitType || 'credit',
          allowance: pageResult.allowance || null,
          cycleStart: pageResult.cycleStart,
          cycleEnd: pageResult.cycleEnd,
          source: 'page',
        };
      }
    } catch (e0) {
      if (e0.status === 401 || e0.status === 403) throw e0;
      // Page fetch failed — continue to API cascade
    }

    // ── Step 1: Undocumented personal usage API (if Step 0 got nothing)
    if (!usageResult) {
      try {
        const personal = await getUserCopilotUsage(pat);
        usageResult = {
          totalUsed: personal.totalUsed,
          usageItems: [],
          unitType: 'credit',
          cycleStart: personal.cycleStart,
          cycleEnd: personal.cycleEnd,
          source: 'api',
        };
      } catch (e1) {
        if (e1.status === 401 || e1.status === 403) throw e1;
        // 404 → fall through
      }
    }

    // ── Step 2: Billing API cascade (if still nothing)
    if (!usageResult) {
      if (org) {
        try {
          usageResult = await getOrgAiCreditUsage(pat, org, username, year, month);
        } catch (e1) {
          if (e1.status !== 404) throw e1;
          try {
            usageResult = await getOrgPremiumRequestUsage(pat, org, username, year, month);
          } catch (e2) {
            if (e2.status !== 404) throw e2;
            var billingErr = new Error('BILLING_UNAVAILABLE');
            billingErr.status = 404;
            billingErr.isBillingUnavailable = true;
            throw billingErr;
          }
        }
      } else {
        try {
          usageResult = await getPremiumRequestUsage(pat, username, year, month);
        } catch (e1) {
          if (e1.status !== 404) throw e1;
          try {
            usageResult = await getAiCreditUsage(pat, username, year, month);
          } catch (e2) {
            if (e2.status !== 404) throw e2;
            try {
              usageResult = await getGeneralUsageFallback(pat, username, year, month);
            } catch (e3) {
              if (e3.status !== 404) throw e3;
              var billingErr2 = new Error('BILLING_UNAVAILABLE');
              billingErr2.status = 404;
              billingErr2.isBillingUnavailable = true;
              throw billingErr2;
            }
          }
        }
        if (usageResult && usageResult.unitType === 'request' && usageResult.totalUsed === 0 && (!usageResult.usageItems || usageResult.usageItems.length === 0)) {
          try {
            var aiResult = await getAiCreditUsage(pat, username, year, month);
            if (aiResult.totalUsed > 0) usageResult = aiResult;
          } catch (e) { /* ignore */ }
        }
      }
    }

    // allowance: null means unlimited / no cap set
    const allowance = usageResult.unitType === 'credit'
      ? null
      : (PLAN_ALLOWANCES[plan] || PLAN_ALLOWANCES.unknown);

    // Use real cycle end date from API if available, otherwise approximate
    var resetDate;
    if (usageResult.cycleEnd) {
      resetDate = new Date(usageResult.cycleEnd);
    } else {
      resetDate = getResetDate(now);
    }

    // Use real cycle start if available
    var cycleStart = usageResult.cycleStart || null;

    const cachePayload = {
      status: 'ok',
      username,
      plan,
      used: usageResult.totalUsed,
      allowance,
      unitType: usageResult.unitType,
      usageItems: usageResult.usageItems || [],
      source: usageResult.source || 'api',
      fetchedAt: Date.now(),
      year,
      month,
      resetDate: resetDate.toISOString(),
      cycleStart: cycleStart,
      errorMessage: null,
    };

    await updateState(cachePayload);
    await updateBadge(cachePayload);
  } catch (err) {
    var status = 'error';
    if (err.status === 401 || err.status === 403) status = 'auth_error';
    else if (err.isBillingUnavailable) {
      // Billing APIs unavailable — try opening the settings page in background
      // so the content script can scrape it silently.
      status = 'billing_unavailable';
      openBackgroundTab();
    }
    const errorPayload = {
      status: status,
      errorMessage: err.message,
      fetchedAt: Date.now(),
    };
    await updateState(errorPayload);
    await updateBadge(errorPayload);
  }
}

// ── Background tab helper ────────────────────────────────────────────────────
// Opens github.com/settings/copilot in a background tab so the content script
// can scrape usage data without requiring user navigation.
function openBackgroundTab() {
  // Don't open another tab if one is already pending
  if (_autoTabId !== null) return;

  chrome.tabs.create({
    url: 'https://github.com/settings/copilot',
    active: false,
  }).then(function(tab) {
    _autoTabId = tab.id;
    // Safety: close the tab after 30s in case scraping doesn't complete
    setTimeout(function() {
      if (_autoTabId === tab.id) {
        _autoTabId = null;
        chrome.tabs.remove(tab.id).catch(function() {});
      }
    }, 30000);
  }).catch(function() {});
}

// ── Badge update ────────────────────────────────────────────────────────────

async function updateBadge({ status, used, allowance }) {
  let text = '';
  let color = BADGE_COLORS.idle;

  if (status === 'ok') {
    const usedNum = used || 0;
    if (allowance === null) {
      // Unlimited / no cap — show raw number, always green
      text = usedNum >= 10000 ? `${Math.round(usedNum / 1000)}k` : String(usedNum);
      color = BADGE_COLORS.ok;
    } else if (allowance > 0) {
      const pct = usedNum / allowance;
      text = usedNum >= 1000 ? `${Math.round(usedNum / 1000)}k` : String(usedNum);
      color =
        pct >= 1.0 ? BADGE_COLORS.max
        : pct >= 0.8 ? BADGE_COLORS.high
        : pct >= 0.5 ? BADGE_COLORS.warn
        : BADGE_COLORS.ok;
    }
  } else if (status === 'auth_error' || status === 'error') {
    text = 'ERR';
    color = BADGE_COLORS.error;
  } else if (status === 'billing_unavailable') {
    text = 'N/A';
    color = BADGE_COLORS.idle;
  } else if (status === 'idle') {
    text = '—';
    color = BADGE_COLORS.idle;
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizePlan(raw) {
  const s = (raw || '').toLowerCase().replace(/\s/g, '');
  if (s.includes('pro+') || s.includes('proplus') || s.includes('copilot_pro_plus')) return 'pro+';
  if (s.includes('enterprise')) return 'enterprise';
  if (s.includes('business')) return 'business';
  if (s.includes('pro')) return 'pro';
  if (s.includes('free')) return 'free';
  return 'unknown';
}

/**
 * Returns the 1st of next month as the approximate billing reset date.
 */
function getResetDate(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
