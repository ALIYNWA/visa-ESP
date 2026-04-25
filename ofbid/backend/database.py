"""
SQLite async database layer — aiosqlite.
Tables : rfps | strategies | scraping_logs
"""
import json
import uuid
from datetime import datetime
from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent / "rfp_platform.db"

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
_CREATE_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS rfps (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    issuer       TEXT,
    source_url   TEXT,
    source_type  TEXT DEFAULT 'manual',   -- manual | boamp | ted | url
    deadline     TEXT,
    budget_min   REAL,
    budget_max   REAL,
    status       TEXT DEFAULT 'new',      -- new | analyzing | analyzed | archived
    complexity   TEXT,                    -- low | medium | high
    summary      TEXT,
    raw_text     TEXT,
    analysis_json TEXT,
    tags         TEXT DEFAULT '[]',
    created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS strategies (
    id           TEXT PRIMARY KEY,
    rfp_id       TEXT NOT NULL,
    worst_case   TEXT,   -- JSON
    medium_case  TEXT,   -- JSON
    best_case    TEXT,   -- JSON
    recommendation TEXT,
    key_differentiators TEXT DEFAULT '[]',
    created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    FOREIGN KEY (rfp_id) REFERENCES rfps(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scraping_logs (
    id           TEXT PRIMARY KEY,
    source       TEXT,
    rfps_found   INTEGER DEFAULT 0,
    rfps_new     INTEGER DEFAULT 0,
    status       TEXT DEFAULT 'running',   -- running | done | error
    error_msg    TEXT,
    started_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    finished_at  TEXT
);
"""


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_CREATE_SQL)
        await db.commit()


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


async def _fetchall(sql: str, params=()) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, params) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def _fetchone(sql: str, params=()) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def _execute(sql: str, params=()) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(sql, params)
        await db.commit()


# ---------------------------------------------------------------------------
# RFP CRUD
# ---------------------------------------------------------------------------
async def rfp_list(
    status: str | None = None,
    source_type: str | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    conditions, params = [], []
    if status and status != "all":
        conditions.append("status = ?"); params.append(status)
    if source_type and source_type != "all":
        conditions.append("source_type = ?"); params.append(source_type)
    if search:
        conditions.append("(title LIKE ? OR issuer LIKE ? OR summary LIKE ?)")
        params += [f"%{search}%", f"%{search}%", f"%{search}%"]
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params += [limit, offset]
    return await _fetchall(
        f"SELECT id,title,issuer,source_url,source_type,deadline,budget_min,budget_max,"
        f"status,complexity,summary,tags,created_at,updated_at "
        f"FROM rfps {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params,
    )


async def rfp_get(rfp_id: str) -> dict | None:
    return await _fetchone("SELECT * FROM rfps WHERE id=?", (rfp_id,))


async def rfp_create(data: dict) -> dict:
    rid = data.get("id") or new_id()
    ts = now_iso()
    await _execute(
        "INSERT INTO rfps (id,title,issuer,source_url,source_type,deadline,"
        "budget_min,budget_max,status,complexity,summary,raw_text,analysis_json,tags,"
        "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            rid,
            data.get("title", "Sans titre"),
            data.get("issuer"),
            data.get("source_url"),
            data.get("source_type", "manual"),
            data.get("deadline"),
            data.get("budget_min"),
            data.get("budget_max"),
            data.get("status", "new"),
            data.get("complexity"),
            data.get("summary"),
            data.get("raw_text"),
            data.get("analysis_json"),
            json.dumps(data.get("tags", [])),
            ts, ts,
        ),
    )
    return await rfp_get(rid)


async def rfp_update(rfp_id: str, data: dict) -> dict | None:
    fields = []
    params = []
    allowed = ["title","issuer","source_url","deadline","budget_min","budget_max",
               "status","complexity","summary","raw_text","analysis_json","tags"]
    for k in allowed:
        if k in data:
            fields.append(f"{k}=?")
            v = data[k]
            params.append(json.dumps(v) if isinstance(v, (dict, list)) else v)
    if not fields:
        return await rfp_get(rfp_id)
    fields.append("updated_at=?"); params.append(now_iso())
    params.append(rfp_id)
    await _execute(f"UPDATE rfps SET {','.join(fields)} WHERE id=?", params)
    return await rfp_get(rfp_id)


async def rfp_delete(rfp_id: str) -> None:
    await _execute("DELETE FROM rfps WHERE id=?", (rfp_id,))


async def rfp_exists_by_url(url: str) -> bool:
    row = await _fetchone("SELECT id FROM rfps WHERE source_url=?", (url,))
    return row is not None


async def rfp_stats() -> dict:
    total    = await _fetchone("SELECT COUNT(*) as n FROM rfps")
    new_     = await _fetchone("SELECT COUNT(*) as n FROM rfps WHERE status='new'")
    analyzed = await _fetchone("SELECT COUNT(*) as n FROM rfps WHERE status='analyzed'")
    week_ago = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    recent   = await _fetchone(
        "SELECT COUNT(*) as n FROM rfps WHERE created_at >= datetime('now','-7 days')"
    )
    deadline = await _fetchone(
        "SELECT COUNT(*) as n FROM rfps WHERE deadline IS NOT NULL "
        "AND deadline >= date('now') AND deadline <= date('now','+30 days')"
    )
    return {
        "total": total["n"],
        "new": new_["n"],
        "analyzed": analyzed["n"],
        "recent_7d": recent["n"],
        "deadline_30d": deadline["n"],
    }


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------
async def strategy_get(rfp_id: str) -> dict | None:
    return await _fetchone("SELECT * FROM strategies WHERE rfp_id=?", (rfp_id,))


async def strategy_upsert(rfp_id: str, data: dict) -> dict:
    existing = await strategy_get(rfp_id)
    sid = existing["id"] if existing else new_id()
    if existing:
        await _execute(
            "UPDATE strategies SET worst_case=?,medium_case=?,best_case=?,"
            "recommendation=?,key_differentiators=? WHERE rfp_id=?",
            (
                json.dumps(data.get("worst_case", {})),
                json.dumps(data.get("medium_case", {})),
                json.dumps(data.get("best_case", {})),
                data.get("recommendation", ""),
                json.dumps(data.get("key_differentiators", [])),
                rfp_id,
            ),
        )
    else:
        await _execute(
            "INSERT INTO strategies (id,rfp_id,worst_case,medium_case,best_case,"
            "recommendation,key_differentiators) VALUES (?,?,?,?,?,?,?)",
            (
                sid, rfp_id,
                json.dumps(data.get("worst_case", {})),
                json.dumps(data.get("medium_case", {})),
                json.dumps(data.get("best_case", {})),
                data.get("recommendation", ""),
                json.dumps(data.get("key_differentiators", [])),
            ),
        )
    return await strategy_get(rfp_id)


# ---------------------------------------------------------------------------
# Scraping logs
# ---------------------------------------------------------------------------
async def scraping_log_create(source: str) -> str:
    lid = new_id()
    await _execute(
        "INSERT INTO scraping_logs (id,source) VALUES (?,?)", (lid, source)
    )
    return lid


async def scraping_log_finish(log_id: str, rfps_found: int, rfps_new: int,
                               status: str = "done", error_msg: str | None = None) -> None:
    await _execute(
        "UPDATE scraping_logs SET status=?,rfps_found=?,rfps_new=?,error_msg=?,"
        "finished_at=? WHERE id=?",
        (status, rfps_found, rfps_new, error_msg, now_iso(), log_id),
    )


async def scraping_logs_list(limit: int = 10) -> list[dict]:
    return await _fetchall(
        "SELECT * FROM scraping_logs ORDER BY started_at DESC LIMIT ?", (limit,)
    )
