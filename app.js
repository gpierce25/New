(() => {
  'use strict';

  const STORAGE_KEY = 'job-tracker.applications.v1';
  const THEME_KEY = 'job-tracker.theme';
  const VIEW_KEY = 'job-tracker.view';

  const STATUSES = [
    { id: 'wishlist', label: 'Wishlist' },
    { id: 'applied', label: 'Applied' },
    { id: 'screening', label: 'Screening' },
    { id: 'interviewing', label: 'Interviewing' },
    { id: 'offer', label: 'Offer' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'withdrawn', label: 'Withdrawn' },
  ];
  const STATUS_IDS = new Set(STATUSES.map((s) => s.id));
  const FIELDS = ['company', 'role', 'status', 'dateApplied', 'location', 'salary',
    'url', 'source', 'contact', 'followUp', 'priority', 'notes'];

  const $ = (sel) => document.querySelector(sel);
  const el = {
    stats: $('#stats'),
    search: $('#search'),
    statusFilter: $('#status-filter'),
    sort: $('#sort'),
    board: $('#board'),
    tableView: $('#table-view'),
    tableBody: $('#table-body'),
    empty: $('#empty'),
    followups: $('#followups'),
    dialog: $('#app-dialog'),
    form: $('#app-form'),
    dialogTitle: $('#dialog-title'),
    statusSelect: $('#status-select'),
    deleteBtn: $('#delete-btn'),
  };

  // ---------- Storage ----------

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }

  function load() {
    try {
      const data = JSON.parse(safeGet(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data.map(normalize).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function save() {
    safeSet(STORAGE_KEY, JSON.stringify(apps));
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const app = {};
    for (const f of FIELDS) app[f] = raw[f] == null ? '' : String(raw[f]);
    if (!app.company && !app.role) return null;
    if (!STATUS_IDS.has(app.status)) app.status = 'applied';
    app.id = raw.id ? String(raw.id) : uid();
    app.createdAt = raw.createdAt || new Date().toISOString();
    app.updatedAt = raw.updatedAt || app.createdAt;
    app.history = Array.isArray(raw.history) ? raw.history : [];
    return app;
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  let apps = load();
  let view = safeGet(VIEW_KEY) === 'table' ? 'table' : 'board';
  let editingId = null;

  // ---------- Helpers ----------

  const statusLabel = (id) => (STATUSES.find((s) => s.id === id) || {}).label || id;
  const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

  function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    if (!y) return d;
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysBetween(a, b) {
    const pa = new Date(a + 'T00:00:00');
    const pb = new Date(b + 'T00:00:00');
    return Math.round((pb - pa) / 86400000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function safeUrl(u) {
    try {
      const url = new URL(u);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }

  function isActive(app) {
    return !['rejected', 'withdrawn', 'offer'].includes(app.status);
  }

  // ---------- Filtering ----------

  function filtered() {
    const q = el.search.value.trim().toLowerCase();
    const status = el.statusFilter.value;
    const [key, dir] = el.sort.value.split('-');
    const list = apps.filter((a) => {
      if (status && a.status !== status) return false;
      if (!q) return true;
      return [a.company, a.role, a.location, a.notes, a.contact, a.source]
        .some((v) => v && v.toLowerCase().includes(q));
    });
    list.sort((a, b) => {
      let va = a[key] || '';
      let vb = b[key] || '';
      // Empty values always sort last.
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      if (key === 'company') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return dir === 'desc' ? -cmp : cmp;
    });
    return list;
  }

  // ---------- Rendering ----------

  function render() {
    renderStats();
    renderFollowups();
    const list = filtered();
    el.empty.hidden = apps.length !== 0;
    el.board.hidden = view !== 'board' || apps.length === 0;
    el.tableView.hidden = view !== 'table' || apps.length === 0;
    if (view === 'board') renderBoard(list); else renderTable(list);
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
      b.setAttribute('aria-selected', b.dataset.view === view);
    });
  }

  function renderStats() {
    const count = (s) => apps.filter((a) => a.status === s).length;
    const total = apps.length;
    const submitted = apps.filter((a) => a.status !== 'wishlist').length;
    const responded = apps.filter((a) => ['screening', 'interviewing', 'offer', 'rejected'].includes(a.status)).length;
    const responseRate = submitted ? Math.round((responded / submitted) * 100) + '%' : '—';
    const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA');
    const thisWeek = apps.filter((a) => a.status !== 'wishlist' && a.dateApplied && a.dateApplied >= weekAgo).length;

    const tiles = [
      ['Total', total],
      ['Active', apps.filter(isActive).length],
      ['Interviewing', count('interviewing')],
      ['Offers', count('offer')],
      ['Applied this week', thisWeek],
      ['Response rate', responseRate],
    ];
    el.stats.innerHTML = tiles.map(([label, value]) =>
      `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`).join('');
  }

  function renderFollowups() {
    const today = todayStr();
    const due = apps
      .filter((a) => a.followUp && isActive(a) && daysBetween(today, a.followUp) <= 3)
      .sort((a, b) => a.followUp.localeCompare(b.followUp));
    el.followups.hidden = due.length === 0;
    if (!due.length) return;
    el.followups.innerHTML = `<strong>Follow-ups due</strong><ul>${due.map((a) => {
      const diff = daysBetween(today, a.followUp);
      const when = diff < 0 ? `<span class="overdue">${-diff}d overdue</span>` : diff === 0 ? '<span class="overdue">today</span>' : `in ${diff}d`;
      return `<li><a data-id="${escapeHtml(a.id)}">${escapeHtml(a.company)} — ${escapeHtml(a.role)}</a> · ${when}</li>`;
    }).join('')}</ul>`;
  }

  function cardHtml(a) {
    const meta = [];
    if (a.dateApplied) meta.push(`Applied ${fmtDate(a.dateApplied)}`);
    if (a.location) meta.push(escapeHtml(a.location));
    if (a.salary) meta.push(escapeHtml(a.salary));
    if (a.followUp && isActive(a)) {
      const diff = daysBetween(todayStr(), a.followUp);
      meta.push(`<span class="${diff <= 0 ? 'overdue' : ''}">Follow up ${fmtDate(a.followUp)}</span>`);
    }
    const prio = a.priority ? `<span class="priority ${a.priority}">${a.priority}</span> ` : '';
    return `<article class="card" draggable="true" data-id="${escapeHtml(a.id)}">
      <div class="company">${prio}${escapeHtml(a.company)}</div>
      <div class="role">${escapeHtml(a.role)}</div>
      ${meta.length ? `<div class="meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>` : ''}
    </article>`;
  }

  function renderBoard(list) {
    const statusFilter = el.statusFilter.value;
    const columns = statusFilter ? STATUSES.filter((s) => s.id === statusFilter) : STATUSES;
    el.board.innerHTML = columns.map((s) => {
      const items = list.filter((a) => a.status === s.id);
      return `<div class="column" data-status="${s.id}">
        <div class="column-header"><span class="dot" style="background:var(--s-${s.id})"></span>${s.label}<span class="count">${items.length}</span></div>
        ${items.map(cardHtml).join('')}
      </div>`;
    }).join('');
  }

  function renderTable(list) {
    el.tableBody.innerHTML = list.map((a) => {
      const url = safeUrl(a.url);
      return `<tr data-id="${escapeHtml(a.id)}">
        <td><strong>${escapeHtml(a.company)}</strong></td>
        <td>${escapeHtml(a.role)}</td>
        <td><span class="badge"><span class="dot" style="background:var(--s-${a.status})"></span>${statusLabel(a.status)}</span></td>
        <td>${fmtDate(a.dateApplied)}</td>
        <td>${fmtDate(a.followUp)}</td>
        <td>${escapeHtml(a.location)}</td>
        <td>${escapeHtml(a.salary)}</td>
        <td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Posting ↗</a>` : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">No matches.</td></tr>';
  }

  // ---------- CRUD ----------

  function openDialog(id) {
    editingId = id || null;
    el.form.reset();
    const app = id ? apps.find((a) => a.id === id) : null;
    el.dialogTitle.textContent = app ? 'Edit application' : 'Add application';
    el.deleteBtn.hidden = !app;
    if (app) {
      for (const f of FIELDS) if (el.form.elements[f]) el.form.elements[f].value = app[f] || '';
    } else {
      el.form.elements.status.value = 'applied';
      el.form.elements.dateApplied.value = todayStr();
    }
    el.dialog.showModal();
    el.form.elements.company.focus();
  }

  function upsert(data) {
    const now = new Date().toISOString();
    if (editingId) {
      const app = apps.find((a) => a.id === editingId);
      if (!app) return;
      if (app.status !== data.status) app.history.push({ from: app.status, to: data.status, at: now });
      Object.assign(app, data, { updatedAt: now });
    } else {
      apps.push(normalize({ ...data, id: uid(), createdAt: now, updatedAt: now,
        history: [{ from: null, to: data.status, at: now }] }));
    }
    save();
    render();
  }

  function setStatus(id, status) {
    const app = apps.find((a) => a.id === id);
    if (!app || app.status === status || !STATUS_IDS.has(status)) return;
    const now = new Date().toISOString();
    app.history.push({ from: app.status, to: status, at: now });
    app.status = status;
    app.updatedAt = now;
    if (status === 'applied' && !app.dateApplied) app.dateApplied = todayStr();
    save();
    render();
  }

  function remove(id) {
    apps = apps.filter((a) => a.id !== id);
    save();
    render();
  }

  // ---------- Import / export ----------

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCsv() {
    const rows = [FIELDS, ...apps.map((a) => FIELDS.map((f) => f === 'status' ? statusLabel(a.status) : a[f]))];
    download(`job-applications-${todayStr()}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  }

  function exportJson() {
    download(`job-applications-${todayStr()}.json`, JSON.stringify(apps, null, 2), 'application/json');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('Expected a JSON array of applications.');
        const incoming = data.map(normalize).filter(Boolean);
        const replace = apps.length && confirm(
          `Import ${incoming.length} application(s).\n\nOK = replace your current ${apps.length}\nCancel = merge with existing`);
        if (replace) {
          apps = incoming;
        } else {
          const byId = new Map(apps.map((a) => [a.id, a]));
          for (const a of incoming) byId.set(a.id, a);
          apps = [...byId.values()];
        }
        save();
        render();
      } catch (err) {
        alert('Could not import file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Theme ----------

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  }
  const storedTheme = safeGet(THEME_KEY);
  applyTheme(storedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  // ---------- Events ----------

  STATUSES.forEach((s) => {
    el.statusFilter.add(new Option(s.label, s.id));
    el.statusSelect.add(new Option(s.label, s.id));
  });

  $('#add-btn').addEventListener('click', () => openDialog());
  $('#cancel-btn').addEventListener('click', () => el.dialog.close());
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    safeSet(THEME_KEY, next);
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {};
    for (const f of FIELDS) data[f] = (el.form.elements[f].value || '').trim();
    if (!data.company || !data.role) return;
    upsert(data);
    el.dialog.close();
  });

  el.deleteBtn.addEventListener('click', () => {
    const app = apps.find((a) => a.id === editingId);
    if (app && confirm(`Delete ${app.company} — ${app.role}?`)) {
      remove(app.id);
      el.dialog.close();
    }
  });

  [el.search, el.statusFilter, el.sort].forEach((c) => c.addEventListener('input', render));

  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    safeSet(VIEW_KEY, view);
    render();
  }));

  el.board.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openDialog(card.dataset.id);
  });
  el.tableBody.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('tr[data-id]');
    if (row) openDialog(row.dataset.id);
  });
  el.followups.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-id]');
    if (link) openDialog(link.dataset.id);
  });

  // Drag and drop between board columns
  el.board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  el.board.addEventListener('dragend', (e) => {
    e.target.closest('.card')?.classList.remove('dragging');
    el.board.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over'));
  });
  el.board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    el.board.querySelectorAll('.drag-over').forEach((c) => c !== col && c.classList.remove('drag-over'));
    col.classList.add('drag-over');
  });
  el.board.addEventListener('drop', (e) => {
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('drag-over');
    setStatus(e.dataTransfer.getData('text/plain'), col.dataset.status);
  });

  $('#export-csv').addEventListener('click', exportCsv);
  $('#export-json').addEventListener('click', exportJson);
  $('#import-json').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importJson(file);
    e.target.value = '';
  });

  // Keep multiple open tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { apps = load(); render(); }
  });

  render();
})();
