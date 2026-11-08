const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const readline = require('readline');
const WebSocket = require('ws');
const { createUboatCrew } = require('./lib/uboat-crew');
require('dotenv').config();

const app = express();
const SERVER_STARTED_AT = new Date().toISOString();   // für /status und Startanzeige (welcher Prozess antwortet?)
const APP_VERSION = require('./package.json').version;

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  PORT = 3000,
  SCOPES,
  HA_WEBHOOK_URL,
  CORS_ORIGINS,
  UBOAT_SAVES_DIR,
} = process.env;

const TOKEN_FILE = './tokens.json';
const RAID_FILE = './raids.json';
const WHITELIST_FILE = './whitelist.json';
const SUBGOAL_FILE = './subgoal_cache.json';
const EVENTLOG_FILE = './events.json';
const EFFECT_MODE_FILE = './effect_mode.json';
const WHITELIST_CHECKS_FILE = './whitelist_checks.json';   // Auffälligkeiten der Aktivitätsprüfung (ADR 0015), Quelle für den Stream-Bericht
const UBOAT_CREW_MAP_FILE = './uboat_crew_map.json';       // Zuordnung Twitch-Login -> Name im Spiel (ADR 0016)
const MODULES_FILE = './modules.json';                     // Modul-Schalter (bdu/uboat activate|deactivate), überdauert Neustarts
const ERROR_LOG_FILE = './error_log.json';                 // letzte Fehlermeldungen, überdauert Beenden, Neustart und Absturz
const MODULE_NAMES = { bdu: 'BdU-Chat', uboat: 'UBOAT-Soldbuch' };   // per Konsole schaltbare Chat-Module, Standard: an

// Bot-Account „DerBdu“ (ADR 0017, docs/specs/bot-account.md)
const BOT_FILE = './bot.json';                    // nur ID und Name des Bots, keine Tokens
const BOT_SCOPES = 'user:bot user:write:chat';    // Freigabe durch das Bot-Konto über /login-bot
const BOT_FEATURES = ['bdu', 'uboat'];            // diese Funktionen senden über den Bot; alles andere als Broadcaster
const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;        // so lange gilt ein über /login oder /login-bot begonnener Login (state)
const APP_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;   // App-Access-Token so lange vor Ablauf neu holen

const RAIDSTATS_COOLDOWN_MS = 30 * 1000;
const RAID_GREETING_MIN_GAP_MS = 90 * 1000;
const RAID_YEARLY_FROM_YEAR = 2027;               // Raid-Statistik ab diesem Jahr je Kalenderjahr statt je Quartal (ADR 0012)
const SHOUTOUT_ACTIVITY_WINDOW_DAYS = 40;         // Whitelist-Shoutout nur, wenn der Kanal in diesem Zeitraum aktiv war (ADR 0015)
const SHOUTOUT_ACTIVITY_STRICT = false;           // Testphase: Aktivität unklar (API-Fehler, kein Video) -> trotzdem Shoutout; später true
const WHITELIST_SHOUTOUT_DELAY_MS = 2000;         // Abstand zwischen Chat-Hinweis und Whitelist-Shoutout (wie beim Raid)
const WHITELIST_CHECKS_MAX = 500;                 // so viele Einträge behält whitelist_checks.json

const EFFECT_BURST_WINDOW_MS = 2500;
const EFFECT_MIN_GAP_MS = 4000;
const EFFECT_MANUAL_CONFIRM_TIMEOUT_MS = 30 * 1000;

// Entdoppelung von EventSub-Ereignissen (siehe Abschnitt "ENTDOPPELUNG" weiter unten)
const EVENT_MESSAGE_ID_TTL_MS = 10 * 60 * 1000;   // Twitch-Wiederzustellungen derselben Nachricht
const SUB_DEDUPE_WINDOW_MS = 60 * 1000;           // Sicherheitsnetz: derselbe Nutzer nicht mehrfach als Sub-Effekt
const FOLLOW_DEDUPE_WINDOW_MS = 60 * 1000;        // Follow/Unfollow/Follow desselben Nutzers

// EventSub-WebSocket
const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const EVENTSUB_RECONNECT_DELAY_MS = 5000;         // Neuaufbau nach unerwartetem Verbindungsende
const EVENTSUB_KEEPALIVE_DEFAULT_S = 10;          // falls session_welcome keinen keepalive_timeout_seconds liefert
const EVENTSUB_KEEPALIVE_GRACE_MS = 5000;         // Zuschlag auf das Keepalive-Intervall, bevor die Verbindung als tot gilt

// Zugriffsschutz (siehe ADR 0013)
// Standard-Herkünfte für Widgets, wenn CORS_ORIGINS in der .env leer ist:
// 'http://absolute' = OBS-Browser-Source mit "Lokale Datei", 'null' = Datei per file:// geöffnet.
const DEFAULT_CORS_ORIGINS = ['http://absolute', 'null'];
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];  // /token nur von diesem Rechner
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];      // erlaubte Host-Header für /token

// Webkonsole (siehe ADR 0018 und docs/specs/webkonsole.md)
const ADMIN_DIR = path.join(__dirname, 'public', 'admin');   // nur dieser Ordner wird ausgeliefert, nie der Server-Ordner
const ADMIN_PAGE_PATH = '/TwitchCompanionAdmin';  // Adresse der Webkonsole im Browser (Groß-/Kleinschreibung egal)
const ADMIN_OVERVIEW_PATH = '/api/admin/overview';
const ADMIN_POLL_MS = 5000;                       // so oft holt die Hauptseite neue Werte
const ADMIN_RECENT_EFFECTS = 5;                   // so viele letzte Effekte zeigt die Hauptseite
const ADMIN_CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const ADMIN_SHUTDOWN_PATH = '/api/admin/server/shutdown';
const ADMIN_RESTART_PATH = '/api/admin/server/restart';
const ADMIN_EXIT_DELAY_MS = 300;                  // Zeit für die Antwort an die Seite, bevor der Prozess endet
const SERVER_RESTART_EXIT_CODE = 75;              // AuthServer.cmd startet den Server nur bei diesem Code neu
const SERVER_SUPERVISED = process.env.TWITCH_COMPANION_SUPERVISED === '1';  // gesetzt von AuthServer.cmd
const ADMIN_LOG_STREAM_PATH = '/api/admin/log/stream';
const ADMIN_LOG_BUFFER_LINES = 1000;              // so viele Log-Zeilen hält der Server im Arbeitsspeicher
const ADMIN_LOG_MAX_CHARS = 4000;                 // längere Log-Einträge werden im Live-Log gekürzt
const ADMIN_LOG_PING_MS = 30 * 1000;              // Lebenszeichen auf der Live-Log-Verbindung
const ADMIN_ERROR_LOG_PATH = '/api/admin/log/errors';
const ERROR_LOG_MAX_ENTRIES = 1000;               // so viele Fehlermeldungen bleiben in error_log.json
const ADMIN_WHITELIST_PATH = '/api/admin/whitelist';
const ADMIN_JSON_LIMIT = '1kb';                   // Webkonsole-Aktionen senden nur kurze JSON-Objekte
const TWITCH_LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/;
const TWITCH_ID_PATTERN = /^\d{1,20}$/;
const LOG_REDACTED = '<entfernt>';
const LOG_PRIVATE_ADDRESS = '<privat>';

// BdU-Chat (!BdU, siehe ADR 0014 und docs/specs/bdu-chat.md)
const BDU_COMMAND = '!bdu';
const BDU_MAX_INPUT_CHARS = 200;                  // Text nach "!BdU" wird darauf gekürzt
const BDU_GLOBAL_COOLDOWN_MS = 3 * 60 * 1000;     // höchstens eine angenommene Anfrage je 3 Minuten
const BDU_USER_WINDOW_MS = 30 * 60 * 1000;        // je Nutzer ...
const BDU_USER_MAX = 3;                           // ... höchstens 3 angenommene Anfragen in 30 Minuten
const BDU_WARNING_COOLDOWN_MS = 10 * 60 * 1000;   // Warnung bei Limit-Verstoß höchstens einmal je 10 Minuten
const BDU_ANSWER_TIMEOUT_MS = 120 * 1000;         // Widget hält Anfragen bis 60 s für den Kaleu zurück
const BDU_SILENCE_MS = 30 * 60 * 1000;            // Funkstille nach erschöpftem KI-Kontingent (Minutenlimit)
const BDU_DAILY_LIMIT = 60;                       // angenommene Chat-Anfragen je Kalendertag (0 = keine Grenze)
const BDU_SSE_PING_MS = 30 * 1000;                // Lebenszeichen auf der Events-Verbindung
const BDU_REPLY_PREFIX = 'FT vom BdU: ';         // nur wenn der Broadcaster sendet; DerBdu postet die Antwort ohne Präfix (ADR 0017)
const BDU_WARNING_TEXT = 'Funkverkehr einschränken, Feind peilt ein!';

// UBOAT-Soldbuch (!soldbuch, siehe ADR 0016 und docs/specs/uboat-personalakte.md)
const UBOAT_COMMAND = '!soldbuch';                // Vergleich ohne Groß-/Kleinschreibung, "!Soldbuch" geht auch
const UBOAT_USER_COOLDOWN_MS = 60 * 1000;         // je Zuschauer höchstens eine Antwort pro Minute
const UBOAT_CATEGORY_NAMES = ['UBOAT'];           // Twitch-Kategorie, in der der Befehl antwortet [UNGEKLÄRT: Name beim ersten Stream prüfen]
const UBOAT_SAVE_SETTLE_MS = 3 * 1000;            // Spielstand erst lesen, wenn er so lange unverändert ist
const UBOAT_POLL_MS = 60 * 1000;                  // zusätzlich zur Dateibeobachtung
const UBOAT_KNOWN_GAME_VERSIONS = ['2026.1 Patch 21'];   // Parser daran erprobt; andere: Hinweis in der Konsole
const UBOAT_HIDDEN_SKILLS = ['Authority', 'Skipper'];    // in der Akte nicht nennen (Spielmechanik bzw. doppelt zum Typ)
const UBOAT_FRESH_MS = 60 * 60 * 1000;           // Spielstand höchstens so alt: "Der Eintrag ist aktuell." im Soldbuch
// Kein Soldbuch zum Namen: keine Antwort im Chat, nur Hinweis in der Konsole
const UBOAT_TEXT_UNAVAILABLE = 'Die Soldbücher sind gerade nicht verfügbar.';
const CHAT_MAX_CHARS = 500;                       // Twitch-Limit je Chat-Nachricht

// ═══════════════════════════════════════════════════════════════════
// LIVE-LOG – Puffer für die Webkonsole (ADR 0018, docs/specs/webkonsole.md)
// ═══════════════════════════════════════════════════════════════════

const logBuffer = [];
const logClients = new Set();     // offene Live-Log-Verbindungen
let nextLogId = 1;

function logRedactedValues() {
  const values = [CLIENT_SECRET, HA_WEBHOOK_URL];
  try {
    const url = new URL(HA_WEBHOOK_URL);
    if (!LOOPBACK_HOSTNAMES.includes(url.hostname)) values.push(url.host, url.hostname);
    values.push(url.pathname.split('/').pop());
  } catch { /* keine oder ungültige Webhook-Adresse */ }
  return values.filter(Boolean).sort((a, b) => b.length - a.length);
}

const logRedactions = logRedactedValues();

// Nur für den Puffer: Das Konsolenfenster zeigt weiter die unveränderte Zeile.
function sanitizeLogText(text) {
  let clean = text;
  for (const value of logRedactions) clean = clean.split(value).join(LOG_REDACTED);
  return clean
    .replace(/((?:access_token|refresh_token|client_secret)["']?\s*[:=]\s*["']?)[^"'&\s,}]+/gi, `$1${LOG_REDACTED}`)
    .replace(/\b(Bearer|OAuth)\s+[\w.~+/=-]+/g, `$1 ${LOG_REDACTED}`)
    .replace(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, LOG_PRIVATE_ADDRESS);
}

function loadErrorLog() {
  if (!fs.existsSync(ERROR_LOG_FILE)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(ERROR_LOG_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

// Erst in eine Hilfsdatei, dann umbenennen: Ein Absturz mitten im Schreiben zerstört so nicht die ganze Liste.
function saveErrorLog(list) {
  const tempFile = `${ERROR_LOG_FILE}.tmp`;
  const json = JSON.stringify(list, null, 2);
  fs.writeFileSync(tempFile, json, 'utf8');
  try {
    fs.renameSync(tempFile, ERROR_LOG_FILE);
  } catch {   // z. B. hält OneDrive die Datei gerade fest
    fs.writeFileSync(ERROR_LOG_FILE, json, 'utf8');
    fs.rmSync(tempFile, { force: true });
  }
}

const errorLog = loadErrorLog();

function appendErrorLog(entry) {
  errorLog.push({ at: entry.at, pid: process.pid, text: entry.text });
  if (errorLog.length > ERROR_LOG_MAX_ENTRIES) errorLog.splice(0, errorLog.length - ERROR_LOG_MAX_ENTRIES);
  try {
    saveErrorLog(errorLog);
  } catch (err) {
    logIfChanged('error-log-write', `[Fehlerprotokoll] ${ERROR_LOG_FILE} konnte nicht geschrieben werden: ${err.message}`, 'warn');
  }
}

function writeLogEntry(res, entry) {
  res.write(`event: line\ndata: ${JSON.stringify(entry)}\n\n`);
}

function recordLogLine(level, args) {
  try {
    const text = sanitizeLogText(util.format(...args));
    const entry = {
      id: nextLogId++,
      at: new Date().toISOString(),
      level,
      text: text.length > ADMIN_LOG_MAX_CHARS ? `${text.slice(0, ADMIN_LOG_MAX_CHARS)} … (gekürzt)` : text,
    };
    logBuffer.push(entry);
    if (logBuffer.length > ADMIN_LOG_BUFFER_LINES) logBuffer.shift();
    for (const res of logClients) writeLogEntry(res, entry);
    if (level === 'error') appendErrorLog(entry);
  } catch { /* Das Protokollieren darf den Server nie stören */ }
}

for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
  const original = console[method];
  console[method] = (...args) => {
    original.apply(console, args);
    recordLogLine(level, args);
  };
}

// ═══════════════════════════════════════════════════════════════════
// LOGGING-HILFSFUNKTIONEN (reduziert Log-Spam bei wiederholten/Polling-Ereignissen)
// ═══════════════════════════════════════════════════════════════════

// Merkt sich pro Schlüssel die letzte ausgegebene Nachricht.
// Solange sich die Nachricht für diesen Schlüssel nicht ändert, wird sie
// nicht erneut ausgegeben (z.B. wiederholte identische Prediction-Status,
// Sub-Goal-Stände, etc.). Bei Änderung wird sofort wieder geloggt.
const lastLoggedByKey = new Map();

function logIfChanged(key, message, level = 'log') {
  const prev = lastLoggedByKey.get(key);
  if (prev === message) return;
  lastLoggedByKey.set(key, message);
  if (level === 'error') {
    console.error(message);
  } else if (level === 'warn') {
    console.warn(message);
  } else {
    console.log(message);
  }
}

// Generischer HTTP-Request-Logger: loggt jede Anfrage, aber unterdrückt
// direkt aufeinanderfolgende, identische Zeilen (z.B. Dauer-Polling von
// Widgets mit immer demselben Ergebnis). Sobald sich Methode, Pfad oder
// Statuscode ändern, wird sofort wieder geloggt. Gilt für ALLE Endpoints,
// auch für künftig angedockte Widgets - es wird nichts an Funktionalität
// eingeschränkt, nur die Konsolenausgabe entrauscht.
let lastRequestLogLine = null;

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    // Die Webkonsole fragt alle paar Sekunden ab; erfolgreiche Abfragen würden die Konsole fluten.
    if (req.method === 'GET' && req.path === ADMIN_OVERVIEW_PATH && res.statusCode === 200) return;
    const durationMs = Date.now() - startedAt;
    // OAuth-Code und state aus /callback nicht ins Protokoll schreiben
    const url = req.originalUrl.replace(/([?&](?:code|state)=)[^&]*/g, '$1…');
    const line = `[HTTP] ${req.method} ${url} -> ${res.statusCode} (${durationMs}ms)`;
    if (line !== lastRequestLogLine) {
      console.log(line);
      lastRequestLogLine = line;
    }
  });
  next();
});

// ═══════════════════════════════════════════════════════════════════
// ZUGRIFFSSCHUTZ – Browser-Herkunft (CORS), Caching, /token nur lokal
// ═══════════════════════════════════════════════════════════════════

