import { getSnapshots } from '../shared/db.js';
import { BAR_CHART_ICON, LINE_CHART_ICON } from './icons.js';

const $ = (id) => document.getElementById(id);

const MAX_SNAPSHOTS = 500;
const CHART_COLOR = '#1f6feb';
const CHART_COLOR_ALPHA = 'rgba(31,111,235,0.12)';

let _chart = null;
let _chartType = 'line';
let _lastSnapshots = null;

/**
 * Format a timestamp for the chart X-axis label.
 * @param {number} ts Unix milliseconds
 * @returns {string}
 */
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a timestamp as a short date for grouped display.
 * @param {number} ts
 */
function fmtShort(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** First entry is always null — no baseline exists for the oldest record. */
function toDailyDeltas(chronological) {
  return chronological.map((s, i) => {
    if (i === 0) return { ...s, dailyUsed: null };
    const prev = chronological[i - 1];
    const delta = s.used - prev.used;
    // Billing cycle reset: counter dropped or cycleStart changed — use full value as day's usage
    const cycleReset = delta < 0
      || (s.cycleStart && prev.cycleStart && s.cycleStart !== prev.cycleStart);
    return { ...s, dailyUsed: cycleReset ? s.used : delta };
  });
}

/**
 * Destroy and re-render the Chart.js line chart.
 * @param {Array} snapshots Ordered oldest→newest
 */
function renderChart(snapshots) {
  const canvas = $('usage-chart');
  if (!canvas) return;

  if (_chart) {
    _chart.destroy();
    _chart = null;
  }

  const chartData = snapshots.filter(s => s.dailyUsed !== null);
  const labels = chartData.map(s => fmtShort(s.fetchedAt));
  const data = chartData.map(s => s.dailyUsed);

  _chart = new Chart(canvas, {
    type: _chartType,
    data: {
      labels,
      datasets: [
        {
          label: 'Daily Usage',
          data,
          borderColor: CHART_COLOR,
          backgroundColor: CHART_COLOR_ALPHA,
          borderWidth: 2,
          pointRadius: chartData.length > 60 ? 0 : 3,
          pointHoverRadius: 5,
          fill: _chartType === 'line',
          tension: _chartType === 'line' ? 0.3 : 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => {
              const s = chartData[item.dataIndex];
              const unit = s.unitType === 'credit' ? 'credits' : 'requests';
              return `${item.raw.toLocaleString()} ${unit}`;
            },
            afterLabel: (item) => {
              const s = chartData[item.dataIndex];
              return `Source: ${s.source}  Plan: ${s.plan}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            maxRotation: 30,
            font: { size: 10 },
            callback: (_, i) => chartData[i] ? fmtShort(chartData[i].fetchedAt) : '',
          },
          grid: { color: '#eaeef2' },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 } },
          grid: { color: '#eaeef2' },
        },
      },
    },
  });
}

/**
 * Populate the history stats summary row.
 * @param {Array} snapshots Ordered oldest→newest
 */
function renderStats(snapshots) {
  const statsEl = $('history-stats');
  if (!statsEl || snapshots.length === 0) return;

  const latest = snapshots[snapshots.length - 1];
  const earliest = snapshots[0];
  const span = Math.ceil((latest.fetchedAt - earliest.fetchedAt) / (1000 * 60 * 60 * 24));
  const withData = snapshots.filter(s => s.dailyUsed !== null);
  const peak = withData.length > 0
    ? withData.reduce((m, s) => (s.dailyUsed > m.dailyUsed ? s : m), withData[0])
    : null;

  statsEl.innerHTML =
    `<div class="stat-block"><span class="stat-value">${snapshots.length}</span><span class="stat-label">Snapshots</span></div>` +
    (peak
      ? `<div class="stat-block"><span class="stat-value accent-blue">${peak.dailyUsed.toLocaleString()}</span><span class="stat-label">Peak / day</span><span class="stat-sub">on ${fmtShort(peak.fetchedAt)}</span></div>`
      : `<div class="stat-block"><span class="stat-value accent-blue">–</span><span class="stat-label">Peak / day</span></div>`) +
    `<div class="stat-block"><span class="stat-value accent-purple">${span || 1}d</span><span class="stat-label">Over</span></div>`;
}

/**
 * Render the history table of recent snapshots.
 * @param {Array} snapshots Ordered newest→oldest (as returned from db)
 */
function renderTable(snapshots) {
  const tbody = $('history-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const recent = snapshots.slice(0, 20);
  for (const s of recent) {
    const tr = document.createElement('tr');
    const daily = s.dailyUsed !== null ? s.dailyUsed.toLocaleString() : '—';
    tr.innerHTML =
      `<td>${fmtShort(s.fetchedAt)}</td>` +
      `<td class="num">${daily}</td>` +
      `<td>${s.unitType === 'credit' ? 'Credits' : 'Requests'}</td>` +
      `<td>${s.plan}</td>`;
    tbody.appendChild(tr);
  }
}

/**
 * Main entry point — called when the History tab is activated.
 * Idempotent: re-renders on each activation to pick up fresh data.
 */
export async function renderHistory() {
  const emptyEl = $('history-empty');
  const contentEl = $('history-content');

  try {
    const allSnapshots = await getSnapshots(MAX_SNAPSHOTS);

    if (allSnapshots.length === 0) {
      emptyEl.classList.remove('hidden');
      contentEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    // Reverse so chart goes oldest → newest, then compute per-day deltas
    const chronological = [...allSnapshots].reverse();
    const withDeltas = toDailyDeltas(chronological);

    renderChart(withDeltas);
    renderStats(withDeltas);
    _lastSnapshots = withDeltas;
    renderTable([...withDeltas].reverse()); // table stays newest-first
  } catch (err) {
    emptyEl.classList.remove('hidden');
    emptyEl.querySelector('p').textContent = 'Could not load history: ' + err.message;
    contentEl.classList.add('hidden');
  }
}

/**
 * Sync the toggle button's icon + label to the current chart type.
 */
function setToggleButtonLabel(toggleBtn) {
  toggleBtn.innerHTML = _chartType === 'line'
    ? `${BAR_CHART_ICON}Bar Chart`
    : `${LINE_CHART_ICON}Line Chart`;
}

/**
 * Wire up the chart toggle button.
 */
export function initHistory() {
  const toggleBtn = $('btn-toggle-chart');
  if (toggleBtn) {
    setToggleButtonLabel(toggleBtn);
    toggleBtn.addEventListener('click', () => {
      _chartType = _chartType === 'line' ? 'bar' : 'line';
      setToggleButtonLabel(toggleBtn);
      if (_lastSnapshots) renderChart(_lastSnapshots);
    });
  }
}
