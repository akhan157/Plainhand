const state = {
  payload: null,
  activeSurface: 'both',
  activeStatus: 'all',
  search: '',
  sort: 'date-desc',
  selectedId: null,
};

const dataUrl = document.querySelector('meta[name="dashboard-data-url"]')?.content || '/api/apps';

const summaryEl = document.querySelector('#summary');
const surfaceTabsEl = document.querySelector('#surfaceTabs');
const statusTabsEl = document.querySelector('#statusTabs');
const statusPanelNoteEl = document.querySelector('#statusPanelNote');
const appRowsEl = document.querySelector('#appRows');
const mobileCardsEl = document.querySelector('#mobileCards');
const resultsTitleEl = document.querySelector('#resultsTitle');
const resultsMetaEl = document.querySelector('#resultsMeta');
const trackedSectionEl = document.querySelector('#trackedSection');
const pendingSectionEl = document.querySelector('#pendingSection');
const pendingRowsEl = document.querySelector('#pendingRows');
const pendingMobileCardsEl = document.querySelector('#pendingMobileCards');
const pendingTitleEl = document.querySelector('#pendingTitle');
const pendingMetaEl = document.querySelector('#pendingMeta');
const detailEmptyEl = document.querySelector('#detailEmpty');
const detailContentEl = document.querySelector('#detailContent');
const searchInputEl = document.querySelector('#searchInput');
const sortSelectEl = document.querySelector('#sortSelect');
const refreshButtonEl = document.querySelector('#refreshButton');
const mobileSheetEl = document.querySelector('#mobileSheet');
const mobileSheetContentEl = document.querySelector('#mobileSheetContent');
const mobileSheetCloseEl = document.querySelector('#mobileSheetClose');
const mobileSheetPanelEl = document.querySelector('.mobile-sheet-panel');
const mobileSheetHeadEl = document.querySelector('.mobile-sheet-head');
const mobileSheetHandleEl = document.querySelector('#mobileSheetHandle');
const mobileSheetBackdropEl = document.querySelector('#mobileSheetBackdrop');
const dragState = { active: false, startY: 0, currentY: 0 };
let closeTimer = null;

searchInputEl.addEventListener('input', (event) => {
  state.search = event.target.value.trim().toLowerCase();
  render();
});

sortSelectEl.addEventListener('change', (event) => {
  state.sort = event.target.value;
  render();
});

refreshButtonEl.addEventListener('click', () => load());
mobileSheetCloseEl.addEventListener('click', () => closeMobileSheet());
mobileSheetBackdropEl.addEventListener('click', () => closeMobileSheet());
mobileSheetHeadEl.addEventListener('touchstart', startSheetTouch, { passive: false });
window.addEventListener('touchmove', moveSheetTouch, { passive: false });
window.addEventListener('touchend', endSheetTouch, { passive: false });
window.addEventListener('touchcancel', endSheetTouch, { passive: false });
mobileSheetHeadEl.addEventListener('mousedown', startSheetMouse);
window.addEventListener('mousemove', moveSheetMouse);
window.addEventListener('mouseup', endSheetMouse);

window.addEventListener('resize', () => {
  if (!isMobile()) {
    closeMobileSheet();
  }
});

await load();

async function load() {
  summaryEl.innerHTML = '<article class="summary-card"><p>Loading dashboard…</p></article>';
  try {
    const response = await fetch(dataUrl, { cache: 'no-store' });
    if (!response.ok) {
      summaryEl.innerHTML = `<article class="summary-card error-card"><p>Failed to load dashboard: ${response.status}</p><p><a href="#" onclick="location.reload();return false;">Retry</a></p></article>`;
      return;
    }
    state.payload = await response.json();
  } catch (error) {
    summaryEl.innerHTML = '<article class="summary-card error-card"><p>Failed to load dashboard: network or data error.</p><p><a href="#" onclick="location.reload();return false;">Retry</a></p></article>';
    return;
  }
  if (!state.selectedId && state.payload.apps.length > 0) {
    state.selectedId = state.payload.apps[0].id;
  }
  render();
}

