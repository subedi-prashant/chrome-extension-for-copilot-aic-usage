// Plan allowances — monthly premium requests included per plan (as of 2025)
export const PLAN_ALLOWANCES = {
  pro: 300,
  business: 300,
  enterprise: 1000,
  'pro+': 1500,
  free: 0,
  unknown: 300, // conservative fallback
};

// Copilot plan labels for display
export const PLAN_LABELS = {
  pro: 'Copilot Pro',
  'pro+': 'Copilot Pro+',
  business: 'Copilot Business',
  enterprise: 'Copilot Enterprise',
  free: 'Copilot Free',
  unknown: 'Unknown Plan',
};

// Badge color thresholds
export const BADGE_COLORS = {
  ok: '#2da44e',      // 0–49% — green
  warn: '#d29922',    // 50–79% — yellow
  high: '#e36209',    // 80–99% — orange
  max: '#cf222e',     // 100%+  — red
  idle: '#6e7781',    // no token / not configured — grey
  error: '#cf222e',   // fetch error — red
};

export const ALARM_NAME = 'poll-usage';
export const DEFAULT_POLL_INTERVAL_MINUTES = 30;
export const API_VERSION_HEADER = '2022-11-28';
export const GITHUB_API_BASE = 'https://api.github.com';
