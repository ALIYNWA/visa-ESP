@echo off
title VisaMonitor – Installation

echo.
echo  ================================================
echo   VisaMonitor – Installation des dependances
echo  ================================================
echo.

cd /d "%~dp0backend"

echo [1/4] Creation de l'environnement virtuel...
python -m venv .venv
if errorlevel 1 ( echo [ERREUR] Python introuvable. Installez Python 3.11+ & pause & exit /b 1 )

echo [2/4] Activation du venv...
call .venv\Scripts\activate.bat

echo [3/4] Installation des packages Python...
pip install -r requirements.txt
if errorlevel 1 ( echo [ERREUR] pip install a echoue & pause & exit /b 1 )

echo [4/4] Installation de Playwright Chromium...
playwright install chromium
if errorlevel 1 ( echo [ERREUR] Playwright install a echoue & pause & exit /b 1 )

echo.
echo  [OK] Installation terminee !
echo.
echo  Etapes suivantes :
echo    1. Copier .env.example en .env  (cd ..)
echo    2. Editer .env avec vos parametres
echo    3. Lancer start.bat
echo.
pause
