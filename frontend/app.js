/**
 * VisaMonitor Dual – BLS Spain + Capago France
 * Affichage complet des informations lors d'un créneau détecté
 */

const BACKEND_PORT = 8000;
const BACKEND_HOST = `${location.hostname}:${BACKEND_PORT}`;
const IS_BACKEND_ORIGIN = location.port === String(BACKEND_PORT);
const API    = IS_BACKEND_ORIGIN ? "" : `http://${BACKEND_HOST}`;
const WS_URL = `ws://${BACKEND_HOST}/ws`;

const MAX_LOG_ENTRIES  = 200;
const MAX_HISTORY_ROWS = 100;

// ----------------------------------------------------------------
// State par monitor
// ----------------------------------------------------------------
const state = {
  spain:       { history: [], countdown: { interval: null, nextAt: null, total: null } },
  france:      { history: [], countdown: { interval: null, nextAt: null, total: null } },
  prefecture:  { history: [], countdown: { interval: null, nextAt: null, total: null } },
};

// ----------------------------------------------------------------
// DOM helpers
// ----------------------------------------------------------------
const $       = id => document.getElementById(id);
const fmt     = d  => d ? new Date(d.endsWith("Z") ? d : d+"Z").toLocaleTimeString("fr-FR") : "–";
const fmtFull = d  => d ? new Date(d.endsWith("Z") ? d : d+"Z").toLocaleString("fr-FR") : "–";
const escHtml = s  => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ----------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------
let ws = null;

function connectWS() {
  if (ws) ws.close();
  ws = new WebSocket(WS_URL);

  ws.onopen  = () => { updateWsBadge(true);  appendLog("Connexion établie", "info", "sys"); };
  ws.onerror = ()  => { appendLog("Erreur WebSocket", "error", "sys"); };
  ws.onclose = ()  => {
    updateWsBadge(false);
    appendLog("Déconnecté – reconnexion dans 5s...", "warn", "sys");
    setTimeout(connectWS, 5000);
  };

  ws.onmessage = ({ data }) => {
    try { handleMessage(JSON.parse(data)); } catch(e) { console.error(e); }
  };

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, 25000);
}

// ----------------------------------------------------------------
// Dispatch messages
// ----------------------------------------------------------------
function handleMessage(msg) {
  switch (msg.type) {
    case "initial_state":
      ["spain","france","prefecture"].forEach(mid => {
        if (msg.data[mid]) applyMonitorState(mid, msg.data[mid]);
      });
      break;
    case "check_result":
      onCheckResult(msg.data.monitor_id || "spain", msg.data);
      break;
    case "status_update":
      if (msg.data.next_check_in_seconds !== undefined)
        startCountdown(msg.data.monitor_id || "spain", msg.data.next_check_in_seconds);
      break;
    case "notification": {
      const mid  = msg.data.monitor_id || "spain";
      const ch   = (msg.data.channels || []).join(", ");
      const flag = mid === "france" ? "🇫🇷" : mid === "prefecture" ? "🏛️" : "🇪🇸";
      appendLog(`${flag} Alerte envoyée → ${ch}`, "success", mid);
      showToast(`${flag} Notifié via ${ch} !`, "success");
      break;
    }
    case "log":
      appendLog(msg.data.message, "info", msg.data.monitor_id || "sys");
      break;
    case "pong": break;
  }
}

// ----------------------------------------------------------------
// Appliquer état initial
// ----------------------------------------------------------------
function applyMonitorState(mid, s) {
  updateControls(mid, s.is_running);
  $(`stat-checks-${mid}`).textContent = s.total_checks  ?? 0;
  $(`stat-slots-${mid}`).textContent  = s.slots_detected ?? 0;
  $(`stat-last-${mid}`).textContent   = fmt(s.last_check);

  if (s.history && s.history.length > 0) {
    state[mid].history = [...s.history].reverse();
    renderHistory(mid);

    // Recharger dernier résultat visuellement
    const last = s.history[s.history.length - 1];
    updateMonitorStatus(mid, last.available, last.message, last.page_excerpt);
    if (last.available) showSlotPanel(mid, last);

    // Logs récents
    s.history.slice(-15).forEach(r => {
      appendLog(formatCheckLog(r), r.available ? "success" : r.error ? "error" : null, mid);
    });
  } else {
    updateMonitorStatus(mid, null, null, null);
  }

  refreshRunningIndicator();
}