// CORS_ORIGINS leer: Standard-Herkünfte. '*': jede Herkunft (altes Verhalten,
// nur als Notschalter gedacht). localhost/127.0.0.1 auf dem eigenen Port sind immer erlaubt.
const corsAllowAll = (CORS_ORIGINS || '').trim() === '*';
const allowedOrigins = new Set([
  ...(CORS_ORIGINS && CORS_ORIGINS.trim() && !corsAllowAll
    ? CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : DEFAULT_CORS_ORIGINS),
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
]);

// Anfragen ohne Origin-Header (Stream Deck, Home Assistant, Adresszeile des
// Browsers) sind nicht betroffen.
function isAllowedOrigin(origin) {
  return corsAllowAll || !origin || allowedOrigins.has(origin);
}

// Browser-Anfragen von fremden Webseiten werden abgelehnt, bevor ein Endpoint
// etwas ausführt oder Daten herausgibt.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) return next();
  logIfChanged(
    `origin-blocked:${origin}`,
    `[Zugriffsschutz] Anfrage von fremder Herkunft "${origin}" abgelehnt (${req.method} ${req.path}). Eigenes Widget? Herkunft in CORS_ORIGINS (.env) eintragen.`,
    'warn'
  );
  res.status(403).json({ error: 'Herkunft nicht erlaubt', origin });
});

app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }));

// Alle Antworten sind Live-Daten. Ohne diesen Header kann z. B. eine
// OBS-Browser-Source eine alte /token-Antwort aus dem Cache verwenden.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function isLoopbackRequest(req) {
  return LOOPBACK_ADDRESSES.includes(req.socket.remoteAddress);
}

// Prüft den Host-Header. Schützt vor DNS-Rebinding: Eine fremde Domain, die auf
// 127.0.0.1 zeigt, käme sonst als "gleiche Herkunft" an CORS vorbei.
function hasLoopbackHost(req) {
  const host = (req.headers.host || '').toLowerCase();
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK_HOSTNAMES.includes(hostname);
}

// ═══════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN – TOKENS
// ═══════════════════════════════════════════════════════════════════

function loadTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

async function getValidAccessToken() {
  let tokens = loadTokens();
  if (!tokens) {
    throw new Error('Keine Tokens gespeichert. Bitte login durchführen: http://localhost:3000/login');
  }

  const now = Date.now();
  const expiresAt = tokens.expires_at || (tokens.obtained_at + tokens.expires_in * 1000);
  const bufferTime = 5 * 60 * 1000;

  if (now < (expiresAt - bufferTime)) {
    return tokens.access_token;
  }

  console.log('Token abgelaufen, führe Refresh durch...');
  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token'
    });

    const response = await axios.post('https://id.twitch.tv/oauth2/token', params);

    tokens.access_token = response.data.access_token;
    tokens.refresh_token = response.data.refresh_token || tokens.refresh_token;
    tokens.obtained_at = Date.now();
    tokens.expires_in = response.data.expires_in;
    tokens.expires_at = Date.now() + response.data.expires_in * 1000;

    saveTokens(tokens);
    console.log('Token erfolgreich aktualisiert!');
    return tokens.access_token;
  } catch (err) {
    console.error('Token-Refresh fehlgeschlagen:', err.response?.data || err.message);
    throw new Error('Token-Refresh fehlgeschlagen. Bitte neu einloggen.');
  }
}

// ═══════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN – BOT-ACCOUNT „DerBdu“ (ADR 0017)
// ═══════════════════════════════════════════════════════════════════

function loadBotConfig() {
  if (!fs.existsSync(BOT_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(BOT_FILE, 'utf8'));
    return data && data.bot_id ? data : null;
  } catch { return null; }
}

function saveBotConfig(config) {
  fs.writeFileSync(BOT_FILE, JSON.stringify(config, null, 2), 'utf8');
}

let appAccessToken = null;          // { token, expiresAt } – nur im RAM (Client-Credentials)
let botLastError = null;            // { at, text } – letzter Fehler beim Senden über den Bot

async function getAppAccessToken(forceNew = false) {
  if (!forceNew && appAccessToken && Date.now() < appAccessToken.expiresAt - APP_TOKEN_REFRESH_MARGIN_MS) {
    return appAccessToken.token;
  }
  const params = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' });
  const response = await axios.post('https://id.twitch.tv/oauth2/token', params);
  appAccessToken = { token: response.data.access_token, expiresAt: Date.now() + response.data.expires_in * 1000 };
  return appAccessToken.token;
}

function botFeatureLabels() {
  return BOT_FEATURES.map(f => MODULE_NAMES[f] || f).join(', ');
}

function printBotStatus() {
  const bot = loadBotConfig();
  if (!bot) {
    console.log(`[Bot] Nicht eingerichtet – alle Nachrichten kommen vom Broadcaster. Einrichten: /mod DerBdu im Chat, dann http://localhost:${PORT}/login-bot in einem Browser, in dem DerBdu bei Twitch angemeldet ist`);
    return;
  }
  console.log(`[Bot] ${bot.bot_name || bot.bot_login} (ID ${bot.bot_id}), freigegeben am ${new Date(bot.authorized_at).toLocaleString('de-DE')}`);
  console.log(`[Bot] Sendet: ${botFeatureLabels()}; alles andere sendet der Broadcaster`);
  console.log(`[Bot] Letzter Sendefehler: ${botLastError ? `${new Date(botLastError.at).toLocaleString('de-DE')} – ${botLastError.text}` : 'keiner'}`);
}

// ═══════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN – RAID-TRACKING
// ═══════════════════════════════════════════════════════════════════

function loadRaidLog() {
  if (!fs.existsSync(RAID_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(RAID_FILE, 'utf8')); } catch { return {}; }
}

function saveRaidLog(log) {
  fs.writeFileSync(RAID_FILE, JSON.stringify(log, null, 2), 'utf8');
}

// Zeitraum-Schlüssel der Raid-Statistik (ADR 0012):
// bis 2026 je Quartal (z. B. "2026-Q4"), ab RAID_YEARLY_FROM_YEAR je Kalenderjahr (z. B. "2027").
// Bestehende Quartalsdaten bleiben unter ihrem Schlüssel in raids.json erhalten.
function getPeriodKey(date) {
  const year = date.getFullYear();
  if (year >= RAID_YEARLY_FROM_YEAR) return `${year}`;
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${year}-Q${q}`;
}

// Wort für die Chat-Texte: "Quartal" oder "Jahr"
function getPeriodWord(pKey) {
  return pKey.includes('-Q') ? 'Quartal' : 'Jahr';
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function trackRaid(fromId, fromName, viewers) {
  const log = loadRaidLog();
  const pKey = getPeriodKey(new Date());
  if (!log[pKey]) log[pKey] = {};
  if (!log[pKey][fromId]) log[pKey][fromId] = { name: fromName, count: 0, totalViewers: 0 };

  log[pKey][fromId].count += 1;
  log[pKey][fromId].totalViewers += viewers;
  log[pKey][fromId].name = fromName;
  saveRaidLog(log);

  return { pKey, data: log[pKey][fromId] };
}

function getRanks(pKey, fromId) {
  const log = loadRaidLog();
  const entries = Object.entries(log[pKey] || {});

  const byCount = [...entries].sort((a, b) => b[1].count - a[1].count);
  const byViewers = [...entries].sort((a, b) => b[1].totalViewers - a[1].totalViewers);

  const countRank = byCount.findIndex(([id]) => id === fromId) + 1;
  const viewerRank = byViewers.findIndex(([id]) => id === fromId) + 1;

  return {
    countRank: countRank >= 1 && countRank <= 5 ? countRank : null,
    viewerRank: viewerRank >= 1 && viewerRank <= 3 ? viewerRank : null
  };
}

function getLeaderboardText() {
  const pKey = getPeriodKey(new Date());
  const log = loadRaidLog();
  const entries = Object.entries(log[pKey] || {});
  if (entries.length === 0) return `Noch keine Raids in ${pKey} erfasst.`;

  const byCount = [...entries].sort((a, b) => b[1].count - a[1].count).slice(0, 3);
  const byViewers = [...entries].sort((a, b) => b[1].totalViewers - a[1].totalViewers).slice(0, 3);

  const countList = byCount.map((e, i) => `${i + 1}. ${e[1].name} (${e[1].count}x)`).join(', ');
  const viewerList = byViewers.map((e, i) => `${i + 1}. ${e[1].name} (${e[1].totalViewers} Zuschauer)`).join(', ');

  return `Top Raider ${pKey} — Häufigkeit: ${countList} | Zuschauer: ${viewerList}`;
}

// ═══════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN – WHITELIST
// ═══════════════════════════════════════════════════════════════════

function loadWhitelist() {
  if (!fs.existsSync(WHITELIST_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf8')); } catch { return {}; }
}

function saveWhitelist(list) {
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function addToWhitelist(userId, userName) {
  const list = loadWhitelist();
  list[userId] = userName;
  saveWhitelist(list);
  console.log(`@${userName} (ID: ${userId}) zur Whitelist hinzugefügt`);
}

function removeFromWhitelist(userId) {
  const list = loadWhitelist();
  const name = list[userId];
  if (!list[userId]) {
    console.log(`ID ${userId} war nicht in der Whitelist`);
    return;
  }
  delete list[userId];
  saveWhitelist(list);
  console.log(`@${name} (ID: ${userId}) aus der Whitelist entfernt`);
}

function printWhitelist() {
  const list = loadWhitelist();
  const entries = Object.entries(list);
  if (entries.length === 0) {
    console.log('Whitelist ist aktuell leer.');
    return;
  }
  console.log('Aktuelle Whitelist:');
  entries.forEach(([id, name]) => console.log(` - @${name} (ID: ${id})`));
}

// Prüfprotokoll der Whitelist-Shoutouts (ADR 0015): nur Auffälligkeiten (live beim Chatten,
// nicht aktiv, nicht feststellbar). Grundlage, um die Whitelist zu überarbeiten, später Teil des Stream-Berichts.
function loadWhitelistChecks() {
  if (!fs.existsSync(WHITELIST_CHECKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(WHITELIST_CHECKS_FILE, 'utf8')); } catch { return []; }
}

function saveWhitelistChecks(list) {
  fs.writeFileSync(WHITELIST_CHECKS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function recordWhitelistCheck(entry) {
  const list = loadWhitelistChecks();
  list.push({ timestamp: new Date().toISOString(), ...entry });
  saveWhitelistChecks(list.slice(-WHITELIST_CHECKS_MAX));
}

const WHITELIST_CHECK_LABELS = {
  live: 'war selbst live und hat hier gechattet – kein Shoutout',
  inaktiv: `in den letzten ${SHOUTOUT_ACTIVITY_WINDOW_DAYS} Tagen nicht aktiv – kein Shoutout`,
  unklar: 'Aktivität nicht feststellbar'
};

function printWhitelistChecks(limit = 20) {
  const list = loadWhitelistChecks().slice(-limit);
  if (list.length === 0) {
    console.log('Keine Auffälligkeiten bei Whitelist-Shoutouts erfasst.');
    return;
  }
  console.log(`Letzte ${list.length} Auffälligkeiten bei Whitelist-Shoutouts:`);
  list.forEach(e => {
    const details = [
      e.game ? `Spiel: ${e.game}` : null,
      e.lastActiveAt ? `zuletzt aktiv: ${formatDateDe(e.lastActiveAt)}` : null,
      e.result === 'unklar' ? (e.shoutout ? 'Shoutout trotzdem (Testphase)' : 'kein Shoutout') : null,
      e.error ? `Fehler: ${e.error}` : null
    ].filter(Boolean).join(', ');
    console.log(` - [${new Date(e.timestamp).toLocaleString('de-DE')}] @${e.userName} (ID: ${e.userId}): ${WHITELIST_CHECK_LABELS[e.result] || e.result}${details ? ' (' + details + ')' : ''}`);
  });
}

async function resolveUserByLogin(login) {
  const accessToken = await getValidAccessToken();
  const res = await axios.get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID }
  });
  return res.data.data[0] || null;
}

async function resolveUserById(id) {
  const accessToken = await getValidAccessToken();
  const res = await axios.get(`https://api.twitch.tv/helix/users?id=${encodeURIComponent(id)}`, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID }
  });
  return res.data.data[0] || null;
}

// ═══════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN – SUB GOAL CACHE
// ═══════════════════════════════════════════════════════════════════

function loadSubGoalCache() {
  if (!fs.existsSync(SUBGOAL_FILE)) return { current: null, target: null, title: null, goalId: null, status: null, lastUpdated: null };
  try { return JSON.parse(fs.readFileSync(SUBGOAL_FILE, 'utf8')); } catch {
    return { current: null, target: null, title: null, goalId: null, status: null, lastUpdated: null };
  }
}

function saveSubGoalCache(data) {
  fs.writeFileSync(SUBGOAL_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function refreshSubGoalCache() {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();
    const res = await axios.get(
      `https://api.twitch.tv/helix/goals?broadcaster_id=${tokens.broadcaster_id}`,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID } }
    );
    const goals = res.data.data || [];
    const goal = goals.find(g => (g.type === 'subscription' || g.type === 'subscription_count') && g.status === 'active')
              || goals.find(g => g.type === 'subscription' || g.type === 'subscription_count')
              || null;

    if (goal) {
      const cache = {
        current: goal.current_amount,
        target: goal.target_amount,
        title: goal.description || goal.type,
        goalId: goal.id,
        status: goal.status,
        lastUpdated: new Date().toISOString()
      };
      saveSubGoalCache(cache);
      logIfChanged('subgoal', `Sub-Goal Cache aktualisiert: ${cache.current}/${cache.target} (${cache.title})`);
      return cache;
    } else {
      logIfChanged('subgoal', 'Kein aktiver Sub-Goal bei Twitch gefunden.', 'warn');
      return loadSubGoalCache();
    }
  } catch (err) {
    console.error('Fehler beim Aktualisieren des Sub-Goal-Cache:', err.response?.data || err.message);
    return loadSubGoalCache();
  }
}

// ═══════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN – EVENT-LOG (Follows, Subs, Gifts für Home Assistant)
// ═══════════════════════════════════════════════════════════════════

function loadEventLog() {
  if (!fs.existsSync(EVENTLOG_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(EVENTLOG_FILE, 'utf8')); } catch { return []; }
}

function saveEventLog(log) {
  fs.writeFileSync(EVENTLOG_FILE, JSON.stringify(log, null, 2), 'utf8');
}

function appendEvent(type, payload) {
  const log = loadEventLog();
  const entry = { type, ...payload, timestamp: new Date().toISOString() };
  log.push(entry);
  saveEventLog(log.slice(-200)); // nur die letzten 200 Ereignisse behalten
  return entry;
}

// ═══════════════════════════════════════════════════════════════════
// HILFSFUNKTIONEN – EFFEKT-MODUS (Auto / Manuell / Off, per Stream Deck)
// ═══════════════════════════════════════════════════════════════════

function loadEffectMode() {
  if (!fs.existsSync(EFFECT_MODE_FILE)) return 'auto';
  try {
    const data = JSON.parse(fs.readFileSync(EFFECT_MODE_FILE, 'utf8'));
    return ['auto', 'manual', 'off'].includes(data.mode) ? data.mode : 'auto';
  } catch { return 'auto'; }
}

function saveEffectMode(mode) {
  fs.writeFileSync(EFFECT_MODE_FILE, JSON.stringify({ mode }, null, 2), 'utf8');
}

let effectMode = loadEffectMode();       // Startet mit dem zuletzt gespeicherten Modus
let pendingManualConfirmation = null;    // { job, resolve } während im Manuell-Modus gewartet wird

// ═══════════════════════════════════════════════════════════════════
// MODUL-SCHALTER (BdU-Chat, UBOAT-Soldbuch) – per Konsole, gespeichert in modules.json
// ═══════════════════════════════════════════════════════════════════

// Fehlende Datei oder fehlender Eintrag: Modul an (Verhalten wie vor Einführung der Schalter)
function loadModuleSwitches() {
  const switches = Object.fromEntries(Object.keys(MODULE_NAMES).map(k => [k, true]));
  if (!fs.existsSync(MODULES_FILE)) return switches;
  try {
    const data = JSON.parse(fs.readFileSync(MODULES_FILE, 'utf8'));
    for (const k of Object.keys(switches)) if (typeof data[k] === 'boolean') switches[k] = data[k];
  } catch { /* defekte Datei: alle Module an */ }
  return switches;
}

function saveModuleSwitches(switches) {
  fs.writeFileSync(MODULES_FILE, JSON.stringify(switches, null, 2), 'utf8');
}

