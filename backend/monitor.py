"""
Boucle de monitoring principale
- Intervalle aléatoire (30–90s)
- Diffusion WebSocket temps réel
- Historique des vérifications
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

logger = logging.getLogger(__name__)

MAX_HISTORY = 200  # entrées conservées en mémoire


class ConnectionManager:
    """Gestionnaire de connexions WebSocket."""

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


ws_manager = ConnectionManager()


class Monitor:
    """Moteur de surveillance périodique."""

    def __init__(self):
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
            logger.warning("Monitor déjà en cours")
            return
        self._running = True
        self._uptime_since = datetime.now(timezone.utc)
        self._task = asyncio.create_task(self._loop())
        logger.info("Monitor démarré")

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
        logger.info("Monitor arrêté")

    @property
    def is_running(self) -> bool:
        return self._running

    # ------------------------------------------------------------------
    # État
    # ------------------------------------------------------------------
    def get_status(self) -> MonitorStatus:
        return MonitorStatus(
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
        logger.info("Boucle de monitoring lancée")
        await self._broadcast_log("Monitoring démarré – vérification en cours...")

        while self._running:
            await self._do_check()

            if not self._running:
                break

            # Délai aléatoire anti-blocage
            interval = random.randint(
                settings.CHECK_INTERVAL_MIN,
                settings.CHECK_INTERVAL_MAX
            )
            self._next_check = datetime.now(timezone.utc) + timedelta(seconds=interval)
            logger.info(f"Prochaine vérification dans {interval}s")

            await self._broadcast(WSMessage(
                type="status_update",
                data={
                    "next_check_in_seconds": interval,
                    "next_check": self._next_check.isoformat(),
                }
            ))

            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break

        logger.info("Boucle de monitoring terminée")

    async def _do_check(self):
        """Effectue une vérification et traite le résultat."""
        self._total_checks += 1
        logger.info(f"Vérification #{self._total_checks}")

        result = await check_appointment()
        self._last_check = result.timestamp
        self._history.append(result)

        # Mise à jour compteurs
        if result.available:
            self._slots_detected = max(self._slots_detected, result.slots_count)

        # Détection de changement d'état
        state_changed = (self._current_status is not None and
                         self._current_status != result.available)
        self._current_status = result.available

        logger.info(result.to_log())

        # Broadcast résultat
        await self._broadcast(WSMessage(
            type="check_result",
            data={
                **result.model_dump(),
                "timestamp": result.timestamp.isoformat(),
                "check_number": self._total_checks,
                "state_changed": state_changed,
            }
        ))

        # Notifications si disponible
        if result.available:
            notif_report = notify(result)
            if notif_report.get("sent"):
                await self._broadcast(WSMessage(
                    type="notification",
                    data={
                        "channels": notif_report.get("channels", []),
                        "message": "Notifications envoyées !",
                    }
                ))
                await self._broadcast_log(
                    f"ALERTE envoyée via {', '.join(notif_report.get('channels', []))}"
                )
        elif result.error:
            await self._broadcast_log(f"Erreur : {result.error}")

    # ------------------------------------------------------------------
    # WebSocket helpers
    # ------------------------------------------------------------------
    async def _broadcast(self, message: WSMessage):
        await ws_manager.broadcast(message)

    async def _broadcast_log(self, text: str):
        await self._broadcast(WSMessage(
            type="log",
            data={"message": text, "timestamp": datetime.now(timezone.utc).isoformat()}
        ))


# Instance globale
monitor = Monitor()
