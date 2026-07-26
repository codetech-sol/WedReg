/**
 * Admin dashboard controller — login, stats, invitation & registration
 * tables (search / filter / sort / paginate), bulk code generation.
 *
 * All rendering uses textContent / createElement — never innerHTML with
 * user data — so stored XSS is impossible.
 */
import { api, initSession } from '/components/api.js';
import { toast } from '/components/toast.js';
import { initTheme } from '/components/theme.js';

initTheme(document.getElementById('theme-toggle'));

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');

function setLoading(btn, loading) {
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
}

function formatDate(value) {
  if (!value) return '—';
  // Postgres timestamps arrive as ISO strings (e.g. 2026-07-24T22:00:00.000Z).
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */
(async function boot() {
  await initSession();
  try {
    const info = await api('/api/admin/login-info');
    const hint = document.getElementById('login-hint');
    const usernameInput = document.getElementById('username');
    if (info.username && usernameInput) {
      usernameInput.value = info.username;
      usernameInput.placeholder = info.username;
      if (hint) {
        hint.textContent = `Username: ${info.username} (from server configuration)`;
        hint.hidden = false;
      }
    }
  } catch {
    /* login-info is optional */
  }
  const { authenticated } = await api('/api/admin/session');
  if (authenticated) enterDashboard();
  else loginView.hidden = false;
})().catch(() => {
  loginView.hidden = false;
  toast('Could not reach the server.', 'error');
});

/* ------------------------------------------------------------------ */
/* Login / logout                                                       */
/* ------------------------------------------------------------------ */
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(loginBtn, true);
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: {
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
      },
    });
    // Session was regenerated on login — refresh the CSRF token.
    await initSession();
    enterDashboard();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(loginBtn, false);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
});

function enterDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  loadStats();
  tables.invitations.load();
  tables.registrations.load();
}

/* ------------------------------------------------------------------ */
/* Statistics                                                           */
/* ------------------------------------------------------------------ */
const STAT_LABELS = [
  ['totalInvitations', 'Total Invitations'],
  ['unusedInvitations', 'Unused Invitations'],
  ['usedInvitations', 'Used Invitations'],
  ['totalRegistrations', 'Total Registrations'],
  ['withPlusOne', 'With Plus Ones'],
  ['withoutPlusOne', 'Without Plus Ones'],
  ['todayRegistrations', "Today's Registrations"],
];

async function loadStats() {
  try {
    const stats = await api('/api/admin/stats');
    const grid = document.getElementById('stats-grid');
    grid.replaceChildren(
      ...STAT_LABELS.map(([key, label], i) => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.style.animationDelay = `${i * 40}ms`;
        const value = document.createElement('div');
        value.className = 'stat-value';
        value.textContent = stats[key] ?? 0;
        const labelEl = document.createElement('div');
        labelEl.className = 'stat-label';
        labelEl.textContent = label;
        card.append(value, labelEl);
        return card;
      })
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Generic data table (search / filter / sort / pagination)             */
/* ------------------------------------------------------------------ */
function createTable({ endpoint, panel, tbody, paginationEl, defaultSort, renderRow, columns, extraParams }) {
  const state = { page: 1, search: '', sort: defaultSort, dir: 'desc' };

  async function load() {
    try {
      const params = new URLSearchParams({
        page: state.page,
        pageSize: 10,
        search: state.search,
        sort: state.sort,
        dir: state.dir,
        ...extraParams(),
      });
      const data = await api(`${endpoint}?${params}`);
      render(data);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function render(data) {
    tbody.replaceChildren();
    if (!data.rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns;
      td.className = 'empty';
      td.textContent = 'No records found.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      data.rows.forEach((row) => tbody.appendChild(renderRow(row)));
    }
    renderPagination(data);
    updateSortIndicators();
  }

  function renderPagination({ page, totalPages, total }) {
    paginationEl.replaceChildren();
    const info = document.createElement('span');
    info.textContent = `${total} record${total === 1 ? '' : 's'} · page ${page} of ${totalPages}`;

    const pages = document.createElement('div');
    pages.className = 'pages';
    const makeBtn = (label, target, { disabled = false, current = false } = {}) => {
      const btn = document.createElement('button');
      btn.className = `page-btn${current ? ' current' : ''}`;
      btn.textContent = label;
      btn.disabled = disabled;
      btn.addEventListener('click', () => { state.page = target; load(); });
      return btn;
    };

    pages.appendChild(makeBtn('‹', page - 1, { disabled: page <= 1 }));
    // Window of up to 5 page buttons around the current page.
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    for (let p = start; p <= Math.min(totalPages, start + 4); p++) {
      pages.appendChild(makeBtn(String(p), p, { current: p === page }));
    }
    pages.appendChild(makeBtn('›', page + 1, { disabled: page >= totalPages }));

    paginationEl.append(info, pages);
  }

  function updateSortIndicators() {
    panel.querySelectorAll('th.sortable').forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === state.sort) {
        th.classList.add(state.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });
  }

  // Column-header sorting.
  panel.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      if (state.sort === th.dataset.sort) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = th.dataset.sort;
        state.dir = 'asc';
      }
      state.page = 1;
      load();
    });
  });

  return { load, state };
}