function render() {
  if (!state.payload) return;

  const filtered = sortApps(filterApps(state.payload.apps));
  const filteredPending = filterPending(state.payload.pending?.items || []);
  if (filtered.length === 0) {
    state.selectedId = null;
  } else if (!filtered.some((app) => app.id === state.selectedId)) {
    state.selectedId = filtered[0].id;
  }
  renderSummary(state.payload, filtered, filteredPending);
  renderSurfaceTabs(state.payload);
  renderTabs(state.payload);
  renderPendingSection(filteredPending);
  renderRows(filtered);
  renderMobileCards(filtered);
  renderDetails(filtered);
}

function renderSummary(payload, filtered, filteredPending) {
  const selected = payload.apps.find((app) => app.id === state.selectedId);
  const generated = new Date(payload.generatedAt).toLocaleString();
  const highest = filtered.reduce((max, app) => Math.max(max, app.score || 0), 0);
  const pendingSections = new Set(filteredPending.map((item) => item.section)).size;
  let cards;

  if (state.activeSurface === 'pending') {
    cards = [
      metricCard('Visible Pending', String(filteredPending.length), 'Current queue result'),
      metricCard('Pending Total', String(payload.pending?.count || 0), `${filteredPending.length} visible in queue`),
      metricCard('Tracked Apply', String(payload.counts.actionable), 'Tracked rows in explicit Apply state'),
      metricCard('Tracked Total', String(payload.counts.all), 'Applications already in tracker'),
      metricCard('Sections', String(pendingSections), generated),
    ];
  } else {
    const visibleLabel = state.activeSurface === 'both' ? 'Visible Tracked' : 'Visible';
    const visibleNote = state.activeSurface === 'both'
      ? 'Tracked rows matching current status/search; pending queue shown separately'
      : 'Current tracked filter result';
    cards = [
      metricCard(visibleLabel, String(filtered.length), visibleNote),
      metricCard('Pending', String(payload.pending?.count || 0), `${filteredPending.length} visible in queue`),
      metricCard('Apply Next', String(payload.counts.actionable), 'Explicit Apply bucket'),
      metricCard('With PDF', String(payload.counts.withPdf), 'Tracker rows marked with PDF'),
      metricCard('Top Score', highest ? `${highest.toFixed(1)}/5` : '0.0/5', generated),
    ];
  }

  const workflowHealth = payload.workflow?.health;
  const workflowItems = payload.workflow?.followUpQueue?.reduce(
    (total, group) => total + (Array.isArray(group.items) ? group.items.length : 0),
    0,
  ) || 0;
  const workflowNote = workflowHealth
    ? `${workflowHealth.overdue || 0} overdue · ${workflowHealth.due || 0} due · ${workflowHealth.upcoming || 0} upcoming`
    : 'Read-only workflow projection unavailable';
  cards.push(metricCard('Workflow Queue', String(workflowHealth ? workflowItems : '—'), workflowNote));

  summaryEl.innerHTML = cards.join('');

  resultsTitleEl.textContent = state.activeStatus === 'all'
    ? 'Tracked Applications'
    : `${statusLabel(state.activeStatus, payload.states)} Tracked Applications`;
  resultsMetaEl.textContent = selected
    ? `Selected: ${selected.company} • ${selected.role}`
    : `${filtered.length} results`;
}

function renderSurfaceTabs(payload) {
  const trackedLabel = `Tracked (${payload.counts.all})`;
  const pendingLabel = `Pending (${payload.pending?.count || 0})`;
  surfaceTabsEl.innerHTML = [
    tabButton('both', 'Both', state.activeSurface === 'both'),
    tabButton('tracked', trackedLabel, state.activeSurface === 'tracked'),
    tabButton('pending', pendingLabel, state.activeSurface === 'pending'),
  ].join('');
  for (const button of surfaceTabsEl.querySelectorAll('button[data-status]')) {
    button.addEventListener('click', () => {
      state.activeSurface = button.dataset.status;
      render();
    });
  }
}

function metricCard(label, value, note) {
  return `
    <article class="summary-card">
      <p class="eyebrow">${escapeHtml(label)}</p>
      <h2>${escapeHtml(value)}</h2>
      <p class="muted">${escapeHtml(note)}</p>
    </article>
  `;
}

