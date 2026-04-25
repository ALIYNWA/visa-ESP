"""
Scraper éthique avec Playwright
- Délais humains aléatoires
- Rotation de User-Agent
- Retry avec backoff exponentiel
- Détection multi-stratégies de disponibilité
- Gestion blocage géographique + proxy optionnel
- Support triple moniteur (Espagne + France + Préfecture 92)
- Bypass Cloudflare + OCR captcha pour Préfecture
"""
import asyncio
import base64
import random
import re
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Tuple, List

from playwright.async_api import (
    async_playwright,
    Page,
    Browser,
    BrowserContext,
    TimeoutError as PWTimeout,
    Error as PWError,
)

try:
    from playwright_stealth import Stealth
    _STEALTH_AVAILABLE = True
except ImportError:
    _STEALTH_AVAILABLE = False
    logging.warning("playwright-stealth non installé — bypass Cloudflare limité")

try:
    import ddddocr
    _OCR = ddddocr.DdddOcr(show_ad=False)
    _OCR_AVAILABLE = True
except ImportError:
    _OCR_AVAILABLE = False
    logging.warning("ddddocr non installé — résolution captcha désactivée")

from config import settings
from models import CheckResult

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Rotation de User-Agents
# ------------------------------------------------------------------
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
]

# ------------------------------------------------------------------
# Patterns BLOCAGE GEO
# ------------------------------------------------------------------
GEO_BLOCK_PATTERNS = [
    "access denied",
    "access may be restricted",
    "not accessible from your current location",
    "vpn or proxy",
    "restricted due to",
    "outside the permitted country",
    "supported region",
    "403 forbidden",
    "cloudflare",
    "ray id",
]

# ------------------------------------------------------------------
# Patterns ABSENCE de créneaux (communs + TLS Contact)
# ------------------------------------------------------------------
NO_SLOT_PATTERNS = [
    "no appointment",
    "no slot",
    "no date available",
    "not available",
    "currently no",
    "aucun creneau",
    "aucune date",
    "pas de rendez",
    "no hay cita",
    "appointment not available",
    "slots not available",
    "no appointments available",
    "there are no",
    "fully booked",
    # Capago spécifique (France – Algérie, depuis mars 2025)
    "aucun creneau n'est disponible",
    "aucun rendez-vous disponible",
    "il n'y a pas de creneau",
    # Préfecture française
    "aucun rendez-vous n'est disponible",
    "aucune plage horaire",
    "pas de créneau disponible",
    "guichet complet",
    "no slot available at this location",
    "les rendez-vous ne sont pas disponibles",
    "no appointment slots available",
    "temporarily unavailable",
    "complet",
    "guichet complet",
]

# ------------------------------------------------------------------
# Patterns DISPONIBILITÉ (communs + TLS Contact + BLS)
# ------------------------------------------------------------------
AVAILABLE_PATTERNS = [
    "select date",
    "choose date",
    "available dates",
    "pick a date",
    "book now",
    "slot available",
    "appointment available",
    "rendez-vous disponible",
    "selectionner une date",
    "sélectionnez une date",
    "book appointment",
    "calendar",
    # Capago spécifique (France – Algérie)
    "choisissez une date",
    "choisir un creneau",
    "prenez rendez-vous",
    "creneaux disponibles",
    "selectionner un creneau",
    "disponibilites",
    "prendre rendez-vous",
    "choisissez votre creneau",
    # Préfecture française
    "choisir un rendez-vous",
    "selectionner une date",
    "plage horaire disponible",
    "prendre un rendez-vous",
    "rdv disponible",
]


async def _human_pause(min_ms: int = 800, max_ms: int = 2500):
    await asyncio.sleep(random.uniform(min_ms / 1000, max_ms / 1000))


def _build_context_options() -> dict:
    """Options de contexte Playwright — imite un vrai navigateur algérien."""
    return {
        "user_agent": random.choice(USER_AGENTS),
        "viewport": random.choice([
            {"width": 1920, "height": 1080},
            {"width": 1366, "height": 768},
            {"width": 1440, "height": 900},
        ]),
        "locale": "fr-DZ",
        "timezone_id": "Africa/Algiers",
        "extra_http_headers": {
            "Accept-Language": "fr-DZ,fr;q=0.9,ar;q=0.8,en;q=0.7",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        },
    }


