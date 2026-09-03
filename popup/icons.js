// Small inline SVG icons for UI elements whose markup is built dynamically in JS.
// Static/decorative icons are written directly in popup.html since they never change at runtime.

export const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="6.3"/><path d="M5.2 8.3l1.8 1.8 3.7-4"/></svg>';

export const BAR_CHART_ICON =
  '<svg class="btn-icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">' +
  '<rect x="2.2" y="8.3" width="2.6" height="4.9" rx="0.6"/>' +
  '<rect x="6.7" y="4.1" width="2.6" height="9.1" rx="0.6"/>' +
  '<rect x="11.2" y="6.3" width="2.6" height="6.9" rx="0.6"/></svg>';

export const LINE_CHART_ICON =
  '<svg class="btn-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="2.2,12.4 6.1,7.5 9,10.1 13.6,3.5"/><polyline points="10.4,3.5 13.6,3.5 13.6,6.7"/></svg>';
