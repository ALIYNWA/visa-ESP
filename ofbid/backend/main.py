"""
RFP Intelligence Platform - FastAPI backend v2
Endpoints: /api/rfps /api/stats /api/scrape /api/health
"""
# -- UTF-8 forcé avant tout import (fix Windows cp1252) --
import os, sys
os.environ.setdefault("PYTHONUTF8", "1")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

import asyncio
import json
import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import StreamingResponse

from analyzer import stream_analysis
from config import settings
from database import (
    init_db, rfp_list, rfp_get, rfp_create, rfp_update, rfp_delete,
    rfp_exists_by_url, rfp_stats, strategy_get, strategy_upsert,
    scraping_log_create, scraping_log_finish, scraping_logs_list,
)
from extractor import ExtractionError, extract_pdf_text, fetch_url_text
from models import RFPImportUrl, RFPImportText, RFPUpdate, ScrapeRequest
from scraper import scrape_boamp, scrape_ted, fetch_url_as_rfp
from strategy import extract_metadata, generate_strategy

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="RFP Intelligence Platform", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_startup():
    await init_db()
    log.info("[OK] Base de donnees initialisee")
    asyncio.create_task(_auto_scrape_loop())


async def _auto_scrape_loop():
    """Scraping automatique toutes les SCRAPE_INTERVAL_SECONDS secondes."""
    await asyncio.sleep(30)
    while True:
        log.info("[SCRAPE] Scraping automatique BOAMP...")
        try:
            await _run_scraping("boamp", "logiciel sante", 20)
        except Exception as e:
            log.error("[SCRAPE] Erreur: %s", e)
        await asyncio.sleep(settings.SCRAPE_INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# Helper SSE
# ---------------------------------------------------------------------------
async def _sse_response(document_text: str) -> StreamingResponse:
    async def generator():
        async for chunk in stream_analysis(document_text):
            yield chunk

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Helper : ingestion (extraction métadonnées AI)
# ---------------------------------------------------------------------------
async def _ingest_rfp(rfp_id: str) -> None:
    rfp = await rfp_get(rfp_id)
    if not rfp or not rfp.get("raw_text"):
        return
    try:
        meta = await extract_metadata(rfp["raw_text"])
        update = {}
        if meta.get("title") and rfp.get("title") in ("Sans titre", "Import manuel",
                                                        rfp.get("source_url", "")):
            update["title"] = meta["title"]
        if meta.get("issuer") and not rfp.get("issuer"):
            update["issuer"] = meta["issuer"]
        if meta.get("deadline") and not rfp.get("deadline"):
            update["deadline"] = meta["deadline"]
        if meta.get("budget_max") and not rfp.get("budget_max"):
            update["budget_min"] = meta.get("budget_min")
            update["budget_max"] = meta.get("budget_max")
        if meta.get("complexity"):
            update["complexity"] = meta["complexity"]
        if meta.get("summary"):
            update["summary"] = meta["summary"]
        if meta.get("tags"):
            update["tags"] = meta["tags"]
        if update:
            await rfp_update(rfp_id, update)
        log.info("Métadonnées extraites pour RFP %s", rfp_id)
    except Exception as e:
        log.error("Erreur ingestion RFP %s: %s", rfp_id, e)


# ---------------------------------------------------------------------------
# Helper : run scraping
# ---------------------------------------------------------------------------
async def _run_scraping(source: str, query: str, max_results: int) -> dict:
    log_id = await scraping_log_create(source)
    found, new_count = 0, 0
    try:
        if source == "boamp":
            items = await scrape_boamp(query, max_results)
        elif source == "ted":
            items = await scrape_ted(query, max_results)
        else:
            raise ValueError(f"Source inconnue: {source}")

        found = len(items)
        for item in items:
            url = item.get("source_url", "")
            if url and await rfp_exists_by_url(url):
                continue
            rfp = await rfp_create(item)
            new_count += 1
            if rfp and rfp.get("raw_text"):
                asyncio.create_task(_ingest_rfp(rfp["id"]))

        await scraping_log_finish(log_id, found, new_count, "done")
        log.info("Scraping %s: %d trouvés, %d nouveaux", source, found, new_count)
    except Exception as e:
        await scraping_log_finish(log_id, found, new_count, "error", str(e))
        log.error("Erreur scraping %s: %s", source, e)
    return {"found": found, "new": new_count}


# ===========================================================================
# ENDPOINTS
# ===========================================================================

@app.get("/api/stats")
async def get_stats():
    return JSONResponse(await rfp_stats())


@app.get("/api/rfps")
async def get_rfps(
    status: str = "all",
    source_type: str = "all",
    search: str = "",
    limit: int = 50,
    offset: int = 0,
):
    items = await rfp_list(
        status=status or None,
        source_type=source_type or None,
        search=search or None,
        limit=limit,
        offset=offset,
    )
    return JSONResponse({"items": items, "count": len(items)})


@app.post("/api/rfps/import-url")
async def import_url(body: RFPImportUrl, background_tasks: BackgroundTasks):
    if await rfp_exists_by_url(body.url):
        items = await rfp_list()
        for r in items:
            if r.get("source_url") == body.url:
                return JSONResponse({"rfp": r, "already_exists": True})

    try:
        raw_data = await fetch_url_as_rfp(body.url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    if body.title:
        raw_data["title"] = body.title
    if body.issuer:
        raw_data["issuer"] = body.issuer

    rfp = await rfp_create(raw_data)
    background_tasks.add_task(_ingest_rfp, rfp["id"])
    return JSONResponse({"rfp": rfp, "already_exists": False})


@app.post("/api/rfps/import-pdf")
async def import_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(default=""),
    issuer: str = Form(default=""),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Fichier PDF requis.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=422, detail="Fichier vide.")

    loop = asyncio.get_event_loop()
    try:
        text = await loop.run_in_executor(None, extract_pdf_text, file_bytes)
    except ExtractionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    data = {
        "title": title or file.filename.replace(".pdf", ""),
        "issuer": issuer or None,
        "source_type": "manual",
        "raw_text": text,
        "status": "new",
    }
    rfp = await rfp_create(data)
    background_tasks.add_task(_ingest_rfp, rfp["id"])
    return JSONResponse({"rfp": rfp})


@app.post("/api/rfps/import-text")
async def import_text(body: RFPImportText, background_tasks: BackgroundTasks):
    """Import manuel — pour les AOs manqués par le scraping automatique."""
    if len(body.raw_text.strip()) < 50:
        raise HTTPException(
            status_code=422, detail="Texte trop court (min. 50 caractères)."
        )
    if body.source_url and await rfp_exists_by_url(body.source_url):
        raise HTTPException(status_code=409, detail="Un AO avec cette URL existe déjà.")

    data = {
        "title": body.title or "Import manuel",
        "issuer": body.issuer,
        "source_url": body.source_url,
        "source_type": "manual",
        "deadline": body.deadline,
        "budget_min": body.budget_min,
        "budget_max": body.budget_max,
        "raw_text": body.raw_text,
        "status": "new",
    }
    rfp = await rfp_create(data)
    background_tasks.add_task(_ingest_rfp, rfp["id"])
    return JSONResponse({"rfp": rfp})


@app.get("/api/rfps/{rfp_id}")
async def get_rfp(rfp_id: str):
    rfp = await rfp_get(rfp_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="AO introuvable.")
    return JSONResponse(rfp)


@app.put("/api/rfps/{rfp_id}")
async def update_rfp(rfp_id: str, body: RFPUpdate):
    rfp = await rfp_get(rfp_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="AO introuvable.")
    updated = await rfp_update(rfp_id, body.model_dump(exclude_none=True))
    return JSONResponse(updated)


@app.delete("/api/rfps/{rfp_id}")
async def delete_rfp(rfp_id: str):
    rfp = await rfp_get(rfp_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="AO introuvable.")
    await rfp_delete(rfp_id)
    return JSONResponse({"ok": True})


@app.get("/api/rfps/{rfp_id}/analyze")
async def analyze_rfp(rfp_id: str):
    rfp = await rfp_get(rfp_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="AO introuvable.")
    if not rfp.get("raw_text"):
        raise HTTPException(status_code=422, detail="Aucun texte disponible.")
    await rfp_update(rfp_id, {"status": "analyzing"})
    return await _sse_response(rfp["raw_text"])


@app.post("/api/rfps/{rfp_id}/analysis")
async def save_analysis(rfp_id: str, body: dict):
    rfp = await rfp_get(rfp_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="AO introuvable.")
    await rfp_update(rfp_id, {
        "analysis_json": body.get("analysis_text", ""),
        "status": "analyzed",
    })
    return JSONResponse({"ok": True})


@app.get("/api/rfps/{rfp_id}/strategy")
async def get_strategy(rfp_id: str):
    rfp = await rfp_get(rfp_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="AO introuvable.")
    strategy = await strategy_get(rfp_id)
    if not strategy:
        return JSONResponse({"strategy": None})
    for field in ["worst_case", "medium_case", "best_case", "key_differentiators"]:
        val = strategy.get(field)
        if isinstance(val, str):
            try:
                strategy[field] = json.loads(val)
            except Exception:
                pass
    return JSONResponse({"strategy": strategy})


@app.post("/api/rfps/{rfp_id}/strategy")
async def create_strategy(rfp_id: str):
    rfp = await rfp_get(rfp_id)
    if not rfp:
        raise HTTPException(status_code=404, detail="AO introuvable.")
    if not rfp.get("raw_text"):
        raise HTTPException(status_code=422, detail="Aucun texte disponible.")
    try:
        data = await generate_strategy(
            rfp_text=rfp["raw_text"],
            analysis_json=rfp.get("analysis_json"),
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    strategy = await strategy_upsert(rfp_id, data)
    for field in ["worst_case", "medium_case", "best_case", "key_differentiators"]:
        val = strategy.get(field)
        if isinstance(val, str):
            try:
                strategy[field] = json.loads(val)
            except Exception:
                pass
    return JSONResponse({"strategy": strategy})


@app.post("/api/scrape")
async def trigger_scraping(body: ScrapeRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_scraping, body.source, body.query, body.max_results)
    return JSONResponse({"status": "started", "source": body.source, "query": body.query})


@app.get("/api/scrape/logs")
async def get_scraping_logs(limit: int = 10):
    logs = await scraping_logs_list(limit)
    return JSONResponse({"logs": logs})


@app.get("/api/health")
async def health():
    return JSONResponse({"status": "ok", "model": settings.CLAUDE_MODEL, "version": "2.0.0"})


# ---------------------------------------------------------------------------
# Fichiers statiques — doit être en dernier
# ---------------------------------------------------------------------------
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/")
    async def index():
        return FileResponse(str(FRONTEND_DIR / "index.html"))

    @app.get("/{path:path}")
    async def catch_all(path: str):
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        file_path = FRONTEND_DIR / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIR / "index.html"))


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        log_level=settings.LOG_LEVEL.lower(),
    )
