/* ================================================================
   RFP Intelligence Platform — SPA
   ================================================================ */

const API = 'http://localhost:8001/api';

// ================================================================
// Utils
// ================================================================
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function toast(msg, type = 'info', duration = 3500) {
  const c = $('toast-container');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const t = el('div', `toast ${type}`, `<strong>${icons[type] || '•'}</strong> ${msg}`);
  c.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function showLoader(text = 'Chargement...') {
  $('loader-text').textContent = text;
  $('loader-overlay').classList.remove('hidden');
}

function hideLoader() {
  $('loader-overlay').classList.add('hidden');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function formatBudget(min, max) {
  const fmt = n => n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace('.0', '')}M€`
    : n >= 1_000
    ? `${Math.round(n / 1_000)}k€`
    : `${n}€`;
  if (max && min) return `${fmt(min)} – ${fmt(max)}`;
  if (max) return `~${fmt(max)}`;
  if (min) return `≥${fmt(min)}`;
  return '—';
}

function deadlineDays(iso) {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso) - new Date()) / 86_400_000);
  return diff;
}

function deadlinePill(iso) {
  const days = deadlineDays(iso);
  if (days === null) return '';
  if (days < 0)  return `<span class="meta-pill" style="background:#f1f5f9;color:#94a3b8">Expiré</span>`;
  if (days <= 7)  return `<span class="meta-pill deadline-urgent">⚡ J-${days}</span>`;
  if (days <= 30) return `<span class="meta-pill deadline-soon">📅 J-${days}</span>`;
  return `<span class="meta-pill">📅 J-${days}</span>`;
}

function statusBadge(status) {
  const map = {
    new:       ['badge-new',       '● Nouveau'],
    analyzing: ['badge-analyzing', '⟳ Analyse…'],
    analyzed:  ['badge-analyzed',  '✓ Analysé'],
    archived:  ['badge-archived',  '○ Archivé'],
  };
  const [cls, label] = map[status] || ['badge-new', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function complexityBadge(c) {
  if (!c) return '';
  const map = { low: ['complexity-low','Faible'], medium: ['complexity-medium','Moyen'], high: ['complexity-high','Élevé'] };
  const [cls, label] = map[c] || ['', c];
  return `<span class="badge ${cls}">⬡ ${label}</span>`;
}

function sourceBadge(s) {
  const map = { boamp: ['source-boamp','BOAMP'], ted: ['source-ted','TED EU'], manual: ['source-manual','Manuel'], url: ['source-url','URL'] };
  const [cls, label] = map[s] || ['source-manual', s];
  return `<span class="badge ${cls}">${label}</span>`;
}

function riskBadge(r) {
  if (!r) return '';
  const map = { low: '#dcfce7:#15803d', medium: '#fef3c7:#b45309', high: '#fee2e2:#b91c1c' };
  const [bg, color] = (map[r] || '#f3f4f6:#6b7280').split(':');
  const labels = { low: 'Faible', medium: 'Moyen', high: 'Élevé' };
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:20px;font-size:11.5px;font-weight:600">${labels[r] || r}</span>`;
}

function pct(p) {
  if (p == null) return '—';
  return `${Math.round(p * 100)}%`;
}

// ================================================================
// API calls
// ================================================================
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ================================================================
// App State
// ================================================================
const State = {
  currentView: 'dashboard',
  currentRFP: null,
  rfps: [],
  stats: {},
  filters: { status: 'all', source: 'all', search: '' },
};

// ================================================================
// Main App
// ================================================================
const App = {

  // --------------------------------------------------
  // Init
  // --------------------------------------------------
  async init() {
    await this.loadStats();
    this.navigate('dashboard');
    this.updateNavBadge();
  },

  async loadStats() {
    try {
      State.stats = await apiFetch('/stats');
    } catch (e) {
      console.warn('Stats not available:', e.message);
    }
  },

  updateNavBadge() {
    const badge = $('badge-new');
    if (State.stats.new > 0) {
      badge.textContent = State.stats.new;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  },

  // --------------------------------------------------
  // Router
  // --------------------------------------------------
  navigate(view, params = {}) {
    State.currentView = view;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    const views = {
      dashboard: () => this.renderDashboard(),
      rfps:      () => this.renderRFPList(),
      rfp:       () => this.renderRFPDetail(params.id),
      strategy:  () => this.renderStrategy(params.id),
      import:    () => this.renderImport(),
      scraping:  () => this.renderScraping(),
    };

    if (views[view]) views[view]();
  },

  // --------------------------------------------------
  // Dashboard
  // --------------------------------------------------
  async renderDashboard() {
    $('topbar-title').textContent = 'Dashboard';
    $('topbar-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="App.navigate('import')">
        ➕ Importer un AO
      </button>`;

    const content = $('page-content');
    content.innerHTML = '<div style="animation:none">Chargement...</div>';

    try {
      await this.loadStats();
      this.updateNavBadge();
      const s = State.stats;

      const kpis = [
        { label: 'Total AOs',      value: s.total      || 0, sub: 'dans la base',           color: '#1d4ed8' },
        { label: 'Nouveaux',       value: s.new        || 0, sub: 'à traiter',               color: '#dc2626' },
        { label: 'Analysés',       value: s.analyzed   || 0, sub: 'prêts pour stratégie',    color: '#15803d' },
        { label: 'Cette semaine',  value: s.recent_7d  || 0, sub: 'nouveaux en 7 jours',     color: '#7c3aed' },
        { label: 'Deadline 30j',   value: s.deadline_30d || 0, sub: 'à répondre ce mois',    color: '#d97706' },
      ];

      const kpiHtml = kpis.map(k => `
        <div class="kpi-card" style="--kpi-color:${k.color}">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value}</div>
          <div class="kpi-sub">${k.sub}</div>
        </div>`).join('');

      content.innerHTML = `
        <div class="kpi-grid">${kpiHtml}</div>
        <div id="recent-rfps-section"></div>`;

      // Load recent RFPs
      const { items } = await apiFetch('/rfps?limit=8');
      State.rfps = items;

      if (!items.length) {
        $('recent-rfps-section').innerHTML = `
          <div class="card">
            <div class="card-header"><div class="card-title">Appels d'offres récents</div></div>
            <div class="card-body">
              <div class="empty-state">
                <div class="empty-icon">📭</div>
                <div class="empty-title">Aucun appel d'offres</div>
                <div class="empty-sub">Importez un AO manuellement ou lancez un scraping automatique.</div>
                <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
                  <button class="btn btn-primary" onclick="App.navigate('import')">➕ Importer</button>
                  <button class="btn btn-outline" onclick="App.quickScrape()">🔍 Scraper BOAMP</button>
                </div>
              </div>
            </div>
          </div>`;
        return;
      }

      $('recent-rfps-section').innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-title">Appels d'offres récents</div>
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('rfps')">Voir tout →</button>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="background:var(--gray-50);border-bottom:1px solid var(--color-border)">
                  <th style="padding:10px 20px;text-align:left;font-size:11.5px;font-weight:700;color:var(--color-text-2);text-transform:uppercase;letter-spacing:.5px">Titre</th>
                  <th style="padding:10px 20px;text-align:left;font-size:11.5px;font-weight:700;color:var(--color-text-2);text-transform:uppercase;letter-spacing:.5px">Organisme</th>
                  <th style="padding:10px 20px;text-align:left;font-size:11.5px;font-weight:700;color:var(--color-text-2);text-transform:uppercase;letter-spacing:.5px">Deadline</th>
                  <th style="padding:10px 20px;text-align:left;font-size:11.5px;font-weight:700;color:var(--color-text-2);text-transform:uppercase;letter-spacing:.5px">Budget</th>
                  <th style="padding:10px 20px;text-align:left;font-size:11.5px;font-weight:700;color:var(--color-text-2);text-transform:uppercase;letter-spacing:.5px">Statut</th>
                  <th style="padding:10px 20px"></th>
                </tr>
              </thead>
              <tbody>
                ${items.map(r => `
                  <tr style="border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background .12s"
                      onmouseover="this.style.background='var(--gray-50)'"
                      onmouseout="this.style.background=''"
                      onclick="App.navigate('rfp',{id:'${r.id}'})">
                    <td style="padding:12px 20px;max-width:300px">
                      <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r.title)}</div>
                      <div style="font-size:11.5px;color:var(--color-text-3);margin-top:2px">${sourceBadge(r.source_type)}</div>
                    </td>
                    <td style="padding:12px 20px;font-size:12.5px;color:var(--color-text-2)">${escHtml(r.issuer || '—')}</td>
                    <td style="padding:12px 20px">${deadlinePill(r.deadline) || `<span class="text-muted">—</span>`}</td>
                    <td style="padding:12px 20px;font-size:13px;font-weight:600;color:var(--blue-700)">${formatBudget(r.budget_min, r.budget_max)}</td>
                    <td style="padding:12px 20px">${statusBadge(r.status)}</td>
                    <td style="padding:12px 20px;text-align:right">
                      <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();App.navigate('rfp',{id:'${r.id}'})">Ouvrir →</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (e) {
      content.innerHTML = `<div class="card card-body"><div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Erreur de connexion</div>
        <div class="empty-sub">Le serveur backend n'est pas accessible. Vérifiez qu'il tourne sur le port 8001.</div>
        <code style="font-size:12px;color:var(--red-600)">${e.message}</code>
      </div></div>`;
    }
  },

  // --------------------------------------------------
  // RFP List
  // --------------------------------------------------
  async renderRFPList() {
    $('topbar-title').textContent = 'Appels d\'offres';
    $('topbar-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="App.navigate('import')">➕ Importer</button>`;

    const content = $('page-content');
    content.innerHTML = `
      <div class="filters-bar">
        <input type="text" class="search-input" id="search-input" placeholder="🔍  Rechercher par titre, organisme…"
               value="${State.filters.search}" oninput="App.onFilterChange()">
        <select class="filter-select" id="filter-status" onchange="App.onFilterChange()">
          <option value="all" ${State.filters.status==='all'?'selected':''}>Tous les statuts</option>
          <option value="new"      ${State.filters.status==='new'?'selected':''}>Nouveaux</option>
          <option value="analyzing" ${State.filters.status==='analyzing'?'selected':''}>En cours</option>
          <option value="analyzed" ${State.filters.status==='analyzed'?'selected':''}>Analysés</option>
          <option value="archived" ${State.filters.status==='archived'?'selected':''}>Archivés</option>
        </select>
        <select class="filter-select" id="filter-source" onchange="App.onFilterChange()">
          <option value="all" ${State.filters.source==='all'?'selected':''}>Toutes les sources</option>
          <option value="boamp"  ${State.filters.source==='boamp'?'selected':''}>BOAMP</option>
          <option value="ted"    ${State.filters.source==='ted'?'selected':''}>TED EU</option>
          <option value="manual" ${State.filters.source==='manual'?'selected':''}>Manuel</option>
          <option value="url"    ${State.filters.source==='url'?'selected':''}>URL</option>
        </select>
        <span id="results-count" class="text-muted text-sm"></span>
      </div>
      <div id="rfp-grid" class="rfp-grid">
        ${[1,2,3,4,5,6].map(()=>`
          <div class="rfp-card" style="pointer-events:none">
            <div class="skeleton" style="height:18px;width:80%;margin-bottom:10px"></div>
            <div class="skeleton" style="height:14px;width:50%;margin-bottom:14px"></div>
            <div class="skeleton" style="height:12px;width:40%"></div>
          </div>`).join('')}
      </div>`;

    await this.loadRFPs();
  },

  async loadRFPs() {
    const f = State.filters;
    try {
      const params = new URLSearchParams({
        status: f.status, source_type: f.source, search: f.search, limit: 100,
      });
      const { items, count } = await apiFetch(`/rfps?${params}`);
      State.rfps = items;

      const countEl = $('results-count');
      if (countEl) countEl.textContent = `${count} résultat${count > 1 ? 's' : ''}`;

      const grid = $('rfp-grid');
      if (!grid) return;

      if (!items.length) {
        grid.innerHTML = `
          <div style="grid-column:1/-1">
            <div class="empty-state">
              <div class="empty-icon">🔎</div>
              <div class="empty-title">Aucun résultat</div>
              <div class="empty-sub">Essayez d'autres filtres ou importez un AO manuellement.</div>
              <button class="btn btn-primary" onclick="App.navigate('import')">➕ Importer un AO manqué</button>
            </div>
          </div>`;
        return;
      }

      grid.innerHTML = items.map(r => this._rfpCard(r)).join('');
    } catch (e) {
      toast('Erreur de chargement : ' + e.message, 'error');
    }
  },

  _rfpCard(r) {
    const tags = (() => { try { return JSON.parse(r.tags || '[]'); } catch { return []; } })();
    return `
      <div class="rfp-card" onclick="App.navigate('rfp',{id:'${r.id}'})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          ${sourceBadge(r.source_type)}
          ${statusBadge(r.status)}
        </div>
        <div class="rfp-card-title">${escHtml(r.title)}</div>
        <div class="rfp-card-issuer">🏢 ${escHtml(r.issuer || 'Organisme inconnu')}</div>
        <div class="rfp-card-meta">
          ${deadlinePill(r.deadline)}
          ${r.budget_max ? `<span class="meta-pill budget">💰 ${formatBudget(r.budget_min, r.budget_max)}</span>` : ''}
          ${r.complexity ? complexityBadge(r.complexity) : ''}
        </div>
        ${r.summary ? `<div style="font-size:12px;color:var(--color-text-2);line-height:1.55;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(r.summary)}</div>` : ''}
        ${tags.length ? `<div class="tag-list">${tags.slice(0,4).map(t=>`<span class="tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="rfp-card-footer">
          <span style="font-size:11.5px;color:var(--color-text-3)">${formatDate(r.created_at)}</span>
          <div class="rfp-card-actions">
            ${r.status === 'analyzed' ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();App.navigate('strategy',{id:'${r.id}'})">🎯 Stratégie</button>` : ''}
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();App.navigate('rfp',{id:'${r.id}'})">Ouvrir →</button>
          </div>
        </div>
      </div>`;
  },

  onFilterChange() {
    State.filters.search = $('search-input')?.value || '';
    State.filters.status = $('filter-status')?.value || 'all';
    State.filters.source = $('filter-source')?.value || 'all';
    clearTimeout(this._filterTimer);
    this._filterTimer = setTimeout(() => this.loadRFPs(), 300);
  },

  // --------------------------------------------------
  // RFP Detail
  // --------------------------------------------------
  async renderRFPDetail(rfpId) {
    $('topbar-title').textContent = 'Détail AO';
    $('topbar-actions').innerHTML = '';

    const content = $('page-content');
    content.innerHTML = `<div style="text-align:center;padding:60px">
      <div class="loader-spinner" style="margin:0 auto 12px"></div>
      <div class="text-muted">Chargement de l'appel d'offres…</div>
    </div>`;

    let rfp;
    try {
      rfp = await apiFetch(`/rfps/${rfpId}`);
      State.currentRFP = rfp;
    } catch (e) {
      content.innerHTML = `<div class="card card-body"><div class="empty-state">
        <div class="empty-icon">❌</div><div class="empty-title">AO introuvable</div>
        <button class="btn btn-outline" onclick="App.navigate('rfps')">← Retour</button>
      </div></div>`;
      return;
    }

    $('topbar-title').textContent = rfp.title.substring(0, 50) + (rfp.title.length > 50 ? '…' : '');
    $('topbar-actions').innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="App.navigate('rfps')">← Retour</button>
      ${rfp.status === 'analyzed'
        ? `<button class="btn btn-primary btn-sm" onclick="App.navigate('strategy',{id:'${rfp.id}'})">🎯 Voir stratégie</button>`
        : `<button class="btn btn-primary btn-sm" id="analyze-btn" onclick="App.startAnalysis('${rfp.id}')">⚡ Analyser</button>`
      }
      <button class="btn btn-danger btn-sm" onclick="App.deleteRFP('${rfp.id}')">🗑</button>`;

    const tags = (() => { try { return JSON.parse(rfp.tags || '[]'); } catch { return []; } })();

    content.innerHTML = `
      <div class="detail-header">
        <div class="detail-breadcrumb">
          <a onclick="App.navigate('rfps')">Appels d'offres</a> / <span>${escHtml(rfp.title.substring(0,60))}</span>
        </div>
        <div class="detail-title">${escHtml(rfp.title)}</div>
        <div class="detail-meta">
          ${statusBadge(rfp.status)}
          ${sourceBadge(rfp.source_type)}
          ${rfp.complexity ? complexityBadge(rfp.complexity) : ''}
          ${deadlinePill(rfp.deadline)}
          ${rfp.budget_max ? `<span class="meta-pill budget">💰 ${formatBudget(rfp.budget_min, rfp.budget_max)}</span>` : ''}
        </div>
        ${tags.length ? `<div class="tag-list" style="margin-top:12px">${tags.map(t=>`<span class="tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>

      <div class="detail-grid">

        <!-- LEFT : analysis -->
        <div class="analysis-card">
          <div class="analysis-tabs">
            <button class="analysis-tab active" id="tab-analysis" onclick="App.switchTab('analysis')">Analyse IA</button>
            <button class="analysis-tab" id="tab-raw" onclick="App.switchTab('raw')">Document brut</button>
          </div>
          <div class="analysis-body" id="analysis-body">
            ${rfp.analysis_json
              ? `<div class="markdown-output" id="analysis-md">${marked.parse(rfp.analysis_json)}</div>`
              : `<div class="empty-state" style="padding:40px 20px">
                  <div class="empty-icon">🤖</div>
                  <div class="empty-title">Analyse non encore générée</div>
                  <div class="empty-sub">Lancez l'analyse IA pour obtenir un résumé structuré, les exigences clés, les risques, et des scénarios financiers.</div>
                  <button class="btn btn-primary" onclick="App.startAnalysis('${rfp.id}')">⚡ Lancer l'analyse</button>
                </div>`
            }
          </div>
        </div>

        <!-- RIGHT : info -->
        <div>
          <div class="info-card" style="margin-bottom:16px">
            <div class="info-card-header">Informations</div>
            <div class="info-row">
              <div class="info-label">Organisme</div>
              <div class="info-value">${escHtml(rfp.issuer || '—')}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Deadline</div>
              <div class="info-value">${rfp.deadline ? `${formatDate(rfp.deadline)} ${deadlinePill(rfp.deadline)}` : '—'}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Budget</div>
              <div class="info-value" style="color:var(--blue-700);font-weight:700">${formatBudget(rfp.budget_min, rfp.budget_max)}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Source</div>
              <div class="info-value">${sourceBadge(rfp.source_type)}</div>
            </div>
            ${rfp.source_url ? `
            <div class="info-row">
              <div class="info-label">URL</div>
              <div class="info-value"><a href="${escHtml(rfp.source_url)}" target="_blank" style="color:var(--blue-600);text-decoration:underline;font-size:12px;word-break:break-all">${rfp.source_url.substring(0,60)}…</a></div>
            </div>` : ''}
            <div class="info-row">
              <div class="info-label">Importé le</div>
              <div class="info-value">${formatDate(rfp.created_at)}</div>
            </div>
          </div>

          <div class="info-card" style="margin-bottom:16px">
            <div class="info-card-header">Actions rapides</div>
            <div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
              ${rfp.raw_text && rfp.status !== 'analyzing' ? `
              <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="App.startAnalysis('${rfp.id}')">
                ⚡ ${rfp.status === 'analyzed' ? 'Re-analyser' : 'Analyser'}
              </button>` : ''}
              ${rfp.status === 'analyzed' ? `
              <button class="btn btn-outline" style="width:100%;justify-content:center" onclick="App.navigate('strategy',{id:'${rfp.id}'})">
                🎯 Générer stratégie
              </button>` : ''}
              <button class="btn btn-ghost" style="width:100%;justify-content:center" onclick="App.archiveRFP('${rfp.id}')">
                📦 Archiver
              </button>
            </div>
          </div>

          ${rfp.summary ? `
          <div class="info-card">
            <div class="info-card-header">Résumé rapide</div>
            <div style="padding:14px 16px;font-size:12.5px;color:var(--color-text-2);line-height:1.65">${escHtml(rfp.summary)}</div>
          </div>` : ''}
        </div>

      </div>`;

    // Store raw text for tab switching
    this._rawText = rfp.raw_text || '';
    this._analysisHtml = rfp.analysis_json ? marked.parse(rfp.analysis_json) : null;
  },

  switchTab(tab) {
    $('tab-analysis').classList.toggle('active', tab === 'analysis');
    $('tab-raw').classList.toggle('active', tab === 'raw');
    const body = $('analysis-body');
    if (tab === 'raw') {
      body.innerHTML = this._rawText
        ? `<pre style="font-size:12px;line-height:1.6;white-space:pre-wrap;color:var(--color-text-2);font-family:'SF Mono','Fira Code',monospace">${escHtml(this._rawText.substring(0, 15000))}${this._rawText.length > 15000 ? '\n\n[... tronqué ...]' : ''}</pre>`
        : '<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-sub">Aucun texte brut disponible.</div></div>';
    } else {
      body.innerHTML = this._analysisHtml
        ? `<div class="markdown-output">${this._analysisHtml}</div>`
        : `<div class="empty-state" style="padding:40px 20px">
            <div class="empty-icon">🤖</div>
            <div class="empty-title">Analyse non générée</div>
            <button class="btn btn-primary" onclick="App.startAnalysis('${State.currentRFP.id}')">⚡ Lancer l'analyse</button>
          </div>`;
    }
  },

  // --------------------------------------------------
  // Analysis (SSE streaming)
  // --------------------------------------------------
  async startAnalysis(rfpId) {
    const body = $('analysis-body');
    if (!body) return;

    // Switch to analysis tab
    this.switchTab('analysis');
    $('tab-analysis').classList.add('active');
    $('tab-raw').classList.remove('active');

    let fullText = '';
    let sectionsDone = 0;

    body.innerHTML = `
      <div class="stream-progress" id="stream-progress">
        <div class="stream-spinner"></div>
        <span id="stream-label">Initialisation de l'analyse…</span>
        <div class="progress-sections" id="progress-sections">
          ${Array.from({length:10}, (_,i) => `<div class="section-dot" id="dot-${i+1}"></div>`).join('')}
        </div>
      </div>
      <div class="markdown-output" id="stream-output"></div>`;

    const output = $('stream-output');
    const label  = $('stream-label');

    const SECTION_LABELS = [
      '', 'Résumé exécutif', 'Analyse du besoin', 'Benchmark marché',
      'Modélisation financière', 'Scénarios financiers', 'Structures de coûts',
      'Analyse concurrentielle', 'Positionnement stratégique',
      'Détection des risques', 'Recommandation finale',
    ];

    try {
      const res = await fetch(`${API}/rfps/${rfpId}/analyze`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') {
            $('stream-progress')?.remove();
            // Save the analysis
            try {
              await fetch(`${API}/rfps/${rfpId}/analysis`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ analysis_text: fullText }),
              });
              this._analysisHtml = marked.parse(fullText);
              State.currentRFP.analysis_json = fullText;
              State.currentRFP.status = 'analyzed';
              // Update topbar
              $('topbar-actions').innerHTML = `
                <button class="btn btn-outline btn-sm" onclick="App.navigate('rfps')">← Retour</button>
                <button class="btn btn-primary btn-sm" onclick="App.navigate('strategy',{id:'${rfpId}'})">🎯 Voir stratégie</button>
                <button class="btn btn-danger btn-sm" onclick="App.deleteRFP('${rfpId}')">🗑</button>`;
              toast('Analyse terminée et sauvegardée !', 'success');
            } catch {}
            return;
          }
          try {
            const data = JSON.parse(raw);
            if (data.section) {
              sectionsDone = data.section;
              const dot = $(`dot-${data.section}`);
              if (dot) dot.classList.add('done');
              if (label) label.textContent = `Section ${data.section}/10 — ${SECTION_LABELS[data.section] || ''}`;
            }
            if (data.delta) {
              fullText += data.delta;
              output.innerHTML = marked.parse(fullText);
              output.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          } catch {}
        }
      }
    } catch (e) {
      body.innerHTML = `<div class="empty-state">
        <div class="empty-icon">❌</div>
        <div class="empty-title">Erreur d'analyse</div>
        <div class="empty-sub">${escHtml(e.message)}</div>
        <button class="btn btn-outline" onclick="App.startAnalysis('${rfpId}')">Réessayer</button>
      </div>`;
      toast('Erreur : ' + e.message, 'error');
    }
  },

  // --------------------------------------------------
  // Strategy
  // --------------------------------------------------
  async renderStrategy(rfpId) {
    $('topbar-title').textContent = 'Stratégie de réponse';
    $('topbar-actions').innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="App.navigate('rfp',{id:'${rfpId}'})">← AO</button>`;

    const content = $('page-content');
    content.innerHTML = `<div style="text-align:center;padding:60px">
      <div class="loader-spinner" style="margin:0 auto 12px"></div>
      <div class="text-muted">Chargement de la stratégie…</div>
    </div>`;

    let rfp, strategy;
    try {
      [rfp, { strategy }] = await Promise.all([
        apiFetch(`/rfps/${rfpId}`),
        apiFetch(`/rfps/${rfpId}/strategy`),
      ]);
    } catch (e) {
      content.innerHTML = `<div class="card card-body"><div class="empty-state">
        <div class="empty-icon">❌</div><div class="empty-title">Erreur</div>
        <div class="empty-sub">${e.message}</div>
      </div></div>`;
      return;
    }

    $('topbar-title').textContent = `Stratégie — ${rfp.title.substring(0,40)}…`;
    $('topbar-actions').innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="App.navigate('rfp',{id:'${rfpId}'})">← AO</button>
      <button class="btn btn-primary btn-sm" id="gen-strategy-btn" onclick="App.generateStrategy('${rfpId}')">
        ${strategy ? '🔄 Régénérer' : '🎯 Générer la stratégie'}
      </button>`;

    if (!strategy) {
      content.innerHTML = `
        <div class="card">
          <div class="card-body">
            <div class="empty-state">
              <div class="empty-icon">🎯</div>
              <div class="empty-title">Stratégie non générée</div>
              <div class="empty-sub">Générez 3 scénarios de réponse (Worst / Medium / Best) basés sur l'analyse IA de cet appel d'offres.</div>
              <button class="btn btn-primary btn-lg" onclick="App.generateStrategy('${rfpId}')">🎯 Générer la stratégie</button>
            </div>
          </div>
        </div>`;
      return;
    }

    this._renderStrategyContent(rfpId, rfp, strategy, content);
  },

  _renderStrategyContent(rfpId, rfp, s, content) {
    const scenarios = [
      { key: 'worst_case',  label: 'Worst Case',  emoji: '🔴', color: '#dc2626', desc: 'Investissement minimal' },
      { key: 'medium_case', label: 'Medium Case', emoji: '🟡', color: '#d97706', desc: 'Approche équilibrée'   },
      { key: 'best_case',   label: 'Best Case',   emoji: '🟢', color: '#15803d', desc: 'Investissement maximal' },
    ];

    const scenarioCards = scenarios.map(({ key, label, emoji, color, desc }) => {
      const sc = s[key] || {};
      return `
        <div class="scenario-card" style="--scenario-color:${color}">
          <div class="scenario-header">
            <div class="scenario-label">${emoji} ${label} — ${desc}</div>
            <div class="scenario-price">${sc.price ? formatBudget(null, sc.price) : '—'}</div>
            <div class="scenario-win">Probabilité de gain : ${pct(sc.win_probability)}</div>
          </div>
          <div class="scenario-body">
            <div class="scenario-stat-row">
              <span class="scenario-stat-label">Effort total</span>
              <span class="scenario-stat-value">${sc.effort_days ? sc.effort_days + ' j/h' : '—'}</span>
            </div>
            <div class="scenario-stat-row">
              <span class="scenario-stat-label">Équipe</span>
              <span class="scenario-stat-value">${sc.team_size ? sc.team_size + ' pers.' : '—'}</span>
            </div>
            <div class="scenario-stat-row">
              <span class="scenario-stat-label">Niveau de risque</span>
              <span class="scenario-stat-value">${riskBadge(sc.risk_level)}</span>
            </div>
            ${sc.approach ? `<div class="scenario-approach">${escHtml(sc.approach)}</div>` : ''}
            ${sc.price_rationale ? `
              <div style="margin-top:12px;padding:10px;border:1px solid #e5e7eb;border-radius:6px">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-3);margin-bottom:5px">Justification prix</div>
                <div style="font-size:12px;color:var(--color-text-2);line-height:1.55">${escHtml(sc.price_rationale)}</div>
              </div>` : ''}
            ${(sc.pros?.length || sc.cons?.length) ? `
              <div class="pros-cons">
                <div class="pros-list">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-3);margin-bottom:5px">Avantages</div>
                  ${(sc.pros||[]).map(p=>`<div class="tag">✓ ${escHtml(p)}</div>`).join('')}
                </div>
                <div class="cons-list">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--color-text-3);margin-bottom:5px">Inconvénients</div>
                  ${(sc.cons||[]).map(c=>`<div class="tag">✕ ${escHtml(c)}</div>`).join('')}
                </div>
              </div>` : ''}
          </div>
        </div>`;
    }).join('');

    const differentiators = s.key_differentiators || [];

    content.innerHTML = `
      <div class="recommendation-card">
        <div class="rec-label">Recommandation IA</div>
        <div class="rec-text">${escHtml(s.recommendation || '—')}</div>
        ${differentiators.length ? `
          <div style="margin-top:12px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,.5);margin-bottom:8px">Différenciateurs clés</div>
            <div class="differentiators">
              ${differentiators.map(d=>`<span class="diff-chip">✦ ${escHtml(d)}</span>`).join('')}
            </div>
          </div>` : ''}
      </div>
      <div class="scenario-grid">${scenarioCards}</div>
      <div style="text-align:right;padding-top:8px">
        <span style="font-size:12px;color:var(--color-text-3)">Généré le ${formatDate(s.created_at)} · Basé sur l'analyse du document original</span>
      </div>`;
  },

  async generateStrategy(rfpId) {
    const btn = $('gen-strategy-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération…'; }
    showLoader('Génération de la stratégie en cours…\nCela peut prendre 15-30 secondes.');

    try {
      const { strategy } = await apiFetch(`/rfps/${rfpId}/strategy`, { method: 'POST' });
      const rfp = await apiFetch(`/rfps/${rfpId}`);
      hideLoader();
      this._renderStrategyContent(rfpId, rfp, strategy, $('page-content'));
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Régénérer'; }
      toast('Stratégie générée avec succès !', 'success');
    } catch (e) {
      hideLoader();
      if (btn) { btn.disabled = false; btn.textContent = '🎯 Générer la stratégie'; }
      toast('Erreur : ' + e.message, 'error');
    }
  },

  // --------------------------------------------------
  // Import
  // --------------------------------------------------
  renderImport() {
    $('topbar-title').textContent = 'Importer un appel d\'offres';
    $('topbar-actions').innerHTML = '';

    $('page-content').innerHTML = `
      <div style="max-width:760px;margin:0 auto">

        <div style="margin-bottom:24px">
          <h2 style="font-size:18px;font-weight:800;color:var(--color-text);margin-bottom:6px">Importer un appel d'offres</h2>
          <p style="color:var(--color-text-2);font-size:13.5px">Ajoutez manuellement un AO qui n'a pas été capté par le scraping automatique.</p>
        </div>

        <!-- Mode tabs -->
        <div class="import-tabs" style="margin-bottom:24px">
          <button class="import-tab active" id="itab-url"  onclick="App.switchImportTab('url')">🔗 URL</button>
          <button class="import-tab"        id="itab-pdf"  onclick="App.switchImportTab('pdf')">📄 PDF</button>
          <button class="import-tab"        id="itab-text" onclick="App.switchImportTab('text')">✏️  Texte</button>
        </div>

        <div class="card">
          <div class="card-body">

            <!-- URL mode -->
            <div id="import-mode-url">
              <div class="form-group">
                <label class="form-label">URL de l'appel d'offres <span class="required">*</span></label>
                <input class="form-input" id="import-url" type="url" placeholder="https://www.boamp.fr/avis/detail/..." />
                <div class="form-hint">La page sera téléchargée et analysée automatiquement.</div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Titre (optionnel)</label>
                  <input class="form-input" id="import-url-title" type="text" placeholder="Ex: CHU Bordeaux – Dossier Patient" />
                </div>
                <div class="form-group">
                  <label class="form-label">Organisme (optionnel)</label>
                  <input class="form-input" id="import-url-issuer" type="text" placeholder="Ex: CHU de Bordeaux" />
                </div>
              </div>
              <button class="btn btn-primary btn-lg" onclick="App.submitImportUrl()" style="width:100%;justify-content:center">
                🔗 Importer depuis l'URL
              </button>
            </div>

            <!-- PDF mode -->
            <div id="import-mode-pdf" class="hidden">
              <div class="form-group">
                <label class="form-label">Fichier PDF <span class="required">*</span></label>
                <label id="drop-zone" class="drop-zone" for="pdf-file-input">
                  <span class="drop-icon">📂</span>
                  <div class="drop-text">Glissez votre PDF ici ou cliquez pour sélectionner</div>
                  <div class="drop-hint">Format PDF uniquement · Max 20 Mo</div>
                  <input type="file" id="pdf-file-input" accept=".pdf" style="display:none" onchange="App.onPDFSelected(this)" />
                </label>
                <div id="pdf-filename" class="form-hint hidden"></div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Titre (optionnel)</label>
                  <input class="form-input" id="import-pdf-title" type="text" placeholder="Ex: AO Logiciel RIS" />
                </div>
                <div class="form-group">
                  <label class="form-label">Organisme (optionnel)</label>
                  <input class="form-input" id="import-pdf-issuer" type="text" placeholder="Ex: ARS Île-de-France" />
                </div>
              </div>
              <button class="btn btn-primary btn-lg" onclick="App.submitImportPDF()" style="width:100%;justify-content:center">
                📄 Importer le PDF
              </button>
            </div>

            <!-- Text mode (pour AOs manqués) -->
            <div id="import-mode-text" class="hidden">
              <div style="background:var(--blue-50);border:1px solid var(--blue-200);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:20px;font-size:12.5px;color:var(--blue-700)">
                <strong>💡 Pour les AOs manqués par le scraping</strong><br>
                Collez ici le texte d'un appel d'offres que le système n'a pas capté automatiquement.
              </div>
              <div class="form-row" style="margin-bottom:16px">
                <div class="form-group">
                  <label class="form-label">Titre <span class="required">*</span></label>
                  <input class="form-input" id="import-text-title" type="text" placeholder="Ex: Système d'Information Radiologique" />
                </div>
                <div class="form-group">
                  <label class="form-label">Organisme</label>
                  <input class="form-input" id="import-text-issuer" type="text" placeholder="Ex: CHU de Lyon" />
                </div>
              </div>
              <div class="form-row" style="margin-bottom:16px">
                <div class="form-group">
                  <label class="form-label">URL source (optionnel)</label>
                  <input class="form-input" id="import-text-url" type="url" placeholder="https://..." />
                </div>
                <div class="form-group">
                  <label class="form-label">Date limite</label>
                  <input class="form-input" id="import-text-deadline" type="date" />
                </div>
              </div>
              <div class="form-row" style="margin-bottom:16px">
                <div class="form-group">
                  <label class="form-label">Budget min (€ HT)</label>
                  <input class="form-input" id="import-text-budget-min" type="number" placeholder="50000" />
                </div>
                <div class="form-group">
                  <label class="form-label">Budget max (€ HT)</label>
                  <input class="form-input" id="import-text-budget-max" type="number" placeholder="200000" />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Texte complet de l'AO <span class="required">*</span></label>
                <textarea class="form-input form-textarea" id="import-text-raw"
                  placeholder="Collez ici le texte intégral du cahier des charges, de l'annonce ou de tout document relatif à cet appel d'offres…"></textarea>
                <div class="form-hint">Le texte sera analysé automatiquement par l'IA pour en extraire les métadonnées.</div>
              </div>
              <button class="btn btn-primary btn-lg" onclick="App.submitImportText()" style="width:100%;justify-content:center">
                ✏️ Importer et analyser
              </button>
            </div>

          </div>
        </div>
      </div>`;

    this._setupDropZone();
  },

  switchImportTab(tab) {
    ['url','pdf','text'].forEach(t => {
      $(`itab-${t}`)?.classList.toggle('active', t === tab);
      $(`import-mode-${t}`)?.classList.toggle('hidden', t !== tab);
    });
  },

  _setupDropZone() {
    const dz = $('drop-zone');
    if (!dz) return;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) this._setSelectedPDF(f);
    });
  },

  onPDFSelected(input) {
    if (input.files[0]) this._setSelectedPDF(input.files[0]);
  },

  _setSelectedPDF(file) {
    this._selectedPDF = file;
    const el = $('pdf-filename');
    el.textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(0)} Ko)`;
    el.classList.remove('hidden');
    $('drop-zone').style.borderColor = 'var(--blue-500)';
    $('drop-zone').style.background = 'var(--blue-50)';
  },

  async submitImportUrl() {
    const url   = $('import-url')?.value?.trim();
    const title = $('import-url-title')?.value?.trim();
    const issuer= $('import-url-issuer')?.value?.trim();
    if (!url) { toast('URL requise.', 'error'); return; }
    showLoader('Téléchargement et extraction en cours…');
    try {
      const { rfp, already_exists } = await apiFetch('/rfps/import-url', {
        method: 'POST',
        body: JSON.stringify({ url, title: title || undefined, issuer: issuer || undefined }),
      });
      hideLoader();
      if (already_exists) { toast('Cet AO existe déjà dans la base.', 'info'); }
      else { toast('AO importé ! Métadonnées en cours d\'extraction…', 'success'); }
      this.navigate('rfp', { id: rfp.id });
    } catch (e) {
      hideLoader(); toast('Erreur : ' + e.message, 'error');
    }
  },

  async submitImportPDF() {
    if (!this._selectedPDF) { toast('Sélectionnez un fichier PDF.', 'error'); return; }
    const title  = $('import-pdf-title')?.value?.trim() || '';
    const issuer = $('import-pdf-issuer')?.value?.trim() || '';
    const fd = new FormData();
    fd.append('file', this._selectedPDF);
    fd.append('title', title);
    fd.append('issuer', issuer);
    showLoader('Extraction du texte PDF en cours…');
    try {
      const res = await fetch(`${API}/rfps/import-pdf`, { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const { rfp } = await res.json();
      hideLoader();
      toast('PDF importé ! Métadonnées en cours d\'extraction…', 'success');
      this.navigate('rfp', { id: rfp.id });
    } catch (e) {
      hideLoader(); toast('Erreur : ' + e.message, 'error');
    }
  },

  async submitImportText() {
    const raw_text   = $('import-text-raw')?.value?.trim();
    const title      = $('import-text-title')?.value?.trim();
    const issuer     = $('import-text-issuer')?.value?.trim();
    const source_url = $('import-text-url')?.value?.trim();
    const deadline   = $('import-text-deadline')?.value?.trim();
    const budget_min = parseFloat($('import-text-budget-min')?.value) || undefined;
    const budget_max = parseFloat($('import-text-budget-max')?.value) || undefined;
    if (!raw_text) { toast('Le texte de l\'AO est requis.', 'error'); return; }
    if (!title)    { toast('Le titre est requis.', 'error'); return; }
    showLoader('Import en cours…');
    try {
      const { rfp } = await apiFetch('/rfps/import-text', {
        method: 'POST',
        body: JSON.stringify({
          raw_text, title, issuer: issuer || undefined,
          source_url: source_url || undefined,
          deadline: deadline || undefined,
          budget_min, budget_max,
        }),
      });
      hideLoader();
      toast('AO importé ! L\'IA extrait les métadonnées en arrière-plan.', 'success');
      this.navigate('rfp', { id: rfp.id });
    } catch (e) {
      hideLoader(); toast('Erreur : ' + e.message, 'error');
    }
  },

  // --------------------------------------------------
  // Scraping view
  // --------------------------------------------------
  async renderScraping() {
    $('topbar-title').textContent = 'Scraping automatique';
    $('topbar-actions').innerHTML = '';

    const content = $('page-content');
    content.innerHTML = `<div style="text-align:center;padding:40px"><div class="loader-spinner" style="margin:0 auto"></div></div>`;

    let logs = [];
    try { ({ logs } = await apiFetch('/scrape/logs?limit=20')); } catch {}

    content.innerHTML = `
      <div style="max-width:760px;margin:0 auto">

        <div class="card" style="margin-bottom:20px">
          <div class="card-header"><div class="card-title">Lancer un scraping manuel</div></div>
          <div class="card-body">
            <div class="form-row" style="margin-bottom:16px">
              <div class="form-group">
                <label class="form-label">Source</label>
                <select class="form-input filter-select" id="scrape-source" style="width:100%">
                  <option value="boamp">BOAMP (France)</option>
                  <option value="ted">TED (Europe)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Nombre de résultats max</label>
                <input class="form-input" id="scrape-max" type="number" value="20" min="1" max="100" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Mots-clés de recherche</label>
              <input class="form-input" id="scrape-query" type="text" value="logiciel santé" />
              <div class="form-hint">Exemples : "logiciel santé", "système information hospitalier", "dossier patient"</div>
            </div>
            <button class="btn btn-primary btn-lg" onclick="App.runScraping()" style="width:100%;justify-content:center">
              🔍 Lancer le scraping
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Historique des scrapings</div>
            <span class="text-muted text-sm">Automatique toutes les 6h</span>
          </div>
          <div class="card-body" id="scrape-logs-body">
            ${logs.length ? logs.map(l => `
              <div class="log-item">
                <div class="log-dot ${l.status}"></div>
                <div style="flex:1">
                  <strong style="text-transform:uppercase;font-size:12px">${l.source}</strong>
                  <span class="text-muted"> · ${formatDate(l.started_at)}</span>
                </div>
                <div style="font-size:12px;color:var(--color-text-2)">
                  ${l.status === 'done' ? `<span style="color:#15803d">+${l.rfps_new} nouveaux</span> sur ${l.rfps_found} trouvés` : ''}
                  ${l.status === 'running' ? '<span style="color:#d97706">En cours…</span>' : ''}
                  ${l.status === 'error' ? `<span style="color:var(--red-600)">Erreur</span>` : ''}
                </div>
              </div>`).join('')
            : '<div class="text-muted text-sm">Aucun scraping effectué pour l\'instant.</div>'}
          </div>
        </div>

      </div>`;
  },

  async runScraping() {
    const source     = $('scrape-source')?.value || 'boamp';
    const query      = $('scrape-query')?.value?.trim() || 'logiciel santé';
    const max_results= parseInt($('scrape-max')?.value) || 20;

    toast(`Scraping ${source.toUpperCase()} lancé en arrière-plan…`, 'info');
    try {
      await apiFetch('/scrape', {
        method: 'POST',
        body: JSON.stringify({ source, query, max_results }),
      });
      toast('Scraping démarré ! Les résultats apparaîtront automatiquement.', 'success');
      setTimeout(() => this.renderScraping(), 3000);
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    }
  },

  async quickScrape() {
    const btn  = $('quick-scrape-btn');
    const icon = $('scrape-btn-icon');
    const text = $('scrape-btn-text');
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading');
    if (icon) icon.textContent = '⏳';
    if (text) text.textContent = 'Scraping…';

    try {
      await apiFetch('/scrape', {
        method: 'POST',
        body: JSON.stringify({ source: 'boamp', query: 'logiciel santé', max_results: 20 }),
      });
      toast('Scraping BOAMP lancé !', 'success');
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    } finally {
      setTimeout(() => {
        btn.classList.remove('loading');
        if (icon) icon.textContent = '🔍';
        if (text) text.textContent = 'Lancer un scraping';
      }, 3000);
    }
  },

  // --------------------------------------------------
  // CRUD helpers
  // --------------------------------------------------
  async deleteRFP(rfpId) {
    if (!confirm('Supprimer cet appel d\'offres ? Cette action est irréversible.')) return;
    try {
      await apiFetch(`/rfps/${rfpId}`, { method: 'DELETE' });
      toast('AO supprimé.', 'success');
      this.navigate('rfps');
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    }
  },

  async archiveRFP(rfpId) {
    try {
      await apiFetch(`/rfps/${rfpId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'archived' }),
      });
      toast('AO archivé.', 'success');
      this.navigate('rfps');
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    }
  },
};

// ================================================================
// Escape HTML helper
// ================================================================
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

// ================================================================
// Boot
// ================================================================
document.addEventListener('DOMContentLoaded', () => App.init());
