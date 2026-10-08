import { GITHUB_API_BASE, API_VERSION_HEADER } from './constants.js';

var GITHUB_WEB_BASE = 'https://github.com';

async function githubFetch(path, pat, params, apiVersion) {
  var url = new URL(GITHUB_API_BASE + path);
  if (params) {
    for (var _i = 0, _e = Object.entries(params); _i < _e.length; _i++) {
      var k = _e[_i][0], v = _e[_i][1];
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  var response = await fetch(url.toString(), {
    headers: {
      Authorization: 'Bearer ' + pat,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': apiVersion || API_VERSION_HEADER,
    },
  });

  if (!response.ok) {
    var err = new Error('GitHub API error: ' + response.status + ' ' + response.statusText);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

function sumGrossQuantity(items) {
  return Math.round(items.reduce(function(sum, item) { return sum + (item.grossQuantity || 0); }, 0));
}

/**
 * Fetch github.com/settings/copilot HTML silently using the user's existing
 * github.com browser session (cookies) and extract usage data from it.
 * The PAT is intentionally NOT sent — the web UI authenticates via session
 * cookie. Works for any Copilot plan including org-managed users.
 *
 * Throws an error with no `status` when the user isn't signed in to github.com
 * so callers can fall through to the API cascade instead of treating it as a
 * PAT auth failure.
 */
export async function scrapeSettingsPageViaFetch() {
  var response = await fetch(GITHUB_WEB_BASE + '/settings/copilot', {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    credentials: 'include',
    redirect: 'follow',
  });

  if (!response.ok) {
    var err = new Error('Page fetch error: ' + response.status);
    if (response.status !== 401 && response.status !== 403) {
      err.status = response.status;
    }
    throw err;
  }

  var finalPath = new URL(response.url).pathname;
  if (finalPath === '/login' || finalPath === '/session' || finalPath.indexOf('/login/') === 0) {
    throw new Error('NOT_SIGNED_IN_TO_GITHUB_WEB');
  }

  var html = await response.text();
  return parseUsageFromHtml(html);
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function parseUsageFromHtml(html) {
  // 1. Try __NEXT_DATA__ JSON blob
  var nextDataMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      var json = JSON.parse(nextDataMatch[1]);
      var result = extractFromNextData(json);
      if (result) return result;
    } catch (e) { /* ignore parse error */ }
  }

  // 2. Try any <script> tag containing credits_used or ai_credits_used
  var scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (var i = 0; i < scriptMatches.length; i++) {
    var scriptContent = scriptMatches[i].replace(/<\/?script[^>]*>/gi, '');
    var jsonMatch = scriptContent.match(/\{[\s\S]*"(?:ai_credits_used|credits_used|creditsUsed)"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        var parsed = JSON.parse(jsonMatch[0]);
        var r = extractFromObject(parsed);
        if (r) return r;
      } catch (e) { /* ignore */ }
    }
  }

  // 3. Fallback: regex on raw HTML text
  var text = htmlToText(html);
  var creditsMatch = text.match(/([\d,]+)\s+AI credits? used/i);
  if (creditsMatch) {
    var used = parseInt(creditsMatch[1].replace(/,/g, ''), 10);
    var cycleMatch = text.match(/([A-Za-z]+ \d+\s*[-\u2013]\s*\d+,?\s*\d{4})/);
    var cycleText = cycleMatch ? cycleMatch[1] : null;
    var dates = parseCycleDates(cycleText);
    return {
      used: used,
      unitType: 'credit',
      allowance: null,
      cycleStart: dates.start,
      cycleEnd: dates.end,
    };
  }

  return null;
}

function extractFromNextData(json) {
  // Walk the object tree looking for credits_used or ai_credits_used
  var str = JSON.stringify(json);
  var m = str.match(/"(?:ai_credits_used|credits_used|creditsUsed)"\s*:\s*(\d+)/);
  if (!m) return null;
  var used = parseInt(m[1], 10);

  var startM = str.match(/"(?:cycle_start|cycleStart|start_date)"\s*:\s*"([^"]+)"/);
  var endM = str.match(/"(?:cycle_end|cycleEnd|end_date)"\s*:\s*"([^"]+)"/);

  return {
    used: used,
    unitType: 'credit',
    allowance: null,
    cycleStart: startM ? startM[1] : null,
    cycleEnd: endM ? endM[1] : null,
  };
}

function extractFromObject(obj) {
  var used = obj.ai_credits_used || obj.credits_used || obj.creditsUsed;
  if (used === undefined || used === null) return null;
  return {
    used: Math.round(Number(used)),
    unitType: 'credit',
    allowance: null,
    cycleStart: obj.cycle_start || obj.cycleStart || obj.start_date || null,
    cycleEnd: obj.cycle_end || obj.cycleEnd || obj.end_date || null,
  };
}

function parseCycleDates(cycleText) {
  if (!cycleText) return { start: null, end: null };
  var m = cycleText.match(/([A-Za-z]+)\s+(\d+)\s*[-\u2013]\s*(\d+),?\s*(\d{4})/);
  if (m) {
    var monthIdx = new Date(m[1] + ' 1 2000').getMonth();
    var year = parseInt(m[4], 10);
    return {
      start: new Date(year, monthIdx, parseInt(m[2], 10)).toISOString(),
      end: new Date(year, monthIdx, parseInt(m[3], 10)).toISOString(),
    };
  }
  return { start: null, end: null };
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

/**
 * Try the undocumented personal copilot usage endpoint.
 * Requires a PAT with 'copilot' scope.
 * Returns { totalUsed, cycleStart, cycleEnd, unitType } or throws.
 */
export async function getUserCopilotUsage(pat) {
  var data = await githubFetch('/user/copilot/usage', pat, null, '2026-03-10');
  var used = data.ai_credits_used || data.credits_used || data.total_credits_used || 0;
  return {
    totalUsed: Math.round(used),
    cycleStart: data.start_date || data.cycle_start || null,
    cycleEnd: data.end_date || data.cycle_end || null,
    raw: data,
    unitType: 'credit',
  };
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