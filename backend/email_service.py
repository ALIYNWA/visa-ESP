"""
Service d'envoi d'emails — VisaMonitor
- Envoi via Brevo API (gratuit, 300 emails/jour, aucun mot de passe perso)
- Alerte immédiate quand un créneau est détecté (Espagne)
- Rapport toutes les 3h avec les stats des vérifications
- Templates HTML riches
"""
import json
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import List

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"
SENDER_NAME   = "VisaMonitor"
SENDER_EMAIL  = "visaMonitor.alertes@gmail.com"   # affiché comme expéditeur


def send_email(
    api_key: str,
    recipients: List[str],
    subject: str,
    html_body: str,
    **kwargs,          # ignore smtp_* si appelé avec anciens params
) -> tuple[bool, str]:
    """Envoie un email HTML via l'API Brevo (aucun mot de passe perso requis)."""
    if not api_key:
        return False, "Clé API Brevo non configurée"
    if not recipients:
        return False, "Aucun destinataire configuré"

    payload = {
        "sender":      {"name": SENDER_NAME, "email": SENDER_EMAIL},
        "to":          [{"email": r} for r in recipients],
        "subject":     subject,
        "htmlContent": html_body,
    }

    try:
        req = urllib.request.Request(
            BREVO_API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "accept":       "application/json",
                "api-key":      api_key,
                "content-type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status in (200, 201, 202):
                logger.info(f"Email Brevo envoyé à {len(recipients)} destinataire(s)")
                return True, f"Email envoyé à : {', '.join(recipients)}"
            return False, f"Brevo status {resp.status}"

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        logger.error(f"Brevo HTTP {e.code}: {body}")
        if e.code == 401:
            return False, "Clé API invalide — vérifiez votre clé Brevo"
        return False, f"Erreur Brevo {e.code}: {body[:200]}"
    except Exception as e:
        logger.error(f"Erreur email : {e}")
        return False, str(e)


# ──────────────────────────────────────────────────────────────────────
# Templates HTML
# ──────────────────────────────────────────────────────────────────────

def _base_layout(title: str, content: str, color: str = "#dc2626") -> str:
    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#0b1120;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1120;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#111827,#1a2436);border-radius:12px 12px 0 0;padding:24px 32px;border-bottom:3px solid {color};">
          <table width="100%"><tr>
            <td><span style="font-size:2rem;">🛂</span></td>
            <td style="padding-left:12px;">
              <div style="font-size:1.2rem;font-weight:800;color:#e2e8f0;">VisaMonitor</div>
              <div style="font-size:0.75rem;color:#64748b;">Surveillance rendez-vous · Alger</div>
            </td>
            <td align="right"><span style="font-size:0.7rem;color:#475569;">{datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')} UTC</span></td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#111827;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #1a2436;border-top:none;">
          {content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 32px;text-align:center;">
          <p style="font-size:0.68rem;color:#334155;margin:0;">
            VisaMonitor · Surveillance automatique · Ne pas répondre à cet email
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def build_alert_email(
    monitor_label: str,
    booking_url: str,
    slots_count: int,
    check_number: int,
    detection_message: str,
    detected_at: datetime,
    instructions: List[str],
) -> tuple[str, str]:
    """Construit l'email d'alerte créneau détecté. Retourne (sujet, html)."""

    subject = f"🚨 CRÉNEAU VISA {monitor_label.upper()} DISPONIBLE — RÉSERVEZ MAINTENANT !"

    steps_html = "".join(
        f'<tr><td style="padding:6px 0;"><span style="background:#16a34a;color:#fff;border-radius:50%;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;margin-right:10px;">{i+1}</span>'
        f'<span style="color:#e2e8f0;font-size:0.88rem;">{step}</span></td></tr>'
        for i, step in enumerate(instructions)
    )

    content = f"""
      <!-- Alerte principale -->
      <div style="background:linear-gradient(135deg,#052e1c,#0a1a10);border:2px solid #16a34a;border-radius:10px;padding:24px;margin-bottom:20px;text-align:center;">
        <div style="font-size:3rem;margin-bottom:8px;">🎉</div>
        <div style="font-size:1.5rem;font-weight:900;color:#10b981;letter-spacing:1px;">CRÉNEAU DISPONIBLE !</div>
        <div style="font-size:1rem;color:#86efac;margin-top:6px;">Visa {monitor_label} · Alger</div>
        <div style="font-size:0.8rem;color:#6ee7b7;margin-top:4px;">Détecté à {detected_at.strftime('%H:%M:%S')} UTC · Vérification n°{check_number}</div>
      </div>

      <!-- Infos créneaux -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr>
          <td width="33%" style="padding:4px;">
            <div style="background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;padding:14px;text-align:center;">
              <div style="font-size:2rem;font-weight:900;color:#10b981;">{slots_count}</div>
              <div style="font-size:0.68rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Créneaux</div>
            </div>
          </td>
          <td width="33%" style="padding:4px;">
            <div style="background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;padding:14px;text-align:center;">
              <div style="font-size:1.1rem;font-weight:900;color:#e2e8f0;">{detected_at.strftime('%H:%M')}</div>
              <div style="font-size:0.68rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Heure (UTC)</div>
            </div>
          </td>
          <td width="33%" style="padding:4px;">
            <div style="background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;padding:14px;text-align:center;">
              <div style="font-size:1.1rem;font-weight:900;color:#f59e0b;">URGENT</div>
              <div style="font-size:0.68rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Priorité</div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Signal -->
      <div style="background:#060d1a;border:1px solid #1e3a5f;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
        <div style="font-size:0.68rem;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Signal détecté</div>
        <div style="font-size:0.82rem;color:#86efac;font-family:monospace;">{detection_message}</div>
      </div>

      <!-- Bouton réservation -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="{booking_url}" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:1.1rem;font-weight:900;letter-spacing:0.5px;box-shadow:0 4px 20px rgba(16,185,129,0.4);">
          🔗 RÉSERVER MAINTENANT →
        </a>
        <div style="font-size:0.72rem;color:#64748b;margin-top:8px;">Cliquez immédiatement — les créneaux partent vite !</div>
      </div>

      <!-- Instructions -->
      <div style="background:#0a1628;border:1px solid #1e3a5f;border-radius:10px;padding:20px;margin-bottom:16px;">
        <div style="font-size:0.9rem;font-weight:700;color:#93c5fd;margin-bottom:14px;">📋 Étapes pour réserver :</div>
        <table width="100%">{steps_html}</table>
      </div>

      <!-- Avertissement -->
      <div style="background:#2d0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;">
        <div style="font-size:0.8rem;color:#fca5a5;">
          ⏰ <strong>Agissez maintenant !</strong> Les créneaux disponibles partent en quelques minutes.
          Le monitoring continue automatiquement.
        </div>
      </div>
    """

    return subject, _base_layout(subject, content, "#16a34a")


def build_report_email(
    period_hours: int,
    spain_stats: dict,
    france_stats: dict,
    generated_at: datetime,
) -> tuple[str, str]:
    """Construit l'email de rapport périodique. Retourne (sujet, html)."""

    subject = f"📊 Rapport VisaMonitor — {generated_at.strftime('%d/%m/%Y %H:%M')} UTC"

    def country_block(flag: str, label: str, stats: dict, color: str, book_url: str) -> str:
        is_running = stats.get("is_running", False)
        checks = stats.get("total_checks", 0)
        slots = stats.get("slots_detected", 0)
        status = stats.get("current_status")
        last_check = stats.get("last_check", "–")

        if isinstance(last_check, str) and last_check and last_check != "–":
            try:
                dt = datetime.fromisoformat(last_check.replace("Z", "+00:00"))
                last_check = dt.strftime("%H:%M:%S")
            except Exception:
                pass

        status_text = "🟢 DISPONIBLE" if status is True else "🔴 Indisponible" if status is False else "⚪ En attente"
        running_text = "● En cours" if is_running else "■ Arrêté"
        running_color = "#10b981" if is_running else "#ef4444"

        return f"""
        <div style="background:#0a1628;border:1px solid {color};border-radius:10px;padding:18px;margin-bottom:16px;">
          <table width="100%"><tr>
            <td><span style="font-size:1.8rem;">{flag}</span></td>
            <td style="padding-left:10px;">
              <div style="font-size:1rem;font-weight:800;color:#e2e8f0;">VISA {label.upper()}</div>
              <div style="font-size:0.72rem;color:{running_color};font-weight:700;">{running_text}</div>
            </td>
          </tr></table>
          <hr style="border:none;border-top:1px solid {color};margin:12px 0;opacity:0.3;"/>
          <table width="100%">
            <tr>
              <td width="25%" align="center" style="padding:4px;">
                <div style="font-size:1.4rem;font-weight:900;color:#e2e8f0;">{checks}</div>
                <div style="font-size:0.65rem;color:#64748b;">Vérifications</div>
              </td>
              <td width="25%" align="center" style="padding:4px;">
                <div style="font-size:1.4rem;font-weight:900;color:#10b981;">{slots}</div>
                <div style="font-size:0.65rem;color:#64748b;">Créneaux max</div>
              </td>
              <td width="50%" align="center" style="padding:4px;">
                <div style="font-size:0.88rem;font-weight:700;color:#f59e0b;">{status_text}</div>
                <div style="font-size:0.65rem;color:#64748b;">Dernier statut</div>
              </td>
            </tr>
          </table>
          <div style="font-size:0.7rem;color:#475569;margin-top:10px;">Dernière vérif. : {last_check}</div>
          <div style="text-align:center;margin-top:12px;">
            <a href="{book_url}" style="display:inline-block;background:{color};color:#fff;text-decoration:none;padding:8px 20px;border-radius:6px;font-size:0.78rem;font-weight:700;">
              Ouvrir le site →
            </a>
          </div>
        </div>
        """

    spain_block  = country_block("🇪🇸", "Espagne", spain_stats,  "#dc2626", "https://algeria.blsspainglobal.com/DZA/account/login")
    france_block = country_block("🇫🇷", "France",  france_stats, "#2563eb", "https://fr-dz.capago.eu/rendezvous/")

    content = f"""
      <!-- Titre rapport -->
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:1.2rem;font-weight:900;color:#e2e8f0;">Rapport de surveillance</div>
        <div style="font-size:0.78rem;color:#64748b;">Période : {period_hours}h · Généré le {generated_at.strftime('%d/%m/%Y à %H:%M')} UTC</div>
      </div>

      {spain_block}
      {france_block}

      <!-- Note -->
      <div style="background:#111827;border:1px solid #1a2436;border-radius:8px;padding:12px 16px;text-align:center;">
        <div style="font-size:0.75rem;color:#475569;">
          Le monitoring continue automatiquement. Prochain rapport dans {period_hours}h.
        </div>
      </div>
    """

    return subject, _base_layout(subject, content, "#3b82f6")


def build_test_email(recipients: List[str]) -> tuple[str, str]:
    """Email de test de configuration."""
    subject = "✅ VisaMonitor — Configuration email confirmée"

    content = f"""
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:3rem;margin-bottom:12px;">✅</div>
        <div style="font-size:1.3rem;font-weight:800;color:#10b981;">Email configuré avec succès !</div>
        <div style="font-size:0.85rem;color:#64748b;margin-top:8px;">
          Vous recevrez les alertes aux adresses :<br/>
          <strong style="color:#93c5fd;">{', '.join(recipients)}</strong>
        </div>
      </div>
      <div style="background:#0a1628;border:1px solid #1e3a5f;border-radius:10px;padding:18px;margin-top:16px;">
        <div style="font-size:0.85rem;font-weight:700;color:#e2e8f0;margin-bottom:10px;">Vous serez alerté(e) pour :</div>
        <div style="font-size:0.8rem;color:#93c5fd;line-height:2;">
          🚨 Créneau détecté (alerte immédiate)<br/>
          📊 Rapport de vérifications (toutes les 3h)<br/>
          📋 Instructions de réservation pas à pas
        </div>
      </div>
    """

    return subject, _base_layout(subject, content, "#10b981")
