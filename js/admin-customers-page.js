// Phase 5 — admin-customers.html controller. Staff-only CRM home: metrics
// strip, 12-month new-customer trend (inline SVG), and a debounced,
// generation-guarded searchable customer table.
import { requireStaff } from '/js/auth.js';
import { getMetrics, listCustomers } from '/js/crm.js';

await requireStaff();

const fmtTHB = (n) => 'THB ' + (Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (ym) => {
  const [y, m] = String(ym).split('-');
  return `${MONTH_SHORT[Number(m) - 1] || ym} ${y}`;
};

// --- metrics tiles ---
const metricsEl = document.getElementById('metrics');
try {
  const m = await getMetrics();
  metricsEl.innerHTML = [
    ['Total customers', m.total_customers],
    ['New this month', m.new_this_month],
    ['Paid orders', m.paid_orders],
    ['Revenue', fmtTHB(m.revenue_thb)],
    ['Avg order value', fmtTHB(m.aov_thb)],
  ].map(([l, n]) => `<div class="crm-tile"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join('');
  renderChart(m.by_month || []);
} catch (e) {
  console.error(e);
  metricsEl.innerHTML = '<p class="crm-metrics--error">Metrics unavailable.</p>';
}

// --- 12-month new-customer trend: thin ink bars, one selective direct label
// (the current/last month), a live tooltip on hover/focus. Single series →
// no legend needed (the chart label above already names it). ---
function renderChart(series) {
  const chartEl = document.getElementById('chart');
  if (!series.length) {
    chartEl.innerHTML = '<p style="font-size:13px;color:var(--color-muted)">No data yet.</p>';
    return;
  }

  const w = 900, h = 200, padL = 8, padR = 8, padT = 28, padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const max = Math.max(1, ...series.map((s) => s.new_customers));
  const bw = plotW / series.length;
  const barGap = Math.min(10, bw * 0.28);

  const bars = series.map((s, i) => {
    const bh = Math.round((s.new_customers / max) * plotH);
    const x = padL + i * bw + barGap / 2;
    const y = padT + plotH - bh;
    const bwv = bw - barGap;
    const isLast = i === series.length - 1;
    const label = isLast
      ? `<text class="crm-bar-label" x="${x + bwv / 2}" y="${Math.max(12, y - 6)}" text-anchor="middle">${s.new_customers}</text>`
      : '';
    const monthLabel = (i === 0 || isLast || i % 3 === 0)
      ? `<text class="crm-axis-label" x="${x + bwv / 2}" y="${h - 6}" text-anchor="middle">${esc(fmtMonth(s.month).split(' ')[0])}</text>`
      : '';
    return `<rect class="crm-bar" data-month="${esc(fmtMonth(s.month))}" data-count="${s.new_customers}"
        x="${x.toFixed(2)}" y="${y}" width="${Math.max(1, bwv).toFixed(2)}" height="${Math.max(0, bh)}" rx="1.5" tabindex="0"
        role="img" aria-label="${esc(fmtMonth(s.month))}: ${s.new_customers} new customer${s.new_customers === 1 ? '' : 's'}"></rect>${label}${monthLabel}`;
  }).join('');

  chartEl.innerHTML =
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="New customers per month, last 12 months">` +
    `<line class="crm-axis-line" x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}"></line>` +
    bars +
    `</svg>`;

  // Hover / focus tooltip — one shared floating element, positioned per-mark.
  let tip = document.querySelector('.crm-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'crm-tooltip';
    document.body.appendChild(tip);
  }
  const showTip = (rect, clientX, clientY) => {
    rect.classList.add('is-active');
    tip.textContent = `${rect.getAttribute('data-month')} — ${rect.getAttribute('data-count')} new`;
    tip.style.left = `${clientX}px`;
    tip.style.top = `${clientY - 10}px`;
    tip.classList.add('is-visible');
  };
  const hideTip = (rect) => {
    rect.classList.remove('is-active');
    tip.classList.remove('is-visible');
  };
  chartEl.querySelectorAll('.crm-bar').forEach((rect) => {
    rect.addEventListener('mouseenter', (e) => showTip(rect, e.clientX, e.clientY));
    rect.addEventListener('mousemove', (e) => showTip(rect, e.clientX, e.clientY));
    rect.addEventListener('mouseleave', () => hideTip(rect));
    rect.addEventListener('focus', () => {
      const box = rect.getBoundingClientRect();
      showTip(rect, box.left + box.width / 2, box.top);
    });
    rect.addEventListener('blur', () => hideTip(rect));
  });
}

// --- searchable customer table (debounce + stale-response generation guard) ---
const searchEl = document.getElementById('search');
const wrap = document.getElementById('tableWrap');
let gen = 0;
let timer = null;

function goToCustomer(id) {
  location.href = `/admin-customer.html?id=${encodeURIComponent(id)}`;
}

async function load(q) {
  const my = ++gen;
  wrap.innerHTML = '<p class="crm-table-skeleton">Loading customers…</p>';
  let customers = [];
  let total = 0;
  try {
    ({ customers, total } = await listCustomers({ q }));
  } catch (e) {
    if (my !== gen) return;
    console.error(e);
    wrap.innerHTML = '<p class="crm-table-skeleton">Unable to load customers.</p>';
    return;
  }
  if (my !== gen) return; // a newer search superseded this response

  const rows = customers.map((c) => `
    <tr data-id="${esc(c.id)}" tabindex="0" role="link" aria-label="View ${esc(c.full_name || c.email || 'customer')}">
      <td class="crm-name">${esc(c.full_name || '—')}</td>
      <td class="crm-muted">${esc(c.email || '')}</td>
      <td class="crm-muted">${esc(c.phone || '—')}</td>
      <td class="crm-muted">${esc((c.created_at || '').slice(0, 10))}</td>
      <td><span class="crm-source${c.source === 'pos' ? ' crm-source--pos' : ''}">${esc(c.source || 'website')}</span></td>
    </tr>`).join('');

  wrap.innerHTML = `
    <table class="crm-table">
      <thead>
        <tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Source</th></tr>
      </thead>
      <tbody>
        ${rows || `<tr class="crm-empty-row"><td colspan="5">No customers found.</td></tr>`}
      </tbody>
    </table>`;

  wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => goToCustomer(tr.getAttribute('data-id')));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToCustomer(tr.getAttribute('data-id'));
      }
    });
  });

  const toolbar = document.querySelector('.crm-toolbar');
  let countEl = toolbar.querySelector('.crm-count');
  if (!countEl) {
    countEl = document.createElement('span');
    countEl.className = 'crm-count';
    toolbar.appendChild(countEl);
  }
  countEl.textContent = `${total} customer${total === 1 ? '' : 's'}`;
}

searchEl.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => load(searchEl.value), 220);
});

await load('');
