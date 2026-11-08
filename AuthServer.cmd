@echo off
REM Startet den Twitch Companion JS server in einem eigenen Konsolenfenster.
REM Das Fenster bleibt sichtbar, damit die Konsolenbefehle (help, whitelist, effects, bdu) erreichbar sind.
REM "pause" haelt das Fenster nach einem Absturz oder dem Beenden offen, damit die letzten Zeilen lesbar bleiben.
REM Neustart aus der Webkonsole: server.js endet mit Code 75, dann startet die Schleife ihn im selben Fenster neu.
REM Liegt im Projektordner neben server.js; der Ordner wird automatisch ermittelt.
REM Wird vom Stream-Deck-Skript aufgerufen (Server vor OBS und WLED-Controller).
title Twitch Companion JS server
echo ========================================
echo  Twitch Companion JS server wird gestartet...
echo ========================================
echo.
cd /d "%~dp0"
set TWITCH_COMPANION_SUPERVISED=1
:serverstart
node server.js
if "%errorlevel%"=="75" (
  echo.
  echo ========================================
  echo  Neustart aus der Webkonsole...
  echo ========================================
  echo.
  goto serverstart
)
pause
