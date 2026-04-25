"""
Extraction de texte depuis URL ou PDF.
"""
import io
import logging

import httpx
import pdfplumber
from bs4 import BeautifulSoup

from config import settings

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}


class ExtractionError(Exception):
    pass


def _truncate(text: str, source: str) -> str:
    cap = settings.MAX_INPUT_CHARS
    if len(text) > cap:
        log.warning("Document tronqué à %d caractères (source: %s)", cap, source)
        text = text[:cap] + (
            "\n\n[AVERTISSEMENT : le document a été tronqué à cause de sa taille. "
            "L'analyse porte sur la portion disponible.]"
        )
    return text


async def fetch_url_text(url: str) -> str:
    """Télécharge une page web et retourne son texte brut."""
    try:
        async with httpx.AsyncClient(
            headers=HEADERS, follow_redirects=True, timeout=30.0
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise ExtractionError(
            f"Erreur HTTP {e.response.status_code} lors du téléchargement de l'URL."
        ) from e
    except httpx.RequestError as e:
        raise ExtractionError(
            f"Impossible de contacter l'URL : {e}"
        ) from e

    soup = BeautifulSoup(resp.text, "lxml")

    # Supprime les balises inutiles
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)

    if len(text.strip()) < 100:
        raise ExtractionError(
            "Le contenu extrait est trop court. La page est peut-être "
            "protégée ou générée côté client (JavaScript). "
            "Téléchargez le document au format PDF et utilisez l'upload."
        )

    return _truncate(text, url)


def extract_pdf_text(file_bytes: bytes) -> str:
    """Extrait le texte d'un PDF (lecture synchrone, appelée en thread pool)."""
    try:
        pages_text = []
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            if len(pdf.pages) == 0:
                raise ExtractionError("Le PDF ne contient aucune page.")
            for i, page in enumerate(pdf.pages):
                page_text = page.extract_text() or ""
                pages_text.append(f"--- Page {i + 1} ---\n{page_text}")
        text = "\n\n".join(pages_text)
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(f"Impossible de lire le PDF : {e}") from e

    if len(text.strip()) < 100:
        raise ExtractionError(
            "Le PDF semble être composé d'images scannées (pas de texte sélectionnable). "
            "Veuillez fournir un PDF natif ou textuel."
        )

    return _truncate(text, "pdf")
