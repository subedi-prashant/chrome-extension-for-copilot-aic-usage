import { getSnapshots, clearSnapshots } from '../shared/db.js';

const $ = (id) => document.getElementById(id);

const MAX_SNAPSHOTS = 500;
const CHART_COLOR = '#1f6feb';
const CHART_COLOR_ALPHA = 'rgba(31,111,235,0.12)';

let _chart = null;
let _initialized = false;

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

  const labels = snapshots.map((s) => fmtDate(s.fetchedAt));
  const data = snapshots.map((s) => s.used);

  _chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Usage',
          data,
          borderColor: CHART_COLOR,
          backgroundColor: CHART_COLOR_ALPHA,
          borderWidth: 2,
          pointRadius: snapshots.length > 60 ? 0 : 3,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.3,
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
              const s = snapshots[item.dataIndex];
              const unit = s.unitType === 'credit' ? 'credits' : 'requests';
              const cap = s.allowance ? ` / ${s.allowance.toLocaleString()}` : '';
              return `${item.raw.toLocaleString()}${cap} ${unit}`;
            },
            afterLabel: (item) => {
              const s = snapshots[item.dataIndex];
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
            callback: (_, i) => fmtShort(snapshots[i].fetchedAt),
          },
          grid: { color: '#eaeef2' },
        },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 10 } },
          grid: { color: '#eaeef2' },
          title: {
            display: true,
            text: 'Usage',
            font: { size: 10 },
            color: '#57606a',
          },
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
  const peak = snapshots.reduce((m, s) => (s.used > m.used ? s : m), snapshots[0]);
  const span = Math.ceil((latest.fetchedAt - earliest.fetchedAt) / (1000 * 60 * 60 * 24));

  statsEl.innerHTML =
    `<span><b>${snapshots.length}</b> snapshots</span>` +
    `<span>Peak <b>${peak.used.toLocaleString()}</b> on ${fmtShort(peak.fetchedAt)}</span>` +
    `<span>Over <b>${span || 1}d</b></span>`;
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
    const cap = s.allowance ? ` / ${s.allowance.toLocaleString()}` : '';
    tr.innerHTML =
      `<td>${fmtShort(s.fetchedAt)}</td>` +
      `<td class="num">${s.used.toLocaleString()}${cap}</td>` +
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

    // Reverse so chart goes oldest → newest
    const chronological = [...allSnapshots].reverse();

    renderChart(chronological);
    renderStats(chronological);
    renderTable(allSnapshots); // table stays newest-first
  } catch (err) {
    emptyEl.classList.remove('hidden');
    emptyEl.querySelector('p').textContent = 'Could not load history: ' + err.message;
    contentEl.classList.add('hidden');
  }
}

/**
 * Wire up the Clear History button.
 */
export function initHistory() {
  const clearBtn = $('btn-clear-history');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Clear all stored history snapshots?')) return;
      await clearSnapshots();
      if (_chart) { _chart.destroy(); _chart = null; }
      await renderHistory();
    });
  }
}