let moduleSwitches = loadModuleSwitches();

function moduleStateLabel(key) {
  return moduleSwitches[key] ? 'aktiviert' : `deaktiviert ("${key} activate" schaltet ein)`;
}

// Gemeinsamer Teil von "bdu activate|deactivate" und "uboat activate|deactivate"
function setModuleSwitch(key, on) {
  const name = MODULE_NAMES[key];
  if (moduleSwitches[key] === on) {
    console.log(`${name} ist bereits ${on ? 'aktiviert' : 'deaktiviert'}`);
    return false;
  }
  moduleSwitches = { ...moduleSwitches, [key]: on };
  saveModuleSwitches(moduleSwitches);
  console.log(`${name} ${on ? 'aktiviert' : 'deaktiviert – Befehle im Chat werden ignoriert'} (gespeichert, gilt auch nach Neustart)`);
  return true;
}

// Setzt den Effekt-Modus (HTTP-Endpoint und Konsole). Beim Wechsel auf OFF wird eine
// wartende Bestätigung verworfen, damit /api/effects/confirm den Effekt nicht trotzdem
// auslöst (OFFEN.md, K3). Kein Eintrag im Event-Log, wie bei den übrigen verworfenen Jobs.
function setEffectMode(mode) {
  effectMode = mode;
  saveEffectMode(mode);
  console.log(`Effekt-Modus geändert auf: ${mode.toUpperCase()}`);
  if (mode === 'off' && pendingManualConfirmation) {
    console.log(`[Effekt-Modus: OFF] Wartende Bestätigung für ${pendingManualConfirmation.job.type} (${pendingManualConfirmation.job.count}x) verworfen.`);
    pendingManualConfirmation.resolve('off');
  }
}

// ═══════════════════════════════════════════════════════════════════
// EFFEKT-QUEUE – Follows/Subs/Gifts gebündelt & geordnet auslösen
// ═══════════════════════════════════════════════════════════════════

const pendingBursts = {};
const effectQueue = [];
let isProcessingEffectQueue = false;
let lastEffectSentAt = 0;

// Sammelt kurz aufeinanderfolgende Events desselben Typs (z.B. 5 Follower
// in 2 Sekunden) und meldet sie am Ende als EINEN Job mit count > 1 an
// die effectQueue, statt mehrfach denselben Effekt zu feuern.
function scheduleEffect(type, meta) {
  if (!pendingBursts[type]) {
    pendingBursts[type] = { count: 0, sample: meta, timer: null };
  }
  const burst = pendingBursts[type];
  burst.count += 1;
  burst.sample = meta;
  if (burst.timer) clearTimeout(burst.timer);
  burst.timer = setTimeout(() => {
    const finished = pendingBursts[type];
    delete pendingBursts[type];
    enqueueEffect(type, finished.count, finished.sample);
  }, EFFECT_BURST_WINDOW_MS);
}

function enqueueEffect(type, count, meta) {
  effectQueue.push({ type, count, meta, queuedAt: Date.now() });
  console.log(`Effekt eingereiht: ${type} (${count}x) - Queue-Länge jetzt: ${effectQueue.length}`);
  processEffectQueue();
}

function describeEffect(type, meta, count) {
  if (type === 'follow') return count > 1 ? `${count} neue Follower, zuletzt @${meta.userName}` : `@${meta.userName}`;
  if (type === 'sub')    return count > 1 ? `${count} neue Subs, zuletzt @${meta.userName}` : `@${meta.userName}`;
  if (type === 'gift')   return `@${meta.userName} verschenkt ${meta.giftCount || 1} Sub(s)`;
  return JSON.stringify(meta);
}

async function triggerEffect(job) {
  const { type, count, meta } = job;
  console.log(`Effekt ausgelöst: ${type}${count > 1 ? ` (${count}x gebündelt)` : ''} – ${describeEffect(type, meta, count)}`);

  appendEvent(type, { ...meta, count });

  if (HA_WEBHOOK_URL) {
    try {
      await axios.post(HA_WEBHOOK_URL, { type, count, meta, timestamp: new Date().toISOString() });
    } catch (err) {
      console.error('Fehler beim Senden an Home Assistant Webhook:', err.response?.data || err.message);
    }
  }
}

// Führt einen Effekt im MANUELL-Modus aus: wartet bis zu 30s auf eine
// Bestätigung über /api/effects/confirm, bevor der Effekt tatsächlich
// läuft. Ohne Bestätigung wird der Job übersprungen (nicht nachgeholt),
// damit sich bei verpasstem Stream-Deck-Klick nichts aufstaut.
async function runManualConfirmation(job) {
  console.log(`[Effekt-Modus: MANUELL] Warte auf Bestätigung für ${job.type} (${job.count}x) – 30 Sekunden Zeit...`);

  // true = bestätigt, false = Timeout, 'off' = per setEffectMode('off') verworfen
  const outcome = await new Promise((resolve) => {
    pendingManualConfirmation = { job, resolve };
    setTimeout(() => {
      if (pendingManualConfirmation && pendingManualConfirmation.job === job) {
        console.log(`[Effekt-Modus: MANUELL] Keine Bestätigung erhalten – Effekt ${job.type} wird übersprungen.`);
        resolve(false);
      }
    }, EFFECT_MANUAL_CONFIRM_TIMEOUT_MS);
  });

  pendingManualConfirmation = null;

  if (outcome === true) {
    await triggerEffect(job);
  } else if (outcome === false) {
    appendEvent(job.type, { ...job.meta, count: job.count, skippedManualTimeout: true });
  }
}

// Arbeitet die effectQueue strikt nacheinander ab, mit Mindestabstand
// zwischen zwei Effekten — verhindert Überlappungen bei Lichteffekten
// und respektiert den aktuell aktiven Modus (Auto/Manuell/Off).
async function processEffectQueue() {
  if (isProcessingEffectQueue) return;
  isProcessingEffectQueue = true;

  while (effectQueue.length > 0) {
    // Off-Check VOR dem Dequeue: verwirft wartende Jobs komplett,
    // ein bereits laufender Effekt wird dadurch nicht abgebrochen.
    if (effectMode === 'off') {
      console.log(`[Effekt-Modus: OFF] ${effectQueue.length} wartende Effekt(e) werden verworfen, Verarbeitung pausiert.`);
      effectQueue.length = 0;
      break;
    }

    const now = Date.now();
    const sinceLast = now - lastEffectSentAt;
    if (sinceLast < EFFECT_MIN_GAP_MS) {
      await new Promise(r => setTimeout(r, EFFECT_MIN_GAP_MS - sinceLast));
    }

    // Erneuter Check: falls während der Wartezeit auf OFF umgeschaltet wurde
    if (effectMode === 'off') {
      console.log(`[Effekt-Modus: OFF] Wartezeit vorbei, Modus wurde inzwischen auf OFF gesetzt – Warteschlange wird geleert.`);
      effectQueue.length = 0;
      break;
    }

    const job = effectQueue.shift();
    lastEffectSentAt = Date.now();

    try {
      if (effectMode === 'manual') {
        await runManualConfirmation(job);
      } else {
        await triggerEffect(job);
      }
    } catch (err) {
      console.error('Fehler beim Auslösen des Effekts:', err.message);
    }
  }

  isProcessingEffectQueue = false;
}

// ═══════════════════════════════════════════════════════════════════
// TEXTBAUSTEINE FÜR RAID-BEGRÜSSUNG (je 3 Zufallsvarianten)
// ═══════════════════════════════════════════════════════════════════

function buildBaseMessage(fromName, viewers) {
  const bigAddon = viewers > 50 ? pick([
    ` Ach du lieber Himmel! - gleich so viele nette Leute!`,
    ` Oh wow, was für eine Menge!`,
    ` Das ist ja eine ganze Völkerwanderung!`
  ]) : '';

  const variants = [
    `Willkommen, ${viewers} Raider von @${fromName}!${bigAddon}`,
    `Ein herzliches Hallo an die ${viewers} Raider von @${fromName}!${bigAddon}`,
    `@${fromName} bringt ${viewers} Leute mit${bigAddon} — willkommen euch allen!`
  ];
  return pick(variants);
}

// game = null: Spiel unbekannt. Die Varianten brauchen dann unterschiedliche Fälle
// („es gab ein unbekanntes Spiel“, „lief ein unbekanntes Spiel“, „mit einem unbekannten Spiel“).
function buildGameMessage(game, durationStr) {
  const gameNomAkk = game || 'ein unbekanntes Spiel';
  const gameDativ = game || 'einem unbekannten Spiel';
  const variants = [
    `Dort gab es zuletzt ${gameNomAkk}${durationStr}.`,
    `Zuletzt lief bei ihnen ${gameNomAkk}${durationStr}.`,
    `Gerade kommt ihr von einer Session mit ${gameDativ}${durationStr}.`
  ];
  return pick(variants);
}

function buildRankRepeatMessage(countRank, fromName, count, periodWord) {
  const variants = [
    `Platz ${countRank} der treuesten Raider geht an @${fromName}, der schon zum ${count}. Mal raidet.`,
    `@${fromName} sichert sich Platz ${countRank} der häufigsten Raider – bereits der ${count}. Raid in diesem ${periodWord}!`,
    `Rang ${countRank} bei den treuesten Raidern: @${fromName}, mittlerweile zum ${count}. Mal hier!`
  ];
  return pick(variants);
}

function buildRepeatOnlyMessage(fromName, count, periodWord) {
  const variants = [
    `@${fromName} raidet schon zum ${count}. Mal in diesem ${periodWord}!`,
    `Schon der ${count}. Raid von @${fromName} in diesem ${periodWord}!`,
    `@${fromName} ist zum ${count}. Mal dabei – danke für die Treue!`
  ];
  return pick(variants);
}

function buildViewerRankMessage(viewerRank, fromName) {
  const variants = [
    `Außerdem Platz ${viewerRank} bei den insgesamt mitgebrachten Zuschauern!`,
    `Und auch Platz ${viewerRank} bei den meisten mitgebrachten Zuschauern insgesamt!`,
    `Zusätzlich Rang ${viewerRank} in der Gesamt-Zuschauer-Wertung!`
  ];
  return pick(variants);
}

// Chat-Hinweis vor dem Whitelist-Shoutout (ADR 0015). Text vom Nutzer vorgegeben (05.11.2026);
// nennt nur das Spiel, kein Datum. Ohne bekanntes Spiel entfällt der mittlere Satz.
function buildWhitelistShoutoutMessage(name, activity) {
  const gameSentence = activity.game ? ` Dort gab es zuletzt ${activity.game}.` : '';
  return `Welch netter Besuch! Wir begrüßen @${name}!${gameSentence} Lasst gern mal nen Follow da!`;
}

function buildClosingMessage() {
  const variants = [
    `Vielen lieben Dank und hoffentlich mögt ihr Spargel!`,
    `Danke euch – und Spargel steht bei uns immer auf der Karte!`,
    `Fühlt euch willkommen, es gibt hier auch Spargel für alle!`
  ];
  return pick(variants);
}

// ═══════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// Anmeldung nur vom eigenen Rechner (ADR 0013, Nachtrag 07.11.2026): REDIRECT_URI zeigt auf localhost, die Rückkehr
// von Twitch kommt also immer lokal an. Ohne diese Prüfung könnte ein Gerät im Heimnetz einen Code für ein fremdes
// Konto an /callback schicken und tokens.json überschreiben.
function requireLocalRequest(req, res, label) {
  if (isLoopbackRequest(req) && hasLoopbackHost(req)) return true;
  logIfChanged(
    `local-only-denied:${label}:${req.socket.remoteAddress}|${req.headers.host}`,
    `[Zugriffsschutz] ${label} abgelehnt: Aufruf von ${req.socket.remoteAddress} an Host "${req.headers.host}". Nur lokale Aufrufe über localhost oder 127.0.0.1.`,
    'warn'
  );
  res.status(403).send('Nur für lokale Aufrufe über localhost oder 127.0.0.1');
  return false;
}

// Offene Logins: state -> { kind: 'broadcaster' | 'bot', createdAt }. Jeder state gilt einmal und LOGIN_STATE_TTL_MS lang.
const pendingLogins = new Map();

function createLoginState(kind) {
  const now = Date.now();
  for (const [value, entry] of pendingLogins) if (now - entry.createdAt > LOGIN_STATE_TTL_MS) pendingLogins.delete(value);
  const value = crypto.randomBytes(16).toString('hex');
  pendingLogins.set(value, { kind, createdAt: now });
  return value;
}

// Liefert 'broadcaster', 'bot' oder null (unbekannt, abgelaufen, schon benutzt) und verbraucht den state.
function takeLoginState(value) {
  if (typeof value !== 'string') return null;
  const entry = pendingLogins.get(value);
  if (!entry) return null;
  pendingLogins.delete(value);
  return Date.now() - entry.createdAt > LOGIN_STATE_TTL_MS ? null : entry.kind;
}

app.get('/login', (req, res) => {
  if (!requireLocalRequest(req, res, '/login')) return;
  const scope = SCOPES.replace(/\+/g, ' ');
  const authUrl = `https://id.twitch.tv/oauth2/authorize`
    + `?response_type=code`
    + `&client_id=${CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&scope=${encodeURIComponent(scope)}`
    + `&state=${createLoginState('broadcaster')}`;
  console.log('Leite zu Twitch Login weiter...');
  res.redirect(authUrl);
});

// Einmalige Freigabe des Bot-Kontos (ADR 0017). Nur lokal, wie /token.
app.get('/login-bot', (req, res) => {
  if (!requireLocalRequest(req, res, '/login-bot')) return;
  const authUrl = `https://id.twitch.tv/oauth2/authorize`
    + `?response_type=code`
    + `&client_id=${CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&scope=${encodeURIComponent(BOT_SCOPES)}`
    + `&force_verify=true`
    + `&state=${createLoginState('bot')}`;
  console.log('[Bot] Leite zur Twitch-Freigabe für den Bot-Account weiter (im Browser als DerBdu angemeldet sein)...');
  res.redirect(authUrl);
});

// Rückkehr von /login-bot (state schon geprüft): nur ID und Name des Bots speichern, das Bot-Token wird nicht gebraucht (App-Token reicht).
async function handleBotCallback(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send('Kein Code erhalten (Freigabe abgebrochen?)');
  try {
    const params = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
    const response = await axios.post('https://id.twitch.tv/oauth2/token', params);
    const granted = Array.isArray(response.data.scope) ? response.data.scope : String(response.data.scope || '').split(' ');
    const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
      headers: { 'Authorization': `Bearer ${response.data.access_token}`, 'Client-ID': CLIENT_ID }
    });
    const user = userResponse.data.data[0];
    const tokens = loadTokens();
    if (tokens && user.id === tokens.broadcaster_id) {
      console.warn(`[Bot] Freigabe abgelehnt: angemeldet war der Broadcaster ${user.login}, nicht der Bot`);
      return res.status(400).send(`Du warst bei Twitch als ${user.login} (Broadcaster) angemeldet. Bitte in einem privaten Browserfenster als DerBdu anmelden und /login-bot erneut aufrufen.`);
    }
    const missing = BOT_SCOPES.split(' ').filter(s => !granted.includes(s));
    if (missing.length) {
      console.warn(`[Bot] Freigabe abgelehnt: es fehlen die Rechte ${missing.join(', ')}`);
      return res.status(400).send(`Es fehlen die Rechte ${missing.join(', ')}. Bitte /login-bot erneut aufrufen und alles bestätigen.`);
    }
    saveBotConfig({ bot_id: user.id, bot_login: user.login, bot_name: user.display_name || user.login, authorized_at: new Date().toISOString() });
    botLastError = null;
    console.log(`[Bot] Bot-Account eingerichtet: ${user.display_name || user.login} (ID ${user.id}). Sendet ab jetzt: ${botFeatureLabels()}`);
    res.send(`\n\nBot-Account eingerichtet: ${user.display_name || user.login}\n\nSendet ab jetzt: ${botFeatureLabels()}\n\nWichtig: DerBdu muss Moderator in deinem Kanal sein (/mod ${user.login}).\n\nDu kannst diesen Tab jetzt schließen.`);
  } catch (err) {
    console.error('[Bot] Fehler bei der Freigabe:', err.response?.data || err.message);
    res.status(500).send(`Fehler: ${err.message}`);
  }
}

