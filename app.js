(() => {
  'use strict';

  const STORAGE_KEY = 'job-tracker.applications.v1';
  const THEME_KEY = 'job-tracker.theme';
  const VIEW_KEY = 'job-tracker.view';
  const DB_COLLECTION = 'applications';

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
    emptyText: $('#empty-text'),
    examplesBtn: $('#examples-btn'),
    examplesBanner: $('#examples-banner'),
    followups: $('#followups'),
    dialog: $('#app-dialog'),
    form: $('#app-form'),
    dialogTitle: $('#dialog-title'),
    statusSelect: $('#status-select'),
    deleteBtn: $('#delete-btn'),
    toast: $('#toast'),
    exportCsv: $('#export-csv'),
    exportJson: $('#export-json'),
  };

  // ---------- Helpers ----------

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  const statusLabel = (id) => (STATUSES.find((s) => s.id === id) || {}).label || id;
  const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
  const offsetDate = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA');

  function fmtDate(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    if (!y) return d;
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
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

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3500);
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const app = {};
    for (const f of FIELDS) app[f] = raw[f] == null ? '' : String(raw[f]);
    if (!app.company && !app.role) return null;
    if (!STATUS_IDS.has(app.status)) app.status = 'applied';
    app.id = raw.id && /^[A-Za-z0-9_\-.~:@+]{1,100}$/.test(String(raw.id)) ? String(raw.id) : uid();
    app.createdAt = raw.createdAt || new Date().toISOString();
    app.updatedAt = raw.updatedAt || app.createdAt;
    app.history = Array.isArray(raw.history) ? raw.history : [];
    app.example = raw.example === true;
    return app;
  }

  // ---------- Storage ----------
  // Browser localStorage by default. When the page runs as a claude.ai
  // artifact with the `db` capability, applications are kept in the
  // artifact's database instead, so they follow the user across devices.

  const embedded = typeof window.claude?.use === 'function';
  let db = null;
  let loading = embedded;

  function loadLocal() {
    try {
      const data = JSON.parse(safeGet(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data.map(normalize).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function saveLocal() {
    safeSet(STORAGE_KEY, JSON.stringify(apps));
  }

  function reportWriteError(err) {
    toast(err && err.code === 'quota_exceeded'
      ? 'Storage is full. Delete some applications and try again.'
      : 'Could not save your change. Check your connection and try again.');
  }

  function persist(app) {
    if (!db) return saveLocal();
    db.collection(DB_COLLECTION).doc(app.id).set({ ...app }).catch(reportWriteError);
  }

  function unpersist(id) {
    if (!db) return saveLocal();
    db.collection(DB_COLLECTION).doc(id).delete().catch(reportWriteError);
  }

  async function connectDb() {
    if (!embedded) return;
    try {
      db = await window.claude.use('db');
    } catch {
      db = null;
    }
    if (!db) {
      apps = loadLocal();
      loading = false;
      render();
      return;
    }
    db.collection(DB_COLLECTION).onSnapshot((snap) => {
      apps = snap.docs.map((d) => normalize({ ...d.data(), id: d.id })).filter(Boolean);
      loading = false;
      render();
    }, () => {
      loading = false;
      toast('Lost connection to your saved applications. Reload the page to reconnect.');
      render();
    });
  }

  let apps = embedded ? [] : loadLocal();
  let view = safeGet(VIEW_KEY) === 'table' ? 'table' : 'board';
  let editingId = null;

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
    const hasApps = apps.length !== 0;
    el.empty.hidden = hasApps;
    el.emptyText.innerHTML = loading
      ? 'Loading your applications…'
      : 'No applications yet. Click <strong>+ Add application</strong> to start tracking, or load a few examples to see how it works.';
    el.examplesBtn.hidden = loading;
    el.examplesBanner.hidden = !apps.some((a) => a.example);
    el.board.hidden = view !== 'board' || !hasApps;
    el.tableView.hidden = view !== 'table' || !hasApps;
    if (view === 'board') renderBoard(list); else renderTable(list);
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
      b.setAttribute('aria-selected', b.dataset.view === view);
    });
  }

  function renderStats() {
    const count = (s) => apps.filter((a) => a.status === s).length;
    const submitted = apps.filter((a) => a.status !== 'wishlist').length;
    const responded = apps.filter((a) => ['screening', 'interviewing', 'offer', 'rejected'].includes(a.status)).length;
    const responseRate = submitted ? Math.round((responded / submitted) * 100) + '%' : '—';
    const weekAgo = offsetDate(-7);
    const thisWeek = apps.filter((a) => a.status !== 'wishlist' && a.dateApplied && a.dateApplied >= weekAgo).length;

    const tiles = [
      ['Total', apps.length],
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
      return `<li><button type="button" class="link" data-id="${escapeHtml(a.id)}">${escapeHtml(a.company)} — ${escapeHtml(a.role)}</button> · ${when}</li>`;
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
    const example = a.example ? '<span class="example-tag">Example</span>' : '';
    return `<article class="card" draggable="true" tabindex="0" data-id="${escapeHtml(a.id)}">
      <div class="company">${prio}${escapeHtml(a.company)}${example}</div>
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
        <td><strong>${escapeHtml(a.company)}</strong>${a.example ? '<span class="example-tag">Example</span>' : ''}</td>
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

  function resetDeleteBtn() {
    el.deleteBtn.dataset.armed = '';
    el.deleteBtn.textContent = 'Delete';
  }

  function openDialog(id) {
    editingId = id || null;
    el.form.reset();
    resetDeleteBtn();
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
    let app;
    if (editingId) {
      app = apps.find((a) => a.id === editingId);
      if (!app) return;
      if (app.status !== data.status) app.history.push({ from: app.status, to: data.status, at: now });
      Object.assign(app, data, { updatedAt: now, example: false });
    } else {
      app = normalize({ ...data, id: uid(), createdAt: now, updatedAt: now,
        history: [{ from: null, to: data.status, at: now }] });
      apps.push(app);
    }
    persist(app);
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
    persist(app);
    render();
  }

  function remove(id) {
    apps = apps.filter((a) => a.id !== id);
    unpersist(id);
    render();
  }

  // ---------- Examples ----------

  function loadExamples() {
    const now = new Date().toISOString();
    const samples = [
      { company: 'Northwind Labs', role: 'Senior Frontend Engineer', status: 'interviewing', dateApplied: offsetDate(-12), location: 'Remote (US)', salary: '$150k–175k', source: 'Referral', contact: 'Priya Shah, Eng Manager', followUp: offsetDate(1), priority: 'high', notes: 'Onsite loop next week: system design + pairing session.' },
      { company: 'Halcyon Health', role: 'Product Engineer', status: 'screening', dateApplied: offsetDate(-6), location: 'Boston, MA', salary: '$135k', source: 'LinkedIn', followUp: offsetDate(-1), priority: 'medium', notes: 'Recruiter call went well. Waiting on hiring manager.' },
      { company: 'Brightline Freight', role: 'Full Stack Developer', status: 'applied', dateApplied: offsetDate(-3), location: 'Hybrid, Chicago', salary: '$120k–140k', source: 'Company site' },
      { company: 'Cobalt Studio', role: 'UI Engineer', status: 'wishlist', location: 'Remote', notes: 'Portfolio review required. Update case studies first.' },
      { company: 'Meridian Bank', role: 'Software Engineer II', status: 'rejected', dateApplied: offsetDate(-30), location: 'New York, NY', source: 'Indeed' },
      { company: 'Fernwood Games', role: 'Tools Engineer', status: 'offer', dateApplied: offsetDate(-40), location: 'Remote', salary: '$145k + equity', priority: 'high', followUp: offsetDate(4), notes: 'Offer expires in two weeks. Negotiate start date.' },
    ];
    for (const s of samples) {
      const app = normalize({ ...s, id: uid(), createdAt: now, updatedAt: now, example: true,
        history: [{ from: null, to: s.status, at: now }] });
      apps.push(app);
      persist(app);
    }
    render();
  }

  function clearExamples() {
    for (const a of apps.filter((x) => x.example)) remove(a.id);
    toast('Examples removed.');
  }

  // ---------- Import / export ----------

  let downloads = null;

  async function saveFile(filename, content, type) {
    if (downloads) {
      try {
        await downloads.save({ filename, data: content });
      } catch (err) {
        if (err && err.code !== 'declined') toast('Could not save the file. Try again in a moment.');
      }
      return;
    }
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
    saveFile(`job-applications-${todayStr()}.csv`, rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  }

  function exportJson() {
    saveFile(`job-applications-${todayStr()}.json`, JSON.stringify(apps, null, 2), 'application/json');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('the file should contain a list of applications');
        const incoming = data.map(normalize).filter(Boolean);
        // Merge: entries with a matching id are replaced, others are added.
        const byId = new Map(apps.map((a) => [a.id, a]));
        for (const a of incoming) { byId.set(a.id, a); persist(a); }
        apps = [...byId.values()];
        if (!db) saveLocal();
        render();
        toast(`Imported ${incoming.length} application${incoming.length === 1 ? '' : 's'}.`);
      } catch (err) {
        toast(`Could not import that file: ${err.message}. Choose a JSON backup made by this tracker.`);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Theme ----------
  // No stored choice means "follow the system"; the CSS handles that.

  const storedTheme = safeGet(THEME_KEY);
  if (storedTheme === 'dark' || storedTheme === 'light') document.documentElement.dataset.theme = storedTheme;

  function currentTheme() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // ---------- Events ----------

  STATUSES.forEach((s) => {
    el.statusFilter.add(new Option(s.label, s.id));
    el.statusSelect.add(new Option(s.label, s.id));
  });

  $('#add-btn').addEventListener('click', () => openDialog());
  $('#cancel-btn').addEventListener('click', () => el.dialog.close());
  el.examplesBtn.addEventListener('click', loadExamples);
  $('#clear-examples').addEventListener('click', clearExamples);
  $('#theme-toggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
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

  // Two-step delete: the first click asks for confirmation in place.
  el.deleteBtn.addEventListener('click', () => {
    const app = apps.find((a) => a.id === editingId);
    if (!app) return;
    if (!el.deleteBtn.dataset.armed) {
      el.deleteBtn.dataset.armed = '1';
      el.deleteBtn.textContent = 'Click again to delete';
      return;
    }
    remove(app.id);
    el.dialog.close();
    toast(`Deleted ${app.company}.`);
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
  el.board.addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDialog(card.dataset.id); }
  });
  el.tableBody.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('tr[data-id]');
    if (row) openDialog(row.dataset.id);
  });
  el.followups.addEventListener('click', (e) => {
    const link = e.target.closest('[data-id]');
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

  el.exportCsv.addEventListener('click', exportCsv);
  el.exportJson.addEventListener('click', exportJson);
  $('#import-json').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importJson(file);
    e.target.value = '';
  });

  // Keep multiple open tabs in sync (localStorage mode)
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && !db) { apps = loadLocal(); render(); }
  });

  if (embedded) {
    // Plain downloads are blocked inside an artifact; exports go through
    // the downloads capability, or are hidden if it is unavailable.
    el.exportCsv.hidden = el.exportJson.hidden = true;
    window.claude.use('downloads').then((d) => {
      downloads = d;
      el.exportCsv.hidden = el.exportJson.hidden = !d;
    }, () => {});
  }

  render();
  connectDb();
})();