// ----------------------------------------------------------------
// Résultat d'une vérification
// ----------------------------------------------------------------
function onCheckResult(mid, data) {
  updateMonitorStatus(mid, data.available, data.message, data.page_excerpt);

  // Stats
  $(`stat-checks-${mid}`).textContent = data.check_number ?? (parseInt($(`stat-checks-${mid}`).textContent||0)+1);
  if (data.slots_count > 0) {
    const prev = parseInt($(`stat-slots-${mid}`).textContent||0);
    $(`stat-slots-${mid}`).textContent = Math.max(data.slots_count, prev);
  }
  $(`stat-last-${mid}`).textContent = fmt(data.timestamp);

  appendLog(formatCheckLog(data), data.available ? "success" : data.error ? "error" : null, mid);

  state[mid].history.unshift(data);
  if (state[mid].history.length > MAX_HISTORY_ROWS) state[mid].history.pop();
  renderHistory(mid);

  if (data.available) {
    showSlotPanel(mid, data);
    const flag = mid === "france" ? "🇫🇷" : mid === "prefecture" ? "🏛️" : "🇪🇸";
    showToast(`${flag} CRÉNEAU DISPONIBLE ! Réservez maintenant !`, "success", 12000);
  } else {
    hideSlotPanel(mid);
  }
}

function formatCheckLog(r) {
  const flag = r.monitor_id === "france" ? "🇫🇷" : r.monitor_id === "prefecture" ? "🏛️" : "🇪🇸";
  const icon = r.available ? "✓" : r.error ? "✗" : "–";
  const dur  = r.duration_ms ? ` (${Math.round(r.duration_ms)}ms)` : "";
  return `${flag} [#${r.check_number||"?"}] ${icon} ${r.message}${dur}`;
}

// ----------------------------------------------------------------
// Mise à jour visuelle statut
// ----------------------------------------------------------------
function updateMonitorStatus(mid, status, message, pageExcerpt) {
  const card      = $(`card-${mid}`);
  const iconEl    = $(`icon-${mid}`);
  const badgeEl   = $(`badge-${mid}`);
  const msgEl     = $(`msg-${mid}`);
  const centerEl  = card.querySelector(".status-center");

  const lastMsg    = message || state[mid].history[0]?.message || "";
  const isGeoBlock = lastMsg.includes("GEO_BLOCKED");

  // Reset classes
  card.className    = "status-block";
  centerEl.className = "status-center";

  if (isGeoBlock) {
    card.classList.add("geo-blocked");
    centerEl.classList.add("geo-blocked");
    iconEl.textContent  = "🚫";
    badgeEl.textContent = "ACCÈS BLOQUÉ";
    badgeEl.className   = "status-badge geo-blocked";
    msgEl.textContent   = "Inaccessible depuis votre région — désactivez le VPN";
  } else if (status === true) {
    card.classList.add("available");
    centerEl.classList.add("available");
    iconEl.textContent  = "✅";
    badgeEl.textContent = "DISPONIBLE";
    badgeEl.className   = "status-badge available";
    msgEl.textContent   = message || "Des créneaux sont disponibles !";
  } else if (status === false) {
    iconEl.textContent  = "⏳";
    badgeEl.textContent = "INDISPONIBLE";
    badgeEl.className   = "status-badge unavailable";
    msgEl.textContent   = message || "Aucun créneau pour le moment";
  } else {
    iconEl.textContent  = "🔍";
    badgeEl.textContent = "EN ATTENTE";
    badgeEl.className   = "status-badge unknown";
    msgEl.textContent   = "Démarrez le monitoring pour vérifier";
  }

  // Aperçu page quand indisponible
  const previewDiv  = $(`preview-${mid}`);
  const previewText = $(`preview-text-${mid}`);
  const excerpt     = pageExcerpt || state[mid].history[0]?.page_excerpt || "";
  if (excerpt && status === false && !isGeoBlock) {
    previewDiv.style.display = "block";
    previewText.textContent  = excerpt;
  } else if (status !== false) {
    previewDiv.style.display = "none";
  }
}

