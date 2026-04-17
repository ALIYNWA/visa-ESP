"""
Application FastAPI – VisaMonitor Dual
- Double monitor : Espagne (BLS) + France (TLS Contact)
- REST API par pays + endpoints partagés
- WebSocket temps réel unique (broadcast monitor_id)
- Fichiers statiques frontend
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
from monitor import spain_monitor, france_monitor, MONITORS, ws_manager
import notification_store as store
from notifier import test_notification

# ------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------
log_dir = Path(__file__).parent.parent / "logs"
log_dir.mkdir(exist_ok=True)

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_dir / "monitor.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Lifespan
# ------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== VisaMonitor Dual démarrage ===")
    logger.info(f"Espagne : {settings.TARGET_URL}")
    logger.info(f"France  : {settings.FRANCE_TARGET_URL}")
    yield
    for m in MONITORS.values():
        m.stop()
    logger.info("=== VisaMonitor arrêt ===")


app = FastAPI(
    title="VisaMonitor Dual",
    description="Monitoring Espagne (BLS) + France (TLS Contact) – Alger",
    version="2.0.0",
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
# Endpoints partagés
# ------------------------------------------------------------------
@app.get("/", include_in_schema=False)
async def serve_dashboard():
    index = frontend_dir / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"message": "VisaMonitor API", "docs": "/docs"})


@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/status")
async def get_all_status():
    """Retourne le statut des deux monitors."""
    return {
        mid: m.get_status().model_dump()
        for mid, m in MONITORS.items()
    }


# ------------------------------------------------------------------
# Endpoints par monitor (spain | france)
# ------------------------------------------------------------------
@app.get("/api/{monitor_id}/status")
async def get_monitor_status(monitor_id: str):
    if monitor_id not in MONITORS:
        raise HTTPException(404, f"Monitor inconnu : {monitor_id}")
    return MONITORS[monitor_id].get_status().model_dump()


@app.post("/api/{monitor_id}/start")
async def start_monitor(monitor_id: str):
    if monitor_id not in MONITORS:
        raise HTTPException(404, f"Monitor inconnu : {monitor_id}")
    m = MONITORS[monitor_id]
    if m.is_running:
        raise HTTPException(400, f"Monitor {monitor_id} déjà en cours")
    m.start()
    return {"message": f"Monitor {monitor_id} démarré", "started_at": datetime.now(timezone.utc).isoformat()}


@app.post("/api/{monitor_id}/stop")
async def stop_monitor(monitor_id: str):
    if monitor_id not in MONITORS:
        raise HTTPException(404, f"Monitor inconnu : {monitor_id}")
    m = MONITORS[monitor_id]
    if not m.is_running:
        raise HTTPException(400, f"Monitor {monitor_id} non démarré")
    m.stop()
    return {"message": f"Monitor {monitor_id} arrêté", "stopped_at": datetime.now(timezone.utc).isoformat()}


@app.get("/api/{monitor_id}/history")
async def get_history(monitor_id: str, limit: int = 50):
    if monitor_id not in MONITORS:
        raise HTTPException(404, f"Monitor inconnu : {monitor_id}")
    status = MONITORS[monitor_id].get_status()
    history = status.history[-limit:]
    return {
        "monitor_id": monitor_id,
        "total": len(status.history),
        "returned": len(history),
        "history": [r.model_dump() for r in history],
    }


# ------------------------------------------------------------------
# Notifications
# ------------------------------------------------------------------
@app.get("/api/notifications/settings")
async def get_notif_settings():
    cfg = store.load()
    return {
        **store.get_masked(cfg),
        "twilio_configured": store.twilio_configured(cfg),
        "telegram_configured": store.telegram_configured(cfg),
    }


@app.post("/api/notifications/settings")
async def save_notif_settings(body: dict):
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
    channel = body.get("channel", "").strip()
    number = body.get("number", "").strip()

    if not channel or not number:
        raise HTTPException(400, "channel et number sont requis")

    if channel in ("sms", "whatsapp") and not number.startswith("+"):
        raise HTTPException(400, "Le numéro doit commencer par + (ex: +213XXXXXXXXX)")

    cfg = store.load()
    if channel == "telegram":
        chat_ids = cfg.get("telegram_chat_ids", [])
        if not chat_ids:
            raise HTTPException(400, "Aucun chat ID configuré")
        number = chat_ids[0]

    ok, msg = test_notification(channel, number, cfg)
    return {"success": ok, "message": msg}


# ------------------------------------------------------------------
# WebSocket unique (broadcast pour les deux monitors)
# ------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    logger.info("Nouveau client WebSocket connecté")

    try:
        # Envoi de l'état initial des deux monitors
        all_status = {
            mid: m.get_status().model_dump()
            for mid, m in MONITORS.items()
        }
        await websocket.send_text(
            WSMessage(
                type="initial_state",
                data=all_status,
            ).model_dump_json()
        )

        while True:
            try:
                data = await websocket.receive_text()
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
# Fichiers statiques frontend
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