function renderTabs(payload) {
  if (state.activeSurface === 'pending') {
    statusTabsEl.innerHTML = '';
    if (statusPanelNoteEl) {
      statusPanelNoteEl.textContent = 'Pending queue mode: search applies to the queue; status tabs only affect tracked applications.';
    }
    return;
  }
  if (statusPanelNoteEl) {
    statusPanelNoteEl.textContent = state.activeSurface === 'both'
      ? 'Status tabs filter tracked applications only. Pending queue remains visible below.'
      : 'Hot path: filter tracked applications, inspect reports, open artifacts, apply.';
  }
  const allCount = payload.counts.all;
  const buttons = [
    tabButton('all', `All (${allCount})`, state.activeStatus === 'all'),
    ...payload.states.map((entry) => tabButton(entry.id, `${entry.label} (${entry.count})`, state.activeStatus === entry.id)),
  ];
  statusTabsEl.innerHTML = buttons.join('');
  for (const button of statusTabsEl.querySelectorAll('button[data-status]')) {
    button.addEventListener('click', () => {
      state.activeStatus = button.dataset.status;
      render();
    });
  }
}

function tabButton(status, label, active) {
  return `<button class="${active ? 'status-tab active' : 'status-tab'}" type="button" data-status="${escapeHtml(status)}">${escapeHtml(label)}</button>`;
}

function filterApps(apps) {
  if (state.activeSurface === 'pending') {
    return [];
  }
  return apps.filter((app) => {
    if (state.activeStatus !== 'all' && app.statusId !== state.activeStatus) {
      return false;
    }
    if (!state.search) return true;
    const haystack = [
      app.company,
      app.role,
      app.status,
      app.notes,
      app.reportSummary?.tldr,
      app.reportSummary?.verdict,
    ].join(' ').toLowerCase();
    return haystack.includes(state.search);
  });
}

function filterPending(items) {
  if (state.activeSurface === 'tracked') {
    return [];
  }
  return items.filter((item) => {
    if (!state.search) return true;
    const haystack = [
      item.section,
      item.company,
      item.role,
      item.location,
      item.comp,
      item.note,
    ].join(' ').toLowerCase();
    return haystack.includes(state.search);
  });
}

function sortApps(apps) {
  const sorted = [...apps];
  sorted.sort((left, right) => {
    switch (state.sort) {
      case 'score-desc':
        return (right.score || 0) - (left.score || 0) || right.id - left.id;
      case 'company-asc':
        return left.company.localeCompare(right.company) || right.id - left.id;
      case 'status-asc':
        return left.status.localeCompare(right.status) || right.id - left.id;
      case 'date-desc':
      default:
        return right.date.localeCompare(left.date) || right.id - left.id;
    }
  });
  return sorted;
}

function renderRows(apps) {
  const showTracked = state.activeSurface !== 'pending';
  trackedSectionEl.hidden = !showTracked;
  mobileCardsEl.style.display = showTracked && isMobile() ? 'grid' : 'none';
  if (!showTracked) {
    appRowsEl.innerHTML = '';
    mobileCardsEl.innerHTML = '';
    return;
  }
  if (apps.length === 0) {
    appRowsEl.innerHTML = '<tr><td colspan="6" class="empty-row">No applications match this filter.</td></tr>';
    return;
  }

  appRowsEl.innerHTML = apps.map((app) => `
    <tr class="${app.id === state.selectedId ? 'selected-row' : ''}" data-id="${app.id}">
      <td>${app.id}</td>
      <td>
        <strong>${escapeHtml(app.company)}</strong>
        <span class="subline">${escapeHtml(app.role)}</span>
      </td>
      <td><span class="pill pill-${escapeHtml(app.statusId)}">${escapeHtml(app.status)}</span></td>
      <td>${escapeHtml(app.scoreRaw)}</td>
      <td>${escapeHtml(app.date)}</td>
      <td>${inlineLinks(app)}</td>
    </tr>
  `).join('');

  for (const row of appRowsEl.querySelectorAll('tr[data-id]')) {
    row.addEventListener('click', () => {
      state.selectedId = Number(row.dataset.id);
      render();
    });
  }
}

