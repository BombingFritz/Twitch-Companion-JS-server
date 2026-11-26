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

  // Log und Fehlerprotokoll (ADR 0018)
  ERROR_LOG_FILE: './error_log.json',     // letzte Fehlermeldungen, überdauert Beenden, Neustart und Absturz
  ERROR_LOG_MAX_ENTRIES: 1000,            // so viele Fehlermeldungen bleiben in error_log.json
  ADMIN_LOG_BUFFER_LINES: 1000,           // so viele Log-Zeilen hält der Server im Arbeitsspeicher
  ADMIN_LOG_MAX_CHARS: 4000,              // längere Log-Einträge werden im Live-Log gekürzt
  LOG_REDACTED: '<entfernt>',
  LOG_PRIVATE_ADDRESS: '<privat>',
};
