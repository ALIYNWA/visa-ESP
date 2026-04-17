/**
 * VisaMonitor Dual – Dashboard JavaScript
 * Double monitor : Espagne (BLS) + France (Capago)
 * WebSocket temps réel + REST API
 */

const BACKEND_PORT = 8000;
const BACKEND_HOST = `${location.hostname}:${BACKEND_PORT}`;
const IS_BACKEND_ORIGIN = location.port === String(BACKEND_PORT);
const API = IS_BACKEND_ORIGIN ? "" : `http://${BACKEND_HOST}`;
const WS_URL = `ws://${BACKEND_HOST}/ws`;

const MAX_LOG_ENTRIES  = 200;
const MAX_HISTORY_ROWS = 100;

// ----------------------------------------------------------------
// State par monitor
// ----------------------------------------------------------------
const state = {
  spain:  { history: [], countdown: { interval: null, nextAt: null, total: null } },
  france: { history: [], countdown: { interval: null, nextAt: null, total: null } },
};

// ----------------------------------------------------------------
// DOM helpers
// ----------------------------------------------------------------
const $ = id => document.getElementById(id);
const fmt     = d => d ? new Date(d.endsWith("Z") ? d : d+"Z").toLocaleTimeString("fr-FR") : "–";
const fmtFull = d => d ? new Date(d.endsWith("Z") ? d : d+"Z").toLocaleString("fr-FR") : "–";
const escHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ----------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------
let ws = null;

function connectWS() {
  if (ws) ws.close();
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    updateWsBadge(true);
    appendLog("Connexion WebSocket établie", "info", "sys");
  };

  ws.onmessage = ({ data }) => {
    try { handleMessage(JSON.parse(data)); }
    catch (e) { console.error("WS parse error", e); }
  };

  ws.onerror = () => appendLog("Erreur WebSocket", "error", "sys");

  ws.onclose = () => {
    updateWsBadge(false);
    appendLog("WebSocket déconnecté – reconnexion dans 5s...", "warn", "sys");
    setTimeout(connectWS, 5000);
  };

  // Ping keepalive
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
      // data = { spain: MonitorStatus, france: MonitorStatus }
      ["spain", "france"].forEach(mid => {
        if (msg.data[mid]) applyMonitorState(mid, msg.data[mid]);
      });
      break;

    case "check_result": {
      const mid = msg.data.monitor_id || "spain";
      onCheckResult(mid, msg.data);
      break;
    }

    case "status_update": {
      const mid = msg.data.monitor_id || "spain";
      if (msg.data.next_check_in_seconds !== undefined) {
        startCountdown(mid, msg.data.next_check_in_seconds);
      }
      break;
    }

    case "notification": {
      const mid = msg.data.monitor_id || "spain";
      const ch  = (msg.data.channels || []).join(", ");
      const flag = mid === "france" ? "🇫🇷" : "🇪🇸";
      appendLog(`${flag} Alertes envoyées → ${ch}`, "success", mid);
      showToast(`${flag} Notification via ${ch} !`, "success");
      break;
    }

    case "log": {
      const mid = msg.data.monitor_id || "sys";
      appendLog(msg.data.message, "info", mid);
      break;
    }

    case "pong":
      break;
  }
}

// ----------------------------------------------------------------
// Appliquer état initial d'un monitor
// ----------------------------------------------------------------
function applyMonitorState(mid, s) {
  updateMonitorStatus(mid, s.current_status, null, null);
  updateControls(mid, s.is_running);
  $(`stat-checks-${mid}`).textContent = s.total_checks ?? 0;
  $(`stat-slots-${mid}`).textContent  = s.slots_detected ?? 0;
  $(`stat-last-${mid}`).textContent   = fmt(s.last_check);

  if (s.history && s.history.length > 0) {
    state[mid].history = [...s.history].reverse();
    renderHistory(mid);
    s.history.slice(-20).forEach(r => {
      appendLog(formatCheckLog(r), r.available ? "success" : r.error ? "error" : null, mid);
    });
  }

  // Mise à jour indicateur global "en cours"
  refreshRunningIndicator();
}

