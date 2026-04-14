@echo off
title VisaMonitor – Surveillance Visa Espagne

echo.
echo  ================================================
echo   VisaMonitor – Rendez-vous Visa Espagne Alger
echo  ================================================
echo.

REM Aller dans le dossier backend
cd /d "%~dp0backend"

REM Activer le venv si présent
if exist ".venv\Scripts\activate.bat" (
    echo [*] Activation de l'environnement virtuel...
    call .venv\Scripts\activate.bat
) else (
    echo [!] Venv non trouve – utilisation de Python systeme
)

REM Verifier que le .env existe
if not exist "..\env" (
    if not exist ".env" (
        echo [!] Fichier .env introuvable.
        echo [!] Copier .env.example en .env et configurer vos parametres.
        echo.
        pause
        exit /b 1
    )
)

REM Lancer l'application
echo [*] Demarrage de VisaMonitor sur http://localhost:8000
echo [*] Appuyez sur Ctrl+C pour arreter
echo.
python main.py

pause