app.get('/callback', async (req, res) => {
  if (!requireLocalRequest(req, res, '/callback')) return;
  // Der state entscheidet, welcher Login zurückkehrt; ohne gültigen state wird nichts gespeichert.
  const kind = takeLoginState(req.query.state);
  if (kind === 'bot') return handleBotCallback(req, res);
  if (kind !== 'broadcaster') {
    console.warn('[Zugriffsschutz] /callback abgelehnt: unbekannter, abgelaufener oder schon benutzter Login (state) – nichts gespeichert');
    return res.status(400).send(`Anmeldung ungültig oder abgelaufen. Bitte http://localhost:${PORT}/login bzw. /login-bot erneut aufrufen.`);
  }
  const { code } = req.query;
  if (!code) return res.status(400).send('Kein Code erhalten (Anmeldung abgebrochen?)');

  try {
    console.log('Tausche Authorization Code gegen Tokens...');
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    });

    const response = await axios.post('https://id.twitch.tv/oauth2/token', params);

    const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${response.data.access_token}`,
        'Client-ID': CLIENT_ID
      }
    });

    const userData = userResponse.data.data[0];
    const broadcasterUserId = userData.id;
    const broadcasterName = userData.login || userData.display_name;

    console.log('Broadcaster ID extrahiert:', broadcasterUserId);
    console.log('Broadcaster Name:', broadcasterName);

    const tokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      broadcaster_id: broadcasterUserId,
      broadcaster_name: broadcasterName,
      obtained_at: Date.now(),
      expires_in: response.data.expires_in,
      expires_at: Date.now() + response.data.expires_in * 1000
    };

    saveTokens(tokens);
    console.log('Tokens gespeichert');
    console.log(`Token läuft ab in: ${Math.floor(response.data.expires_in / 3600)} Stunden`);

    res.send(`\n\nBroadcaster: ${broadcasterName}\n\nID: ${broadcasterUserId}\n\nToken-Gültigkeit: ${Math.floor(response.data.expires_in / 3600)} Stunden\n\nAuto-Refresh: Aktiviert\n\nDu kannst diesen Tab jetzt schließen.\n\nDer Server ist bereit und die Widgets können geladen werden.`);

    if (!eventSubWs) connectEventSub();

  } catch (err) {
    console.error('Callback Fehler:', err.response?.data || err.message);
    res.status(500).send(`Fehler: ${err.message}`);
  }
});

app.get('/token', async (req, res) => {
  // Den Access-Token nur an Aufrufer auf diesem Rechner über localhost/127.0.0.1 herausgeben.
  if (!isLoopbackRequest(req) || !hasLoopbackHost(req)) {
    logIfChanged(
      `token-denied:${req.socket.remoteAddress}|${req.headers.host}`,
      `[Zugriffsschutz] /token abgelehnt: Aufruf von ${req.socket.remoteAddress} an Host "${req.headers.host}". Erlaubt sind nur lokale Aufrufe über localhost oder 127.0.0.1.`,
      'warn'
    );
    return res.status(403).json({ error: 'Token nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  }

  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();
    // Einmal je Herkunft loggen, damit sichtbar wird, welche Origin die Widgets tatsächlich senden.
    logIfChanged(`token-origin:${req.headers.origin || '-'}`, `[Token] Ausgabe an Widget-Herkunft: ${req.headers.origin || '(keine Origin)'}`);
    res.json({
      access_token: accessToken,
      broadcaster_id: tokens.broadcaster_id,
      client_id: CLIENT_ID
    });
  } catch (err) {
    console.error('Token-Endpoint Fehler:', err.message);
    res.status(401).json({
      error: err.message,
      hint: 'Bitte login durchführen: http://localhost:3000/login'
    });
  }
});

// ── BdU-Chat: Verbindung des Enigma-Widgets (Server-Sent Events) ──
function isLocalWidgetRequest(req, label) {
  if (isLoopbackRequest(req) && hasLoopbackHost(req)) return true;
  logIfChanged(
    `bdu-denied:${label}:${req.socket.remoteAddress}|${req.headers.host}`,
    `[Zugriffsschutz] ${label} abgelehnt: Aufruf von ${req.socket.remoteAddress} an Host "${req.headers.host}". Nur lokale Aufrufe über localhost oder 127.0.0.1.`,
    'warn'
  );
  return false;
}

app.get('/api/bdu/stream', (req, res) => {
  if (!isLocalWidgetRequest(req, '/api/bdu/stream')) {
    return res.status(403).json({ error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive'
  });
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ server: 'twitch-companion-js-server', bduChat: true })}\n\n`);
  const client = { res, connectedAt: Date.now(), origin: req.headers.origin || '-' };
  client.ping = setInterval(() => res.write(': ping\n\n'), BDU_SSE_PING_MS);
  bduClients.push(client);
  console.log(`[BdU] Enigma-Widget verbunden (Herkunft: ${client.origin}, verbunden: ${bduClients.length})`);
  req.on('close', () => {
    clearInterval(client.ping);
    const i = bduClients.indexOf(client);
    if (i >= 0) bduClients.splice(i, 1);
    console.log(`[BdU] Enigma-Widget getrennt (verbunden: ${bduClients.length})`);
  });
});

// ── BdU-Chat: Antwort des Widgets ──
app.post('/api/bdu/answer', express.json({ limit: '16kb' }), async (req, res) => {
  if (!isLocalWidgetRequest(req, '/api/bdu/answer')) {
    return res.status(403).json({ error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  }
  const { id, status, text, error } = req.body || {};
  const pending = bduPending.get(id);
  if (!pending) {
    console.log(`[BdU] Antwort zu unbekannter oder abgelaufener Anfrage ${id} verworfen`);
    return res.status(404).json({ ok: false, error: 'Anfrage unbekannt oder abgelaufen' });
  }
  bduPending.delete(id);
  clearTimeout(pending.timer);

  if (status === 'ok' && typeof text === 'string' && text.trim()) {
    await sendBduChatMessage(text.trim(), pending.messageId, BDU_REPLY_PREFIX);
    console.log(`[BdU] Antwort an @${pending.userLogin} gepostet (${Math.round((Date.now() - pending.acceptedAt) / 1000)} s nach Annahme)`);
    return res.json({ ok: true });
  }
  if (status === 'quota') {
    startBduSilence(String(error || ''));
    return res.json({ ok: true, silenceUntil: bduSilenceUntil });
  }
  console.log(`[BdU] Widget meldet Fehler zur Anfrage von @${pending.userLogin}: ${error || status || 'unbekannt'} – keine Antwort im Chat`);
  res.json({ ok: true });
});

app.get('/api/twitch/prediction/current', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    const response = await axios.get(
      `https://api.twitch.tv/helix/predictions?broadcaster_id=${tokens.broadcaster_id}&first=1`,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID } }
    );

    const predictions = response.data.data;
    if (!predictions || predictions.length === 0) {
      logIfChanged('prediction', 'Keine Prediction vorhanden – Status: WAITING');
      return res.json({ status: 'WAITING' });
    }

    const prediction = predictions[0];
    if (prediction.status === 'ACTIVE' || prediction.status === 'LOCKED') {
      logIfChanged('prediction', `Prediction "${prediction.title}" - Status: ${prediction.status}`);
    }

    const outcomes = prediction.outcomes.map(outcome => ({
      id: outcome.id,
      title: outcome.title,
      channelPoints: outcome.channel_points_won || outcome.channel_points,
      users: outcome.users || 0
    }));

    res.json({
      predictionId: prediction.id,
      title: prediction.title,
      status: prediction.status,
      outcomes: outcomes,
      createdAt: prediction.created_at,
      locksAt: prediction.locks_at,
      endsAt: prediction.ends_at
    });
  } catch (err) {
    console.error('Prediction API Fehler:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch prediction', status: 'ERROR', message: err.message });
  }
});

app.get('/api/twitch/subcounter', async (req, res) => {
  try {
    let cache = loadSubGoalCache();
    if (cache.current === null) {
      cache = await refreshSubGoalCache();
    }

    logIfChanged('subcounter-endpoint', `SubCounter-Abfrage – Stand: ${cache.current}/${cache.target ?? '?'}`);

    res.json({
      current: cache.current,
      target: cache.target,
      title: cache.title,
      goalId: cache.goalId || null,
      status: cache.status || null,
      lastUpdated: cache.lastUpdated,
      apiStatus: 'OK'
    });
  } catch (err) {
    console.error('SubCounter API Fehler:', err.message);
    res.status(500).json({ error: 'Failed to fetch sub goal', apiStatus: 'ERROR', message: err.message });
  }
});

app.get('/api/homeassistant/events', (req, res) => {
  const log = loadEventLog();
  const last = log[log.length - 1] || null;

  res.json({
    lastEvent: last,
    recentEvents: log.slice(-20),
    counts: {
      follow: log.filter(e => e.type === 'follow').length,
      sub: log.filter(e => e.type === 'sub').length,
      gift: log.filter(e => e.type === 'gift').length
    },
    totalLogged: log.length
  });
});

// Modus setzen – per Stream Deck "Website öffnen"-Aktion aufrufbar:
// http://localhost:3000/api/effects/mode/auto
// http://localhost:3000/api/effects/mode/manual
// http://localhost:3000/api/effects/mode/off
app.get('/api/effects/mode/:mode', (req, res) => {
  const mode = req.params.mode.toLowerCase();
  if (!['auto', 'manual', 'off'].includes(mode)) {
    return res.status(400).json({ error: 'Ungültiger Modus. Erlaubt: auto, manual, off' });
  }
  setEffectMode(mode);
  res.json({ ok: true, mode });
});

// Aktuellen Modus + Queue-Status abfragen (z.B. für ein Status-Widget)
app.get('/api/effects/mode', (req, res) => {
  res.json({
    mode: effectMode,
    queueLength: effectQueue.length,
    pendingConfirmation: pendingManualConfirmation
      ? { type: pendingManualConfirmation.job.type, count: pendingManualConfirmation.job.count }
      : null
  });
});

// Bestätigung im Manuell-Modus – zweiter Stream-Deck-Knopf:
// http://localhost:3000/api/effects/confirm
app.get('/api/effects/confirm', (req, res) => {
  if (!pendingManualConfirmation) {
    return res.json({ ok: false, message: 'Kein Effekt wartet aktuell auf Bestätigung.' });
  }
  pendingManualConfirmation.resolve(true);
  res.json({ ok: true, message: 'Effekt bestätigt und wird ausgelöst.' });
});

// UBOAT-Crew aus dem letzten Spielstand (ADR 0016), z. B. für ein späteres Widget „Heute an Bord“
app.get('/api/uboat/crew', (req, res) => {
  if (!uboatCrew) return res.json({ enabled: false, active: false, category: currentCategory, crew: [] });
  const s = uboatCrew.getState();
  res.json({
    enabled: true,
    active: isUboatCategoryActive(),
    category: currentCategory,
    source: s.source,
    savedAt: s.savedAt ? new Date(s.savedAt).toISOString() : null,
    loadedAt: s.loadedAt ? new Date(s.loadedAt).toISOString() : null,
    gameVersion: s.gameVersion,
    crew: s.crew
  });
});

// Anmeldestand für /status und die Webkonsole (setzt vorhandene Tokens voraus)
function buildAuthStatus(tokens) {
  const expiresAt = tokens.expires_at || (tokens.obtained_at + tokens.expires_in * 1000);
  const remainingSeconds = Math.floor((expiresAt - Date.now()) / 1000);
  return {
    authenticated: true,
    broadcaster_id: tokens.broadcaster_id,
    broadcaster_name: tokens.broadcaster_name,
    token_valid: remainingSeconds > 0,
    expires_in_seconds: remainingSeconds,
    expires_in_minutes: Math.floor(remainingSeconds / 60),
    auto_refresh: true
  };
}

// Laufzeitwerte für /status und die Webkonsole
function buildRuntimeStatus() {
  return {
    eventsub_connected: eventSubWs !== null && eventSubWs.readyState === WebSocket.OPEN,
    raid_queue_length: raidQueue.length,
    whitelist_count: Object.keys(loadWhitelist()).length,
    effect_mode: effectMode,
    effect_queue_length: effectQueue.length,
    allowed_origins: corsAllowAll ? '*' : [...allowedOrigins],
    modules: { ...moduleSwitches },
    bot_configured: Boolean(loadBotConfig()),
    bot_login: loadBotConfig()?.bot_login || null,
    bot_features: BOT_FEATURES,
    bdu_widget_connected: bduClients.length > 0,
    // isBduSilenceActive() räumt eine abgelaufene Funkstille ab, sonst stünde hier die alte Uhrzeit (K9)
    bdu_silence_until: isBduSilenceActive() ? (bduSilenceUntil === Infinity ? 'bis Streamstart' : new Date(bduSilenceUntil).toISOString()) : null,
    uboat_enabled: Boolean(uboatCrew),
    uboat_active: isUboatCategoryActive(),
    uboat_save: uboatCrew ? uboatCrew.getState().source : null,
    uboat_saved_at: uboatCrew && uboatCrew.getState().savedAt ? new Date(uboatCrew.getState().savedAt).toISOString() : null,
    pid: process.pid,
    started_at: SERVER_STARTED_AT
  };
}

app.get('/status', (req, res) => {
  const tokens = loadTokens();
  if (!tokens) {
    return res.json({ authenticated: false, message: 'Keine Tokens vorhanden. Bitte login durchführen.', pid: process.pid, started_at: SERVER_STARTED_AT });
  }
  res.json({ ...buildAuthStatus(tokens), ...buildRuntimeStatus() });
});

// ═══════════════════════════════════════════════════════════════════
// WEBKONSOLE – nur am Streaming-PC (ADR 0018, docs/specs/webkonsole.md)
// ═══════════════════════════════════════════════════════════════════

// Strenger als die allgemeine Herkünfte-Liste (ADR 0013): "null" senden auch abgeschottete
// iframes fremder Seiten, und CORS_ORIGINS=* darf die Konsole nicht öffnen.
const adminOrigins = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

function requireAdminApi(req, res, next) {
  if (!requireLocalRequest(req, res, '/api/admin')) return;
  const origin = req.headers.origin;
  if (origin !== undefined && !adminOrigins.has(origin)) {
    logIfChanged(`admin-origin-blocked:${origin}`, `[Zugriffsschutz] Webkonsole: Anfrage von Herkunft "${origin}" abgelehnt (${req.method} ${req.path}).`, 'warn');
    return res.status(403).json({ error: 'Herkunft nicht erlaubt', origin });
  }
  next();
}

