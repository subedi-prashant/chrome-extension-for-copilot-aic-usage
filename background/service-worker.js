import { readState, updateState } from '../shared/storage.js';
import {
  getAuthenticatedUser, getCopilotPlan,
  getPremiumRequestUsage, getAiCreditUsage, getGeneralUsageFallback,
  getOrgAiCreditUsage, getOrgPremiumRequestUsage,
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

// ── Message handler (from popup / options) ──────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FORCE_FETCH') {
    fetchAndCache()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true; // async response
  }

  if (message.type === 'SETTINGS_CHANGED') {
    registerAlarm()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
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

    if (org) {
      // ── Org-managed license path ─────────────────────────────────────────
      try {
        usageResult = await getOrgAiCreditUsage(pat, org, username, year, month);
      } catch (e1) {
        if (e1.status !== 404) throw e1;
        try {
          usageResult = await getOrgPremiumRequestUsage(pat, org, username, year, month);
        } catch (e2) {
          if (e2.status !== 404) throw e2;
          // Both 404 → enhanced billing platform not enabled OR not an org admin
          const billingErr = new Error('BILLING_UNAVAILABLE');
          billingErr.status = 404;
          billingErr.isBillingUnavailable = true;
          throw billingErr;
        }
      }
    } else {
      // ── Personal license path ─────────────────────────────────────────────
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
            const billingErr = new Error('BILLING_UNAVAILABLE');
            billingErr.status = 404;
            billingErr.isBillingUnavailable = true;
            throw billingErr;
          }
        }
      }

      if (usageResult.unitType === 'request' && usageResult.totalUsed === 0 && usageResult.usageItems.length === 0) {
        try {
          const aiResult = await getAiCreditUsage(pat, username, year, month);
          if (aiResult.totalUsed > 0) usageResult = aiResult;
        } catch (e) { /* ignore */ }
      }
    }

    // allowance: null means unlimited / no cap set
    const allowance = usageResult.unitType === 'credit'
      ? null  // AI credits have no fixed monthly cap (org-configured)
      : (PLAN_ALLOWANCES[plan] || PLAN_ALLOWANCES.unknown);

    const resetDate = getResetDate(now);

    const cachePayload = {
      status: 'ok',
      username,
      plan,
      used: usageResult.totalUsed,
      allowance,                       // null = unlimited
      unitType: usageResult.unitType,  // 'request' | 'credit'
      usageItems: usageResult.usageItems,
      fetchedAt: Date.now(),
      year,
      month,
      resetDate: resetDate.toISOString(),
      errorMessage: null,
    };

    await updateState(cachePayload);
    await updateBadge(cachePayload);
  } catch (err) {
    var status = 'error';
    if (err.status === 401 || err.status === 403) status = 'auth_error';
    else if (err.isBillingUnavailable) status = 'billing_unavailable';
    const errorPayload = {
      status: status,
      errorMessage: err.message,
      fetchedAt: Date.now(),
    };
    await updateState(errorPayload);
    await updateBadge(errorPayload);
  }
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
