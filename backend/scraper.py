"""
Scraper éthique avec Playwright
- Délais humains aléatoires
- Rotation de User-Agent
- Retry avec backoff exponentiel
- Détection multi-stratégies de disponibilité
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
# Textes indiquant l'ABSENCE de créneaux
# ------------------------------------------------------------------
NO_SLOT_PATTERNS = [
    "no appointment",
    "no slot",
    "no date available",
    "not available",
    "currently no",
    "aucun créneau",
    "aucune date",
    "pas de rendez",
    "no hay cita",
    "appointment not available",
    "slots not available",
    "no appointments available",
    "there are no",
    "لا يوجد موعد",  # arabe
]

# ------------------------------------------------------------------
# Textes indiquant la DISPONIBILITÉ
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
    "créneaux disponibles",
    "sélectionner une date",
    "موعد متاح",  # arabe
]


def _random_delay(min_ms: int = 800, max_ms: int = 2500):
    """Simule un délai humain."""
    return random.uniform(min_ms / 1000, max_ms / 1000)


async def _human_pause(page: Page, min_ms: int = 500, max_ms: int = 1500):
    """Pause aléatoire pour simuler un comportement humain."""
    delay = _random_delay(min_ms, max_ms)
    await asyncio.sleep(delay)


def _build_context_options() -> dict:
    """Options de contexte Playwright anti-détection."""
    return {
        "user_agent": random.choice(USER_AGENTS),
        "viewport": random.choice([
            {"width": 1920, "height": 1080},
            {"width": 1366, "height": 768},
            {"width": 1440, "height": 900},
            {"width": 1280, "height": 800},
        ]),
        "locale": "fr-FR",
        "timezone_id": "Africa/Algiers",
        "extra_http_headers": {
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "DNT": "1",
        },
    }


async def _detect_availability(page: Page) -> Tuple[bool, int, str]:
    """
    Détecte la disponibilité via plusieurs stratégies :
    1. Présence d'éléments de calendrier actifs
    2. Analyse textuelle du contenu
    3. Présence de messages d'erreur/info

    Retourne: (available, slots_count, message)
    """
    page_text = (await page.inner_text("body")).lower().strip()

    # --- Stratégie 1 : Sélecteur CSS direct (à adapter selon le site) ---
    slot_selectors = [
        "table.datepicker td:not(.disabled):not(.unavailable)",
        ".available-date",
        ".slot-available",
        "input[type='radio'][name*='date']",
        "select[name*='date'] option:not([disabled])",
        ".calendar-day.available",
        "td.available",
    ]

    slots_found = 0
    for selector in slot_selectors:
        try:
            elements = await page.query_selector_all(selector)
            if elements:
                # Filtrer les éléments vraiment visibles
                visible = []
                for el in elements:
                    if await el.is_visible():
                        visible.append(el)
                if visible:
                    slots_found = len(visible)
                    logger.debug(f"Sélecteur '{selector}' → {slots_found} créneaux visibles")
                    break
        except PWError:
            continue

    # --- Stratégie 2 : Patterns textuels ---
    for pattern in NO_SLOT_PATTERNS:
        if pattern in page_text:
            return False, 0, f"Message détecté : '{pattern}'"

    for pattern in AVAILABLE_PATTERNS:
        if pattern in page_text:
            return True, max(slots_found, 1), f"Disponibilité détectée : '{pattern}'"

    # --- Stratégie 3 : Créneaux CSS ---
    if slots_found > 0:
        return True, slots_found, f"{slots_found} créneau(x) trouvé(s) dans le calendrier"

    # --- Stratégie 4 : Présence d'un formulaire de date actif ---
    try:
        date_input = await page.query_selector("input[type='date']:not([disabled]), select[name*='date']:not([disabled])")
        if date_input and await date_input.is_visible():
            return True, 1, "Champ de date actif détecté"
    except PWError:
        pass

    # Cas ambiguë : on ne peut pas déterminer
    return False, 0, "Statut indéterminé – aucun créneau détecté"


async def _fill_appointment_form(page: Page):
    """
    Remplit le formulaire de prise de RDV BLS.
    NOTE : Les sélecteurs CSS doivent être adaptés selon la page réelle.
    Inspecter la page avec les DevTools pour les IDs exacts.
    """
    await _human_pause(page, 1000, 2000)

    # Sélection de la catégorie visa (ex: "Spain")
    try:
        category_selector = "select#VisaCategory, select[name='VisaCategory'], select[name='visa_category']"
        cat_el = await page.query_selector(category_selector)
        if cat_el:
            await cat_el.select_option(label=settings.VISA_CATEGORY)
            logger.debug(f"Catégorie sélectionnée : {settings.VISA_CATEGORY}")
            await _human_pause(page, 500, 1200)
    except (PWError, PWTimeout):
        logger.debug("Sélecteur catégorie non trouvé, on continue")

    # Sélection de la sous-catégorie (ex: "Short Stay")
    try:
        subcategory_selector = "select#VisaSubCategory, select[name='VisaSubCategory'], select[name='visa_subcategory']"
        subcat_el = await page.query_selector(subcategory_selector)
        if subcat_el:
            await subcat_el.select_option(label=settings.VISA_SUBCATEGORY)
            logger.debug(f"Sous-catégorie sélectionnée : {settings.VISA_SUBCATEGORY}")
            await _human_pause(page, 500, 1200)
    except (PWError, PWTimeout):
        logger.debug("Sélecteur sous-catégorie non trouvé, on continue")

    # Clic sur "Submit" ou "Check Availability"
    try:
        submit_selectors = [
            "input[type='submit']",
            "button[type='submit']",
            "button:has-text('Submit')",
            "button:has-text('Check')",
            "button:has-text('Search')",
            "#btnSubmit",
        ]
        for sel in submit_selectors:
            btn = await page.query_selector(sel)
            if btn and await btn.is_visible():
                await btn.click()
                logger.debug(f"Bouton submit cliqué : {sel}")
                await _human_pause(page, 1500, 3000)
                break
    except (PWError, PWTimeout):
        logger.debug("Bouton submit non trouvé")


async def check_appointment(retry: int = 0) -> CheckResult:
    """
    Effectue une vérification de disponibilité.
    Retry avec backoff exponentiel en cas d'erreur.
    """
    start_time = time.monotonic()
    timestamp = datetime.now(timezone.utc)

    async with async_playwright() as pw:
        browser: Optional[Browser] = None
        context: Optional[BrowserContext] = None
        try:
            browser = await pw.chromium.launch(
                headless=settings.HEADLESS,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            context = await browser.new_context(**_build_context_options())

            # Masquer les indicateurs d'automatisation
            await context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.chrome = { runtime: {} };
            """)

            page = await context.new_page()
            page.set_default_timeout(settings.BROWSER_TIMEOUT)

            # Navigation avec retry interne
            logger.info(f"Navigation vers {settings.TARGET_URL}")
            await page.goto(settings.TARGET_URL, wait_until="domcontentloaded")
            await _human_pause(page, 1500, 3000)

            # Attente chargement JS
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except PWTimeout:
                logger.debug("networkidle timeout – on continue quand même")

            # Remplissage du formulaire si nécessaire
            await _fill_appointment_form(page)

            # Détection disponibilité
            available, slots_count, message = await _detect_availability(page)

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
                logger.info(f"Retry {retry + 1}/{settings.MAX_RETRIES} dans {backoff:.1f}s")
                await asyncio.sleep(backoff)
                return await check_appointment(retry + 1)
            return CheckResult(
                timestamp=timestamp,
                available=False,
                slots_count=0,
                message="Timeout – page inaccessible",
                error=str(e),
                duration_ms=(time.monotonic() - start_time) * 1000,
            )

        except Exception as e:
            logger.error(f"Erreur scraper : {e}")
            if retry < settings.MAX_RETRIES:
                backoff = settings.RETRY_BACKOFF_BASE ** (retry + 1) + random.uniform(0, 2)
                logger.info(f"Retry {retry + 1}/{settings.MAX_RETRIES} dans {backoff:.1f}s")
                await asyncio.sleep(backoff)
                return await check_appointment(retry + 1)
            return CheckResult(
                timestamp=timestamp,
                available=False,
                slots_count=0,
                message=f"Erreur inattendue",
                error=str(e),
                duration_ms=(time.monotonic() - start_time) * 1000,
            )

        finally:
            if context:
                await context.close()
            if browser:
                await browser.close()