MONTHS_FR = {
    "january":"JAN","february":"FEV","march":"MAR","april":"AVR","may":"MAI",
    "june":"JUN","july":"JUL","august":"AOU","september":"SEP","october":"OCT",
    "november":"NOV","december":"DEC",
    "janvier":"JAN","février":"FEV","mars":"MAR","avril":"AVR","mai":"MAI",
    "juin":"JUN","juillet":"JUL","août":"AOU","septembre":"SEP","octobre":"OCT",
    "novembre":"NOV","décembre":"DEC",
}

def _extract_slot_dates(page_text: str) -> List[str]:
    """
    Extrait les dates réelles de créneaux disponibles depuis le texte de la page.
    Retourne une liste de strings lisibles ex: ["Ven. 25 AVR 2026 à 10h30"]
    """
    dates_found = []
    text = page_text

    # Pattern 1 : DD/MM/YYYY hh:mm  ou  DD-MM-YYYY
    p1 = re.findall(r'\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})(?:\s+(?:à|at)?\s*(\d{1,2}[h:]\d{2}))?\b', text)
    for m in p1[:5]:
        day, month, year, hour = m
        date_str = f"{day.zfill(2)}/{month.zfill(2)}/{year}"
        if hour:
            date_str += f" à {hour.replace(':','h')}"
        dates_found.append(f"RDV le {date_str}")

    # Pattern 2 : "25 avril 2026" ou "25 April 2026"
    p2 = re.findall(
        r'\b(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre'
        r'|january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})'
        r'(?:\s+(?:à|at)?\s*(\d{1,2}[h:]\d{2}))?',
        text, re.IGNORECASE
    )
    for m in p2[:5]:
        day, month_raw, year, hour = m
        month_code = MONTHS_FR.get(month_raw.lower(), month_raw[:3].upper())
        date_str = f"{day.zfill(2)} {month_code} {year}"
        if hour:
            date_str += f" à {hour.replace(':','h')}"
        dates_found.append(f"RDV le {date_str}")

    # Pattern 3 : YYYY-MM-DD (attributs data-date HTML)
    p3 = re.findall(r'\b(20\d{2})-(\d{2})-(\d{2})\b', text)
    for m in p3[:5]:
        year, month, day = m
        try:
            from datetime import date
            d = date(int(year), int(month), int(day))
            months = ["JAN","FEV","MAR","AVR","MAI","JUN","JUL","AOU","SEP","OCT","NOV","DEC"]
            dates_found.append(f"RDV le {day} {months[d.month-1]} {year}")
        except Exception:
            pass

    # Dédoublonner et limiter
    seen, unique = set(), []
    for d in dates_found:
        if d not in seen:
            seen.add(d)
            unique.append(d)
    return unique[:5]


def _is_geo_blocked(page_text: str) -> bool:
    t = page_text.lower()
    return any(p in t for p in GEO_BLOCK_PATTERNS)


def _extract_page_excerpt(page_text: str, max_chars: int = 600) -> str:
    """Extrait un résumé lisible du texte de la page."""
    # Nettoyer les espaces multiples et sauts de ligne
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]
    # Filtrer les lignes trop courtes (menus, boutons isolés)
    meaningful = [l for l in lines if len(l) > 15]
    combined = " · ".join(meaningful[:20])
    if len(combined) > max_chars:
        combined = combined[:max_chars] + "..."
    return combined


async def _try_click_slot(page: Page) -> Optional[str]:
    """
    Tente de cliquer sur le premier créneau disponible pour le retenir temporairement.
    Retourne l'URL de la page après le clic (lien à envoyer à l'utilisateur).
    """
    click_selectors = [
        "table.datepicker td:not(.disabled):not(.unavailable):not(.past)",
        ".available-date", ".slot-available", "td.available",
        ".calendar-day.available", ".fc-day:not(.fc-day-disabled)",
        "[data-date]:not(.disabled)",
        "input[type='radio'][name*='date']",
        ".rdv-slot:not(.disabled)", ".créneau-disponible",
        "button[class*='available']", "a[class*='slot']",
    ]
    for selector in click_selectors:
        try:
            elements = await page.query_selector_all(selector)
            visible = [el for el in elements if await el.is_visible()]
            if visible:
                await visible[0].click()
                await asyncio.sleep(1.5)
                return page.url
        except Exception:
            continue
    return page.url


