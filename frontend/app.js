/**
 * VisaMonitor – Dashboard JavaScript
 * WebSocket temps réel + REST API
 */

// Si la page est servie depuis le port 8000 (FastAPI), on reste sur la même origine.
// Sinon (ex: preview statique sur autre port), on pointe explicitement vers le backend.
const BACKEND_PORT = 8000;
const BACKEND_HOST = `${location.hostname}:${BACKEND_PORT}`;
const IS_BACKEND_ORIGIN = location.port === String(BACKEND_PORT);
const API = IS_BACKEND_ORIGIN ? "" : `http://${BACKEND_HOST}`;
const WS_URL = `ws://${BACKEND_HOST}/ws`;
const MAX_LOG_ENTRIES = 150;
const MAX_HISTORY_ROWS = 100;

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------
let ws = null;
let wsConnected = false;
let countdownInterval = null;
let nextCheckAt = null;
let totalInterval = null;
let historyData = [];

// ----------------------------------------------------------------
// DOM helpers
// ----------------------------------------------------------------
const $ = id => document.getElementById(id);
const fmt = d => d ? new Date(d + (d.endsWith("Z") ? "" : "Z")).toLocaleTimeString("fr-FR") : "–";
const fmtFull = d => d ? new Date(d + (d.endsWith("Z") ? "" : "Z")).toLocaleString("fr-FR") : "–";

// ----------------------------------------------------------------
// WebSocket
// ----------------------------------------------------------------
function connectWS() {
  if (ws) { ws.close(); }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsConnected = true;
    updateWsBadge(true);
    appendLog("Connexion WebSocket établie", "info");
  };

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(msg);
    } catch (e) {
      console.error("WS parse error", e);
    }
  };

  ws.onerror = () => {
    appendLog("Erreur WebSocket", "error");
  };

  ws.onclose = () => {
    wsConnected = false;
    updateWsBadge(false);
    appendLog("WebSocket déconnecté – reconnexion dans 5s...", "warn");
    setTimeout(connectWS, 5000);
  };

  // Ping keepalive
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, 25000);
}

function handleMessage(msg) {
  switch (msg.type) {
    case "initial_state":
      applyFullState(msg.data);
      break;

    case "check_result":
      updateFromCheckResult(msg.data);
      break;

    case "status_update":
      if (msg.data.next_check_in_seconds !== undefined) {
        startCountdown(msg.data.next_check_in_seconds);
      }
      break;

    case "notification":
      const channels = (msg.data.channels || []).join(", ");
      appendLog(`Alertes envoyées → ${channels}`, "success");
      showToast(`Notification envoyée via ${channels} !`, "success");
      break;

    case "log":
      appendLog(msg.data.message, "info");
      break;

    case "pong":
      break;
  }
}

// ----------------------------------------------------------------
// Affichage état complet (initial_state)
// ----------------------------------------------------------------
function applyFullState(state) {
  updateStatus(state.current_status);
  $("stat-checks").textContent = state.total_checks ?? 0;
  $("stat-slots").textContent = state.slots_detected ?? 0;
  $("stat-last").textContent = fmt(state.last_check);
  $("stat-uptime").textContent = fmt(state.uptime_since);
  updateControls(state.is_running);

  if (state.history && state.history.length > 0) {
    historyData = [...state.history].reverse();
    renderHistoryTable();
    // Charger les logs passés
    state.history.slice(-30).forEach(r => {
      appendLog(formatCheckLog(r), r.available ? "success" : r.error ? "error" : null);
    });
  }
}

// ----------------------------------------------------------------
// Mise à jour d'un résultat de vérification
// ----------------------------------------------------------------
function updateFromCheckResult(data) {
  updateStatus(data.available);
  $("stat-checks").textContent = data.check_number ?? parseInt($("stat-checks").textContent || 0) + 1;
  if (data.slots_count > 0) $("stat-slots").textContent = data.slots_count;
  $("stat-last").textContent = fmt(data.timestamp);

  appendLog(formatCheckLog(data), data.available ? "success" : data.error ? "error" : null);

  // Ajouter au tableau historique
  historyData.unshift(data);
  if (historyData.length > MAX_HISTORY_ROWS) historyData.pop();
  renderHistoryTable();

  if (data.available) {
    showToast("Créneau disponible ! Réservez maintenant.", "success", 8000);
    pulseStatus();
  }
}

function formatCheckLog(r) {
  const icon = r.available ? "✓" : r.error ? "✗" : "–";
  const dur = r.duration_ms ? ` (${Math.round(r.duration_ms)}ms)` : "";
  return `[#${r.check_number || "?"}] ${icon} ${r.message}${dur}`;
}