function requireAdminPage(req, res, next) {
  if (!requireLocalRequest(req, res, ADMIN_PAGE_PATH)) return;
  res.set('Content-Security-Policy', ADMIN_CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  next();
}

app.use('/api/admin', requireAdminApi);
app.use(ADMIN_PAGE_PATH, requireAdminPage, express.static(ADMIN_DIR, { dotfiles: 'ignore' }));

app.get(ADMIN_OVERVIEW_PATH, (req, res) => {
  const tokens = loadTokens();
  const { broadcaster_id, ...auth } = tokens ? buildAuthStatus(tokens) : { authenticated: false };
  const { allowed_origins, ...runtime } = buildRuntimeStatus();
  const { current, target, title, status, lastUpdated } = loadSubGoalCache();
  res.json({
    ...auth,
    ...runtime,
    version: APP_VERSION,
    port: Number(PORT),
    poll_ms: ADMIN_POLL_MS,
    can_restart: SERVER_SUPERVISED,
    ha_webhook_configured: Boolean(HA_WEBHOOK_URL),
    category: currentCategory,
    pending_confirmation: pendingManualConfirmation
      ? { type: pendingManualConfirmation.job.type, count: pendingManualConfirmation.job.count }
      : null,
    recent_effects: loadEventLog().slice(-ADMIN_RECENT_EFFECTS).reverse().map(e => ({
      type: e.type,
      count: e.count,
      userName: e.userName || null,
      giftCount: e.giftCount || null,
      skipped: Boolean(e.skippedManualTimeout),
      timestamp: e.timestamp
    })),
    subgoal: { current, target, title, status, lastUpdated }
  });
});

// Liefert zuerst den Puffer, danach jede neue Zeile. Die Seite erkennt Doppelte an der id.
app.get(ADMIN_LOG_STREAM_PATH, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive'
  });
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ pid: process.pid, started_at: SERVER_STARTED_AT })}\n\n`);
  logBuffer.forEach(entry => writeLogEntry(res, entry));
  const ping = setInterval(() => res.write(': ping\n\n'), ADMIN_LOG_PING_MS);
  logClients.add(res);
  req.on('close', () => {
    clearInterval(ping);
    logClients.delete(res);
  });
});

app.get(ADMIN_ERROR_LOG_PATH, (req, res) => {
  res.json({ entries: [...errorLog].reverse(), limit: ERROR_LOG_MAX_ENTRIES });
});

// Ändernde Aktionen: Browser senden bei POST immer einen Origin-Header, er ist hier Pflicht.
function requireAdminWrite(req, res, next) {
  if (!adminOrigins.has(req.headers.origin)) {
    logIfChanged(`admin-write-blocked:${req.headers.origin}`, `[Zugriffsschutz] Webkonsole: ${req.method} ${req.path} ohne eigene Herkunft abgelehnt.`, 'warn');
    return res.status(403).json({ error: 'Herkunft fehlt oder ist nicht erlaubt' });
  }
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON erwartet' });
  next();
}

// Wie an der Konsole: "@name" ist immer ein Name, reine Ziffern ohne @ sind eine ID.
function parseWhitelistInput(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const login = text.startsWith('@') ? text.slice(1) : text;
  if (text === login && TWITCH_ID_PATTERN.test(text)) return { id: text };
  return TWITCH_LOGIN_PATTERN.test(login) ? { login } : null;
}

app.get(ADMIN_WHITELIST_PATH, (req, res) => {
  const entries = Object.entries(loadWhitelist())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  res.json({ entries, count: entries.length });
});

app.post(`${ADMIN_WHITELIST_PATH}/add`, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), async (req, res) => {
  const target = parseWhitelistInput(req.body && req.body.user);
  if (!target) return res.status(400).json({ error: 'Bitte einen Twitch-Namen oder eine ID eingeben' });
  let user;
  try {
    user = target.login ? await resolveUserByLogin(target.login) : await resolveUserById(target.id);
  } catch (err) {
    console.error('[Webkonsole] Whitelist: Twitch-Abfrage fehlgeschlagen:', err.response?.data || err.message);
    return res.status(502).json({ error: 'Twitch konnte nicht gefragt werden' });
  }
  if (!user) return res.status(404).json({ error: `Kein Twitch-Konto „${target.login || target.id}“ gefunden` });
  if (Object.hasOwn(loadWhitelist(), user.id)) return res.status(409).json({ error: `@${user.login} steht schon auf der Whitelist` });
  addToWhitelist(user.id, user.login);
  res.json({ ok: true, entry: { id: user.id, name: user.login } });
});

app.post(`${ADMIN_WHITELIST_PATH}/remove`, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), (req, res) => {
  const id = req.body && req.body.id;
  if (typeof id !== 'string' || !TWITCH_ID_PATTERN.test(id)) return res.status(400).json({ error: 'Ungültige ID' });
  if (!Object.hasOwn(loadWhitelist(), id)) return res.status(404).json({ error: 'Dieser Eintrag steht nicht auf der Whitelist' });
  removeFromWhitelist(id);
  res.json({ ok: true, id });
});

let adminExitRequested = false;

function endServerFromAdmin(res, exitCode, message) {
  if (adminExitRequested) return res.status(409).json({ error: 'Der Server wird bereits beendet' });
  adminExitRequested = true;
  console.log(`[Webkonsole] ${message} (PID ${process.pid}).`);
  res.json({ ok: true, pid: process.pid, at: new Date().toISOString() });
  setTimeout(() => process.exit(exitCode), ADMIN_EXIT_DELAY_MS);
}

app.post(ADMIN_SHUTDOWN_PATH, requireAdminWrite, (req, res) => {
  endServerFromAdmin(res, 0, 'Server wird beendet');
});

app.post(ADMIN_RESTART_PATH, requireAdminWrite, (req, res) => {
  if (!SERVER_SUPERVISED) return res.status(409).json({ error: 'Neustart geht nur beim Start über AuthServer.cmd' });
  endServerFromAdmin(res, SERVER_RESTART_EXIT_CODE, 'Server wird neu gestartet');
});

// ═══════════════════════════════════════════════════════════════════
// EVENTSUB – RAID-BEGRÜSSUNG, SHOUTOUTS, FOLLOWS, SUBS & MOD-BEFEHL
// ═══════════════════════════════════════════════════════════════════

let eventSubWs = null;               // aktive EventSub-Verbindung (die, deren Ende einen Neuaufbau auslöst)
let eventSubReconnectTimer = null;   // geplanter Neuaufbau nach Verbindungsende

let lastRaidstatsCommandAt = 0;
let lastRaidGreetingSentAt = 0;

const raidQueue = [];
let isProcessingQueue = false;

const shoutedOutThisSession = new Set();

// ═══════════════════════════════════════════════════════════════════
// ENTDOPPELUNG – verhindert doppelte Effekte für dasselbe Ereignis
// ═══════════════════════════════════════════════════════════════════

const seenMessageIds = new Map();   // message_id -> Zeitstempel
const recentSubByUser = new Map();  // user_id/login -> Zeitstempel des letzten Sub-Effekts
const recentFollowByUser = new Map();

function pruneOldEntries(map, maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, ts] of map) {
    if (ts < cutoff) map.delete(key);
  }
}

// Twitch kann dieselbe Benachrichtigung erneut zustellen (z.B. rund um Reconnects).
// Jede Nachricht trägt eine eindeutige metadata.message_id.
function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  pruneOldEntries(seenMessageIds, EVENT_MESSAGE_ID_TTL_MS);
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.set(messageId, Date.now());
  return false;
}

// Liefert true, wenn für diesen Schlüssel innerhalb des Zeitfensters schon ein Effekt
// ausgelöst wurde. Ohne Schlüssel (z.B. anonym) wird nie entdoppelt.
function wasRecentlyTriggered(map, key, windowMs) {
  if (!key) return false;
  pruneOldEntries(map, windowMs);
  const last = map.get(key);
  if (last && Date.now() - last < windowMs) return true;
  map.set(key, Date.now());
  return false;
}

// Baut eine EventSub-Verbindung auf.
// - Ohne URL: frische Verbindung, nach session_welcome werden alle Subscriptions angelegt.
// - Mit reconnectUrl (aus session_reconnect): Twitch überträgt die bestehenden
//   Subscriptions selbst auf die neue Session. Die alte Verbindung bleibt aktiv, bis die
//   neue ihr session_welcome erhalten hat, und wird erst dann geschlossen. Ihr
//   close-Ereignis löst dann keinen zusätzlichen Neuaufbau aus.
function connectEventSub(reconnectUrl = null) {
  const isReconnect = Boolean(reconnectUrl);
  const ws = new WebSocket(isReconnect ? reconnectUrl : EVENTSUB_WS_URL);

  if (!isReconnect) {
    if (eventSubReconnectTimer) {
      clearTimeout(eventSubReconnectTimer);
      eventSubReconnectTimer = null;
    }
    eventSubWs = ws;
  }

  // Keepalive: Twitch schickt spätestens alle keepalive_timeout_seconds eine Nachricht
  // (Ereignis oder session_keepalive). Bleibt jede Nachricht aus, ist die Verbindung still
  // abgebrochen (ohne close). Dann wird sie hart getrennt; das close-Ereignis löst für die
  // aktive Verbindung den üblichen Neuaufbau aus.
  let keepaliveTimer = null;
  let keepaliveTimeoutMs = null;   // erst nach session_welcome bekannt
  function armKeepalive() {
    if (keepaliveTimeoutMs === null) return;
    clearTimeout(keepaliveTimer);
    keepaliveTimer = setTimeout(() => {
      const seconds = Math.round(keepaliveTimeoutMs / 1000);
      if (ws === eventSubWs) {
        console.warn(`EventSub: seit ${seconds} s keine Nachricht (weder Ereignis noch Keepalive) – Verbindung gilt als abgebrochen und wird neu aufgebaut`);
      } else {
        console.warn(`EventSub: nicht aktive Verbindung seit ${seconds} s ohne Nachricht – wird geschlossen`);
      }
      ws.terminate();
    }, keepaliveTimeoutMs);
  }

  ws.on('message', async (data) => {
    const msg = JSON.parse(data);
    const msgType = msg.metadata.message_type;

    if (msgType === 'session_welcome') {
      const keepaliveSeconds = msg.payload.session.keepalive_timeout_seconds || EVENTSUB_KEEPALIVE_DEFAULT_S;
      keepaliveTimeoutMs = keepaliveSeconds * 1000 + EVENTSUB_KEEPALIVE_GRACE_MS;
    }
    armKeepalive();   // jede Nachricht zählt als Lebenszeichen

    if (msgType === 'session_welcome') {
      const sessionId = msg.payload.session.id;

      if (isReconnect) {
        const oldWs = eventSubWs;
        eventSubWs = ws;
        console.log('EventSub-Reconnect abgeschlossen, Session:', sessionId, '– Subscriptions von Twitch übernommen');
        if (oldWs && oldWs !== ws) oldWs.close();
        return;
      }

      console.log('EventSub WebSocket verbunden, Session:', sessionId);
      await subscribeToRaid(sessionId);
      await subscribeToChat(sessionId);
      await subscribeToStreamOnline(sessionId);
      await subscribeToSubscriptions(sessionId);
      await subscribeToChatNotifications(sessionId);
      await subscribeToFollows(sessionId);
      await subscribeToChannelUpdate(sessionId);
      await refreshChannelCategory();
    }

    if (msgType === 'notification') {
      const subType = msg.metadata.subscription_type;

      if (isDuplicateMessage(msg.metadata.message_id)) {
        console.log(`Doppelt zugestellte EventSub-Nachricht ignoriert (${subType}, ID: ${msg.metadata.message_id})`);
        return;
      }

      if (subType === 'channel.raid') {
        enqueueRaidEvent(msg.payload.event);
      }

      if (subType === 'channel.chat.message') {
        await handleChatCommand(msg.payload.event);
        handleBduCommand(msg.payload.event);
        await handleUboatCommand(msg.payload.event);
        await handleWhitelistShoutout(msg.payload.event);
      }

      if (subType === 'channel.update') {
        setCurrentCategory(msg.payload.event.category_name || null, 'channel.update');
      }

      if (subType === 'stream.online') {
        shoutedOutThisSession.clear();
        console.log('Stream gestartet – Whitelist-Shoutout-Tracking für diese Session zurückgesetzt');
        if (bduSilenceUntil === Infinity) {
          bduSilenceUntil = 0;
          console.log('[BdU] Stream gestartet – Funkstille (Tageskontingent) aufgehoben');
        }
        await refreshSubGoalCache();
      }

      if (subType === 'channel.follow') {
        const evt = msg.payload.event;
        console.log(`Neuer Follow: @${evt.user_login}`);
        if (wasRecentlyTriggered(recentFollowByUser, evt.user_id, FOLLOW_DEDUPE_WINDOW_MS)) {
          console.log(`Follow-Effekt für @${evt.user_login} übersprungen – innerhalb von ${FOLLOW_DEDUPE_WINDOW_MS / 1000}s bereits ausgelöst`);
        } else {
          scheduleEffect('follow', { userName: evt.user_login, userId: evt.user_id });
        }
      }

      if (subType === 'channel.chat.notification') {
        handleChatNotification(msg.payload.event);
      }

      if (
        subType === 'channel.subscribe' ||
        subType === 'channel.subscription.gift' ||
        subType === 'channel.subscription.message'
      ) {
        const evt = msg.payload.event;
        console.log(`Sub-Event (${subType}): ${evt.user_name || evt.user_login || 'anonym'}`);
        await refreshSubGoalCache();

        // Diese Events treffen oft Sekunden VOR der Chat-Ankündigung ein. Sie aktualisieren
        // daher nur noch den Sub-Goal-Cache; die Effekte werden erst durch die
        // Chat-Ankündigung (channel.chat.notification, siehe handleChatNotification) ausgelöst.
      }
    }

    if (msgType === 'session_reconnect') {
      const newUrl = msg.payload.session.reconnect_url;
      console.log('EventSub Reconnect angefordert – verbinde mit neuer URL, alte Verbindung bleibt bis zum Welcome offen...');
      connectEventSub(newUrl);
    }
  });

  ws.on('close', () => {
    clearTimeout(keepaliveTimer);
    // Nur das Ende der aktiven Verbindung löst einen Neuaufbau aus. Alte Verbindungen
    // nach einem Reconnect oder ein gescheiterter Reconnect-Versuch werden ignoriert;
    // im letzteren Fall bleibt die bisherige Verbindung aktiv.
    if (ws !== eventSubWs) {
      console.log('Vorherige EventSub-Verbindung geschlossen (kein Neuaufbau nötig)');
      return;
    }
    eventSubWs = null;
    if (eventSubReconnectTimer) return;
    console.log(`EventSub WebSocket geschlossen, reconnect in ${EVENTSUB_RECONNECT_DELAY_MS / 1000}s...`);
    eventSubReconnectTimer = setTimeout(() => {
      eventSubReconnectTimer = null;
      if (!eventSubWs) connectEventSub();
    }, EVENTSUB_RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error('EventSub WS Fehler:', err.message);
  });
}

async function subscribeToRaid(sessionId) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      {
        type: 'channel.raid',
        version: '1',
        condition: { to_broadcaster_user_id: tokens.broadcaster_id },
        transport: { method: 'websocket', session_id: sessionId }
      },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } }
    );
    console.log('Raid-Subscription aktiv');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.raid:', err.response?.data || err.message);
  }
}

async function subscribeToChat(sessionId) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      {
        type: 'channel.chat.message',
        version: '1',
        condition: {
          broadcaster_user_id: tokens.broadcaster_id,
          user_id: tokens.broadcaster_id
        },
        transport: { method: 'websocket', session_id: sessionId }
      },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } }
    );
    console.log('Chat-Message-Subscription aktiv (für Mod-Befehle & Whitelist)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.chat.message:', err.response?.data || err.message);
  }
}

async function subscribeToStreamOnline(sessionId) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      {
        type: 'stream.online',
        version: '1',
        condition: { broadcaster_user_id: tokens.broadcaster_id },
        transport: { method: 'websocket', session_id: sessionId }
      },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } }
    );
    console.log('Stream-Online-Subscription aktiv (für Whitelist-Reset & Sub-Goal-Refresh)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von stream.online:', err.response?.data || err.message);
  }
}

async function subscribeToSubscriptions(sessionId) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();
    const headers = { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' };
    const condition = { broadcaster_user_id: tokens.broadcaster_id };

    const subTypes = ['channel.subscribe', 'channel.subscription.gift', 'channel.subscription.message'];
    for (const type of subTypes) {
      await axios.post(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        {
          type,
          version: '1',
          condition,
          transport: { method: 'websocket', session_id: sessionId }
        },
        { headers }
      );
      console.log(`${type}-Subscription aktiv`);
    }
  } catch (err) {
    console.error('Fehler beim Abonnieren der Sub-Events:', err.response?.data || err.message);
  }
}

async function subscribeToChatNotifications(sessionId) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      {
        type: 'channel.chat.notification',
        version: '1',
        condition: {
          broadcaster_user_id: tokens.broadcaster_id,
          user_id: tokens.broadcaster_id
        },
        transport: { method: 'websocket', session_id: sessionId }
      },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } }
    );
    console.log('Chat-Notification-Subscription aktiv (löst Sub-/Gift-Effekte aus, sobald die Meldung im Chat erscheint)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.chat.notification (ohne diese Subscription gibt es KEINE Sub-/Gift-Effekte!):', err.response?.data || err.message);
  }
}

// Wertet Chat-Ankündigungen aus und speist die Effekte ein – exakt dann, wenn
// Twitch die Meldung im Chat anzeigt. Effekt-Typen und Metadaten bleiben
// identisch zu früher ('sub' mit userName, 'gift' mit userName/giftCount),
// damit die Home-Assistant-Webhooks unverändert ankommen.
function handleChatNotification(evt) {
  const noticeType = evt.notice_type;

  // Shared Chat: Ankündigungen aus anderen Kanälen nicht als eigene Subs werten
  if (evt.source_broadcaster_user_id && evt.source_broadcaster_user_id !== evt.broadcaster_user_id) return;

  const userName = evt.chatter_is_anonymous ? 'anonym' : (evt.chatter_user_login || evt.chatter_user_name);

  if (noticeType === 'sub' || noticeType === 'resub') {
    // Gifted Sub/Resub: der Effekt kommt über die Gift-Ankündigung des Schenkenden
    if ((evt.sub && evt.sub.is_gift) || (evt.resub && evt.resub.is_gift)) {
      console.log(`Chat-Ankündigung (${noticeType}) für @${userName} übersprungen – Gift-Empfänger`);
      return;
    }
    if (wasRecentlyTriggered(recentSubByUser, evt.chatter_user_id || userName, SUB_DEDUPE_WINDOW_MS)) {
      console.log(`Sub-Effekt für @${userName} übersprungen – innerhalb von ${SUB_DEDUPE_WINDOW_MS / 1000}s bereits ausgelöst`);
      return;
    }
    console.log(`Chat-Ankündigung (${noticeType}): @${userName}`);
    scheduleEffect('sub', { userName });
    return;
  }

  // Gift-Bomb: EINE Kopfzeile pro Verschenk-Vorgang -> genau ein Gift-Effekt
  if (noticeType === 'community_sub_gift') {
    const total = (evt.community_sub_gift && evt.community_sub_gift.total) || 1;
    console.log(`Chat-Ankündigung (Gift-Bomb): @${userName} verschenkt ${total} Sub(s)`);
    scheduleEffect('gift', { userName, giftCount: total });
    return;
  }

  // Einzelne Gift-Meldungen: gehören sie zu einem Gift-Bomb (community_gift_id gesetzt),
  // werden sie ignoriert; echte Einzel-Gifts lösen selbst einen Gift-Effekt aus.
  if (noticeType === 'sub_gift') {
    if (evt.sub_gift && evt.sub_gift.community_gift_id) return;
    console.log(`Chat-Ankündigung (Einzel-Gift): @${userName}`);
    scheduleEffect('gift', { userName, giftCount: 1 });
    return;
  }
}

async function subscribeToFollows(sessionId) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      {
        type: 'channel.follow',
        version: '2',
        condition: {
          broadcaster_user_id: tokens.broadcaster_id,
          moderator_user_id: tokens.broadcaster_id
        },
        transport: { method: 'websocket', session_id: sessionId }
      },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } }
    );
    console.log('Follow-Subscription aktiv');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.follow:', err.response?.data || err.message);
  }
}

function isModOrBroadcaster(evt) {
  const badges = evt.badges || [];
  return badges.some(b => b.set_id === 'moderator' || b.set_id === 'broadcaster');
}

// Postet eine Chat-Nachricht; mit replyToMessageId als Antwort auf diese Chat-Nachricht. Über CHAT_MAX_CHARS wird gekürzt.
// feature in BOT_FEATURES und Bot eingerichtet: über den Bot (App-Token, ADR 0017), bei HTTP-Fehler Rückfall auf den Broadcaster.
// Sonst als Broadcaster. Fehler werden geloggt; Rückgabe true, wenn Twitch die Nachricht angenommen hat.
// options.broadcasterPrefix: nur beim Versand als Broadcaster vor den Text setzen (Absenderangabe, z. B. "FT vom BdU: ").
async function sendChatMessage(text, replyToMessageId = null, feature = null, options = {}) {
  const cut = t => (t.length > CHAT_MAX_CHARS ? t.slice(0, CHAT_MAX_CHARS - 1) + '…' : t);
  const logPrefix = feature === 'bdu' ? '[BdU] ' : feature === 'uboat' ? '[UBOAT] ' : '';
  const bot = feature && BOT_FEATURES.includes(feature) ? loadBotConfig() : null;
  if (bot) {
    const result = await sendChatMessageAsBot(bot, cut(text), replyToMessageId, logPrefix);
    if (result !== 'fallback') return result;
  }
  const message = cut((options.broadcasterPrefix || '') + text);
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();
    const body = { broadcaster_id: tokens.broadcaster_id, sender_id: tokens.broadcaster_id, message };
    if (replyToMessageId) body.reply_parent_message_id = replyToMessageId;
    const response = await axios.post('https://api.twitch.tv/helix/chat/messages', body,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } });
    return checkChatSendResult(response, message, logPrefix);
  } catch (err) {
    console.error(`${logPrefix}Fehler beim Senden in den Chat:`, err.response?.data || err.message, '– Text:', message);
    return false;
  }
}

function checkChatSendResult(response, message, logPrefix) {
  const result = response?.data?.data?.[0];
  if (result && result.is_sent === false) {
    console.warn(`${logPrefix}Twitch hat die Nachricht nicht gesendet (${result.drop_reason?.message || 'ohne Grund'}): ${message}`);
    return false;
  }
  return true;
}

// Ergebnis: true/false (Twitch hat geantwortet; bei is_sent:false kein Rückfall, damit der Broadcaster keine Filter umgeht)
// oder 'fallback' (HTTP-Fehler, Broadcaster soll senden).
async function sendChatMessageAsBot(bot, message, replyToMessageId, logPrefix) {
  const tokens = loadTokens();
  if (!tokens) return 'fallback';
  const body = { broadcaster_id: tokens.broadcaster_id, sender_id: bot.bot_id, message };
  if (replyToMessageId) body.reply_parent_message_id = replyToMessageId;
  const post = async token => axios.post('https://api.twitch.tv/helix/chat/messages', body,
    { headers: { 'Authorization': `Bearer ${token}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } });
  try {
    let response;
    try {
      response = await post(await getAppAccessToken());
    } catch (err) {
      if (err.response?.status !== 401) throw err;
      response = await post(await getAppAccessToken(true));   // App-Token abgelaufen oder widerrufen: einmal neu
    }
    return checkChatSendResult(response, message, logPrefix);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.message || err.message;
    const hint = status === 403 ? ' – Ist DerBdu Moderator (/mod DerBdu) und ist die Freigabe noch gültig (/login-bot)?' : '';
    botLastError = { at: Date.now(), text: `${status || 'kein HTTP-Status'}: ${detail}` };
    console.warn(`${logPrefix}Senden über den Bot ${bot.bot_login} fehlgeschlagen (${status || '-'}: ${detail})${hint} – sende als Broadcaster`);
    return 'fallback';
  }
}