async def _detect_availability(page: Page) -> Tuple[bool, int, str, str, List[str], Optional[str]]:
    """
    Détecte la disponibilité via plusieurs stratégies.
    Retourne: (available, slots_count, message, page_excerpt, slot_dates, booking_url)
    """
    try:
        page_text = (await page.inner_text("body")).strip()
    except Exception:
        page_text = await page.content()

    page_excerpt = _extract_page_excerpt(page_text)
    page_text_lower = page_text.lower()

    # --- Détection blocage géographique EN PREMIER ---
    if _is_geo_blocked(page_text_lower):
        return False, 0, "GEO_BLOCKED: Accès refusé depuis cette région", page_excerpt, [], None

    # --- Stratégie 1 : Sélecteurs CSS calendrier ---
    slot_selectors = [
        "table.datepicker td:not(.disabled):not(.unavailable):not(.past)",
        ".available-date",
        ".slot-available",
        "input[type='radio'][name*='date']",
        "select[name*='date'] option:not([disabled])",
        ".calendar-day.available",
        "td.available",
        ".fc-day:not(.fc-day-disabled)",
        "[data-date]:not(.disabled)",
        # TLS Contact spécifique
        ".tls-slot:not(.disabled)",
        ".appointment-slot.available",
    ]
    slots_found = 0
    for selector in slot_selectors:
        try:
            elements = await page.query_selector_all(selector)
            visible = [el for el in elements if await el.is_visible()]
            if visible:
                slots_found = len(visible)
                break
        except PWError:
            continue

    # --- Stratégie 2 : Patterns textuels d'absence ---
    for pattern in NO_SLOT_PATTERNS:
        if pattern in page_text_lower:
            return False, 0, f"Aucun creneau — '{pattern}' detecte", page_excerpt, [], None

    # --- Stratégie 3 : Patterns textuels de disponibilité ---
    for pattern in AVAILABLE_PATTERNS:
        if pattern in page_text_lower:
            dates = _extract_slot_dates(page_text)
            booking_url = await _try_click_slot(page)
            return True, max(slots_found, 1), f"Disponibilite detectee : '{pattern}'", page_excerpt, dates, booking_url

    # --- Stratégie 4 : Créneaux CSS ---
    if slots_found > 0:
        dates = _extract_slot_dates(page_text)
        booking_url = await _try_click_slot(page)
        return True, slots_found, f"{slots_found} creneau(x) trouve(s) dans le calendrier", page_excerpt, dates, booking_url

    # --- Stratégie 5 : Formulaire de date actif ---
    try:
        date_input = await page.query_selector(
            "input[type='date']:not([disabled]), select[name*='date']:not([disabled])"
        )
        if date_input and await date_input.is_visible():
            dates = _extract_slot_dates(page_text)
            return True, 1, "Champ de date actif detecte", page_excerpt, dates, page.url
    except PWError:
        pass

    return False, 0, "Statut indetermine — aucun creneau detecte", page_excerpt, [], None


PREFECTURE_BASE = "https://www.rdv-prefecture.interieur.gouv.fr"
PREFECTURE_HOME = f"{PREFECTURE_BASE}/rdvpref/reservation/demarche/3327/"

# ── Session persistante Préfecture (navigateur gardé ouvert entre checks) ──
_pref_pw        = None
_pref_browser   = None
_pref_context   = None
_pref_page      = None
_pref_cf_ok_at  = 0.0          # timestamp dernière validation CF réussie
CF_SESSION_TTL  = 1800         # revalider CF toutes les 30 min


def _build_stealth_context_options() -> dict:
    return {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "locale": "fr-FR",
        "timezone_id": "Europe/Paris",
        "viewport": {"width": 1366, "height": 768},
        "extra_http_headers": {
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
        },
    }


def _preprocess_captcha(img_bytes: bytes) -> bytes:
    """
    Prétraitement de l'image captcha pour améliorer la lecture OCR.
    Agrandit x2 + lissage + seuillage pour séparer le texte du fond quadrillé.
    """
    try:
        import cv2
        import numpy as np
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        # Agrandir x2 pour plus de détails
        img = cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        # Lissage médian pour atténuer le fond quadrillé
        img = cv2.medianBlur(img, 3)
        # Seuillage Otsu
        _, img = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        _, buf = cv2.imencode('.png', img)
        return bytes(buf)
    except Exception:
        return img_bytes  # fallback sur l'image brute