// ----------------------------------------------------------------
// Panneau créneaux – afficher toutes les infos
// ----------------------------------------------------------------
function showSlotPanel(mid, data) {
  const panel = $(`slot-panel-${mid}`);
  panel.style.display = "block";

  // Nombre de créneaux
  $(`slot-count-${mid}`).textContent = data.slots_count > 0
    ? `${data.slots_count} créneau${data.slots_count > 1 ? "x" : ""}`
    : "Détecté";

  // Heure de détection
  $(`slot-time-${mid}`).textContent = fmt(data.timestamp);

  // Durée de vérification
  $(`slot-dur-${mid}`).textContent = data.duration_ms
    ? `${(data.duration_ms / 1000).toFixed(1)} s`
    : "–";

  // Numéro de vérification
  $(`slot-checkno-${mid}`).textContent = `#${data.check_number || "?"}`;

  // Signal (message de détection)
  $(`slot-msg-${mid}`).textContent = data.message || "–";

  // ── Dates réelles des créneaux ──
  const datesWrap = $(`slot-dates-wrap-${mid}`);
  const datesBox  = $(`slot-dates-${mid}`);
  if (datesWrap && datesBox) {
    const dates = data.slot_dates || [];
    if (dates.length > 0) {
      datesBox.innerHTML = dates.map(d =>
        `<div class="slot-date-item">📅 <strong>${escHtml(d)}</strong></div>`
      ).join("");
      datesWrap.style.display = "block";
    } else {
      datesBox.innerHTML = '<div class="slot-date-item" style="color:#64748b;">Dates en cours d\'extraction...</div>';
      datesWrap.style.display = "block";
    }
  }

  // ── Bouton lien direct vers le créneau retenu ──
  const bookBtn = $(`book-btn-${mid}`);
  if (bookBtn && data.booking_url) {
    bookBtn.href = data.booking_url;
  }

  // Extrait de la page
  const excerptWrap = $(`slot-excerpt-wrap-${mid}`);
  const excerptText = $(`slot-excerpt-${mid}`);
  const excerpt = data.page_excerpt || "";
  if (excerpt) {
    excerptText.textContent   = excerpt;
    excerptWrap.style.display = "block";
  } else {
    excerptWrap.style.display = "none";
  }

  // Masquer l'aperçu page "indisponible"
  $(`preview-${mid}`).style.display = "none";
}

function hideSlotPanel(mid) {
  $(`slot-panel-${mid}`).style.display = "none";
}

// ----------------------------------------------------------------
// Countdown
// ----------------------------------------------------------------
function startCountdown(mid, seconds) {
  const cd = state[mid].countdown;
  clearInterval(cd.interval);
  cd.nextAt  = Date.now() + seconds * 1000;
  cd.total   = seconds;
  updateCountdown(mid);
  cd.interval = setInterval(() => updateCountdown(mid), 1000);
}

function updateCountdown(mid) {
  const cd        = state[mid].countdown;
  const remaining = Math.max(0, Math.round((cd.nextAt - Date.now()) / 1000));
  $(`cd-timer-${mid}`).textContent = `${remaining}s`;
  const pct = cd.total > 0 ? ((cd.total - remaining) / cd.total * 100) : 0;
  $(`cd-bar-${mid}`).style.width   = `${pct}%`;
  if (remaining === 0) clearInterval(cd.interval);
}