async function sendShoutout(toBroadcasterId, toBroadcasterName) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/chat/shoutouts',
      null,
      {
        params: {
          from_broadcaster_id: tokens.broadcaster_id,
          to_broadcaster_id: toBroadcasterId,
          moderator_id: tokens.broadcaster_id
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Client-ID': CLIENT_ID
        }
      }
    );
    console.log(`Shoutout erfolgreich gesendet für @${toBroadcasterName}`);
    return true;
  } catch (e) {
    // Erwartbare Ablehnungen durch Twitch als kurze Hinweise statt als Fehler ausgeben
    const status = e.response?.status;
    if (status === 400 && /not streaming live/i.test(e.response?.data?.message || '')) {
      console.warn(`Shoutout für @${toBroadcasterName} nicht möglich – Kanal ist noch nicht live`);
    } else if (status === 429) {
      console.warn(`Shoutout für @${toBroadcasterName} nicht möglich – Twitch-Wartezeit läuft (2 min zwischen Shoutouts, 60 min je Streamer)`);
    } else {
      console.error(`Fehler beim Senden des Shoutouts für @${toBroadcasterName}:`, e.response?.data || e.message);
    }
    return false;
  }
}

async function handleChatCommand(evt) {
  const text = (evt.message?.text || '').trim().toLowerCase();
  if (text !== '!raidstats') return;

  console.log(`!raidstats-Befehl erkannt von: ${evt.chatter_user_login} (Mod/Broadcaster: ${isModOrBroadcaster(evt)})`);

  if (!isModOrBroadcaster(evt)) {
    console.log('!raidstats ignoriert – Nutzer ist kein Mod/Broadcaster');
    return;
  }

  const now = Date.now();
  const sinceLast = now - lastRaidstatsCommandAt;
  if (sinceLast < RAIDSTATS_COOLDOWN_MS) {
    const remaining = Math.ceil((RAIDSTATS_COOLDOWN_MS - sinceLast) / 1000);
    console.log(`!raidstats im Cooldown – noch ${remaining}s zu warten, Befehl ignoriert`);
    return;
  }

  lastRaidstatsCommandAt = now;

  // Als Broadcaster (kein feature); Fehler meldet sendChatMessage selbst
  if (await sendChatMessage(getLeaderboardText())) console.log('Leaderboard auf !raidstats-Befehl gesendet');
}

// ═══════════════════════════════════════════════════════════════════
// BDU-CHAT – Funksprüche aus dem Chat an das Enigma-Widget (ADR 0014)
// Der Server erkennt "!BdU …", prüft Limits und Funkstille und postet die
// Antwort. Die Antwort selbst erzeugt das Widget mit seiner KI und seinem Kontext.
// ═══════════════════════════════════════════════════════════════════

const bduClients = [];                  // offene Events-Verbindungen der Widgets (zuletzt verbundenes erhält Anfragen)
const bduPending = new Map();           // id -> { messageId, userLogin, acceptedAt, timer }
const bduAcceptedByUser = new Map();    // user_id -> [Zeitpunkte angenommener Anfragen]
let bduLastAcceptedAt = 0;
let bduLastWarningAt = 0;
let bduSilenceUntil = 0;                // 0 = keine Funkstille, Infinity = bis Streamstart
let bduSilenceEndedAt = 0;              // Ende der letzten Funkstille (für Verlängerung ohne neue Ansage)
let bduDailyKey = '';
let bduDailyCount = 0;
let bduRequestCounter = 0;

function isBduSilenceActive(now = Date.now()) {
  if (!bduSilenceUntil) return false;
  if (now < bduSilenceUntil) return true;
  bduSilenceEndedAt = bduSilenceUntil;
  bduSilenceUntil = 0;
  console.log('[BdU] Funkstille beendet – Chat-Anfragen werden wieder angenommen');
  return false;
}

function bduDailyLimitReached(now = Date.now()) {
  if (!BDU_DAILY_LIMIT) return false;
  const key = new Date(now).toDateString();
  if (key !== bduDailyKey) { bduDailyKey = key; bduDailyCount = 0; }
  return bduDailyCount >= BDU_DAILY_LIMIT;
}

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Postet eine BdU-Nachricht (über den Bot, wenn eingerichtet; ADR 0017), optional als Antwort auf eine Chat-Nachricht.
// broadcasterPrefix (z. B. "FT vom BdU: ") steht nur davor, wenn der Broadcaster sendet; DerBdu braucht keine Absenderangabe.
async function sendBduChatMessage(text, replyToMessageId, broadcasterPrefix = '') {
  return sendChatMessage(text, replyToMessageId || null, 'bdu', { broadcasterPrefix });
}

// Funkstille nach erschöpftem KI-Kontingent. Betrifft nur den Chat.
function startBduSilence(errorText) {
  const now = Date.now();
  const daily = /per ?day|perday|daily|täglich/i.test(errorText);
  const until = daily ? Infinity : now + BDU_SILENCE_MS;
  const wasActive = isBduSilenceActive(now);
  // Direkt nach einer abgelaufenen Funkstille erneut ausgelöst: still verlängern, keine zweite Ansage
  const extendQuietly = wasActive || (bduSilenceEndedAt && now - bduSilenceEndedAt < BDU_SILENCE_MS);
  bduSilenceUntil = Math.max(bduSilenceUntil || 0, until);
  // Offene Anfragen verfallen
  for (const [id, p] of bduPending) { clearTimeout(p.timer); bduPending.delete(id); }
  console.log(`[BdU] KI-Kontingent erschöpft (${daily ? 'Tageslimit' : 'Minutenlimit'}) – Funkstille ${daily ? 'bis zum nächsten Streamstart' : 'bis ' + formatClock(bduSilenceUntil)}. Meldung: ${errorText || '-'}`);
  if (extendQuietly) {
    console.log('[BdU] Funkstille verlängert, keine erneute Ansage im Chat');
    return;
  }
  const text = daily
    ? 'BdU befiehlt Funkstille bis auf Weiteres – Meldungen werden nicht beantwortet.'
    : `BdU befiehlt Funkstille bis ${formatClock(bduSilenceUntil)} Uhr – Meldungen werden nicht beantwortet.`;
  sendBduChatMessage(text);
}

// Erkennt "!BdU <Text>" und reicht angenommene Anfragen an das Enigma-Widget weiter.
// Limits gelten für alle Nutzer, ausdrücklich ohne Ausnahme für Mods und Broadcaster (ADR 0014).
function handleBduCommand(evt) {
  const raw = (evt.message?.text || '').trim();
  const lower = raw.toLowerCase();
  if (!(lower === BDU_COMMAND || lower.startsWith(BDU_COMMAND + ' '))) return;

  // Shared Chat: Nachrichten aus fremden Kanälen ignorieren
  if (evt.source_broadcaster_user_id && evt.source_broadcaster_user_id !== evt.broadcaster_user_id) return;

  const text = raw.slice(BDU_COMMAND.length).trim().slice(0, BDU_MAX_INPUT_CHARS);
  if (!text) return;

  const login = evt.chatter_user_login || evt.chatter_user_name || 'unbekannt';
  const now = Date.now();

  // 0. Modul per Konsole deaktiviert: still ignorieren, nichts zählen
  if (!moduleSwitches.bdu) {
    console.log(`[BdU] !BdU von @${login} ignoriert – BdU-Chat deaktiviert`);
    return;
  }
  // 1. Kein Widget verbunden: still ignorieren, nichts zählen
  if (bduClients.length === 0) {
    console.log(`[BdU] !BdU von @${login} ignoriert – kein Enigma-Widget verbunden`);
    return;
  }
  // 2. Funkstille
  if (isBduSilenceActive(now)) {
    console.log(`[BdU] !BdU von @${login} ignoriert – Funkstille`);
    return;
  }
  // 3. Tagesobergrenze
  if (bduDailyLimitReached(now)) {
    console.log(`[BdU] !BdU von @${login} ignoriert – Tagesobergrenze (${BDU_DAILY_LIMIT}) erreicht`);
    return;
  }
  // 4./5. Globales Limit und Nutzerlimit
  const userKey = evt.chatter_user_id || login;
  // Abgelaufene Zeitpunkte aller Nutzer entfernen und leere Einträge löschen, sonst wächst die Liste mit jedem Zuschauer
  for (const [key, times] of bduAcceptedByUser) {
    const kept = times.filter(t => now - t < BDU_USER_WINDOW_MS);
    if (kept.length) bduAcceptedByUser.set(key, kept); else bduAcceptedByUser.delete(key);
  }
  const recent = bduAcceptedByUser.get(userKey) || [];
  const globalBlocked = now - bduLastAcceptedAt < BDU_GLOBAL_COOLDOWN_MS;
  const userBlocked = recent.length >= BDU_USER_MAX;
  if (globalBlocked || userBlocked) {
    const reason = globalBlocked
      ? `globales Limit (noch ${Math.ceil((BDU_GLOBAL_COOLDOWN_MS - (now - bduLastAcceptedAt)) / 1000)} s)`
      : `Nutzerlimit (${BDU_USER_MAX} in ${BDU_USER_WINDOW_MS / 60000} min)`;
    if (now - bduLastWarningAt >= BDU_WARNING_COOLDOWN_MS) {
      bduLastWarningAt = now;
      console.log(`[BdU] !BdU von @${login} abgelehnt – ${reason}, Warnung gepostet`);
      sendBduChatMessage(BDU_WARNING_TEXT, evt.message_id);
    } else {
      console.log(`[BdU] !BdU von @${login} abgelehnt – ${reason}, keine Warnung (letzte vor ${Math.round((now - bduLastWarningAt) / 1000)} s)`);
    }
    return;
  }

  // 6. Annehmen: zählt sofort, auch wenn die KI später scheitert
  bduLastAcceptedAt = now;
  recent.push(now);
  bduAcceptedByUser.set(userKey, recent);
  bduDailyCount++;
  const id = `bdu-${now}-${++bduRequestCounter}`;
  const timer = setTimeout(() => {
    if (bduPending.delete(id)) console.log(`[BdU] Keine Antwort des Widgets binnen ${BDU_ANSWER_TIMEOUT_MS / 1000} s – Anfrage von @${login} verworfen`);
  }, BDU_ANSWER_TIMEOUT_MS);
  bduPending.set(id, { messageId: evt.message_id, userLogin: login, acceptedAt: now, timer });
  const client = bduClients[bduClients.length - 1];
  client.res.write(`event: request\ndata: ${JSON.stringify({ id, text })}\n\n`);
  console.log(`[BdU] !BdU von @${login} angenommen (${id}, heute ${bduDailyCount}${BDU_DAILY_LIMIT ? '/' + BDU_DAILY_LIMIT : ''}): ${text}`);
}

function printBduStatus() {
  const now = Date.now();
  const silence = isBduSilenceActive(now)
    ? (bduSilenceUntil === Infinity ? 'bis Streamstart' : `bis ${formatClock(bduSilenceUntil)}`)
    : 'nein';
  const nextFree = Math.max(0, Math.ceil((BDU_GLOBAL_COOLDOWN_MS - (now - bduLastAcceptedAt)) / 1000));
  bduDailyLimitReached(now);
  console.log(`[BdU] Modul: ${moduleStateLabel('bdu')}`);
  console.log(`[BdU] Widget verbunden: ${bduClients.length > 0 ? 'ja (' + bduClients.length + ')' : 'nein'} | Funkstille: ${silence} | offene Anfragen: ${bduPending.size} | heute angenommen: ${bduDailyCount}${BDU_DAILY_LIMIT ? '/' + BDU_DAILY_LIMIT : ''} | nächste Annahme frühestens in ${nextFree} s`);
}