async def _solve_captcha_image(page: Page) -> Optional[str]:
    """
    Extrait et résout le captcha image via ddddocr.
    Essaie plusieurs prétraitements et retourne le meilleur résultat (nettoyé, uppercase).
    """
    if not _OCR_AVAILABLE:
        return None
    try:
        img_el = await page.query_selector("img[src^='data:image']")
        if not img_el:
            return None
        src = await img_el.get_attribute("src")
        b64_data = src.split(",", 1)[1]
        raw_bytes = base64.b64decode(b64_data)

        candidates = []
        # Tentative 1 : image brute
        try:
            r = _OCR.classification(raw_bytes)
            if r: candidates.append(r.strip())
        except Exception:
            pass
        # Tentative 2 : image prétraitée
        try:
            r = _OCR.classification(_preprocess_captcha(raw_bytes))
            if r: candidates.append(r.strip())
        except Exception:
            pass

        if not candidates:
            return None

        # Choisir le résultat le plus court et cohérent (captchas = 4-8 chars)
        # Nettoyer : garder alphanum seulement, uppercase
        cleaned = []
        for c in candidates:
            c = re.sub(r'[^A-Za-z0-9]', '', c).upper()
            if 3 <= len(c) <= 10:
                cleaned.append(c)

        if not cleaned:
            # Fallback sans filtre longueur
            result = re.sub(r'[^A-Za-z0-9]', '', candidates[0]).upper()
        else:
            # Préférer le résultat prétraité si disponible, sinon le brut
            result = cleaned[-1] if len(cleaned) > 1 else cleaned[0]

        logger.info(f"[prefecture] OCR captcha: '{result}' (candidats: {candidates})")
        return result
    except Exception as e:
        logger.error(f"[prefecture] Erreur OCR: {e}")
        return None


async def _refresh_captcha(page: Page) -> bool:
    """Clique sur 'Générer un nouveau captcha' pour renouveler l'image."""
    try:
        refresh_btn = await page.query_selector(
            "button[title*='nouveau'], button[title*='Générer'], button[title*='rafraîchir']"
        )
        if refresh_btn:
            await refresh_btn.click()
            await asyncio.sleep(1.5)
            return True
    except Exception:
        pass
    return False


async def _ensure_pref_session() -> Optional[Page]:
    """
    Retourne une page active avec session CF validée.
    Crée ou réutilise le navigateur persistant.
    """
    global _pref_pw, _pref_browser, _pref_context, _pref_page, _pref_cf_ok_at

    now = time.monotonic()
    need_cf = (now - _pref_cf_ok_at) > CF_SESSION_TTL

    # Vérifier si la page est encore valide
    page_alive = False
    if _pref_page is not None:
        try:
            _ = _pref_page.url        # lève si la page est fermée
            page_alive = True
        except Exception:
            page_alive = False

    # Session valide et CF OK → retourner directement
    if page_alive and not need_cf:
        return _pref_page

    # ── Démarrer ou redémarrer le navigateur ──
    try:
        if _pref_browser is not None:
            await _pref_browser.close()
    except Exception:
        pass
    try:
        if _pref_pw is not None:
            await _pref_pw.__aexit__(None, None, None)
    except Exception:
        pass

    _pref_pw      = async_playwright()
    pw            = await _pref_pw.__aenter__()
    _pref_browser = await pw.chromium.launch(
        headless=settings.HEADLESS,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
    )
    _pref_context = await _pref_browser.new_context(**_build_stealth_context_options())
    _pref_page    = await _pref_context.new_page()

    if _STEALTH_AVAILABLE:
        await Stealth(navigator_user_agent=False).apply_stealth_async(_pref_page)

    _pref_page.set_default_timeout(settings.BROWSER_TIMEOUT)

    # ── Validation Cloudflare ──
    logger.info("[prefecture] Validation session Cloudflare…")
    await _pref_page.goto(PREFECTURE_HOME, wait_until="networkidle")
    await asyncio.sleep(5)                        # laisser CF valider

    body = (await _pref_page.inner_text("body")).lower()
    if "blocked" in body and "ray id" in body:
        logger.error("[prefecture] Cloudflare bloque — session invalide")
        return None

    _pref_cf_ok_at = time.monotonic()
    logger.info("[prefecture] Session CF validée")
    return _pref_page