// ----------------------------------------------------------------
// Historique
// ----------------------------------------------------------------
function renderHistory(mid) {
  const tbody = $(`history-tbody-${mid}`);
  tbody.innerHTML = state[mid].history.slice(0, MAX_HISTORY_ROWS).map(r => {
    const cls = r.error ? "err" : r.available ? "ok" : "nok";
    const txt = r.error ? "ERREUR" : r.available ? "OK" : "NON";
    const dur = r.duration_ms ? `${Math.round(r.duration_ms)}ms` : "–";
    return `<tr>
      <td>${fmtFull(r.timestamp)}</td>
      <td><span class="badge ${cls}">${txt}</span></td>
      <td>${r.slots_count ?? 0}</td>
      <td style="max-width:260px;word-break:break-word;">${escHtml(r.message)}</td>
      <td>${dur}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:#475569;padding:16px;">Aucune donnée</td></tr>`;
}

// ----------------------------------------------------------------
// Logs
// ----------------------------------------------------------------
function appendLog(message, type = null, monitorId = "sys") {
  const container = $("log-container");
  const now  = new Date().toLocaleTimeString("fr-FR");
  const div  = document.createElement("div");
  div.className = "log-entry";
  const tagLabel = monitorId === "spain" ? "ESP" : monitorId === "france" ? "FRA" : monitorId === "prefecture" ? "PRF" : "SYS";
  const tagClass = monitorId === "spain" ? "spain" : monitorId === "france" ? "france" : monitorId === "prefecture" ? "prefecture" : "sys";
  const cls      = type ? `log-msg ${type}` : "log-msg";
  div.innerHTML = `<span class="log-time">${now}</span><span class="log-tag ${tagClass}">${tagLabel}</span><span class="${cls}">${escHtml(message)}</span>`;
  container.prepend(div);
  while (container.children.length > MAX_LOG_ENTRIES) container.lastChild.remove();
}

function clearLog() {
  $("log-container").innerHTML = "";
  appendLog("Logs effacés", "info", "sys");
}

// ----------------------------------------------------------------
// Contrôles
// ----------------------------------------------------------------
function updateControls(mid, running) {
  $(`btn-start-${mid}`).disabled = running;
  $(`btn-stop-${mid}`).disabled  = !running;
  const lbl = $(`running-${mid}`);
  if (lbl) lbl.style.display = running ? "flex" : "none";
}

function refreshRunningIndicator() {
  const anyRunning = ["spain","france","prefecture"].some(mid => !$(`btn-start-${mid}`).disabled);
  $("running-indicator").style.display = anyRunning ? "inline-flex" : "none";
}

async function startMonitor(mid) {
  try {
    const r = await fetch(`${API}/api/${mid}/start`, { method: "POST" });
    if (!r.ok) { showToast((await r.json()).detail || `Erreur démarrage`, "error"); return; }
    updateControls(mid, true);
    updateMonitorStatus(mid, null, null, null);
    appendLog(`Monitor ${mid} démarré`, "success", mid);
    refreshRunningIndicator();
  } catch(e) { showToast("Impossible de joindre l'API", "error"); }
}

async function stopMonitor(mid) {
  try {
    const r = await fetch(`${API}/api/${mid}/stop`, { method: "POST" });
    if (!r.ok) { showToast((await r.json()).detail || `Erreur arrêt`, "error"); return; }
    updateControls(mid, false);
    const cd = state[mid].countdown;
    clearInterval(cd.interval);
    $(`cd-timer-${mid}`).textContent = "–";
    $(`cd-bar-${mid}`).style.width   = "0%";
    appendLog(`Monitor ${mid} arrêté`, "warn", mid);
    refreshRunningIndicator();
  } catch(e) { showToast("Impossible de joindre l'API", "error"); }
}

// ----------------------------------------------------------------
// Onglets
// ----------------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  $(`tab-${tabId}`).classList.add("active");
  $(`tab-btn-${tabId}`).classList.add("active");
}

// ----------------------------------------------------------------
// Aperçu page – toggle collapse
// ----------------------------------------------------------------
function togglePreview(mid) {
  const body  = $(`preview-text-${mid}`);
  const arrow = $(`preview-arrow-${mid}`);
  body.classList.toggle("collapsed");
  arrow.textContent = body.classList.contains("collapsed") ? "▶" : "▼";
}

// ----------------------------------------------------------------
// Sections collapsibles
// ----------------------------------------------------------------
function toggleSection(id) {
  const body  = $(id);
  const arrow = $(`${id}-arrow`);
  body.classList.toggle("hidden");
  if (arrow) arrow.textContent = body.classList.contains("hidden") ? "▶" : "▼";
}

// ----------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------
function showToast(message, type = "info", duration = 5000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $("toasts").appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.4s";
    toast.style.opacity    = "0";
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

function updateWsBadge(connected) {
  const b = $("ws-badge");
  b.textContent = connected ? "● Connecté" : "○ Déconnecté";
  b.className   = `ws-badge ${connected ? "connected" : "disconnected"}`;
}

// ----------------------------------------------------------------
// Notification settings — Email
// ----------------------------------------------------------------
const emailAddrs = [];

function renderEmailTags() {
  $("email-tags").innerHTML = emailAddrs.map((addr,i) =>
    `<span class="number-tag" style="background:#041a10;border-color:#059669;color:#6ee7b7;">
      ${escHtml(addr)}<button onclick="removeEmailAddr(${i})">✕</button>
    </span>`
  ).join("") || '<span style="color:#374151;font-size:0.76rem;">Aucune adresse</span>';
}

function addEmailAddr() {
  const raw = $("email-new-addr").value.trim();
  if (!raw) return;
  if (!raw.includes("@")) { showToast("Adresse email invalide", "error"); return; }
  if (emailAddrs.includes(raw)) { showToast("Adresse déjà présente", "info"); return; }
  emailAddrs.push(raw); $("email-new-addr").value = ""; renderEmailTags();
}
function removeEmailAddr(i) { emailAddrs.splice(i,1); renderEmailTags(); }

async function testEmail() {
  const resultEl = $("email-test-result");
  const apiKey = $("cfg-brevo-key").value.trim();
  if (!apiKey) { showToast("Entrez votre clé API Brevo d'abord", "error"); return; }
  if (emailAddrs.length === 0) { showToast("Ajoutez au moins un destinataire", "error"); return; }
  resultEl.className="test-result"; resultEl.textContent="Envoi en cours..."; resultEl.style.display="block"; resultEl.style.background="transparent"; resultEl.style.color="#94a3b8";
  try {
    const r = await fetch(`${API}/api/notifications/test-email`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ api_key: apiKey, recipients: [...emailAddrs] }),
    });
    const d = await r.json();
    if (d.success) { resultEl.className="test-result ok"; resultEl.textContent="Email envoyé ! "+d.message; showToast("Email de test envoyé !","success"); }
    else { resultEl.className="test-result err"; resultEl.textContent=d.message||d.detail||"Échec"; }
  } catch(e) { resultEl.className="test-result err"; resultEl.textContent="API inaccessible"; }
}

