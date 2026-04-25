"""
Boucle de monitoring principale – Double moniteur (Espagne + France)
- Intervalle aléatoire (30–90s)
- Diffusion WebSocket temps réel avec monitor_id
- Historique des vérifications par pays
- Journalisation fichier
"""
import asyncio
import logging
import random
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Optional, Set, Deque

from fastapi import WebSocket

from config import settings
from models import CheckResult, MonitorStatus, WSMessage
from notifier import notify, cooldown
from scraper import check_appointment
import notification_store as store
from email_service import send_email, build_alert_email, build_report_email

logger = logging.getLogger(__name__)

MAX_HISTORY = 200


class ConnectionManager:
    """Gestionnaire de connexions WebSocket partagé."""

    def __init__(self):
        self._connections: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.add(ws)
        logger.debug(f"WS connecté – {len(self._connections)} client(s)")

    def disconnect(self, ws: WebSocket):
        self._connections.discard(ws)
        logger.debug(f"WS déconnecté – {len(self._connections)} client(s)")

    async def broadcast(self, message: WSMessage):
        payload = message.model_dump_json()
        dead = set()
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)


# Instance partagée unique
ws_manager = ConnectionManager()


class Monitor:
    """Moteur de surveillance périodique pour un pays donné."""

    def __init__(self, monitor_id: str, target_url: str, label: str):
        self.monitor_id = monitor_id
        self.target_url = target_url
        self.label = label

        self._task: Optional[asyncio.Task] = None
        self._running: bool = False
        self._total_checks: int = 0
        self._slots_detected: int = 0
        self._current_status: Optional[bool] = None
        self._last_check: Optional[datetime] = None
        self._next_check: Optional[datetime] = None
        self._uptime_since: Optional[datetime] = None
        self._history: Deque[CheckResult] = deque(maxlen=MAX_HISTORY)

    # ------------------------------------------------------------------
    # Contrôle
    # ------------------------------------------------------------------
    def start(self):
        if self._running:
            logger.warning(f"[{self.monitor_id}] Monitor déjà en cours")
            return
        self._running = True
        self._uptime_since = datetime.now(timezone.utc)
        self._task = asyncio.create_task(self._loop())
        logger.info(f"[{self.monitor_id}] Monitor démarré → {self.target_url}")

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
        logger.info(f"[{self.monitor_id}] Monitor arrêté")

    @property
    def is_running(self) -> bool:
        return self._running

    # ------------------------------------------------------------------
    # État
    # ------------------------------------------------------------------
    def get_status(self) -> MonitorStatus:
        return MonitorStatus(
            monitor_id=self.monitor_id,
            label=self.label,
            is_running=self._running,
            current_status=self._current_status,
            slots_detected=self._slots_detected,
            total_checks=self._total_checks,
            last_check=self._last_check,
            next_check=self._next_check,
            last_notification=cooldown.last_sent,
            uptime_since=self._uptime_since,
            history=list(self._history),
        )

    # ------------------------------------------------------------------
    # Boucle principale
    # ------------------------------------------------------------------
    async def _loop(self):
        logger.info(f"[{self.monitor_id}] Boucle lancée")
        await self._broadcast_log(f"Monitoring {self.label} démarré – vérification en cours...")

        while self._running:
            await self._do_check()

            if not self._running:
                break

            interval = random.randint(
                settings.CHECK_INTERVAL_MIN,
                settings.CHECK_INTERVAL_MAX
            )
            self._next_check = datetime.now(timezone.utc) + timedelta(seconds=interval)
            logger.info(f"[{self.monitor_id}] Prochaine vérif dans {interval}s")

            await self._broadcast(WSMessage(
                type="status_update",
                data={
                    "monitor_id": self.monitor_id,
                    "next_check_in_seconds": interval,
                    "next_check": self._next_check.isoformat(),
                }
            ))

            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break

        logger.info(f"[{self.monitor_id}] Boucle terminée")

    async def _do_check(self):
        """Effectue une vérification et traite le résultat."""
        self._total_checks += 1
        logger.info(f"[{self.monitor_id}] Vérification #{self._total_checks}")

        result = await check_appointment(
            monitor_id=self.monitor_id,
            target_url=self.target_url,
        )
        self._last_check = result.timestamp
        self._history.append(result)

        if result.available:
            self._slots_detected = max(self._slots_detected, result.slots_count)

        state_changed = (self._current_status is not None and
                         self._current_status != result.available)
        self._current_status = result.available

        logger.info(result.to_log())

        # Broadcast résultat avec monitor_id
        await self._broadcast(WSMessage(
            type="check_result",
            data={
                **result.model_dump(),
                "timestamp": result.timestamp.isoformat(),
                "check_number": self._total_checks,
                "state_changed": state_changed,
                "monitor_id": self.monitor_id,
            }
        ))

        # Notifications si disponible
        if result.available:
            notif_report = notify(result)
            channels = notif_report.get("channels", [])

            # Email alerte immédiate (Espagne uniquement si configuré)
            await self._send_alert_email(result)

            if notif_report.get("sent") or channels:
                await self._broadcast(WSMessage(
                    type="notification",
                    data={
                        "monitor_id": self.monitor_id,
                        "channels": channels,
                        "message": f"Notifications {self.label} envoyées !",
                    }
                ))
                await self._broadcast_log(
                    f"[{self.label}] ALERTE envoyée"
                )
        elif result.error:
            await self._broadcast_log(f"[{self.label}] Erreur : {result.error}")

    async def _send_alert_email(self, result: CheckResult):
        """Envoie un email d'alerte créneau. Espagne + Préfecture."""
        if self.monitor_id not in ("spain", "prefecture"):
            return
        cfg = store.load()
        if not cfg.get("email_enabled") or not store.email_configured(cfg):
            return
        try:
            instructions_by_monitor = {
                "spain": [
                    "Cliquez sur le bouton 'RÉSERVER MAINTENANT' ci-dessous",
                    "Connectez-vous à votre compte BLS Spain Visa (ou créez-en un)",
                    "Sélectionnez 'Espagne' → 'Court séjour'",
                    "Choisissez une date et un horaire disponibles",
                    "Remplissez vos informations personnelles (passeport, etc.)",
                    "Confirmez et téléchargez votre confirmation de rendez-vous",
                    "Préparez vos documents avant la date du RDV",
                ],
                "prefecture": [
                    "Cliquez sur le bouton 'RÉSERVER MAINTENANT' ci-dessous",
                    "Cliquez sur 'Prendre rendez-vous' sur le site de la préfecture",
                    "Sélectionnez votre type de titre de séjour",
                    "Choisissez la préfecture des Hauts-de-Seine — Nanterre",
                    "Sélectionnez une date et un horaire disponibles",
                    "Confirmez le rendez-vous et notez la référence",
                    "Apportez votre convocation + documents demandés le jour J",
                ],
            }
            instructions_spain = instructions_by_monitor.get(self.monitor_id, instructions_by_monitor["spain"])
            subject, html = build_alert_email(
                monitor_label=self.label,
                booking_url=self.target_url,
                slots_count=result.slots_count,
                check_number=self._total_checks,
                detection_message=result.message,
                detected_at=result.timestamp,
                instructions=instructions_spain,
            )
            ok, msg = send_email(
                api_key=cfg["email_brevo_api_key"],
                recipients=cfg["email_recipients"],
                subject=subject,
                html_body=html,
            )
            if ok:
                await self._broadcast_log(f"[{self.label}] Email alerte envoye a {len(cfg['email_recipients'])} destinataire(s)")
            else:
                await self._broadcast_log(f"[{self.label}] Erreur email : {msg}")
        except Exception as e:
            logger.error(f"Erreur email alerte : {e}")

    # ------------------------------------------------------------------
    # WebSocket helpers
    # ------------------------------------------------------------------
    async def _broadcast(self, message: WSMessage):
        await ws_manager.broadcast(message)

    async def _broadcast_log(self, text: str):
        await self._broadcast(WSMessage(
            type="log",
            data={
                "message": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "monitor_id": self.monitor_id,
            }
        ))


# ------------------------------------------------------------------
# Instances globales – Espagne + France
# ------------------------------------------------------------------
spain_monitor = Monitor(
    monitor_id="spain",
    target_url=settings.TARGET_URL,
    label="Espagne",
)

france_monitor = Monitor(
    monitor_id="france",
    target_url=settings.FRANCE_TARGET_URL,
    label="France",
)

prefecture_monitor = Monitor(
    monitor_id="prefecture",
    target_url=settings.PREFECTURE_TARGET_URL,
    label="Préfecture 92",
)

# Dictionnaire pour accès générique
MONITORS = {
    "spain":       spain_monitor,
    "france":      france_monitor,
    "prefecture":  prefecture_monitor,
}