async function handleWhitelistShoutout(evt) {
  const chatterId = evt.chatter_user_id;
  const chatterName = evt.chatter_user_login;

  const whitelist = loadWhitelist();
  if (!whitelist[chatterId]) return;
  if (shoutedOutThisSession.has(chatterId)) return;

  // Je Session nur einmal prüfen bzw. shouten, auch wenn die Prüfung negativ ausfällt
  shoutedOutThisSession.add(chatterId);

  let activity;
  let checkError = null;
  try {
    activity = await getChannelActivity(chatterId);
  } catch (err) {
    checkError = err.response?.data?.message || err.message;
    console.error(`Aktivitätsprüfung für @${chatterName} fehlgeschlagen:`, err.response?.data || err.message);
    activity = { active: null, lastActiveAt: null, lastLiveAt: null, source: null, game: null };
  }
  const record = (result, shoutout) => recordWhitelistCheck({
    userId: chatterId, userName: chatterName, result, shoutout,
    lastActiveAt: activity.lastActiveAt, lastLiveAt: activity.lastLiveAt, game: activity.game,
    ...(checkError ? { error: checkError } : {})
  });

  // Selbst live und gleichzeitig hier im Chat: kein Hinweis, kein Shoutout, aber festhalten (Nutzer, 05.11.2026)
  if (activity.source === 'live') {
    console.log(`Kein Shoutout für gelisteten Streamer @${chatterName} – ist gerade selbst live${activity.game ? ` (${activity.game})` : ''} und chattet hier; im Prüfprotokoll vermerkt`);
    record('live', false);
    return;
  }
  if (activity.active === false) {
    console.log(`Kein Shoutout für gelisteten Streamer @${chatterName} – in den letzten ${SHOUTOUT_ACTIVITY_WINDOW_DAYS} Tagen nicht aktiv (zuletzt aktiv am ${formatDateDe(activity.lastActiveAt)}); im Prüfprotokoll vermerkt`);
    record('inaktiv', false);
    return;
  }
  if (activity.active === null) {
    // Unklar: API-Fehler oder kein Video gefunden (VODs deaktiviert/abgelaufen, keine Highlights)
    if (SHOUTOUT_ACTIVITY_STRICT) {
      console.log(`Kein Shoutout für gelisteten Streamer @${chatterName} – Aktivität nicht feststellbar; im Prüfprotokoll vermerkt`);
      record('unklar', false);
      return;
    }
    console.log(`Aktivität von @${chatterName} nicht feststellbar – Shoutout trotzdem (Testphase, SHOUTOUT_ACTIVITY_STRICT = false); im Prüfprotokoll vermerkt`);
    record('unklar', true);
  } else {
    console.log(`Erstnachricht von gelistetem Streamer @${chatterName} (ID: ${chatterId}) erkannt (zuletzt aktiv am ${formatDateDe(activity.lastActiveAt)}) – sende Hinweis und Shoutout`);
  }

  // Wie beim Raid: erst die Chat-Nachricht (mit Spiel, soweit bekannt), dann der Shoutout
  await sendChatMessage(buildWhitelistShoutoutMessage(chatterName, activity));
  setTimeout(() => sendShoutout(chatterId, chatterName), WHITELIST_SHOUTOUT_DELAY_MS);
}

function formatDateDe(iso) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Prüft, ob ein Kanal in den letzten SHOUTOUT_ACTIVITY_WINDOW_DAYS Tagen aktiv war (ADR 0015).
// Aktiv heißt: gerade live (/helix/streams) oder das neueste Video jeder Art (/helix/videos,
// type=all: vergangene Übertragung, Highlight, Upload) ist jünger als das Zeitfenster.
// Liefert { active: true | false | null (unklar, kein Video), lastActiveAt, lastLiveAt, source, game }.
// lastLiveAt: Beginn der letzten gespeicherten Übertragung (nur aus type=archive, für den Chat-Text).
// game: aktuelle Kategorie des Kanals (/helix/channels), bei Offline-Kanälen meist das zuletzt gestreamte Spiel.
// Wirft bei einem API-Fehler.
async function getChannelActivity(userId) {
  const accessToken = await getValidAccessToken();
  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID };
  const id = encodeURIComponent(userId);
  const [streamRes, videoRes, channelRes] = await Promise.all([
    axios.get(`https://api.twitch.tv/helix/streams?user_id=${id}`, { headers }),
    axios.get(`https://api.twitch.tv/helix/videos?user_id=${id}&type=all&sort=time&first=20`, { headers }),
    axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${id}`, { headers })
  ]);

  const channelGame = channelRes.data.data?.[0]?.game_name || null;
  const stream = streamRes.data.data?.[0];
  if (stream) {
    return { active: true, lastActiveAt: stream.started_at, lastLiveAt: stream.started_at, source: 'live', game: stream.game_name || channelGame };
  }

  const videos = videoRes.data.data || [];
  const newest = videos[0];
  const lastArchive = videos.find(v => v.type === 'archive');
  const lastLiveAt = lastArchive ? lastArchive.created_at : null;
  if (!newest) return { active: null, lastActiveAt: null, lastLiveAt: null, source: null, game: channelGame };

  const ageDays = (Date.now() - new Date(newest.created_at).getTime()) / (24 * 60 * 60 * 1000);
  return { active: ageDays <= SHOUTOUT_ACTIVITY_WINDOW_DAYS, lastActiveAt: newest.created_at, lastLiveAt, source: newest.type, game: channelGame };
}

function enqueueRaidEvent(evt) {
  console.log(`Raid-Event von @${evt.from_broadcaster_user_login} in Warteschlange eingereiht (Queue-Länge jetzt: ${raidQueue.length + 1})`);
  raidQueue.push(evt);
  processRaidQueue();
}

async function processRaidQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (raidQueue.length > 0) {
    const now = Date.now();
    const sinceLast = now - lastRaidGreetingSentAt;

    if (sinceLast < RAID_GREETING_MIN_GAP_MS) {
      const waitMs = RAID_GREETING_MIN_GAP_MS - sinceLast;
      console.log(`Warte ${Math.ceil(waitMs / 1000)}s vor nächster Raid-Begrüßung (Mindestabstand ${RAID_GREETING_MIN_GAP_MS / 1000}s)...`);
      await new Promise(r => setTimeout(r, waitMs));
    }

    const evt = raidQueue.shift();
    lastRaidGreetingSentAt = Date.now();

    try {
      await handleRaidEvent(evt);
    } catch (err) {
      console.error('Unerwarteter Fehler bei Raid-Verarbeitung aus der Queue:', err.message);
    }
  }

  isProcessingQueue = false;
}

async function handleRaidEvent(evt) {
  const fromId = evt.from_broadcaster_user_id;
  const fromName = evt.from_broadcaster_user_login;
  const viewers = evt.viewers;

  console.log('');
  console.log('=== RAID-EVENT WIRD VERARBEITET ===');
  console.log(' Von:', fromName, `(ID: ${fromId})`);
  console.log(' Mitgebrachte Viewer:', viewers);
  console.log(' Ziel-Broadcaster-ID:', evt.to_broadcaster_user_id);
  console.log(' Whitelist-ID zum Kopieren:', fromId);
  console.log(' Whitelist-Konsolenbefehl:', `whitelist add ${fromId} ${fromName}`);
  console.log(' Rohes Event-Objekt:', JSON.stringify(evt, null, 2));

  let headers;
  try {
    const accessToken = await getValidAccessToken();
    headers = { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID };
  } catch (err) {
    console.error('Konnte Access-Token für Raid-Verarbeitung nicht laden:', err.message);
    return;
  }

  let game = null;   // null = unbekannt, Text dafür in buildGameMessage
  let durationStr = '';
  let startedAt = null;

  try {
    const [chanRes, streamRes] = await Promise.all([
      axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${fromId}`, { headers }),
      axios.get(`https://api.twitch.tv/helix/streams?user_id=${fromId}`, { headers })
    ]);

    game = chanRes.data.data[0]?.game_name || null;
    startedAt = streamRes.data.data[0]?.started_at || null;

    if (startedAt) {
      const ms = Date.now() - new Date(startedAt).getTime();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      durationStr = h > 0 ? ` (${h}h ${m}min)` : ` (${m} Minuten)`;
    } else {
      console.warn(`Kein aktiver Stream-Datensatz für ${fromName} gefunden (evtl. bereits offline) – Streamdauer nicht verfügbar`);
    }

    console.log(' Ermitteltes Spiel:', game || 'unbekannt');
    console.log(' Stream gestartet um:', startedAt || 'unbekannt');
    console.log(' Berechnete Dauer:', durationStr || 'n/a');
  } catch (e) {
    console.error('Fehler beim Abrufen von Kanal-/Stream-Infos für Raid:', e.response?.data || e.message);
  }

  let pKey, data, countRank, viewerRank;
  try {
    const tracked = trackRaid(fromId, fromName, viewers);
    pKey = tracked.pKey;
    data = tracked.data;

    const ranks = getRanks(pKey, fromId);
    countRank = ranks.countRank;
    viewerRank = ranks.viewerRank;

    console.log(' Zeitraum-Key:', pKey);
    console.log(' Bisherige Raid-Anzahl in diesem Zeitraum:', data.count);
    console.log(' Bisherige Gesamt-Zuschauer in diesem Zeitraum:', data.totalViewers);
    console.log(' Rang nach Häufigkeit:', countRank ?? 'außerhalb Top 5');
    console.log(' Rang nach Zuschauern:', viewerRank ?? 'außerhalb Top 3');
  } catch (err) {
    console.error('Fehler beim Tracken/Rangberechnen des Raids:', err.message);
    data = { count: 1, totalViewers: viewers };
    countRank = null;
    viewerRank = null;
  }

  const msgParts = [
    buildBaseMessage(fromName, viewers),
    buildGameMessage(game, durationStr)
  ];

  const periodWord = getPeriodWord(pKey || getPeriodKey(new Date()));
  if (countRank && data.count >= 2) {
    msgParts.push(buildRankRepeatMessage(countRank, fromName, data.count, periodWord));
  } else if (data.count >= 2) {
    msgParts.push(buildRepeatOnlyMessage(fromName, data.count, periodWord));
  }

  if (viewerRank) {
    msgParts.push(buildViewerRankMessage(viewerRank, fromName));
  }

  msgParts.push(buildClosingMessage());

  const message = msgParts.join(' ');
  console.log(' Finale Chat-Nachricht:', message);

  // Als Broadcaster (kein feature). Shoutout nur, wenn Twitch die Begrüßung angenommen hat.
  if (!(await sendChatMessage(message))) {
    console.error(`Raid-Begrüßung für @${fromName} nicht gesendet – kein Shoutout`);
  } else {
    console.log(`Raid-Begrüßung erfolgreich gesendet für @${fromName}`);

    if (viewers >= 3) {
      // Sofort als geshoutet merken, damit die erste Chat-Nachricht des Raiders (Whitelist)
      // keinen zweiten Shoutout versucht, den Twitch mit 429 ablehnt. Scheitert der
      // Raid-Shoutout, wird der Eintrag wieder entfernt.
      const alreadyMarked = shoutedOutThisSession.has(fromId);
      shoutedOutThisSession.add(fromId);
      setTimeout(async () => {
        const ok = await sendShoutout(fromId, fromName);
        if (!ok && !alreadyMarked) shoutedOutThisSession.delete(fromId);
      }, 2000);
    } else {
      console.log(`Kein Shoutout – nur ${viewers} Viewer (Schwelle: 3)`);
    }
  }

  console.log('=== RAID-EVENT VERARBEITUNG ABGESCHLOSSEN ===');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════
// UBOAT-SOLDBUCH – Crew aus dem letzten Spielstand (ADR 0016)
// Formatlogik und Einlesen in lib/uboat-save.js und lib/uboat-crew.js; hier nur
// Kategorie, Chat-Befehl, Zuordnungsdatei und Anzeige.
// ═══════════════════════════════════════════════════════════════════

// %USERPROFILE% o. Ä. im Pfad aus der .env auflösen (dotenv tut das nicht)
const uboatSavesDir = (UBOAT_SAVES_DIR || '').trim().replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m);
const uboatCrew = uboatSavesDir
  ? createUboatCrew({
    savesDir: uboatSavesDir,
    knownGameVersions: UBOAT_KNOWN_GAME_VERSIONS,
    hiddenSkills: UBOAT_HIDDEN_SKILLS,
    settleMs: UBOAT_SAVE_SETTLE_MS,
    pollMs: UBOAT_POLL_MS,
    freshMs: UBOAT_FRESH_MS
  })
  : null;
const uboatLastAnswerByUser = new Map();   // user_id -> Zeitpunkt der letzten Antwort
let currentCategory = null;                // Twitch-Kategorie des eigenen Kanals, null = unbekannt

function loadUboatCrewMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(UBOAT_CREW_MAP_FILE, 'utf8'));
    const map = {};
    for (const [login, name] of Object.entries(raw)) map[login.toLowerCase()] = String(name);
    return map;
  } catch {
    return {};
  }
}

function saveUboatCrewMap(map) {
  fs.writeFileSync(UBOAT_CREW_MAP_FILE, JSON.stringify(map, null, 2));
}

function isUboatCategoryActive() {
  return Boolean(currentCategory) && UBOAT_CATEGORY_NAMES.some(n => n.toLowerCase() === currentCategory.toLowerCase());
}

function setCurrentCategory(name, source) {
  if (name === currentCategory) return;
  currentCategory = name;
  console.log(`[Kategorie] Twitch-Kategorie: ${name || 'unbekannt'} (${source})${uboatCrew ? ` – UBOAT-Soldbuch ${!moduleSwitches.uboat ? 'deaktiviert' : isUboatCategoryActive() ? 'aktiv' : 'inaktiv'}` : ''}`);
}