async def check_prefecture_appointment() -> CheckResult:
    """
    Scraper Préfecture 92 avec session persistante :
    - Navigation CF faite UNE seule fois toutes les 30 min
    - Captcha résolu à chaque check (~3-8 s total)
    - Retry automatique si captcha incorrect (nouveau captcha)
    """
    start_time = time.monotonic()
    timestamp  = datetime.now(timezone.utc)
    mid        = "prefecture"

    try:
        page = await _ensure_pref_session()
        if page is None:
            return CheckResult(
                monitor_id=mid, timestamp=timestamp,
                available=False, slots_count=0,
                message="Session Cloudflare invalide — réessai prochain cycle",
                duration_ms=(time.monotonic() - start_time) * 1000,
            )

        # ── Naviguer vers la page formulaire (CGU) ──
        logger.info(f"[{mid}] Navigation vers page formulaire…")

        # Clic depuis la home si on y est, sinon goto direct
        if "demarche/3327/" in page.url and "cgu" not in page.url:
            rdv_link = await page.query_selector("a[href*='cgu']")
            if rdv_link:
                await page.mouse.move(random.randint(200, 500), random.randint(200, 400))
                await asyncio.sleep(random.uniform(0.3, 0.7))
                await rdv_link.hover()
                await asyncio.sleep(random.uniform(0.4, 0.9))
                await rdv_link.click()
                try:
                    await page.wait_for_load_state("networkidle", timeout=12000)
                except PWTimeout:
                    pass
                await asyncio.sleep(2)
        elif "cgu" not in page.url:
            await page.goto(PREFECTURE_HOME, wait_until="domcontentloaded")
            await asyncio.sleep(2)
            rdv_link = await page.query_selector("a[href*='cgu']")
            if rdv_link:
                await rdv_link.hover(); await asyncio.sleep(0.5); await rdv_link.click()
                try: await page.wait_for_load_state("networkidle", timeout=12000)
                except PWTimeout: pass
                await asyncio.sleep(2)

        # Vérifier si CF a bloqué cette requête
        body_text = await page.inner_text("body")
        if "blocked" in body_text.lower() and "ray id" in body_text.lower():
            # Invalider la session pour la prochaine fois
            global _pref_cf_ok_at
            _pref_cf_ok_at = 0.0
            return CheckResult(
                monitor_id=mid, timestamp=timestamp,
                available=False, slots_count=0,
                message="Bloqué CF — session réinitialisée au prochain cycle",
                duration_ms=(time.monotonic() - start_time) * 1000,
            )

        # ── Résolution captcha avec jusqu'à 3 tentatives ──
        captcha_solved = False
        for attempt in range(3):
            code = await _solve_captcha_image(page)
            if not code:
                break

            captcha_input = await page.query_selector(
                "#captchaFormulaireExtInput, input[name='captchaUsercode']"
            )
            if not captcha_input:
                break

            await captcha_input.click(click_count=3)
            await captcha_input.fill(code)
            await asyncio.sleep(random.uniform(0.3, 0.7))

            submit_btn = await page.query_selector("button[type='submit']")
            if not submit_btn:
                break

            await submit_btn.click()
            try:
                await page.wait_for_load_state("networkidle", timeout=12000)
            except PWTimeout:
                pass
            await asyncio.sleep(2)

            current_url = page.url
            body_text   = await page.inner_text("body")
            body_lower  = body_text.lower()

            # Captcha incorrect → rafraîchir et réessayer
            if "cgu" in current_url or ("incorrect" in body_lower or "invalide" in body_lower):
                logger.warning(f"[{mid}] Captcha incorrect (tentative {attempt+1}): '{code}'")
                await _refresh_captcha(page)
                await asyncio.sleep(1.5)
                continue

            captcha_solved = True
            logger.info(f"[{mid}] Captcha résolu: '{code}' — URL: {current_url}")
            break

        if not captcha_solved:
            # Revenir à l'accueil pour le prochain check
            try:
                await page.goto(PREFECTURE_HOME, wait_until="domcontentloaded")
            except Exception:
                pass
            return CheckResult(
                monitor_id=mid, timestamp=timestamp,
                available=False, slots_count=0,
                message="Captcha non résolu après 3 tentatives — réessai prochain cycle",
                duration_ms=(time.monotonic() - start_time) * 1000,
            )

        # ── Détection créneaux ──
        body_text    = await page.inner_text("body")
        page_excerpt = _extract_page_excerpt(body_text)
        current_url  = page.url

        available, slots_count, message, _, slot_dates, booking_url = await _detect_availability(page)

        if available:
            message     = f"CRENEAU PREFECTURE 92 DISPONIBLE — {message}"
            booking_url = booking_url or current_url
        else:
            message = f"Aucun creneau Prefecture 92 — {message}"

        # Revenir à l'accueil pour le prochain check
        try:
            await page.goto(PREFECTURE_HOME, wait_until="domcontentloaded")
        except Exception:
            pass

        return CheckResult(
            monitor_id=mid, timestamp=timestamp,
            available=available, slots_count=slots_count,
            message=message,
            duration_ms=round((time.monotonic() - start_time) * 1000, 1),
            page_excerpt=page_excerpt,
            slot_dates=slot_dates,
            booking_url=booking_url or current_url,
        )

    except Exception as e:
        logger.error(f"[{mid}] Erreur inattendue: {e}")
        # Invalider la session
        _pref_cf_ok_at = 0.0
        return CheckResult(
            monitor_id=mid, timestamp=timestamp,
            available=False, slots_count=0,
            message="Erreur — session réinitialisée",
            error=str(e), duration_ms=(time.monotonic() - start_time) * 1000,
        )