function renderPendingSection(items) {
  const showPending = state.activeSurface !== 'tracked';
  pendingSectionEl.hidden = !showPending;
  if (!showPending) {
    pendingRowsEl.innerHTML = '';
    pendingMobileCardsEl.innerHTML = '';
    return;
  }

  pendingTitleEl.textContent = 'Pending Pipeline';
  pendingMetaEl.textContent = `${items.length} visible pending item${items.length === 1 ? '' : 's'}`;

  if (items.length === 0) {
    pendingRowsEl.innerHTML = '<tr><td colspan="5" class="empty-row">No pending pipeline items match this filter.</td></tr>';
    pendingMobileCardsEl.innerHTML = '';
    pendingMobileCardsEl.style.display = 'none';
    return;
  }

  pendingRowsEl.innerHTML = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.section)}</td>
      <td>
        <strong>${escapeHtml(item.company || 'Unknown')}</strong>
        <span class="subline">${escapeHtml(item.role || item.sourceLine)}</span>
        ${item.note ? `<span class="subline muted">${escapeHtml(item.note)}</span>` : ''}
      </td>
      <td>${escapeHtml(item.location || '—')}</td>
      <td>${escapeHtml(item.comp || '—')}</td>
      <td>${pendingLinks(item)}</td>
    </tr>
  `).join('');

  pendingMobileCardsEl.innerHTML = items.map((item) => `
    <article class="mobile-card pending-card">
      <div class="mobile-card-head">
        <div class="mobile-card-title">
          <p class="eyebrow">${escapeHtml(item.section)}</p>
          <h3>${escapeHtml(item.company || 'Unknown')}</h3>
        </div>
        <span class="pill pill-pending">Pending</span>
      </div>
      <p class="mobile-role">${escapeHtml(item.role || item.sourceLine)}</p>
      <div class="mobile-meta-row">
        <span class="score-chip">${escapeHtml(item.location || 'No location')}</span>
        <span class="mobile-date">${escapeHtml(item.comp || 'No comp')}</span>
      </div>
      ${item.note ? `<p class="muted pending-note">${escapeHtml(item.note)}</p>` : ''}
      <div class="mobile-actions">${pendingQuickLinks(item)}</div>
    </article>
  `).join('');
  pendingMobileCardsEl.style.display = isMobile() ? 'grid' : 'none';
}

function renderMobileCards(apps) {
  if (state.activeSurface === 'pending') {
    mobileCardsEl.innerHTML = '';
    mobileCardsEl.style.display = 'none';
    return;
  }
  mobileCardsEl.innerHTML = apps.map((app) => `
    <article class="${app.id === state.selectedId ? 'mobile-card selected-card' : 'mobile-card'}" data-id="${app.id}">
      <div class="mobile-card-head">
        <div class="mobile-card-title">
          <p class="eyebrow">#${app.id}</p>
          <h3>${escapeHtml(app.company)}</h3>
        </div>
        <span class="pill pill-${escapeHtml(app.statusId)}">${escapeHtml(app.status)}</span>
      </div>
      <p class="mobile-role">${escapeHtml(app.role)}</p>
      <div class="mobile-meta-row">
        <span class="score-chip">${escapeHtml(app.scoreRaw)}</span>
        <span class="mobile-date">${escapeHtml(app.date)}</span>
      </div>
      <div class="mobile-actions">${mobileQuickLinks(app)}</div>
    </article>
  `).join('');

  for (const card of mobileCardsEl.querySelectorAll('article[data-id]')) {
    card.addEventListener('click', () => {
      state.selectedId = Number(card.dataset.id);
      render();
      openMobileSheet();
    });
  }

  for (const link of mobileCardsEl.querySelectorAll('a[data-stop]')) {
    link.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }
}

function renderDetails(apps) {
  if (state.activeSurface === 'pending') {
    detailEmptyEl.hidden = false;
    detailContentEl.hidden = true;
    detailContentEl.innerHTML = '';
    mobileSheetContentEl.innerHTML = '';
    detailEmptyEl.innerHTML = `
      <p class="prompt-line">inspection pane</p>
      <h2>PENDING QUEUE MODE</h2>
      <p>Open pending links directly from the queue, then evaluate to move them into tracked applications.</p>
    `;
    return;
  }
  const app = apps.find((entry) => entry.id === state.selectedId) || state.payload.apps.find((entry) => entry.id === state.selectedId);
  if (!app) {
    detailEmptyEl.hidden = false;
    detailContentEl.hidden = true;
    detailContentEl.innerHTML = '';
    mobileSheetContentEl.innerHTML = '';
    detailEmptyEl.innerHTML = `
      <p class="prompt-line">inspection pane</p>
      <h2>NO TARGET SELECTED</h2>
      <p>Open a row/card to inspect report, artifact links, and job URL.</p>
    `;
    return;
  }

  detailEmptyEl.hidden = true;
  detailContentEl.hidden = false;
  const detailMarkup = `
    <div class="detail-card">
      <p class="eyebrow">#${app.id} • ${escapeHtml(app.date)}</p>
      <h2>${escapeHtml(app.company)}</h2>
      <h3>${escapeHtml(app.role)}</h3>
      <div class="detail-meta">
        <span class="pill pill-${escapeHtml(app.statusId)}">${escapeHtml(app.status)}</span>
        <span class="score-chip">${escapeHtml(app.scoreRaw)}</span>
      </div>
      <div class="detail-links">
        ${detailLink('Report', app.reportUrl)}
        ${detailLink('Job URL', app.reportSummary?.url)}
        ${detailLink('CV', app.outputFiles.find((file) => file.name.startsWith('cv-'))?.url)}
        ${detailLink('Cover', app.outputFiles.find((file) => file.name.startsWith('cover'))?.url)}
      </div>
    </div>

    <div class="detail-card">
      <p class="eyebrow">Summary</p>
      <p>${escapeHtml(app.reportSummary?.verdict || app.reportSummary?.tldr || app.notes || 'No summary found.')}</p>
      ${app.notes ? `<p class="muted"><strong>Notes:</strong> ${escapeHtml(app.notes)}</p>` : ''}
      ${app.reportSummary?.remote ? `<p class="muted"><strong>Remote:</strong> ${escapeHtml(app.reportSummary.remote)}</p>` : ''}
      ${app.reportSummary?.comp ? `<p class="muted"><strong>Comp:</strong> ${escapeHtml(app.reportSummary.comp)}</p>` : ''}
      ${app.reportSummary?.archetype ? `<p class="muted"><strong>Archetype:</strong> ${escapeHtml(app.reportSummary.archetype)}</p>` : ''}
    </div>

    ${renderTimeline(app.timeline, state.payload.timelineSources)}

    <div class="detail-card">
      <p class="eyebrow">Output Files</p>
      ${app.outputFiles.length
        ? `<ul class="file-list">${app.outputFiles.map((file) => `<li><a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">${escapeHtml(file.name)}</a></li>`).join('')}</ul>`
        : '<p class="muted">No matching output files found.</p>'}
    </div>
  `;
  detailContentEl.innerHTML = detailMarkup;
  mobileSheetContentEl.innerHTML = detailMarkup;
}

function renderTimeline(timeline, sources) {
  if (!timeline) {
    return `
      <div class="detail-card">
        <p class="eyebrow">Timeline</p>
        <p class="muted">No canonical timeline record found.</p>
      </div>
    `;
  }

  const statusHistory = timeline.statusHistory?.length
    ? `<ol class="file-list">${timeline.statusHistory.map((entry) => `
      <li><strong>${escapeHtml(entry.status)}</strong>${entry.date ? ` <span class="muted">${escapeHtml(entry.date)}</span>` : ''}</li>
    `).join('')}</ol>`
    : '<p class="muted">No status history recorded.</p>';
  const artifacts = timeline.artifacts?.length
    ? `<ul class="file-list">${timeline.artifacts.map((artifact) => `
      <li>${artifact.url
        ? `<a href="${escapeHtml(artifact.url)}" target="_blank" rel="noreferrer">${escapeHtml(artifact.path || artifact.kind)}</a>`
        : escapeHtml(artifact.path || artifact.kind)}
        ${artifact.status ? `<span class="muted">· ${escapeHtml(artifact.status)}</span>` : ''}
      </li>
    `).join('')}</ul>`
    : '<p class="muted">No artifacts recorded.</p>';
  const contacts = timeline.contacts?.length
    ? `<ul class="file-list">${timeline.contacts.map((contact) => `
      <li><strong>${escapeHtml(contact.name || 'Unnamed contact')}</strong>${contact.type ? ` <span class="muted">· ${escapeHtml(contact.type)}</span>` : ''}
        ${contact.email ? `<span class="subline">${escapeHtml(contact.email)}</span>` : ''}
        ${contact.notes ? `<span class="subline muted">${escapeHtml(contact.notes)}</span>` : ''}
      </li>
    `).join('')}</ul>`
    : '<p class="muted">No contacts recorded.</p>';
  const interviews = timeline.interviews?.length
    ? `<ul class="file-list">${timeline.interviews.map((interview) => `
      <li><strong>${escapeHtml(interview.stage || 'Interview')}</strong>${interview.date ? ` <span class="muted">${escapeHtml(interview.date)}</span>` : ''}
        ${interview.interviewer ? `<span class="subline">${escapeHtml(interview.interviewer)}</span>` : ''}
        ${interview.preparation ? `<span class="subline muted">Prep: ${escapeHtml(interview.preparation)}</span>` : ''}
      </li>
    `).join('')}</ul>`
    : '<p class="muted">No interviews recorded.</p>';
  const followUp = timeline.followUp;
  const latestFollowUp = followUp?.last;
  const ledgerStatus = Object.entries(sources || {})
    .filter(([name]) => name !== 'tracker')
    .map(([name, source]) => `${name}: ${source.status}`)
    .join(' · ');
  return `
    <div class="detail-card timeline-card">
      <p class="eyebrow">Timeline</p>
      <p><strong>Next action:</strong> ${escapeHtml(timeline.nextAction || 'No next action recorded.')}</p>
      ${followUp?.nextDate ? `<p class="muted"><strong>Next follow-up:</strong> ${escapeHtml(followUp.nextDate)}</p>` : ''}
      ${latestFollowUp ? `<p class="muted"><strong>Last follow-up:</strong> ${escapeHtml(latestFollowUp.date || 'Undated')}${latestFollowUp.contact ? ` · ${escapeHtml(latestFollowUp.contact)}` : ''}</p>` : ''}
      ${ledgerStatus ? `<p class="muted"><strong>Optional ledgers:</strong> ${escapeHtml(ledgerStatus)}</p>` : ''}
      <div class="timeline-grid">
        <section><p class="eyebrow">Status history</p>${statusHistory}</section>
        <section><p class="eyebrow">Artifacts</p>${artifacts}</section>
        <section><p class="eyebrow">Contacts</p>${contacts}</section>
        <section><p class="eyebrow">Interviews</p>${interviews}</section>
      </div>
    </div>
  `;
}


function inlineLinks(app) {
  const report = app.reportUrl ? `<a href="${escapeHtml(app.reportUrl)}" target="_blank" rel="noreferrer">Report</a>` : '';
  const pdf = app.outputFiles.find((file) => file.name.endsWith('.pdf'));
  const pdfLink = pdf ? `<a href="${escapeHtml(pdf.url)}" target="_blank" rel="noreferrer">PDF</a>` : '';
  const job = app.reportSummary?.url ? `<a href="${escapeHtml(app.reportSummary.url)}" target="_blank" rel="noreferrer">Job</a>` : '';
  return [report, pdfLink, job].filter(Boolean).join(' <span class="muted">·</span> ');
}

function detailLink(label, url) {
  if (!url) return '';
  return `<a class="ghost-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function mobileQuickLinks(app) {
  const links = [
    quickLink('Report', app.reportUrl),
    quickLink('PDF', app.outputFiles.find((file) => file.name.endsWith('.pdf'))?.url),
    quickLink('Job', app.reportSummary?.url),
  ].filter(Boolean);
  return links.join('');
}

