"""
Scraper éthique avec Playwright
- Délais humains aléatoires
- Rotation de User-Agent
- Retry avec backoff exponentiel
- Détection multi-stratégies de disponibilité
- Gestion blocage géographique + proxy optionnel
"""
import asyncio
import random
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Tuple

from playwright.async_api import (
    async_playwright,
    Page,
    Browser,
    BrowserContext,
    TimeoutError as PWTimeout,
    Error as PWError,
)

from config import settings
from models import CheckResult

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Rotation de User-Agents (navigateurs réels récents)
# ------------------------------------------------------------------
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
]

# ------------------------------------------------------------------
# Patterns de BLOCAGE GEO / Access Denied
# ------------------------------------------------------------------
GEO_BLOCK_PATTERNS = [
    "access denied",
    "access may be restricted",
    "not accessible from your current location",
    "vpn or proxy",
    "restricted due to",
    "outside the permitted country",
    "supported region",
    "forbidden",
    "403 forbidden",
    "cloudflare",
    "ray id",
]

# ------------------------------------------------------------------
# Patterns indiquant l'ABSENCE de créneaux
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
    "booked",
    "fully booked",
]

# ------------------------------------------------------------------
# Patterns indiquant la DISPONIBILITÉ
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
    "sélectionner une date",
    "selectionner une date",
    "book appointment",
    "schedule",
    "calendar",
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


def _is_geo_blocked(page_text: str) -> bool:
    t = page_text.lower()
    return any(p in t for p in GEO_BLOCK_PATTERNS)


async def _detect_availability(page: Page) -> Tuple[bool, int, str]:
    """
    Détecte la disponibilité via plusieurs stratégies.
    Retourne: (available, slots_count, message)
    """
    try:
        page_text = (await page.inner_text("body")).lower().strip()
    except Exception:
        page_text = (await page.content()).lower()

    # --- Détection blocage géographique EN PREMIER ---
    if _is_geo_blocked(page_text):
        return False, 0, "GEO_BLOCKED: Accès refusé depuis cette région — désactivez votre VPN"

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

    # --- Stratégie 2 : Patterns textuels ---
    for pattern in NO_SLOT_PATTERNS:
        if pattern in page_text:
            return False, 0, f"Aucun creneau — '{pattern}' detecte"

    for pattern in AVAILABLE_PATTERNS:
        if pattern in page_text:
            return True, max(slots_found, 1), f"Disponibilite detectee : '{pattern}'"

    # --- Stratégie 3 : Créneaux CSS ---
    if slots_found > 0:
        return True, slots_found, f"{slots_found} creneau(x) trouve(s) dans le calendrier"

    # --- Stratégie 4 : Formulaire de date actif ---
    try:
        date_input = await page.query_selector(
            "input[type='date']:not([disabled]), select[name*='date']:not([disabled])"
        )
        if date_input and await date_input.is_visible():
            return True, 1, "Champ de date actif detecte"
    except PWError:
        pass

    return False, 0, "Statut indetermine — aucun creneau detecte"


async def check_appointment(retry: int = 0) -> CheckResult:
    """
    Effectue une vérification de disponibilité.
    Retry avec backoff exponentiel en cas d'erreur.
    """
    start_time = time.monotonic()
    timestamp = datetime.now(timezone.utc)

    # Options proxy si configuré
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
        logger.info(f"Utilisation du proxy : {settings.PROXY_SERVER}")

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

            logger.info(f"Navigation vers {settings.TARGET_URL}")
            await page.goto(settings.TARGET_URL, wait_until="domcontentloaded")
            await _human_pause(1500, 3000)

            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except PWTimeout:
                pass

            available, slots_count, message = await _detect_availability(page)

            # Si geo-bloqué et qu'un proxy est configuré → signaler clairement
            if "GEO_BLOCKED" in message and settings.PROXY_SERVER:
                message = "GEO_BLOCKED: Proxy configuré mais toujours bloqué — vérifiez votre proxy"

            duration_ms = (time.monotonic() - start_time) * 1000
            return CheckResult(
                timestamp=timestamp,
                available=available,
                slots_count=slots_count,
                message=message,
                duration_ms=round(duration_ms, 1),
            )

        except PWTimeout as e:
            logger.warning(f"Timeout Playwright : {e}")
            if retry < settings.MAX_RETRIES:
                backoff = settings.RETRY_BACKOFF_BASE ** retry + random.uniform(0, 1)
                await asyncio.sleep(backoff)
                return await check_appointment(retry + 1)
            return CheckResult(
                timestamp=timestamp, available=False, slots_count=0,
                message="Timeout — page inaccessible",
                error=str(e), duration_ms=(time.monotonic() - start_time) * 1000,
            )

        except Exception as e:
            logger.error(f"Erreur scraper : {e}")
            if retry < settings.MAX_RETRIES:
                backoff = settings.RETRY_BACKOFF_BASE ** (retry + 1) + random.uniform(0, 2)
                await asyncio.sleep(backoff)
                return await check_appointment(retry + 1)
            return CheckResult(
                timestamp=timestamp, available=False, slots_count=0,
                message="Erreur inattendue",
                error=str(e), duration_ms=(time.monotonic() - start_time) * 1000,
            )

        finally:
            if context:
                await context.close()
            if browser:
                await browser.close()