// ----------------------------------------------------------------
// Résultat d'une vérification
// ----------------------------------------------------------------
function onCheckResult(mid, data) {
  // Mettre à jour le statut
  updateMonitorStatus(mid, data.available, data.message, data.page_excerpt);

  // Stats
  const prevChecks = parseInt($(`stat-checks-${mid}`).textContent || "0");
  $(`stat-checks-${mid}`).textContent = data.check_number ?? prevChecks + 1;
  if (data.slots_count > 0) {
    const prev = parseInt($(`stat-slots-${mid}`).textContent || "0");
    $(`stat-slots-${mid}`).textContent = Math.max(data.slots_count, prev);
  }
  $(`stat-last-${mid}`).textContent = fmt(data.timestamp);

  // Log
  appendLog(formatCheckLog(data), data.available ? "success" : data.error ? "error" : null, mid);

  // Historique
  state[mid].history.unshift(data);
  if (state[mid].history.length > MAX_HISTORY_ROWS) state[mid].history.pop();
  renderHistory(mid);

  // Toast si disponible
  if (data.available) {
    const flag = mid === "france" ? "🇫🇷" : "🇪🇸";
    showToast(`${flag} Créneau disponible ! Réservez maintenant.`, "success", 10000);
    pulseCard(mid);
  }
}

function formatCheckLog(r) {
  const flag = r.monitor_id === "france" ? "🇫🇷" : "🇪🇸";
  const icon = r.available ? "✓" : r.error ? "✗" : "–";
  const dur  = r.duration_ms ? ` (${Math.round(r.duration_ms)}ms)` : "";
  return `${flag} [#${r.check_number || "?"}] ${icon} ${r.message}${dur}`;
}

// ----------------------------------------------------------------
// Mise à jour visuelle du statut d'un monitor
// ----------------------------------------------------------------
function updateMonitorStatus(mid, status, message, pageExcerpt) {
  const card    = $(`card-${mid}`);
  const iconEl  = $(`icon-${mid}`);
  const badgeEl = $(`badge-${mid}`);
  const msgEl   = $(`msg-${mid}`);
  const statusDiv = $(`status-${mid}`);

  // Déterminer l'état
  const lastMsg = message || state[mid].history[0]?.message || "";
  const isGeoBlocked = lastMsg.includes("GEO_BLOCKED");

  // Reset classes
  card.className = "monitor-card";
  statusDiv.className = "monitor-status";

  if (isGeoBlocked) {
    card.classList.add("geo-blocked");
    statusDiv.classList.add("geo-blocked");
    iconEl.textContent       = "🚫";
    badgeEl.textContent      = "ACCÈS BLOQUÉ";
    badgeEl.className        = "status-badge geo-blocked";
    msgEl.textContent        = "Site inaccessible depuis votre région — désactivez le VPN";
  } else if (status === true) {
    card.classList.add("available");
    statusDiv.classList.add("available");
    iconEl.textContent       = "✅";
    badgeEl.textContent      = "DISPONIBLE";
    badgeEl.className        = "status-badge available";
    msgEl.textContent        = message || "Des créneaux sont disponibles !";
    // Faire briller le bouton de réservation
    $(`book-${mid}`).classList.add("available-glow");
  } else if (status === false) {
    iconEl.textContent       = "⏳";
    badgeEl.textContent      = "INDISPONIBLE";
    badgeEl.className        = "status-badge unavailable";
    msgEl.textContent        = message || "Aucun créneau disponible";
    $(`book-${mid}`).classList.remove("available-glow");
  } else {
    iconEl.textContent       = "🔍";
    badgeEl.textContent      = "EN ATTENTE";
    badgeEl.className        = "status-badge unknown";
    msgEl.textContent        = "Démarrez le monitoring pour vérifier";
    $(`book-${mid}`).classList.remove("available-glow");
  }

  // Aperçu page (ce que voit le moniteur)
  const previewDiv  = $(`preview-${mid}`);
  const previewText = $(`preview-text-${mid}`);
  const excerpt = pageExcerpt || state[mid].history[0]?.page_excerpt || "";

  if (excerpt && status !== null) {
    previewDiv.style.display = "block";
    previewText.textContent  = excerpt;
  } else {
    previewDiv.style.display = "none";
  }
}

function pulseCard(mid) {
  const card = $(`card-${mid}`);
  card.style.boxShadow = "0 0 48px rgba(16,185,129,0.7)";
  setTimeout(() => { card.style.boxShadow = ""; }, 4000);
}

// ----------------------------------------------------------------
// Countdown par monitor
// ----------------------------------------------------------------
function startCountdown(mid, seconds) {
  const cd = state[mid].countdown;
  clearInterval(cd.interval);
  cd.nextAt = Date.now() + seconds * 1000;
  cd.total  = seconds;
  updateCountdown(mid);
  cd.interval = setInterval(() => updateCountdown(mid), 1000);
}