async def check_appointment(
    monitor_id: str = "spain",
    target_url: str = None,
    retry: int = 0
) -> CheckResult:
    """
    Effectue une vérification de disponibilité.
    Paramètres:
        monitor_id: "spain" ou "france"
        target_url: URL à vérifier (si None, utilise settings.TARGET_URL pour spain)
    """
    if target_url is None:
        target_url = settings.TARGET_URL

    start_time = time.monotonic()
    timestamp = datetime.now(timezone.utc)

    launch_args = [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
        "--lang=fr-DZ",
    ]

    proxy_config = None
    if settings.PROXY_SERVER:
        proxy_config = {"server": settings.PROXY_SERVER}
        if settings.PROXY_USERNAME:
            proxy_config["username"] = settings.PROXY_USERNAME
            proxy_config["password"] = settings.PROXY_PASSWORD
        logger.info(f"[{monitor_id}] Utilisation du proxy : {settings.PROXY_SERVER}")

    async with async_playwright() as pw:
        browser: Optional[Browser] = None
        context: Optional[BrowserContext] = None
        try:
            browser = await pw.chromium.launch(
                headless=settings.HEADLESS,
                args=launch_args,
                proxy=proxy_config,
            )

            ctx_options = _build_context_options()
            if proxy_config:
                ctx_options["proxy"] = proxy_config

            context = await browser.new_context(**ctx_options)

            # Masquer les indicateurs d'automatisation
            await context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
                Object.defineProperty(navigator, 'languages', { get: () => ['fr-DZ','fr','ar'] });
                window.chrome = { runtime: {} };
            """)

            page = await context.new_page()
            page.set_default_timeout(settings.BROWSER_TIMEOUT)

            logger.info(f"[{monitor_id}] Navigation vers {target_url}")
            await page.goto(target_url, wait_until="domcontentloaded")
            await _human_pause(1500, 3000)

            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except PWTimeout:
                pass

            available, slots_count, message, page_excerpt, slot_dates, booking_url = await _detect_availability(page)

            if "GEO_BLOCKED" in message and settings.PROXY_SERVER:
                message = "GEO_BLOCKED: Proxy configuré mais toujours bloqué — vérifiez votre proxy"

            duration_ms = (time.monotonic() - start_time) * 1000
            return CheckResult(
                monitor_id=monitor_id,
                timestamp=timestamp,
                available=available,
                slots_count=slots_count,
                message=message,
                duration_ms=round(duration_ms, 1),
                page_excerpt=page_excerpt,
                slot_dates=slot_dates,
                booking_url=booking_url or target_url,
            )

        except PWTimeout as e:
            logger.warning(f"[{monitor_id}] Timeout Playwright : {e}")
            if retry < settings.MAX_RETRIES:
                backoff = settings.RETRY_BACKOFF_BASE ** retry + random.uniform(0, 1)
                await asyncio.sleep(backoff)
                return await check_appointment(monitor_id, target_url, retry + 1)
            return CheckResult(
                monitor_id=monitor_id,
                timestamp=timestamp, available=False, slots_count=0,
                message="Timeout — page inaccessible",
                error=str(e), duration_ms=(time.monotonic() - start_time) * 1000,
            )

        except Exception as e:
            logger.error(f"[{monitor_id}] Erreur scraper : {e}")
            if retry < settings.MAX_RETRIES:
                backoff = settings.RETRY_BACKOFF_BASE ** (retry + 1) + random.uniform(0, 2)
                await asyncio.sleep(backoff)
                return await check_appointment(monitor_id, target_url, retry + 1)
            return CheckResult(
                monitor_id=monitor_id,
                timestamp=timestamp, available=False, slots_count=0,
                message="Erreur inattendue",
                error=str(e), duration_ms=(time.monotonic() - start_time) * 1000,
            )

        finally:
            if context:
                await context.close()
            if browser:
                await browser.close()
