"""
Application FastAPI – VisaMonitor
- REST API pour contrôle et statut
- WebSocket pour dashboard temps réel
- Serveur de fichiers statiques (frontend)
"""
import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from models import WSMessage
from monitor import monitor, ws_manager
import notification_store as store
from notifier import test_notification

# ------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(Path(__file__).parent.parent / "logs" / "monitor.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# App
# ------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== VisaMonitor démarrage ===")
    logger.info(f"Cible : {settings.TARGET_URL}")
    logger.info(f"Intervalle : {settings.CHECK_INTERVAL_MIN}–{settings.CHECK_INTERVAL_MAX}s")
    yield
    monitor.stop()
    logger.info("=== VisaMonitor arrêt ===")


app = FastAPI(
    title="VisaMonitor",
    description="Monitoring de disponibilité de rendez-vous visa Espagne – Alger",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_dir = Path(__file__).parent.parent / "frontend"


# ------------------------------------------------------------------
# REST endpoints
# ------------------------------------------------------------------
@app.get("/", include_in_schema=False)
async def serve_dashboard():
    index = frontend_dir / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"message": "VisaMonitor API", "docs": "/docs"})


@app.get("/api/status")
async def get_status():
    """Retourne le statut complet du monitor."""
    status = monitor.get_status()
    return status.model_dump()


@app.post("/api/start")
async def start_monitor():
    """Démarre le monitoring."""
    if monitor.is_running:
        raise HTTPException(400, "Monitor déjà en cours")
    monitor.start()
    return {"message": "Monitor démarré", "started_at": datetime.now(timezone.utc).isoformat()}


@app.post("/api/stop")
async def stop_monitor():
    """Arrête le monitoring."""
    if not monitor.is_running:
        raise HTTPException(400, "Monitor non démarré")
    monitor.stop()
    return {"message": "Monitor arrêté", "stopped_at": datetime.now(timezone.utc).isoformat()}


@app.get("/api/history")
async def get_history(limit: int = 50):
    """Retourne l'historique des vérifications."""
    status = monitor.get_status()
    history = status.history[-limit:]
    return {
        "total": len(status.history),
        "returned": len(history),
        "history": [r.model_dump() for r in history],
    }


@app.get("/api/health")
async def health():
    """Health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# ------------------------------------------------------------------
# Notifications settings
# ------------------------------------------------------------------
@app.get("/api/notifications/settings")
async def get_notif_settings():
    """Retourne les paramètres de notification (token masqué)."""
    cfg = store.load()
    return {
        **store.get_masked(cfg),
        "twilio_configured": store.twilio_configured(cfg),
        "telegram_configured": store.telegram_configured(cfg),
    }


@app.post("/api/notifications/settings")
async def save_notif_settings(body: dict):
    """
    Sauvegarde les paramètres de notification.
    Seuls les champs reconnus sont acceptés.
    """
    allowed_keys = {
        "telegram_enabled", "telegram_bot_token", "telegram_chat_ids",
        "sms_enabled", "sms_numbers",
        "whatsapp_enabled", "whatsapp_numbers",
        "twilio_account_sid", "twilio_auth_token",
        "twilio_phone_from", "twilio_whatsapp_from",
    }
    current = store.load()

    for key in allowed_keys:
        if key in body:
            val = body[key]
            # Ne pas écraser le token si masqué (****) — l'utilisateur n'a pas changé
            if key == "twilio_auth_token" and "****" in str(val):
                continue
            current[key] = val

    if store.save(current):
        logger.info("Parametres de notification sauvegardes")
        return {
            "saved": True,
            "twilio_configured": store.twilio_configured(current),
            "telegram_configured": store.telegram_configured(current),
        }
    raise HTTPException(500, "Erreur lors de la sauvegarde")


@app.post("/api/notifications/test")
async def test_notif(body: dict):
    """
    Envoie un message de test.
    body: { channel: "sms"|"whatsapp", number: "+213XXXXXXXXX" }
    """
    channel = body.get("channel", "").strip()
    number = body.get("number", "").strip()

    if not channel or not number:
        raise HTTPException(400, "channel et number sont requis")

    # Pour Telegram le "number" est un chat_id numérique, pas un numéro de téléphone
    if channel in ("sms", "whatsapp") and not number.startswith("+"):
        raise HTTPException(400, "Le numéro doit commencer par + (ex: +213XXXXXXXXX)")

    cfg = store.load()
    # Pour Telegram : tester vers tous les chat_ids configurés (number = premier id ou "all")
    if channel == "telegram":
        chat_ids = cfg.get("telegram_chat_ids", [])
        if not chat_ids:
            raise HTTPException(400, "Aucun chat ID configuré — ajoutez-en un d'abord")
        number = chat_ids[0]  # on teste sur le premier

    ok, msg = test_notification(channel, number, cfg)
    return {"success": ok, "message": msg}


# ------------------------------------------------------------------
# WebSocket
# ------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    logger.info("Nouveau client WebSocket connecté")

    # Envoi du statut initial
    try:
        status = monitor.get_status()
        await websocket.send_text(
            WSMessage(
                type="initial_state",
                data=status.model_dump(),
            ).model_dump_json()
        )

        # Maintenir la connexion ouverte
        while True:
            try:
                data = await websocket.receive_text()
                # Commandes simples depuis le client
                if data == "ping":
                    await websocket.send_text(
                        WSMessage(type="pong", data={}).model_dump_json()
                    )
            except WebSocketDisconnect:
                break
            except Exception:
                break

    finally:
        ws_manager.disconnect(websocket)
        logger.info("Client WebSocket déconnecté")


# ------------------------------------------------------------------
# Fichiers statiques frontend (monté EN DERNIER pour ne pas masquer les routes API)
# ------------------------------------------------------------------
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


# ------------------------------------------------------------------
# Entrée
# ------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        log_level=settings.LOG_LEVEL.lower(),
    )