function quickLink(label, url) {
  if (!url) return '';
  return `<a class="mini-link" data-stop="true" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function pendingLinks(item) {
  return [
    item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Job</a>` : '',
    item.company && item.role
      ? `<a href="https://www.google.com/search?q=${encodeURIComponent(`${item.company} ${item.role}`)}" target="_blank" rel="noreferrer">Search</a>`
      : '',
  ].filter(Boolean).join(' <span class="muted">·</span> ');
}

function pendingQuickLinks(item) {
  return [
    quickLink('Job', item.url),
    item.company && item.role
      ? quickLink('Search', `https://www.google.com/search?q=${encodeURIComponent(`${item.company} ${item.role}`)}`)
      : '',
  ].filter(Boolean).join('');
}

function statusLabel(statusId, states) {
  return states.find((entry) => entry.id === statusId)?.label || statusId;
}

function openMobileSheet() {
  if (!isMobile()) return;
  clearTimeout(closeTimer);
  mobileSheetEl.hidden = false;
  document.body.classList.add('sheet-open');
  mobileSheetEl.classList.remove('sheet-closing', 'sheet-dragging');
  mobileSheetEl.classList.add('sheet-opened');
  mobileSheetPanelEl.style.transition = 'none';
  mobileSheetPanelEl.style.transform = 'translateY(100%)';
  mobileSheetBackdropEl.style.transition = 'none';
  mobileSheetBackdropEl.style.opacity = '0';
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      mobileSheetPanelEl.style.transition = '';
      mobileSheetBackdropEl.style.transition = '';
      mobileSheetPanelEl.style.transform = 'translateY(0)';
      mobileSheetBackdropEl.style.opacity = '1';
    });
  });
}

