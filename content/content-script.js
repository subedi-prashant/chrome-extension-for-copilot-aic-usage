/**
 * Content script — runs on https://github.com/settings/copilot*
 *
 * Reads the "Usage this cycle" section from the DOM and sends it to the
 * service worker via chrome.runtime.sendMessage so the popup can display it
 * without needing any billing API access.
 *
 * GitHub renders this page as a React SPA, so we observe DOM mutations and
 * re-try until the usage widget appears (or we time out).
 */

var MAX_WAIT_MS = 15000;
var POLL_INTERVAL_MS = 500;

function extractUsage() {
  // The "Usage this cycle" widget contains text like "4,825 AI credits used"
  // We search all text nodes for this pattern.

  var result = {
    used: null,
    unitType: null,
    cycleText: null,
    limitText: null,
  };

  // Find all elements that might contain usage text
  var allText = document.body ? document.body.innerText : '';

  // Match "X,XXX AI credits used" or "X AI credits used"
  var creditsMatch = allText.match(/([\d,]+)\s+AI credits? used/i);
  if (creditsMatch) {
    result.used = parseInt(creditsMatch[1].replace(/,/g, ''), 10);
    result.unitType = 'credit';
  }

  // Match "X/X premium requests" style
  var requestsMatch = allText.match(/([\d,]+)\s+\/\s*([\d,]+)\s+premium requests?/i);
  if (requestsMatch) {
    result.used = parseInt(requestsMatch[1].replace(/,/g, ''), 10);
    result.allowance = parseInt(requestsMatch[2].replace(/,/g, ''), 10);
    result.unitType = 'request';
  }

  // Match cycle date range "August 1-31, 2026" or "Aug 1 - Aug 31, 2026"
  var cycleMatch = allText.match(/([A-Za-z]+ \d+[-–]\d+,?\s*\d{4})/);
  if (cycleMatch) {
    result.cycleText = cycleMatch[1].trim();
  }

  // Match "No monthly limit set" style text
  if (allText.match(/no monthly limit/i)) {
    result.limitText = 'No monthly limit set';
  }

  return result;
}

function parseCycleDates(cycleText) {
  if (!cycleText) return { start: null, end: null };

  // "August 1-31, 2026"
  var m = cycleText.match(/([A-Za-z]+)\s+(\d+)[-–](\d+),?\s*(\d{4})/);
  if (m) {
    var month = m[1], startDay = parseInt(m[2]), endDay = parseInt(m[3]), year = parseInt(m[4]);
    var monthIdx = new Date(month + ' 1 2000').getMonth();
    return {
      start: new Date(year, monthIdx, startDay).toISOString(),
      end: new Date(year, monthIdx, endDay).toISOString(),
    };
  }
  return { start: null, end: null };
}

function sendToExtension(usage) {
  var dates = parseCycleDates(usage.cycleText);
  chrome.runtime.sendMessage({
    type: 'SCRAPE_RESULT',
    data: {
      used: usage.used,
      unitType: usage.unitType || 'credit',
      allowance: usage.allowance || null,
      limitText: usage.limitText,
      cycleText: usage.cycleText,
      cycleStart: dates.start,
      cycleEnd: dates.end,
      scrapedAt: Date.now(),
    },
  }, function() {
    // Ignore response / connection errors silently
    if (chrome.runtime.lastError) { /* no-op */ }
  });
}

function tryExtract() {
  var usage = extractUsage();
  if (usage.used !== null) {
    sendToExtension(usage);
    return true;
  }
  return false;
}

// Try immediately in case DOM is already rendered
if (!tryExtract()) {
  // Page may be loading / React hydrating — poll until we find the data
  var elapsed = 0;
  var interval = setInterval(function() {
    elapsed += POLL_INTERVAL_MS;
    if (tryExtract() || elapsed >= MAX_WAIT_MS) {
      clearInterval(interval);
    }
  }, POLL_INTERVAL_MS);
}

// Also re-extract on any significant DOM change (React re-renders)
if (typeof MutationObserver !== 'undefined') {
  var lastSent = 0;
  var observer = new MutationObserver(function() {
    var now = Date.now();
    if (now - lastSent < 2000) return; // debounce 2s
    var usage = extractUsage();
    if (usage.used !== null) {
      lastSent = now;
      sendToExtension(usage);
    }
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}