// ----------------------------------------------------------------
// Statut visuel
// ----------------------------------------------------------------
function updateStatus(status) {
  const card = $("status-card");
  const icon = $("status-icon");
  const label = $("status-label");
  const sub = $("status-sub");

  card.className = "card status-card";

  const bookBtn = $("book-btn");
  // Vérifier si le dernier message indique un blocage géo
  const lastMsg = historyData[0]?.message || "";
  const isGeoBlocked = lastMsg.includes("GEO_BLOCKED");

  if (isGeoBlocked) {
    card.classList.add("unavailable");
    icon.textContent = "🚫";
    label.textContent = "ACCÈS BLOQUÉ";
    label.className = "status-label unavailable";
    sub.textContent = "Site inaccessible depuis votre région — désactivez votre VPN";
    if (bookBtn) bookBtn.style.display = "none";
  } else if (status === true) {
    card.classList.add("available");
    icon.textContent = "✅";
    label.textContent = "DISPONIBLE";
    label.className = "status-label available";
    sub.textContent = "Des créneaux sont disponibles – Réservez maintenant !";
    if (bookBtn) bookBtn.style.display = "inline-block";
  } else if (status === false) {
    card.classList.add("unavailable");
    icon.textContent = "⏳";
    label.textContent = "INDISPONIBLE";
    label.className = "status-label unavailable";
    sub.textContent = "Aucun créneau disponible pour le moment";
    if (bookBtn) bookBtn.style.display = "none";
  } else {
    card.classList.add("unknown");
    icon.textContent = "🔍";
    label.textContent = "EN ATTENTE";
    label.className = "status-label unknown";
    sub.textContent = "Démarrez le monitoring pour vérifier";
    if (bookBtn) bookBtn.style.display = "none";
  }
}

function pulseStatus() {
  const card = $("status-card");
  card.style.boxShadow = "0 0 40px rgba(16,185,129,0.6)";
  setTimeout(() => { card.style.boxShadow = ""; }, 3000);
}

// ----------------------------------------------------------------
// Countdown
// ----------------------------------------------------------------
function startCountdown(seconds) {
  clearInterval(countdownInterval);
  nextCheckAt = Date.now() + seconds * 1000;
  totalInterval = seconds;
  $("countdown-wrap").style.display = "flex";
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  const remaining = Math.max(0, Math.round((nextCheckAt - Date.now()) / 1000));
  $("countdown-timer").textContent = `${remaining}s`;
  const pct = totalInterval > 0 ? ((totalInterval - remaining) / totalInterval * 100) : 0;
  $("countdown-bar").style.width = `${pct}%`;
  if (remaining === 0) clearInterval(countdownInterval);
}

// ----------------------------------------------------------------
// Historique
// ----------------------------------------------------------------
function renderHistoryTable() {
  const tbody = $("history-tbody");
  tbody.innerHTML = historyData.slice(0, MAX_HISTORY_ROWS).map(r => {
    const badgeCls = r.error ? "err" : r.available ? "ok" : "nok";
    const badgeTxt = r.error ? "ERREUR" : r.available ? "OK" : "NON";
    const dur = r.duration_ms ? `${Math.round(r.duration_ms)}ms` : "–";
    return `
      <tr>
        <td>${fmtFull(r.timestamp)}</td>
        <td><span class="badge ${badgeCls}">${badgeTxt}</span></td>
        <td>${r.slots_count ?? 0}</td>
        <td>${escHtml(r.message)}</td>
        <td>${dur}</td>
      </tr>
    `;
  }).join("");
}

// ----------------------------------------------------------------
// Log console
// ----------------------------------------------------------------
function appendLog(message, type = null) {
  const container = $("log-container");
  const now = new Date().toLocaleTimeString("fr-FR");
  const div = document.createElement("div");
  div.className = "log-entry";
  const cls = type ? `log-msg ${type}` : "log-msg";
  div.innerHTML = `<span class="log-time">${now}</span><span class="${cls}">${escHtml(message)}</span>`;
  container.prepend(div);

  // Limiter le nombre d'entrées
  while (container.children.length > MAX_LOG_ENTRIES) {
    container.lastChild.remove();
  }
}

// ----------------------------------------------------------------
// Contrôles
// ----------------------------------------------------------------
function updateControls(running) {
  $("btn-start").disabled = running;
  $("btn-stop").disabled = !running;
  $("running-indicator").style.display = running ? "inline-flex" : "none";
}

async function startMonitor() {
  try {
    const r = await fetch(`${API}/api/start`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json();
      showToast(err.detail || "Erreur démarrage", "error");
      return;
    }
    appendLog("Monitor démarré", "success");
    updateControls(true);
    updateStatus(null);
  } catch (e) {
    showToast("Impossible de joindre l'API", "error");
  }
}

