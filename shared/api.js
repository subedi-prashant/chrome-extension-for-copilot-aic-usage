import { GITHUB_API_BASE, API_VERSION_HEADER } from './constants.js';

async function githubFetch(path, pat, params) {
  const url = new URL(GITHUB_API_BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: 'Bearer ' + pat,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION_HEADER,
    },
  });

  if (!response.ok) {
    const err = new Error('GitHub API error: ' + response.status + ' ' + response.statusText);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

function sumGrossQuantity(items) {
  return Math.round(items.reduce(function(sum, item) { return sum + (item.grossQuantity || 0); }, 0));
}

export async function getAuthenticatedUser(pat) {
  return githubFetch('/user', pat);
}

export async function getCopilotPlan(pat, username) {
  try {
    return await githubFetch('/users/' + encodeURIComponent(username) + '/copilot', pat);
  } catch (e) {
    return null;
  }
}

export async function getPremiumRequestUsage(pat, username, year, month) {
  const data = await githubFetch(
    '/users/' + encodeURIComponent(username) + '/settings/billing/premium_request/usage',
    pat,
    { year: year, month: month }
  );
  const items = data.usageItems || [];
  return { totalUsed: sumGrossQuantity(items), usageItems: items, unitType: 'request' };
}

export async function getAiCreditUsage(pat, username, year, month) {
  const data = await githubFetch(
    '/users/' + encodeURIComponent(username) + '/settings/billing/ai_credit/usage',
    pat,
    { year: year, month: month }
  );
  const items = data.usageItems || [];
  return { totalUsed: sumGrossQuantity(items), usageItems: items, unitType: 'credit' };
}

export async function getOrgAiCreditUsage(pat, org, username, year, month) {
  const data = await githubFetch(
    '/organizations/' + encodeURIComponent(org) + '/settings/billing/ai_credit/usage',
    pat,
    { user: username, year: year, month: month }
  );
  const items = data.usageItems || [];
  return { totalUsed: sumGrossQuantity(items), usageItems: items, unitType: 'credit' };
}

export async function getOrgPremiumRequestUsage(pat, org, username, year, month) {
  const data = await githubFetch(
    '/organizations/' + encodeURIComponent(org) + '/settings/billing/premium_request/usage',
    pat,
    { user: username, year: year, month: month }
  );
  const items = data.usageItems || [];
  return { totalUsed: sumGrossQuantity(items), usageItems: items, unitType: 'request' };
}

export async function getGeneralUsageFallback(pat, username, year, month) {
  const data = await githubFetch(
    '/users/' + encodeURIComponent(username) + '/settings/billing/usage',
    pat,
    { year: year, month: month }
  );
  const items = (data.usageItems || []).filter(function(item) {
    const prod = (item.product || '').toLowerCase();
    const sku = (item.sku || '').toLowerCase();
    return prod.includes('copilot') && (sku.includes('premium') || sku.includes('credit'));
  });
  return { totalUsed: sumGrossQuantity(items), usageItems: items, unitType: 'request' };
}
