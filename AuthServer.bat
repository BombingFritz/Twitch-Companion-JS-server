@echo off
REM Startet den Twitch Companion JS server in einem eigenen Konsolenfenster.
REM Das Fenster bleibt sichtbar, damit die Konsolenbefehle (help, whitelist, effects, bdu) erreichbar sind.
REM "pause" haelt das Fenster nach einem Absturz offen, damit die Fehlermeldung lesbar bleibt.
REM Liegt im Projektordner neben server.js; der Ordner wird automatisch ermittelt.
title Twitch Companion JS server
echo ========================================
echo  Twitch Companion JS server wird gestartet...
echo ========================================
echo.
cd /d "%~dp0"
node server.js
pause