function closeMobileSheet() {
  clearTimeout(closeTimer);
  dragState.active = false;
  dragState.currentY = 0;
  mobileSheetEl.classList.remove('sheet-dragging', 'sheet-opened');
  mobileSheetEl.classList.remove('sheet-opened');
  mobileSheetEl.classList.add('sheet-closing');
  mobileSheetPanelEl.style.transition = '';
  mobileSheetPanelEl.style.transform = 'translateY(100%)';
  mobileSheetBackdropEl.style.opacity = '0';
  closeTimer = window.setTimeout(() => {
    mobileSheetEl.hidden = true;
    mobileSheetEl.classList.remove('sheet-closing');
    mobileSheetPanelEl.style.transform = '';
    mobileSheetBackdropEl.style.opacity = '';
    document.body.classList.remove('sheet-open');
  }, 260);
}

function isMobile() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function startSheetDrag(clientY) {
  if (!isMobile() || mobileSheetEl.hidden) return;
  dragState.active = true;
  dragState.startY = clientY;
  dragState.currentY = 0;
  mobileSheetEl.classList.add('sheet-dragging');
  mobileSheetPanelEl.style.transition = 'none';
}

function moveSheetDrag(clientY) {
  if (!dragState.active) return;
  const delta = Math.max(0, clientY - dragState.startY);
  dragState.currentY = delta;
  mobileSheetPanelEl.style.transform = `translateY(${delta}px)`;
  mobileSheetBackdropEl.style.opacity = String(Math.max(0, 1 - (delta / 220)));
}

