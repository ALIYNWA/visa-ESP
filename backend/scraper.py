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
PREFECTURE_CGU  = f"{PREFECTURE_BASE}/rdvpref/reservation/demarche/3327/cgu/"


def _build_stealth_context_options() -> dict:
    """Options contexte optimisées pour contourner Cloudflare."""
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


async def _solve_captcha_image(page: Page) -> Optional[str]:
    """Extrait et résout le captcha image via ddddocr."""
    if not _OCR_AVAILABLE:
        logger.warning("ddddocr non disponible — captcha non résolu")
        return None
    try:
        img_el = await page.query_selector("img[src^='data:image']")
        if not img_el:
            logger.warning("Image captcha non trouvée")
            return None
        src = await img_el.get_attribute("src")
        b64_data = src.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_data)
        result = _OCR.classification(img_bytes)
        logger.info(f"OCR captcha: '{result}'")
        return result.strip()
    except Exception as e:
        logger.error(f"Erreur OCR captcha: {e}")
        return None


async def check_prefecture_appointment(retry: int = 0) -> CheckResult:
    """
    Scraper spécialisé Préfecture 92 :
    1. Bypass Cloudflare (stealth + hover + clic natif)
    2. Résolution captcha image via ddddocr
    3. Soumission formulaire
    4. Détection créneaux disponibles + retour URL directe
    """
    start_time = time.monotonic()
    timestamp = datetime.now(timezone.utc)
    monitor_id = "prefecture"

    async with async_playwright() as pw:
        browser: Optional[Browser] = None
        context: Optional[BrowserContext] = None
        try:
            browser = await pw.chromium.launch(
                headless=settings.HEADLESS,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
            )
            context = await browser.new_context(**_build_stealth_context_options())

            page = await context.new_page()

            # Appliquer stealth si disponible
            if _STEALTH_AVAILABLE:
                await Stealth(navigator_user_agent=False).apply_stealth_async(page)

            page.set_default_timeout(settings.BROWSER_TIMEOUT)

            # ── Étape 1 : Page d'accueil – laisser Cloudflare valider la session ──
            logger.info(f"[{monitor_id}] Chargement page accueil préfecture…")
            await page.goto(PREFECTURE_HOME, wait_until="networkidle")
            await asyncio.sleep(6)  # CF challenge timeout

            # Vérifier présence du lien CGU
            rdv_link = await page.query_selector("a[href*='cgu']")
            if not rdv_link:
                return CheckResult(
                    monitor_id=monitor_id, timestamp=timestamp,
                    available=False, slots_count=0,
                    message="Page accueil inaccessible ou structure modifiée",
                    duration_ms=(time.monotonic() - start_time) * 1000,
                )

            # ── Étape 2 : Clic humain sur "Prendre un rendez-vous" ──
            logger.info(f"[{monitor_id}] Clic sur 'Prendre un rendez-vous'…")
            await page.mouse.move(random.randint(200, 600), random.randint(200, 500))
            await asyncio.sleep(random.uniform(0.3, 0.8))
            await rdv_link.hover()
            await asyncio.sleep(random.uniform(0.5, 1.2))
            await rdv_link.click()

            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except PWTimeout:
                pass
            await asyncio.sleep(3)

            # Vérifier Cloudflare
            body_text = (await page.inner_text("body")).lower()
            if "blocked" in body_text or "cloudflare" in body_text and "ray id" in body_text:
                return CheckResult(
                    monitor_id=monitor_id, timestamp=timestamp,
                    available=False, slots_count=0,
                    message="Bloqué par Cloudflare — réessai dans quelques secondes",
                    duration_ms=(time.monotonic() - start_time) * 1000,
                )

            # ── Étape 3 : Résolution captcha ──
            logger.info(f"[{monitor_id}] Résolution captcha…")
            captcha_code = await _solve_captcha_image(page)
            if not captcha_code:
                page_excerpt = _extract_page_excerpt(await page.inner_text("body"))
                return CheckResult(
                    monitor_id=monitor_id, timestamp=timestamp,
                    available=False, slots_count=0,
                    message="Captcha non résolu — OCR indisponible",
                    page_excerpt=page_excerpt,
                    duration_ms=(time.monotonic() - start_time) * 1000,
                )

            # Remplir le champ captcha
            captcha_input = await page.query_selector("#captchaFormulaireExtInput, input[name='captchaUsercode']")
            if captcha_input:
                await captcha_input.click()
                await asyncio.sleep(0.3)
                await captcha_input.fill(captcha_code)
                await asyncio.sleep(random.uniform(0.5, 1.0))
                logger.info(f"[{monitor_id}] Captcha rempli: '{captcha_code}'")
            else:
                return CheckResult(
                    monitor_id=monitor_id, timestamp=timestamp,
                    available=False, slots_count=0,
                    message="Champ captcha introuvable",
                    duration_ms=(time.monotonic() - start_time) * 1000,
                )

            # ── Étape 4 : Soumettre le formulaire captcha ──
            submit_btn = await page.query_selector("button[type='submit']")
            if submit_btn:
                await submit_btn.click()
                try:
                    await page.wait_for_load_state("networkidle", timeout=15000)
                except PWTimeout:
                    pass
                await asyncio.sleep(3)
            else:
                return CheckResult(
                    monitor_id=monitor_id, timestamp=timestamp,
                    available=False, slots_count=0,
                    message="Bouton Suivant introuvable",
                    duration_ms=(time.monotonic() - start_time) * 1000,
                )

            # ── Étape 5 : Vérifier résultat captcha ──
            body_text = await page.inner_text("body")
            current_url = page.url
            logger.info(f"[{monitor_id}] Après captcha — URL: {current_url}")

            # Captcha incorrect ?
            if "captcha" in current_url.lower() or "cgu" in current_url.lower():
                body_lower = body_text.lower()
                if "incorrect" in body_lower or "invalide" in body_lower or "erreur" in body_lower:
                    return CheckResult(
                        monitor_id=monitor_id, timestamp=timestamp,
                        available=False, slots_count=0,
                        message=f"Captcha incorrect (OCR: '{captcha_code}') — réessai",
                        duration_ms=(time.monotonic() - start_time) * 1000,
                    )

            # ── Étape 6 : Détecter disponibilité créneaux ──
            page_excerpt = _extract_page_excerpt(body_text)
            available, slots_count, message, _, slot_dates, booking_url = await _detect_availability(page)

            # Enrichir le message
            if available:
                message = f"CRENEAU PREFECTURE 92 DISPONIBLE — {message}"
                booking_url = booking_url or current_url
                logger.info(f"[{monitor_id}] CRENEAU DISPONIBLE ! URL: {booking_url}")
            else:
                message = f"Aucun creneau Prefecture 92 — {message}"

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
                booking_url=booking_url or current_url,
            )

        except PWTimeout as e:
            logger.warning(f"[{monitor_id}] Timeout: {e}")
            if retry < settings.MAX_RETRIES:
                await asyncio.sleep(settings.RETRY_BACKOFF_BASE ** retry + random.uniform(0, 1))
                return await check_prefecture_appointment(retry + 1)
            return CheckResult(
                monitor_id=monitor_id, timestamp=timestamp,
                available=False, slots_count=0,
                message="Timeout — site inaccessible",
                error=str(e), duration_ms=(time.monotonic() - start_time) * 1000,
            )
        except Exception as e:
            logger.error(f"[{monitor_id}] Erreur: {e}")
            if retry < settings.MAX_RETRIES:
                await asyncio.sleep(settings.RETRY_BACKOFF_BASE ** (retry + 1) + random.uniform(0, 2))
                return await check_prefecture_appointment(retry + 1)
            return CheckResult(
                monitor_id=monitor_id, timestamp=timestamp,
                available=False, slots_count=0,
                message="Erreur inattendue",
                error=str(e), duration_ms=(time.monotonic() - start_time) * 1000,
            )
        finally:
            if context:
                await context.close()
            if browser:
                await browser.close()


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