async function sendManualReport() {
  const resultEl = $("email-test-result");
  resultEl.className="test-result"; resultEl.textContent="Envoi du rapport..."; resultEl.style.display="block"; resultEl.style.background="transparent"; resultEl.style.color="#94a3b8";
  try {
    const r = await fetch(`${API}/api/notifications/send-report`, { method:"POST" });
    const d = await r.json();
    if (d.success) { resultEl.className="test-result ok"; resultEl.textContent="Rapport envoyé ! "+d.message; showToast("Rapport envoyé !","success"); }
    else { resultEl.className="test-result err"; resultEl.textContent=d.message||d.detail||"Échec"; }
  } catch(e) { resultEl.className="test-result err"; resultEl.textContent="API inaccessible"; }
}

// ----------------------------------------------------------------
// Notification settings — SMS/WA/Telegram
// ----------------------------------------------------------------
const smsNumbers = [], waNumbers = [], tgIds = [];

function renderTags(ch) {
  const arr   = ch === "sms" ? smsNumbers : waNumbers;
  const tagId = ch === "sms" ? "sms-tags" : "wa-tags";
  $(tagId).innerHTML = arr.map((n,i) => `<span class="number-tag">${escHtml(n)}<button onclick="removeNumber('${ch}',${i})">✕</button></span>`).join("") || '<span style="color:#374151;font-size:0.76rem;">Aucun numéro</span>';
}

