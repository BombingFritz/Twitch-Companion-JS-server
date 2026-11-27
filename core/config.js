// Kern: Konfiguration aus der .env und Konstanten des Kerns (ADR 0027). Funktionsbezogene Konstanten stehen
// noch in server.js und ziehen mit ihrem Modul um.
'use strict';
require('dotenv').config();

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  PORT = 3000,
  SCOPES,
  HA_WEBHOOK_URL,
  CORS_ORIGINS,
  UBOAT_SAVES_DIR,
  STREAM_KARTEI_REPO,
  STREAM_KARTEI_TOKEN,
} = process.env;

module.exports = {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  PORT,
  SCOPES,
  HA_WEBHOOK_URL,
  CORS_ORIGINS,
  UBOAT_SAVES_DIR,
  STREAM_KARTEI_REPO,
  STREAM_KARTEI_TOKEN,

  APP_VERSION: require('../package.json').version,
  SERVER_STARTED_AT: new Date().toISOString(),   // für /status und Startanzeige (welcher Prozess antwortet?)

  // Zugriffsschutz (ADR 0013). Standard-Herkünfte für Widgets, wenn CORS_ORIGINS in der .env leer ist:
  // 'http://absolute' = OBS-Browser-Source mit "Lokale Datei", 'null' = Datei per file:// geöffnet.
  DEFAULT_CORS_ORIGINS: ['http://absolute', 'null'],
  LOOPBACK_ADDRESSES: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],   // /token nur von diesem Rechner
  LOOPBACK_HOSTNAMES: ['localhost', '127.0.0.1', '[::1]'],        // erlaubte Host-Header für /token

  // Login, Tokens und Bot (ADR 0013, 0017, 0024)
  TOKEN_FILE: './tokens.json',
  BOT_FILE: './bot.json',                     // nur ID und Name des Bots, keine Tokens
  BOT_SCOPES: 'user:bot user:write:chat',     // Freigabe durch das Bot-Konto über /login-bot
  LOGIN_STATE_TTL_MS: 10 * 60 * 1000,         // so lange gilt ein über /login oder /login-bot begonnener Login (state)
  APP_TOKEN_REFRESH_MARGIN_MS: 5 * 60 * 1000, // App-Access-Token so lange vor Ablauf neu holen
  TOKEN_REFRESH_BUFFER_MS: 5 * 60 * 1000,     // so kurz vor Ablauf erneuert eine Anfrage den Token selbst
  TOKEN_PROACTIVE_REFRESH_MS: 10 * 60 * 1000, // so lange vor Ablauf erneuert der Server den Token von sich aus
  TOKEN_PROACTIVE_RETRY_MS: 10 * 60 * 1000,   // nach einer gescheiterten Erneuerung erst so viel später wieder
  TOKEN_CHECK_INTERVAL_MS: 60 * 1000,

  // Twitch-API (ADR 0024, Issue #50): Vorgabe des Nutzers für alle Helix-Anfragen des Servers zusammen
  TWITCH_API_PER_SECOND: 3,                   // im Schnitt
  TWITCH_API_BURST: 20,                       // kurze Spitze, z. B. die EventSub-Abos binnen 10 s nach dem Welcome
  TWITCH_API_PER_MINUTE: 200,                 // hart, in jedem gleitenden 60-s-Fenster
  TWITCH_API_STARTUP_FREE: 300,               // so viele Anfragen nach dem Start ohne Zeitgrenze (Token, Abos, Ausgangsstände)
  TWITCH_API_MAX_RETRY_WAIT_MS: 60 * 1000,    // bei 429 höchstens so lange auf den Reset warten

  // Log und Fehlerprotokoll (ADR 0018)
  ERROR_LOG_FILE: './error_log.json',     // letzte Fehlermeldungen, überdauert Beenden, Neustart und Absturz
  ERROR_LOG_MAX_ENTRIES: 1000,            // so viele Fehlermeldungen bleiben in error_log.json
  ADMIN_LOG_BUFFER_LINES: 1000,           // so viele Log-Zeilen hält der Server im Arbeitsspeicher
  ADMIN_LOG_MAX_CHARS: 4000,              // längere Log-Einträge werden im Live-Log gekürzt
  LOG_REDACTED: '<entfernt>',
  LOG_PRIVATE_ADDRESS: '<privat>',
};