/** Debounce helper for the search boxes. */
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

const cell = (value, className) => {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = value ?? '—';
  return td;
};

/* ---------- Invitations table ---------- */
const invStatus = document.getElementById('inv-status');
const invitationsTable = createTable({
  endpoint: '/api/admin/invitations',
  panel: document.getElementById('view-invitations'),
  tbody: document.getElementById('inv-tbody'),
  paginationEl: document.getElementById('inv-pagination'),
  defaultSort: 'created_at',
  columns: 4,
  extraParams: () => (invStatus.value ? { status: invStatus.value } : {}),
  renderRow(row) {
    const tr = document.createElement('tr');
    tr.appendChild(cell(row.invitation_code, 'mono'));
    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${row.status}`;
    badge.textContent = row.status;
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);
    tr.appendChild(cell(formatDate(row.created_at)));
    tr.appendChild(cell(formatDate(row.used_at)));
    return tr;
  },
});

document.getElementById('inv-search').addEventListener('input', debounce((e) => {
  invitationsTable.state.search = e.target.value.trim();
  invitationsTable.state.page = 1;
  invitationsTable.load();
}));
invStatus.addEventListener('change', () => { invitationsTable.state.page = 1; invitationsTable.load(); });

/* ---------- Registrations table ---------- */
const regPlusOne = document.getElementById('reg-plusone');
const registrationsTable = createTable({
  endpoint: '/api/admin/registrations',
  panel: document.getElementById('view-registrations'),
  tbody: document.getElementById('reg-tbody'),
  paginationEl: document.getElementById('reg-pagination'),
  defaultSort: 'registered_at',
  columns: 8,
  extraParams: () => (regPlusOne.value !== '' ? { plusOne: regPlusOne.value } : {}),
  renderRow(row) {
    const tr = document.createElement('tr');
    tr.appendChild(cell(row.guest_name));
    tr.appendChild(cell(row.guest_email));
    tr.appendChild(cell(row.guest_phone, 'mono'));
    tr.appendChild(cell(row.invitation_code, 'mono'));
    tr.appendChild(cell(row.has_plus_one ? row.plus_one_name : '—'));
    tr.appendChild(cell(row.has_plus_one ? row.plus_one_phone : '—', 'mono'));
    tr.appendChild(cell(row.has_plus_one ? row.plus_one_id : '—', 'mono'));
    tr.appendChild(cell(formatDate(row.registered_at)));
    return tr;
  },
});

document.getElementById('reg-search').addEventListener('input', debounce((e) => {
  registrationsTable.state.search = e.target.value.trim();
  registrationsTable.state.page = 1;
  registrationsTable.load();
}));
regPlusOne.addEventListener('change', () => { registrationsTable.state.page = 1; registrationsTable.load(); });

const tables = { invitations: invitationsTable, registrations: registrationsTable };

/* ---------- Tabs ---------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    document.getElementById('view-invitations').hidden = tab.dataset.tab !== 'invitations';
    document.getElementById('view-registrations').hidden = tab.dataset.tab !== 'registrations';
  });
});

/* ---------- Bulk code generation ---------- */
const generateForm = document.getElementById('generate-form');
const generateBtn = document.getElementById('generate-btn');

/* ---------- Post-event cleanup (delete all) ---------- */
async function deleteAll(endpoint, confirmMessage, label) {
  // Double confirmation — this is irreversible.
  if (!window.confirm(confirmMessage)) return;
  if (!window.confirm(`Are you absolutely sure? Deleting ${label} CANNOT be undone.`)) return;
  try {
    const result = await api(endpoint, { method: 'DELETE' });
    toast(`Deleted ${result.deleted} ${label}.`, 'success');
    loadStats();
    invitationsTable.load();
    registrationsTable.load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('inv-delete-all').addEventListener('click', () =>
  deleteAll(
    '/api/admin/invitations',
    'Delete ALL invitations? This also deletes every registration linked to them.',
    'invitations'
  )
);

document.getElementById('reg-delete-all').addEventListener('click', () =>
  deleteAll(
    '/api/admin/registrations',
    'Delete ALL registrations? Invitation codes will be kept.',
    'registrations'
  )
);

generateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(generateBtn, true);
  try {
    const result = await api('/api/admin/invitations/generate', {
      method: 'POST',
      body: {
        guestName: document.getElementById('gen-name').value.trim() || 'Guest',
        count: Number(document.getElementById('gen-count').value) || 1,
      },
    });
    const box = document.getElementById('generated-codes');
    box.hidden = false;
    box.textContent = `Created ${result.created.length} code(s): ${result.created.join('  ·  ')}`;
    toast(`${result.created.length} invitation code(s) generated.`, 'success');
    loadStats();
    invitationsTable.load();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(generateBtn, false);
  }
});
