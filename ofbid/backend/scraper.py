# -*- coding: utf-8 -*-
"""
Scraper multi-sources - appels d'offres sante.
Sources : BOAMP (France) | TED (EU) | URL libre
"""
import json
import logging
import re
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept": "application/json,text/html,*/*;q=0.8",
}

# Mots-cles sante (ASCII-safe pour les comparaisons internes)
HEALTH_KEYWORDS = [
    "sante", "health", "medical", "hopital", "hospital", "clinic",
    "dossier patient", "dmp", "ehr", "his", "pacs", "radiology",
    "telemedecine", "telemedicine", "pharmacie", "pharmacy",
    "laboratoire", "laboratory", "ehpad", "sih", "pmsi", "hl7",
    "fhir", "interop", "logiciel", "chu", "chru", "ars ", "cpam",
    "assurance maladie", "clinique",
]


def _is_health_related(text: str) -> bool:
    # Normalise les accents pour la comparaison
    import unicodedata
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return any(kw in t for kw in HEALTH_KEYWORDS)


def _parse_budget(text: str | None) -> tuple[Optional[float], Optional[float]]:
    if not text:
        return None, None
    numbers = re.findall(r"\d[\d\s]*(?:[.,]\d+)?", str(text).replace("\xa0", ""))
    cleaned = []
    for n in numbers:
        try:
            cleaned.append(float(n.replace(",", ".").replace(" ", "")))
        except ValueError:
            pass
    if not cleaned:
        return None, None
    if len(cleaned) == 1:
        return None, cleaned[0]
    return min(cleaned), max(cleaned)


def _parse_date(text: str | None) -> Optional[str]:
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(str(text).strip()[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# BOAMP
# ---------------------------------------------------------------------------
# L'API BOAMP open-data utilise le moteur Solr expose via DILA.
# Endpoint valide (2024-2026): https://www.boamp.fr/api/search/
# Parametres : q, sort, rows (pas "limit", pas "type_marche")
BOAMP_API = "https://www.boamp.fr/api/search/"


async def scrape_boamp(query: str = "logiciel sante", max_results: int = 20) -> list[dict]:
    """Scrape l'API BOAMP. Fallback HTML si l'API renvoie une erreur."""
    results: list[dict] = []

    async with httpx.AsyncClient(headers=HEADERS, timeout=30.0, follow_redirects=True) as client:
        # Essai 1 : API JSON officielle
        for q in [query, "logiciel sante", "systeme information hospitalier"]:
            if len(results) >= max_results:
                break
            params = {"q": q, "sort": "-dateparution", "rows": max_results}
            try:
                resp = await client.get(BOAMP_API, params=params)
                if resp.status_code == 404:
                    log.warning("[BOAMP] API 404 pour q=%s, essai suivant...", q)
                    continue
                resp.raise_for_status()
                data = resp.json()
                items = (
                    data.get("results") or
                    data.get("hits") or
                    data.get("response", {}).get("docs", []) or
                    []
                )
                log.info("[BOAMP] API OK: %d items pour q='%s'", len(items), q)
                for item in items:
                    rfp = _normalize_boamp_item(item)
                    if rfp and not any(r.get("source_url") == rfp.get("source_url") for r in results):
                        results.append(rfp)
                if results:
                    break
            except Exception as e:
                log.error("[BOAMP] API error: %s", e)
                break

        # Fallback HTML si aucun resultat
        if not results:
            log.info("[BOAMP] Fallback HTML scraping...")
            results = await _scrape_boamp_html(query, max_results, client)

    return results[:max_results]


def _normalize_boamp_item(item: dict) -> Optional[dict]:
    title = (
        item.get("titre") or item.get("objet") or item.get("title") or
        item.get("libelle_acheteur", "")
    )
    if not title:
        return None

    issuer_raw = item.get("acheteur", {})
    if isinstance(issuer_raw, dict):
        issuer = issuer_raw.get("nom") or issuer_raw.get("name") or ""
    else:
        issuer = str(issuer_raw or "")

    item_id = item.get("id") or item.get("idweb") or ""
    source_url = (
        item.get("urlsource") or item.get("url") or
        (f"https://www.boamp.fr/avis/detail/{item_id}" if item_id else "")
    )

    deadline = _parse_date(
        item.get("datelimitereponse") or item.get("date_limite_reception") or
        item.get("deadline")
    )
    budget_text = str(item.get("montant") or item.get("valeur_estimee") or "")
    bmin, bmax = _parse_budget(budget_text)

    description = (
        item.get("descriptif") or item.get("description") or
        item.get("objet_marche") or str(title)
    )
    full_text = f"Titre: {title}\nOrganisme: {issuer}\n\nDescription:\n{description}"

    return {
        "title": str(title)[:200],
        "issuer": str(issuer)[:100],
        "source_url": source_url,
        "source_type": "boamp",
        "deadline": deadline,
        "budget_min": bmin,
        "budget_max": bmax,
        "status": "new",
        "raw_text": full_text,
        "summary": str(description)[:500] if description else None,
    }


async def _scrape_boamp_html(query: str, max_results: int,
                              client: httpx.AsyncClient) -> list[dict]:
    """Fallback: scraping HTML de la page de recherche BOAMP."""
    try:
        resp = await client.get(
            "https://www.boamp.fr/pages/recherche/",
            params={"q": query, "limit": max_results},
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")
        results = []
        selectors = [".search-result", ".avis-item", "article.result", "li.result-item"]
        articles = []
        for sel in selectors:
            articles = soup.select(sel)
            if articles:
                break
        if not articles:
            articles = soup.select("article")

        for article in articles[:max_results]:
            title_el = article.select_one("h2, h3, .title, .objet, .libelle")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            if not _is_health_related(title):
                continue
            link_el = article.select_one("a[href]")
            url = ""
            if link_el:
                href = str(link_el.get("href", ""))
                url = href if href.startswith("http") else f"https://www.boamp.fr{href}"
            issuer_el = article.select_one(".acheteur, .organisme, .issuer, .pouvoir-adj")
            issuer = issuer_el.get_text(strip=True) if issuer_el else ""
            results.append({
                "title": title[:200],
                "issuer": issuer[:100],
                "source_url": url,
                "source_type": "boamp",
                "status": "new",
                "raw_text": article.get_text(separator="\n", strip=True)[:5000],
                "summary": title,
            })
        log.info("[BOAMP HTML] %d resultats trouves", len(results))
        return results
    except Exception as e:
        log.error("[BOAMP HTML] error: %s", e)
        return []


# ---------------------------------------------------------------------------
# TED - Tenders Electronic Daily (EU)
# ---------------------------------------------------------------------------
TED_API = "https://ted.europa.eu/api/v3.0/notices/search"


async def scrape_ted(query: str = "health software", max_results: int = 20) -> list[dict]:
    """Scrape l'API TED pour des marches europeens."""
    results = []
    async with httpx.AsyncClient(headers=HEADERS, timeout=30.0) as client:
        payload = {
            "query": f"({query}) AND (cpv:72000000 OR cpv:72200000 OR cpv:72210000)",
            "fields": ["title", "buyer", "deadlineForTender", "estimatedValue",
                       "publicationDate", "noticePublicationId"],
            "page": 1,
            "pageSize": max_results,
            "scope": "ACTIVE",
        }
        try:
            resp = await client.post(TED_API, json=payload)
            resp.raise_for_status()
            data = resp.json()
            for item in data.get("notices", []):
                rfp = _normalize_ted_item(item)
                if rfp:
                    results.append(rfp)
            log.info("[TED] %d resultats", len(results))
        except Exception as e:
            log.error("[TED] API error: %s", e)
    return results


def _normalize_ted_item(item: dict) -> Optional[dict]:
    title_data = item.get("title", {})
    title = (
        title_data.get("fr") or title_data.get("en") or
        (list(title_data.values())[0] if title_data else "")
    )
    if not title:
        return None
    buyer = item.get("buyer", {})
    issuer = buyer.get("name", "") if isinstance(buyer, dict) else ""
    nid = item.get("noticePublicationId", "")
    source_url = f"https://ted.europa.eu/en/notice/{nid}" if nid else ""
    deadline = _parse_date(item.get("deadlineForTender", ""))
    val = item.get("estimatedValue")
    budget_max = float(val) if val else None

    return {
        "title": str(title)[:200],
        "issuer": str(issuer)[:100],
        "source_url": source_url,
        "source_type": "ted",
        "deadline": deadline,
        "budget_min": None,
        "budget_max": budget_max,
        "status": "new",
        "raw_text": json.dumps(item, ensure_ascii=False)[:5000],
        "summary": str(title)[:500],
    }


# ---------------------------------------------------------------------------
# Import URL libre
# ---------------------------------------------------------------------------
async def fetch_url_as_rfp(url: str) -> dict:
    """Telecharge une URL et retourne un dict RFP partiel."""
    from extractor import fetch_url_text
    text = await fetch_url_text(url)
    title = url
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=20.0,
                                      follow_redirects=True) as client:
            resp = await client.get(url)
            soup = BeautifulSoup(resp.text, "lxml")
            if soup.title and soup.title.string:
                title = soup.title.string.strip()[:200]
    except Exception:
        pass
    return {
        "title": title,
        "source_url": url,
        "source_type": "url",
        "raw_text": text,
        "status": "new",
    }