function renderTgTags() {
  $("tg-tags").innerHTML = tgIds.map((id,i) => `<span class="number-tag" style="background:#0e1f3a;border-color:#2563eb;color:#93c5fd;">${escHtml(String(id))}<button onclick="removeTgId(${i})">✕</button></span>`).join("") || '<span style="color:#374151;font-size:0.76rem;">Aucun chat ID</span>';
}

function addTgId() {
  const raw = $("tg-new-id").value.trim();
  if (!raw) return;
  if (!/^-?\d+$/.test(raw)) { showToast("Chat ID invalide — entrez un nombre", "error"); return; }
  if (tgIds.includes(raw))  { showToast("ID déjà présent", "info"); return; }
  tgIds.push(raw); $("tg-new-id").value = ""; renderTgTags();
}
function removeTgId(i) { tgIds.splice(i,1); renderTgTags(); }

function addNumber(ch) {
  const id  = ch === "sms" ? "sms-new-number" : "wa-new-number";
  const raw = $(id).value.trim();
  if (!raw) return;
  const num = raw.startsWith("+") ? raw : "+"+raw;
  if (!/^\+\d{7,15}$/.test(num)) { showToast("Format invalide – ex: +213661234567", "error"); return; }
  const arr = ch === "sms" ? smsNumbers : waNumbers;
  if (arr.includes(num)) { showToast("Numéro déjà présent", "info"); return; }
  arr.push(num); $(id).value = ""; renderTags(ch);
}
function removeNumber(ch, i) { (ch==="sms"?smsNumbers:waNumbers).splice(i,1); renderTags(ch); }

function setupInputEnter() {
  [["sms-new-number","sms"],["wa-new-number","wa"]].forEach(([id,ch]) => {
    const el = $(id); if(el) el.addEventListener("keydown", e => { if(e.key==="Enter"){e.preventDefault();addNumber(ch);} });
  });
  const t = $("tg-new-id"); if(t) t.addEventListener("keydown", e => { if(e.key==="Enter"){e.preventDefault();addTgId();} });
}

async function loadNotifSettings() {
  try {
    const r = await fetch(`${API}/api/notifications/settings`);
    if (!r.ok) return;
    const cfg = await r.json();
    // Email
    if (cfg.email_configured) { $("email-status").className="config-status ok"; $("email-status-icon").textContent="✓"; $("email-status-text").textContent=`Brevo configuré — ${(cfg.email_recipients||[]).length} destinataire(s)`; $("cfg-brevo-key").placeholder="Clé déjà configurée — laisser vide pour conserver"; }
    $("email-enabled").checked = cfg.email_enabled || false;
    $("email-report-enabled").checked = cfg.email_report_enabled !== false;
    // Ne jamais pré-remplir la clé API (évite de renvoyer la version masquée)
    // Le champ reste vide — on envoie seulement si l'utilisateur saisit une nouvelle clé
    emailAddrs.length=0; (cfg.email_recipients||[]).forEach(a=>emailAddrs.push(a)); renderEmailTags();

    if (cfg.telegram_configured) { $("tg-status").className="config-status ok"; $("tg-status-icon").textContent="✓"; $("tg-status-text").textContent="Bot configuré"; }
    if (cfg.twilio_configured)   { $("twilio-status").className="config-status ok"; $("twilio-status-icon").textContent="✓"; $("twilio-status-text").textContent="Twilio configuré"; }
    $("tg-enabled").checked = cfg.telegram_enabled || false;
    if (cfg.telegram_bot_token) $("cfg-tg-token").value = cfg.telegram_bot_token;
    tgIds.length=0; (cfg.telegram_chat_ids||[]).forEach(id=>tgIds.push(String(id))); renderTgTags();
    if (cfg.twilio_account_sid)  $("cfg-sid").value      = cfg.twilio_account_sid;
    if (cfg.twilio_auth_token)   $("cfg-token").value    = cfg.twilio_auth_token;
    if (cfg.twilio_phone_from)   $("cfg-from-sms").value = cfg.twilio_phone_from;
    if (cfg.twilio_whatsapp_from) $("cfg-from-wa").value = cfg.twilio_whatsapp_from;
    $("sms-enabled").checked = cfg.sms_enabled||false;
    $("wa-enabled").checked  = cfg.whatsapp_enabled||false;
    smsNumbers.length=0; (cfg.sms_numbers||[]).forEach(n=>smsNumbers.push(n));
    waNumbers.length=0;  (cfg.whatsapp_numbers||[]).forEach(n=>waNumbers.push(n));
    renderTags("sms"); renderTags("wa");
  } catch(e) { console.error(e); }
}

