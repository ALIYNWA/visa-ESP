"""
Application FastAPI – VisaMonitor Dual
- Double monitor : Espagne (BLS) + France (TLS Contact)
- REST API par pays + endpoints partagés
- WebSocket temps réel unique (broadcast monitor_id)
- Fichiers statiques frontend
"""
import asyncio
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
from email_service import send_email, build_report_email, build_test_email

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
async def _report_scheduler():
    """Envoie un rapport email toutes les N heures."""
    while True:
        cfg = store.load()
        interval_h = cfg.get("email_report_interval_hours", 3)
        await asyncio.sleep(interval_h * 3600)
        if not cfg.get("email_report_enabled") or not cfg.get("email_enabled"):
            continue
        if not store.email_configured(cfg):
            continue
        try:
            spain_stats  = spain_monitor.get_status().model_dump()
            france_stats = france_monitor.get_status().model_dump()
            now = datetime.now(timezone.utc)
            subject, html = build_report_email(interval_h, spain_stats, france_stats, now)
            ok, msg = send_email(
                smtp_user=cfg["email_smtp_user"],
                smtp_password=cfg["email_smtp_password"],
                recipients=cfg["email_recipients"],
                subject=subject,
                html_body=html,
                smtp_host=cfg.get("email_smtp_host", ""),
                smtp_port=cfg.get("email_smtp_port", 587),
            )
            logger.info(f"Rapport email : {msg}")
        except Exception as e:
            logger.error(f"Erreur rapport email : {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== VisaMonitor Dual démarrage ===")
    logger.info(f"Espagne : {settings.TARGET_URL}")
    logger.info(f"France  : {settings.FRANCE_TARGET_URL}")
    report_task = asyncio.create_task(_report_scheduler())
    yield
    report_task.cancel()
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
        "email_enabled", "email_smtp_user", "email_smtp_password",
        "email_smtp_host", "email_smtp_port", "email_recipients",
        "email_report_enabled", "email_report_interval_hours",
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
    # Ne pas écraser le mot de passe masqué
    if "email_smtp_password" in body and body["email_smtp_password"] == "****":
        body.pop("email_smtp_password")

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
            "email_configured": store.email_configured(current),
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


@app.post("/api/notifications/test-email")
async def test_email(body: dict):
    """Envoie un email de test aux destinataires configurés."""
    cfg = store.load()

    # Mettre à jour temporairement avec les valeurs du body
    smtp_user     = body.get("smtp_user", cfg.get("email_smtp_user", ""))
    smtp_password = body.get("smtp_password", cfg.get("email_smtp_password", ""))
    recipients    = body.get("recipients", cfg.get("email_recipients", []))

    if not smtp_user or not smtp_password:
        raise HTTPException(400, "Email expéditeur et mot de passe requis")
    if not recipients:
        raise HTTPException(400, "Aucun destinataire")

    subject, html = build_test_email(recipients)
    ok, msg = send_email(
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        recipients=recipients,
        subject=subject,
        html_body=html,
    )
    return {"success": ok, "message": msg}


@app.post("/api/notifications/send-report")
async def send_manual_report():
    """Envoie un rapport immédiat par email (bouton manuel)."""
    cfg = store.load()
    if not store.email_configured(cfg):
        raise HTTPException(400, "Email non configuré")

    spain_stats  = spain_monitor.get_status().model_dump()
    france_stats = france_monitor.get_status().model_dump()
    now = datetime.now(timezone.utc)
    interval_h = cfg.get("email_report_interval_hours", 3)
    subject, html = build_report_email(interval_h, spain_stats, france_stats, now)
    ok, msg = send_email(
        smtp_user=cfg["email_smtp_user"],
        smtp_password=cfg["email_smtp_password"],
        recipients=cfg["email_recipients"],
        subject=subject,
        html_body=html,
        smtp_host=cfg.get("email_smtp_host", ""),
        smtp_port=cfg.get("email_smtp_port", 587),
    )
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