// Kategorie beim Verbindungsaufbau holen; danach hält channel.update sie aktuell.
async function refreshChannelCategory() {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();
    const res = await axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${tokens.broadcaster_id}`,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID } });
    setCurrentCategory(res.data?.data?.[0]?.game_name || null, 'Abruf');
  } catch (err) {
    console.warn('[Kategorie] Abruf der Twitch-Kategorie gescheitert:', err.response?.data || err.message);
  }
}

async function subscribeToChannelUpdate(sessionId) {
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      {
        type: 'channel.update',
        version: '2',
        condition: { broadcaster_user_id: tokens.broadcaster_id },
        transport: { method: 'websocket', session_id: sessionId }
      },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } }
    );
    console.log('Channel-Update-Subscription aktiv (Kategorie für das UBOAT-Soldbuch)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.update:', err.response?.data || err.message);
  }
}

// "!soldbuch": Soldbuch des eigenen Matrosen. Für alle Zuschauer, nur in der UBOAT-Kategorie.
async function handleUboatCommand(evt) {
  const text = (evt.message?.text || '').trim().toLowerCase();
  if (!(text === UBOAT_COMMAND || text.startsWith(UBOAT_COMMAND + ' '))) return;
  // Shared Chat: Nachrichten aus fremden Kanälen ignorieren
  if (evt.source_broadcaster_user_id && evt.source_broadcaster_user_id !== evt.broadcaster_user_id) return;

  const login = evt.chatter_user_login;
  if (!uboatCrew) {
    console.log(`[UBOAT] ${UBOAT_COMMAND} von @${login} ignoriert – UBOAT_SAVES_DIR nicht gesetzt`);
    return;
  }
  if (!moduleSwitches.uboat) {
    console.log(`[UBOAT] ${UBOAT_COMMAND} von @${login} ignoriert – UBOAT-Soldbuch deaktiviert`);
    return;
  }
  if (!isUboatCategoryActive()) {
    console.log(`[UBOAT] ${UBOAT_COMMAND} von @${login} ignoriert – Kategorie „${currentCategory || 'unbekannt'}“`);
    return;
  }
  if (wasRecentlyTriggered(uboatLastAnswerByUser, evt.chatter_user_id || login, UBOAT_USER_COOLDOWN_MS)) {
    console.log(`[UBOAT] ${UBOAT_COMMAND} von @${login} ignoriert – Cooldown (${UBOAT_USER_COOLDOWN_MS / 1000} s)`);
    return;
  }
  if (!uboatCrew.hasData()) {
    console.log(`[UBOAT] ${UBOAT_COMMAND} von @${login}: noch kein Spielstand eingelesen`);
    await sendChatMessage(UBOAT_TEXT_UNAVAILABLE, evt.message_id, 'uboat');
    return;
  }
  const found = uboatCrew.findMember(login, evt.chatter_user_name, loadUboatCrewMap());
  if (found && found.ambiguous) {
    console.warn(`[UBOAT] @${login} passt auf mehrere Crewmitglieder (${found.ambiguous.join(', ')}) – mit "uboat map ${login} <Name im Spiel>" festlegen`);
  }
  if (!found || !found.member) {
    console.log(`[UBOAT] Kein Soldbuch für @${login} (${evt.chatter_user_name || login}) – keine Antwort im Chat; ggf. "uboat map ${login} <Name im Spiel>"`);
    return;
  }
  console.log(`[UBOAT] Soldbuch für @${login}: ${found.member.name}`);
  await sendChatMessage(uboatCrew.formatAkte(found.member), evt.message_id, 'uboat');
}

function printUboatStatus() {
  if (!uboatCrew) {
    console.log(`UBOAT-Soldbuch: aus (UBOAT_SAVES_DIR in .env setzen); Schalter: ${moduleStateLabel('uboat')}`);
    return;
  }
  console.log(`UBOAT-Soldbuch: ${moduleStateLabel('uboat')}`);
  const s = uboatCrew.getState();
  const map = loadUboatCrewMap();
  const mappedBy = {};
  for (const [login, name] of Object.entries(map)) mappedBy[name.toLowerCase()] = login;
  console.log(`UBOAT-Spielstände: ${uboatSavesDir}`);
  console.log(`Spielstand: ${s.source || 'keiner'}${s.savedAt ? ` (Stand ${uboatCrew.formatStand(s.savedAt)}, Spielversion ${s.gameVersion || 'unbekannt'})` : ''}${s.error ? ` – letzter Fehler: ${s.error}` : ''}`);
  console.log(`Kategorie: ${currentCategory || 'unbekannt'} – Befehl ${isUboatCategoryActive() ? 'aktiv' : 'inaktiv'}`);
  console.log(`Crew (${s.crew.length}):`);
  s.crew.forEach(m => console.log(` - ${m.typeLabel.padEnd(10)} Stufe ${m.level}  ${m.name}${mappedBy[m.name.toLowerCase()] ? `  ← @${mappedBy[m.name.toLowerCase()]}` : ''}`));
  const crewNames = new Set(s.crew.map(m => m.name.toLowerCase()));
  const orphaned = Object.entries(map).filter(([, name]) => !crewNames.has(name.toLowerCase()));
  if (orphaned.length) console.log(`Zuordnungen ohne passendes Crewmitglied: ${orphaned.map(([l, n]) => `@${l} → ${n}`).join(', ')}`);
}

// ═══════════════════════════════════════════════════════════════════
// KONSOLEN-BEFEHLE (readline) – Übersicht mit "help" (printConsoleHelp)
// ═══════════════════════════════════════════════════════════════════

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function printConsoleHelp() {
  console.log('');
  console.log('Verfügbare Konsolenbefehle:');
  console.log(' whitelist add <id> <name>  - Nutzer per ID zur Whitelist hinzufügen');
  console.log(' whitelist add <id>         - Nutzer per ID zur Whitelist hinzufügen (löst Namen automatisch auf)');
  console.log(' whitelist add @<name>      - Nutzer per Namen zur Whitelist hinzufügen (löst ID automatisch auf)');
  console.log(' whitelist remove <id>      - Nutzer per ID aus der Whitelist entfernen');
  console.log(' whitelist list             - Aktuelle Whitelist anzeigen');
  console.log(' whitelist checks           - Auffälligkeiten der Aktivitätsprüfung anzeigen (live beim Chatten, inaktiv, unklar)');
  console.log(' subgoal refresh            - Sub-Goal-Stand jetzt von Twitch laden');
  console.log(' subgoal show               - Aktuellen gecachten Sub-Goal-Stand anzeigen');
  console.log(' events show                - Letzte 10 Follow/Sub/Gift-Ereignisse anzeigen');
  console.log(' effects mode <auto|manual|off> - Effekt-Modus setzen');
  console.log(' effects show               - Aktuellen Effekt-Modus & Queue-Status anzeigen');
  console.log(' bdu show                   - BdU-Chat: Widget-Verbindung, Funkstille, Limits anzeigen');
  console.log(' bdu silence off            - BdU-Chat: Funkstille sofort aufheben');
  console.log(' bdu activate|deactivate    - BdU-Chat ein- bzw. ausschalten (bleibt nach Neustart)');
  console.log(' uboat show                 - UBOAT: gelesener Spielstand, Kategorie, Crew und Zuordnungen anzeigen');
  console.log(' uboat reload               - UBOAT: neuesten Spielstand sofort einlesen');
  console.log(' uboat map <login> <Name>   - UBOAT: Twitch-Login einem Crewmitglied (Name im Spiel) zuordnen');
  console.log(' uboat unmap <login>        - UBOAT: Zuordnung entfernen');
  console.log(' uboat activate|deactivate  - UBOAT-Soldbuch ein- bzw. ausschalten (bleibt nach Neustart)');
  console.log(' bot show                   - Bot-Account DerBdu: eingerichtet?, was er sendet, letzter Fehler');
  console.log(' bot remove                 - Bot-Account vergessen (danach sendet wieder der Broadcaster)');
  console.log(' help                      - Diese Hilfe anzeigen');
  console.log('');
}

rl.on('line', async (input) => {
  const trimmed = input.trim();
  if (!trimmed) return;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === 'help') {
    printConsoleHelp();
    return;
  }

  if (cmd === 'whitelist') {
    const sub = parts[1] ? parts[1].toLowerCase() : '';

    if (sub === 'list') {
      printWhitelist();
      return;
    }

    if (sub === 'checks') {
      printWhitelistChecks();
      return;
    }

    if (sub === 'add') {
      const arg1 = parts[2];
      const arg2 = parts[3];

      if (!arg1) {
        console.log('Nutzung: whitelist add <id> <name> ODER whitelist add @<name>');
        return;
      }

      if (arg1.startsWith('@')) {
        const login = arg1.slice(1);
        console.log(`Löse Nutzername @${login} zu ID auf...`);
        try {
          const user = await resolveUserByLogin(login);
          if (!user) {
            console.log(`Kein Twitch-Nutzer mit dem Namen @${login} gefunden`);
            return;
          }
          addToWhitelist(user.id, user.login);
        } catch (err) {
          console.error('Fehler beim Auflösen des Nutzernamens:', err.response?.data || err.message);
        }
        return;
      }

      if (arg1 && arg2) {
        addToWhitelist(arg1, arg2);
        return;
      }

      if (arg1 && !arg2) {
        console.log(`Löse ID ${arg1} zu Nutzername auf...`);
        try {
          const user = await resolveUserById(arg1);
          if (!user) {
            console.log(`Kein Twitch-Nutzer mit der ID ${arg1} gefunden`);
            return;
          }
          addToWhitelist(user.id, user.login);
        } catch (err) {
          console.error('Fehler beim Auflösen der ID:', err.response?.data || err.message);
        }
        return;
      }

      return;
    }

    if (sub === 'remove') {
      const arg1 = parts[2];
      if (!arg1) {
        console.log('Nutzung: whitelist remove <id>');
        return;
      }
      removeFromWhitelist(arg1);
      return;
    }

    console.log('Unbekannter Whitelist-Befehl. Tippe "help" für eine Übersicht.');
    return;
  }

  if (cmd === 'subgoal') {
    const sub = parts[1] ? parts[1].toLowerCase() : '';
    if (sub === 'refresh') {
      console.log('Lade Sub-Goal-Stand von Twitch...');
      await refreshSubGoalCache();
      return;
    }
    if (sub === 'show') {
      const c = loadSubGoalCache();
      console.log(`Sub-Goal: ${c.current ?? '?'} / ${c.target ?? '?'} — "${c.title ?? 'kein Titel'}" (Stand: ${c.lastUpdated ?? 'nie geladen'})`);
      return;
    }
    console.log('Nutzung: subgoal refresh | subgoal show');
    return;
  }

  if (cmd === 'events') {
    const sub = parts[1] ? parts[1].toLowerCase() : '';
    if (sub === 'show') {
      const log = loadEventLog();
      console.log(`Letzte ${Math.min(10, log.length)} Ereignisse:`);
      log.slice(-10).forEach(e => console.log(` - [${e.timestamp}] ${e.type}: ${JSON.stringify(e)}`));
      return;
    }
    console.log('Nutzung: events show');
    return;
  }

  if (cmd === 'effects') {
    const sub = parts[1] ? parts[1].toLowerCase() : '';

    if (sub === 'mode') {
      const newMode = parts[2] ? parts[2].toLowerCase() : '';
      if (!['auto', 'manual', 'off'].includes(newMode)) {
        console.log('Nutzung: effects mode <auto|manual|off>');
        return;
      }
      setEffectMode(newMode);
      return;
    }

    if (sub === 'show') {
      console.log(`Effekt-Modus: ${effectMode.toUpperCase()} | Queue-Länge: ${effectQueue.length} | Wartet auf Bestätigung: ${pendingManualConfirmation ? pendingManualConfirmation.job.type : 'nein'}`);
      return;
    }

    console.log('Nutzung: effects mode <auto|manual|off> | effects show');
    return;
  }

  if (cmd === 'bdu') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'show') {
      printBduStatus();
      return;
    }
    if (sub === 'silence' && (parts[2] || '').toLowerCase() === 'off') {
      bduSilenceUntil = 0;
      bduSilenceEndedAt = 0;
      console.log('[BdU] Funkstille aufgehoben');
      return;
    }
    if (sub === 'activate') {
      setModuleSwitch('bdu', true);
      return;
    }
    if (sub === 'deactivate') {
      if (setModuleSwitch('bdu', false) && bduPending.size) {
        // Antworten auf bereits weitergereichte Anfragen nicht mehr posten
        for (const [id, p] of bduPending) { clearTimeout(p.timer); bduPending.delete(id); }
        console.log('[BdU] Offene Anfragen verworfen');
      }
      return;
    }
    console.log('Nutzung: bdu show | bdu silence off | bdu activate | bdu deactivate');
    return;
  }

  if (cmd === 'uboat') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'show') {
      printUboatStatus();
      return;
    }
    if (sub === 'reload') {
      if (!uboatCrew) { console.log('UBOAT-Soldbuch: aus (UBOAT_SAVES_DIR in .env setzen)'); return; }
      if (!uboatCrew.reload()) console.log('[UBOAT] Kein lesbarer Spielstand gefunden');
      return;
    }
    if (sub === 'map' && parts[2] && parts[3]) {
      const login = parts[2].replace(/^@/, '').toLowerCase();
      const name = parts.slice(3).join(' ');
      const map = loadUboatCrewMap();
      map[login] = name;
      saveUboatCrewMap(map);
      const known = uboatCrew && uboatCrew.getState().crew.some(m => m.name.toLowerCase() === name.toLowerCase());
      console.log(`[UBOAT] @${login} → ${name} gespeichert${uboatCrew && !known ? ' (Hinweis: im gelesenen Spielstand gibt es kein Crewmitglied mit diesem Namen)' : ''}`);
      return;
    }
    if (sub === 'unmap' && parts[2]) {
      const login = parts[2].replace(/^@/, '').toLowerCase();
      const map = loadUboatCrewMap();
      if (!(login in map)) { console.log(`[UBOAT] Für @${login} gibt es keine Zuordnung`); return; }
      delete map[login];
      saveUboatCrewMap(map);
      console.log(`[UBOAT] Zuordnung für @${login} entfernt`);
      return;
    }
    if (sub === 'activate') {
      setModuleSwitch('uboat', true);
      if (!uboatCrew) console.log('[UBOAT] Hinweis: UBOAT_SAVES_DIR ist nicht gesetzt – das Soldbuch antwortet erst, wenn der Ordner in der .env steht (Neustart nötig)');
      return;
    }
    if (sub === 'deactivate') {
      setModuleSwitch('uboat', false);
      return;
    }
    console.log('Nutzung: uboat show | uboat reload | uboat map <login> <Name im Spiel> | uboat unmap <login> | uboat activate | uboat deactivate');
    return;
  }

  if (cmd === 'bot') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'show') {
      printBotStatus();
      return;
    }
    if (sub === 'remove') {
      if (!loadBotConfig()) { console.log('[Bot] Es ist kein Bot-Account eingerichtet'); return; }
      fs.unlinkSync(BOT_FILE);
      console.log('[Bot] Bot-Account vergessen – alle Nachrichten kommen wieder vom Broadcaster. Die Freigabe bei Twitch entziehst du als DerBdu unter twitch.tv → Einstellungen → Verbindungen.');
      return;
    }
    console.log('Nutzung: bot show | bot remove');
    return;
  }

  console.log(`Unbekannter Befehl "${trimmed}". Tippe "help" für eine Übersicht.`);
});

// ═══════════════════════════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════════════════════════

const PORT_NUM = parseInt(PORT);
// Express 5 ruft diese Funktion auch bei einem Startfehler auf (z. B. Port belegt), dann mit `err`.
// Ohne diese Prüfung liefe ein zweiter Server ohne HTTP-Teil, aber mit eigener EventSub-Verbindung
// (doppelte Chat-Ausgaben, Widgets verbunden mit dem anderen Server).
app.listen(PORT_NUM, (err) => {
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`FEHLER: Port ${PORT_NUM} ist bereits belegt. Läuft der Server schon in einem anderen Fenster? Dieser Start wird abgebrochen, damit nicht zwei Server parallel laufen.`);
    } else {
      console.error(`FEHLER: Server konnte nicht starten: ${err.message}`);
    }
    process.exit(1);
    return;
  }
  console.log('');
  console.log('═════════════════════════════════════════════');
  console.log('Twitch Companion JS server');
  console.log('═════════════════════════════════════════════');
  console.log(`Server läuft auf: http://localhost:${PORT_NUM}`);
  console.log(`Prozess-ID: ${process.pid} (zum Beenden: taskkill /PID ${process.pid} /F)`);
  console.log(`Login: http://localhost:${PORT_NUM}/login`);
  console.log(`Status: http://localhost:${PORT_NUM}/status`);
  console.log(`Webkonsole: http://localhost:${PORT_NUM}${ADMIN_PAGE_PATH}`);
  console.log('═════════════════════════════════════════════');
  console.log(`Effekt-Modus beim Start: ${effectMode.toUpperCase()}`);
  console.log(`Erlaubte Widget-Herkünfte: ${corsAllowAll ? '* (ALLE – Notschalter aktiv, unsicher!)' : [...allowedOrigins].join(', ')}`);
  console.log(`Home-Assistant-Webhook: ${HA_WEBHOOK_URL ? 'eingetragen' : 'NICHT eingetragen – Effekte werden nur lokal geloggt (HA_WEBHOOK_URL in .env)'}`);
  const bot = loadBotConfig();
  console.log(`Bot-Account: ${bot ? `${bot.bot_name || bot.bot_login} (${botFeatureLabels()})` : `nicht eingerichtet – http://localhost:${PORT_NUM}/login-bot (vorher /mod DerBdu im Chat)`}`);
  console.log(`BdU-Chat: ${moduleStateLabel('bdu')}`);
  console.log(`UBOAT-Soldbuch: ${uboatCrew ? `an (Spielstände: ${uboatSavesDir})` : 'aus (UBOAT_SAVES_DIR in .env)'}${moduleSwitches.uboat ? '' : ' – deaktiviert ("uboat activate" schaltet ein)'}`);
  console.log('═════════════════════════════════════════════');
  if (uboatCrew) uboatCrew.start();

  const tokens = loadTokens();
  if (tokens) {
    const now = Date.now();
    const expiresAt = tokens.expires_at || (tokens.obtained_at + tokens.expires_in * 1000);
    const remainingMinutes = Math.floor((expiresAt - now) / 1000 / 60);
    console.log(`Authentifiziert als: ${tokens.broadcaster_name || 'unbekannt'}`);
    console.log(remainingMinutes > 0
      ? `Token gültig für: ${remainingMinutes} Minuten`
      : 'Token abgelaufen – wird beim ersten Zugriff automatisch erneuert');
    console.log(`Auto-Refresh: Aktiviert`);
    connectEventSub();
  } else {
    console.log('Noch nicht authentifiziert!');
    console.log(` Öffne: http://localhost:${PORT_NUM}/login`);
  }

  console.log('═════════════════════════════════════════════');
  printConsoleHelp();
});