function endSheetDrag() {
  if (!dragState.active) return;
  dragState.active = false;
  mobileSheetEl.classList.remove('sheet-dragging');
  mobileSheetPanelEl.style.transition = '';
  mobileSheetBackdropEl.style.transition = '';
  if (dragState.currentY > 120) {
    closeMobileSheet();
    return;
  }
  mobileSheetPanelEl.style.transform = 'translateY(0)';
  mobileSheetBackdropEl.style.opacity = '1';
}

function startSheetTouch(event) {
  if (!event.touches?.length) return;
  if (!canStartSheetDrag(event.target)) return;
  startSheetDrag(event.touches[0].clientY);
  event.preventDefault();
}

function moveSheetTouch(event) {
  if (!dragState.active || !event.touches?.length) return;
  moveSheetDrag(event.touches[0].clientY);
  event.preventDefault();
}

function endSheetTouch(event) {
  if (!dragState.active) return;
  endSheetDrag();
  event.preventDefault();
}

function startSheetMouse(event) {
  if (!canStartSheetDrag(event.target)) return;
  startSheetDrag(event.clientY);
  event.preventDefault();
}

function moveSheetMouse(event) {
  if (!dragState.active) return;
  moveSheetDrag(event.clientY);
}

function endSheetMouse() {
  if (!dragState.active) return;
  endSheetDrag();
}

function canStartSheetDrag(target) {
  if (mobileSheetPanelEl.scrollTop > 4) return false;
  if (!target) return true;
  return !target.closest('button, a, input, select, textarea');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