function updateCountdown(mid) {
  const cd = state[mid].countdown;
  const remaining = Math.max(0, Math.round((cd.nextAt - Date.now()) / 1000));
  $(`cd-timer-${mid}`).textContent = `${remaining}s`;
  const pct = cd.total > 0 ? ((cd.total - remaining) / cd.total * 100) : 0;
  $(`cd-bar-${mid}`).style.width = `${pct}%`;
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
    return `
      <tr>
        <td>${fmtFull(r.timestamp)}</td>
        <td><span class="badge ${cls}">${txt}</span></td>
        <td>${r.slots_count ?? 0}</td>
        <td style="max-width:260px;word-break:break-word;">${escHtml(r.message)}</td>
        <td>${dur}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:#475569;padding:16px;">Aucune donnée</td></tr>`;
}

// ----------------------------------------------------------------
// Log unifié (avec tag pays)
// ----------------------------------------------------------------
function appendLog(message, type = null, monitorId = "sys") {
  const container = $("log-container");
  const now  = new Date().toLocaleTimeString("fr-FR");
  const div  = document.createElement("div");
  div.className = "log-entry";

  const tagLabel = monitorId === "spain" ? "ESP" : monitorId === "france" ? "FRA" : "SYS";
  const tagClass = monitorId === "spain" ? "spain" : monitorId === "france" ? "france" : "sys";
  const cls      = type ? `log-msg ${type}` : "log-msg";

  div.innerHTML = `
    <span class="log-time">${now}</span>
    <span class="log-tag ${tagClass}">${tagLabel}</span>
    <span class="${cls}">${escHtml(message)}</span>`;
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
  const dot = $(`running-${mid}`);
  if (dot) dot.className = `running-dot ${running ? "active" : ""}`;
}

function refreshRunningIndicator() {
  const anyRunning = ["spain","france"].some(mid => !$(`btn-start-${mid}`).disabled === false);
  // Si au moins un tourne
  const spainRunning  = !$("btn-start-spain").disabled;
  const franceRunning = !$("btn-start-france").disabled;
  $("running-indicator").style.display = (spainRunning || franceRunning) ? "inline-flex" : "none";
}

async function startMonitor(mid) {
  try {
    const r = await fetch(`${API}/api/${mid}/start`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json();
      showToast(err.detail || `Erreur démarrage ${mid}`, "error");
      return;
    }
    updateControls(mid, true);
    updateMonitorStatus(mid, null, null, null);
    appendLog(`Monitor ${mid} démarré`, "success", mid);
    refreshRunningIndicator();
  } catch (e) {
    showToast("Impossible de joindre l'API", "error");
  }
}

async function stopMonitor(mid) {
  try {
    const r = await fetch(`${API}/api/${mid}/stop`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json();
      showToast(err.detail || `Erreur arrêt ${mid}`, "error");
      return;
    }
    updateControls(mid, false);
    clearInterval(state[mid].countdown.interval);
    $(`cd-timer-${mid}`).textContent = "–";
    $(`cd-bar-${mid}`).style.width = "0%";
    appendLog(`Monitor ${mid} arrêté`, "warn", mid);
    refreshRunningIndicator();
  } catch (e) {
    showToast("Impossible de joindre l'API", "error");
  }
}

// ----------------------------------------------------------------
// Onglets
// ----------------------------------------------------------------
function switchTab(tabId) {
  // Masquer tous les contenus
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));

  // Afficher le bon
  $(`tab-${tabId}`).classList.add("active");
  $(`tab-btn-${tabId}`).classList.add("active");
}

// ----------------------------------------------------------------
// Aperçu page – toggle
// ----------------------------------------------------------------
function togglePreview(mid) {
  const body  = $(`preview-text-${mid}`);
  const arrow = $(`preview-arrow-${mid}`);
  const collapsed = body.classList.toggle("collapsed");
  arrow.textContent = collapsed ? "▶" : "▼";
}

// ----------------------------------------------------------------
// Sections collapsibles
// ----------------------------------------------------------------
function toggleSection(id) {
  const body  = $(id);
  const arrow = $(`${id}-arrow`);
  const hidden = body.classList.toggle("hidden");
  if (arrow) arrow.textContent = hidden ? "▶" : "▼";
}