async function saveNotifSettings() {
  const btn = document.querySelector(".btn-save-notif");
  const res = $("save-result");
  btn.disabled=true; res.textContent="Sauvegarde..."; res.style.color="#94a3b8";
  try {
    const r = await fetch(`${API}/api/notifications/settings`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        email_enabled:$("email-enabled").checked,
        // N'envoyer la clé que si l'utilisateur a saisi quelque chose de nouveau
        ...($("cfg-brevo-key").value.trim() ? {email_brevo_api_key:$("cfg-brevo-key").value.trim()} : {}),
        email_recipients:[...emailAddrs],
        email_report_enabled:$("email-report-enabled").checked,
        email_report_interval_hours:3,
        telegram_enabled:$("tg-enabled").checked, telegram_bot_token:$("cfg-tg-token").value.trim(), telegram_chat_ids:[...tgIds],
        twilio_account_sid:$("cfg-sid").value.trim(), twilio_auth_token:$("cfg-token").value.trim(),
        twilio_phone_from:$("cfg-from-sms").value.trim(), twilio_whatsapp_from:$("cfg-from-wa").value.trim(),
        sms_enabled:$("sms-enabled").checked, sms_numbers:[...smsNumbers],
        whatsapp_enabled:$("wa-enabled").checked, whatsapp_numbers:[...waNumbers],
      }),
    });
    const d = await r.json();
    if (r.ok && d.saved) { res.textContent="Sauvegardé !"; res.style.color="#10b981"; showToast("Configuration sauvegardée","success"); await loadNotifSettings(); }
    else { res.textContent="Erreur : "+(d.detail||"inconnue"); res.style.color="#ef4444"; }
  } catch(e) { res.textContent="API inaccessible"; res.style.color="#ef4444"; }
  finally { btn.disabled=false; setTimeout(()=>{res.textContent="";},5000); }
}

async function testNotif(channel, numberOverride) {
  const isTg     = channel==="telegram";
  const numInput = isTg ? null : (channel==="sms"?$("sms-test-number"):$("wa-test-number"));
  const resultEl = isTg ? $("tg-test-result") : (channel==="sms"?$("sms-test-result"):$("wa-test-result"));
  const num      = numberOverride==="all" ? (tgIds[0]||"") : (numInput?numInput.value.trim():"");
  if (isTg && tgIds.length===0) { showToast("Ajoutez un chat ID d'abord","error"); return; }
  if (!num) { showToast("Entrez un numéro","error"); return; }
  resultEl.className="test-result"; resultEl.textContent="Envoi..."; resultEl.style.display="block"; resultEl.style.background="transparent"; resultEl.style.color="#94a3b8";
  try {
    const r = await fetch(`${API}/api/notifications/test`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({channel,number:num}) });
    const d = await r.json();
    if (d.success) { resultEl.className="test-result ok"; resultEl.textContent="Envoyé ! "+d.message; showToast(`Test ${channel.toUpperCase()} envoyé`,"success"); }
    else { resultEl.className="test-result err"; resultEl.textContent=d.message||d.detail||"Échec"; }
  } catch(e) { resultEl.className="test-result err"; resultEl.textContent="API inaccessible"; }
}

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  ["spain","france","prefecture"].forEach(mid => { updateMonitorStatus(mid,null,null,null); updateControls(mid,false); });
  setupInputEnter(); renderEmailTags(); renderTgTags(); renderTags("sms"); renderTags("wa");
  const emailInput = $("email-new-addr");
  if(emailInput) emailInput.addEventListener("keydown", e => { if(e.key==="Enter"){e.preventDefault();addEmailAddr();} });
  connectWS();
  loadNotifSettings();
  appendLog("VisaMonitor Dual — BLS Spain + Capago France", "info", "sys");
});