async function stopMonitor() {
  try {
    const r = await fetch(`${API}/api/stop`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json();
      showToast(err.detail || "Erreur arrêt", "error");
      return;
    }
    appendLog("Monitor arrêté", "warn");
    updateControls(false);
    clearInterval(countdownInterval);
    $("countdown-wrap").style.display = "none";
  } catch (e) {
    showToast("Impossible de joindre l'API", "error");
  }
}

function clearLog() {
  $("log-container").innerHTML = "";
  appendLog("Logs effacés", "info");
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
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ----------------------------------------------------------------
// Utils
// ----------------------------------------------------------------
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateWsBadge(connected) {
  const badge = $("ws-badge");
  badge.textContent = connected ? "● Connecté" : "○ Déconnecté";
  badge.className = `ws-badge ${connected ? "connected" : "disconnected"}`;
}

// ----------------------------------------------------------------
// Notification settings
// ----------------------------------------------------------------
const smsNumbers = [];
const waNumbers = [];
const tgIds = [];

function toggleSection(id) {
  const body = $(id);
  const arrow = $(`${id}-arrow`);
  const hidden = body.classList.toggle("hidden");
  if (arrow) arrow.textContent = hidden ? "▶" : "▼";
}

function renderTags(channel) {
  const arr = channel === "sms" ? smsNumbers : waNumbers;
  const tagId = channel === "sms" ? "sms-tags" : "wa-tags";
  $(tagId).innerHTML = arr.map((n, i) => `
    <span class="number-tag">
      ${escHtml(n)}
      <button onclick="removeNumber('${channel}', ${i})" title="Supprimer">✕</button>
    </span>
  `).join("") || '<span style="color:#475569;font-size:0.78rem;">Aucun numéro ajouté</span>';
}

function renderTgTags() {
  $("tg-tags").innerHTML = tgIds.map((id, i) => `
    <span class="number-tag" style="background:#1e3a5f;border-color:#2563eb;color:#93c5fd;">
      ${escHtml(String(id))}
      <button onclick="removeTgId(${i})" title="Supprimer">✕</button>
    </span>
  `).join("") || '<span style="color:#475569;font-size:0.78rem;">Aucun chat ID ajouté</span>';
}

function addTgId() {
  const input = $("tg-new-id");
  const raw = input.value.trim();
  if (!raw) return;
  if (!/^-?\d+$/.test(raw)) {
    showToast("Chat ID invalide — doit être un nombre (ex: 123456789)", "error");
    return;
  }
  if (tgIds.includes(raw)) { showToast("ID déjà dans la liste", "info"); return; }
  tgIds.push(raw);
  input.value = "";
  renderTgTags();
}

function removeTgId(idx) {
  tgIds.splice(idx, 1);
  renderTgTags();
}

function addNumber(channel) {
  const inputId = channel === "sms" ? "sms-new-number" : "wa-new-number";
  const input = $(inputId);
  const raw = input.value.trim();
  if (!raw) return;
  const num = raw.startsWith("+") ? raw : "+" + raw;
  if (!/^\+\d{7,15}$/.test(num)) {
    showToast("Format invalide. Exemple : +213661234567", "error");
    return;
  }
  const arr = channel === "sms" ? smsNumbers : waNumbers;
  if (arr.includes(num)) {
    showToast("Numéro déjà dans la liste", "info");
    return;
  }
  arr.push(num);
  input.value = "";
  renderTags(channel);
}

function removeNumber(channel, idx) {
  const arr = channel === "sms" ? smsNumbers : waNumbers;
  arr.splice(idx, 1);
  renderTags(channel);
}

// Enter key on number inputs
function setupNumberInputEnter() {
  ["sms-new-number", "wa-new-number"].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); addNumber(id.startsWith("sms") ? "sms" : "wa"); }
    });
  });
  const tgInput = $("tg-new-id");
  if (tgInput) tgInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addTgId(); }
  });
}