// ----------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------
function showToast(message, type = "info", duration = 4000) {
  const container = $("toasts");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.4s";
    toast.style.opacity    = "0";
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ----------------------------------------------------------------
// WS badge
// ----------------------------------------------------------------
function updateWsBadge(connected) {
  const badge = $("ws-badge");
  badge.textContent  = connected ? "● Connecté" : "○ Déconnecté";
  badge.className    = `ws-badge ${connected ? "connected" : "disconnected"}`;
}

// ----------------------------------------------------------------
// Notification settings
// ----------------------------------------------------------------
const smsNumbers = [];
const waNumbers  = [];
const tgIds      = [];

function renderTags(channel) {
  const arr   = channel === "sms" ? smsNumbers : waNumbers;
  const tagId = channel === "sms" ? "sms-tags" : "wa-tags";
  $(tagId).innerHTML = arr.map((n, i) => `
    <span class="number-tag">
      ${escHtml(n)}
      <button onclick="removeNumber('${channel}', ${i})">✕</button>
    </span>`).join("") || '<span style="color:#374151;font-size:0.76rem;">Aucun numéro ajouté</span>';
}

function renderTgTags() {
  $("tg-tags").innerHTML = tgIds.map((id, i) => `
    <span class="number-tag" style="background:#0e1f3a;border-color:#2563eb;color:#93c5fd;">
      ${escHtml(String(id))}
      <button onclick="removeTgId(${i})">✕</button>
    </span>`).join("") || '<span style="color:#374151;font-size:0.76rem;">Aucun chat ID</span>';
}

function addTgId() {
  const input = $("tg-new-id");
  const raw = input.value.trim();
  if (!raw) return;
  if (!/^-?\d+$/.test(raw)) { showToast("Chat ID invalide — entrez un nombre", "error"); return; }
  if (tgIds.includes(raw))  { showToast("ID déjà présent", "info"); return; }
  tgIds.push(raw);
  input.value = "";
  renderTgTags();
}

function removeTgId(idx) { tgIds.splice(idx, 1); renderTgTags(); }

function addNumber(channel) {
  const inputId = channel === "sms" ? "sms-new-number" : "wa-new-number";
  const raw = $(inputId).value.trim();
  if (!raw) return;
  const num = raw.startsWith("+") ? raw : "+" + raw;
  if (!/^\+\d{7,15}$/.test(num)) { showToast("Format invalide — ex: +213661234567", "error"); return; }
  const arr = channel === "sms" ? smsNumbers : waNumbers;
  if (arr.includes(num)) { showToast("Numéro déjà dans la liste", "info"); return; }
  arr.push(num);
  $(inputId).value = "";
  renderTags(channel);
}

function removeNumber(channel, idx) {
  (channel === "sms" ? smsNumbers : waNumbers).splice(idx, 1);
  renderTags(channel);
}

// Enter key
function setupInputEnter() {
  [["sms-new-number","sms"],["wa-new-number","wa"]].forEach(([id,ch]) => {
    const el = $(id);
    if (el) el.addEventListener("keydown", e => { if (e.key==="Enter") { e.preventDefault(); addNumber(ch); } });
  });
  const tgInput = $("tg-new-id");
  if (tgInput) tgInput.addEventListener("keydown", e => { if (e.key==="Enter") { e.preventDefault(); addTgId(); } });
}

async function loadNotifSettings() {
  try {
    const r = await fetch(`${API}/api/notifications/settings`);
    if (!r.ok) return;
    const cfg = await r.json();

    // Telegram
    if (cfg.telegram_configured) {
      $("tg-status").className = "config-status ok";
      $("tg-status-icon").textContent = "✓";
      $("tg-status-text").textContent = "Bot Telegram configuré";
    }
    $("tg-enabled").checked = cfg.telegram_enabled || false;
    if (cfg.telegram_bot_token) $("cfg-tg-token").value = cfg.telegram_bot_token;
    tgIds.length = 0;
    (cfg.telegram_chat_ids || []).forEach(id => tgIds.push(String(id)));
    renderTgTags();

    // Twilio
    if (cfg.twilio_configured) {
      $("twilio-status").className = "config-status ok";
      $("twilio-status-icon").textContent = "✓";
      $("twilio-status-text").textContent = "Credentials Twilio configurés";
    }
    if (cfg.twilio_account_sid) $("cfg-sid").value = cfg.twilio_account_sid;
    if (cfg.twilio_auth_token)  $("cfg-token").value = cfg.twilio_auth_token;
    if (cfg.twilio_phone_from)  $("cfg-from-sms").value = cfg.twilio_phone_from;
    if (cfg.twilio_whatsapp_from) $("cfg-from-wa").value = cfg.twilio_whatsapp_from;
    $("sms-enabled").checked = cfg.sms_enabled || false;
    $("wa-enabled").checked  = cfg.whatsapp_enabled || false;
    smsNumbers.length = 0; (cfg.sms_numbers || []).forEach(n => smsNumbers.push(n));
    waNumbers.length  = 0; (cfg.whatsapp_numbers || []).forEach(n => waNumbers.push(n));
    renderTags("sms");
    renderTags("wa");
  } catch (e) { console.error("loadNotifSettings:", e); }
}

async function saveNotifSettings() {
  const saveBtn  = document.querySelector(".btn-save-notif");
  const resultEl = $("save-result");
  saveBtn.disabled = true;
  resultEl.textContent = "Sauvegarde...";
  resultEl.style.color = "#94a3b8";

  const payload = {
    telegram_enabled:     $("tg-enabled").checked,
    telegram_bot_token:   $("cfg-tg-token").value.trim(),
    telegram_chat_ids:    [...tgIds],
    twilio_account_sid:   $("cfg-sid").value.trim(),
    twilio_auth_token:    $("cfg-token").value.trim(),
    twilio_phone_from:    $("cfg-from-sms").value.trim(),
    twilio_whatsapp_from: $("cfg-from-wa").value.trim(),
    sms_enabled:          $("sms-enabled").checked,
    sms_numbers:          [...smsNumbers],
    whatsapp_enabled:     $("wa-enabled").checked,
    whatsapp_numbers:     [...waNumbers],
  };

  try {
    const r = await fetch(`${API}/api/notifications/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (r.ok && data.saved) {
      resultEl.textContent = "Configuration sauvegardée !";
      resultEl.style.color = "#10b981";
      showToast("Configuration sauvegardée", "success");
      await loadNotifSettings();
    } else {
      resultEl.textContent = "Erreur : " + (data.detail || "inconnue");
      resultEl.style.color = "#ef4444";
    }
  } catch (e) {
    resultEl.textContent = "Impossible de joindre l'API";
    resultEl.style.color = "#ef4444";
  } finally {
    saveBtn.disabled = false;
    setTimeout(() => { resultEl.textContent = ""; }, 5000);
  }
}

async function testNotif(channel, numberOverride) {
  const isTg = channel === "telegram";
  const numInput = isTg ? null : (channel === "sms" ? $("sms-test-number") : $("wa-test-number"));
  const resultEl = isTg ? $("tg-test-result") : (channel === "sms" ? $("sms-test-result") : $("wa-test-result"));
  const num = (numberOverride === "all") ? (tgIds[0] || "") : (numInput ? numInput.value.trim() : "");

  if (isTg && tgIds.length === 0) { showToast("Ajoutez un chat ID d'abord", "error"); return; }
  if (!num) { showToast("Entrez un numéro pour le test", "error"); return; }

  resultEl.className = "test-result";
  resultEl.textContent = "Envoi...";
  resultEl.style.display = "block";
  resultEl.style.background = "transparent";
  resultEl.style.color = "#94a3b8";

  try {
    const r = await fetch(`${API}/api/notifications/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, number: num }),
    });
    const data = await r.json();
    if (data.success) {
      resultEl.className = "test-result ok";
      resultEl.textContent = "Envoyé ! " + data.message;
      showToast(`Test ${channel.toUpperCase()} envoyé`, "success");
    } else {
      resultEl.className = "test-result err";
      resultEl.textContent = data.message || data.detail || "Échec";
    }
  } catch (e) {
    resultEl.className = "test-result err";
    resultEl.textContent = "Impossible de joindre l'API";
  }
}

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Initialiser l'état vide des deux monitors
  ["spain", "france"].forEach(mid => {
    updateMonitorStatus(mid, null, null, null);
    updateControls(mid, false);
  });

  setupInputEnter();
  renderTgTags();
  renderTags("sms");
  renderTags("wa");

  connectWS();
  loadNotifSettings();
  appendLog("Dashboard VisaMonitor Dual chargé — BLS Spain + Capago France", "info", "sys");
});
