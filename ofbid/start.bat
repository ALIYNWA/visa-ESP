@echo off
echo.
echo  ==========================================
echo   RFP Intelligence Platform
echo   Plateforme d'analyse d'appels d'offres
echo  ==========================================
echo.

cd /d "%~dp0backend"

if not exist ".env" (
    echo [ERREUR] Fichier .env manquant dans le dossier backend/
    echo.
    echo  1. Copiez .env.example en backend\.env
    echo  2. Renseignez votre ANTHROPIC_API_KEY
    echo.
    pause
    exit /b 1
)

echo [1/2] Installation des dependances Python...
pip install -r requirements.txt -q

echo.
echo [2/2] Demarrage du serveur...
echo.
echo  Plateforme accessible sur : http://localhost:8001
echo  Scraping BOAMP automatique toutes les 6 heures
echo  Appuyez sur Ctrl+C pour arreter
echo.
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
pause