async function loadNotifSettings() {
  try {
    const r = await fetch(`${API}/api/notifications/settings`);
    if (!r.ok) return;
    const cfg = await r.json();

    // Telegram status
    if (cfg.telegram_configured) {
      $("tg-status").className = "twilio-status ok";
      $("tg-status-icon").textContent = "✓";
      $("tg-status-text").textContent = "Bot Telegram configuré";
    } else {
      $("tg-status").className = "twilio-status nok";
      $("tg-status-icon").textContent = "✗";
      $("tg-status-text").textContent = "Bot non configuré";
    }

    // Twilio status
    if (cfg.twilio_configured) {
      $("twilio-status").className = "twilio-status ok";
      $("twilio-status-icon").textContent = "✓";
      $("twilio-status-text").textContent = "Credentials Twilio configurés";
    } else {
      $("twilio-status").className = "twilio-status nok";
      $("twilio-status-icon").textContent = "✗";
      $("twilio-status-text").textContent = "Credentials Twilio non configurés (SMS/WhatsApp optionnel)";
    }

    // Telegram fields
    $("tg-enabled").checked = cfg.telegram_enabled || false;
    if (cfg.telegram_bot_token) $("cfg-tg-token").value = cfg.telegram_bot_token;
    tgIds.length = 0;
    (cfg.telegram_chat_ids || []).forEach(id => tgIds.push(String(id)));
    renderTgTags();

    // Twilio fields
    if (cfg.twilio_account_sid) $("cfg-sid").value = cfg.twilio_account_sid;
    if (cfg.twilio_auth_token)  $("cfg-token").value = cfg.twilio_auth_token;
    if (cfg.twilio_phone_from)  $("cfg-from-sms").value = cfg.twilio_phone_from;
    if (cfg.twilio_whatsapp_from) $("cfg-from-wa").value = cfg.twilio_whatsapp_from;
    $("sms-enabled").checked = cfg.sms_enabled || false;
    $("wa-enabled").checked  = cfg.whatsapp_enabled || false;
    smsNumbers.length = 0;
    (cfg.sms_numbers || []).forEach(n => smsNumbers.push(n));
    waNumbers.length = 0;
    (cfg.whatsapp_numbers || []).forEach(n => waNumbers.push(n));
    renderTags("sms");
    renderTags("wa");
  } catch (e) {
    console.error("loadNotifSettings error:", e);
  }
}

async function saveNotifSettings() {
  const saveBtn = document.querySelector(".btn-save-notif");
  const resultEl = $("save-result");
  saveBtn.disabled = true;
  resultEl.textContent = "Sauvegarde en cours...";
  resultEl.style.color = "#94a3b8";

  const payload = {
    telegram_enabled:      $("tg-enabled").checked,
    telegram_bot_token:    $("cfg-tg-token").value.trim(),
    telegram_chat_ids:     [...tgIds],
    twilio_account_sid:    $("cfg-sid").value.trim(),
    twilio_auth_token:     $("cfg-token").value.trim(),
    twilio_phone_from:     $("cfg-from-sms").value.trim(),
    twilio_whatsapp_from:  $("cfg-from-wa").value.trim(),
    sms_enabled:           $("sms-enabled").checked,
    sms_numbers:           [...smsNumbers],
    whatsapp_enabled:      $("wa-enabled").checked,
    whatsapp_numbers:      [...waNumbers],
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
      showToast("Configuration notifications sauvegardée", "success");
      await loadNotifSettings();  // Rafraîchir le statut Twilio
    } else {
      resultEl.textContent = "Erreur : " + (data.detail || "inconnue");
      resultEl.style.color = "#ef4444";
    }
  } catch (e) {
    resultEl.textContent = "Impossible de joindre l'API";
    resultEl.style.color = "#ef4444";
  } finally {
    saveBtn.disabled = false;
    setTimeout(() => { resultEl.textContent = ""; }, 4000);
  }
}

async function testNotif(channel, numberOverride) {
  const isTg = channel === "telegram";
  const numInput = isTg ? null : (channel === "sms" ? $("sms-test-number") : $("wa-test-number"));
  const resultEl = isTg ? $("tg-test-result") : (channel === "sms" ? $("sms-test-result") : $("wa-test-result"));
  const num = numberOverride === "all" ? (tgIds[0] || "") : (numInput ? numInput.value.trim() : "");

  if (isTg && tgIds.length === 0) {
    showToast("Ajoutez au moins un chat ID avant de tester", "error");
    return;
  }

  if (!num) { showToast("Entrez un numéro pour le test", "error"); return; }

  resultEl.className = "test-result";
  resultEl.textContent = "Envoi en cours...";
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
      resultEl.textContent = data.message || (data.detail || "Échec");
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
  updateStatus(null);
  updateControls(false);
  $("countdown-wrap").style.display = "none";
  $("btn-start").addEventListener("click", startMonitor);
  $("btn-stop").addEventListener("click", stopMonitor);
  $("btn-clear-log").addEventListener("click", clearLog);

  setupNumberInputEnter();
  renderTgTags();
  renderTags("sms");
  renderTags("wa");

  connectWS();
  loadNotifSettings();
  appendLog("Dashboard VisaMonitor chargé", "info");
});
