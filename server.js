const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const WebSocket = require('ws');
const { createUboatCrew, normalizeName: normalizeCrewName } = require('./lib/uboat-crew');
const uboatHistoryLib = require('./lib/uboat-history');
const { createGithubPublisher } = require('./lib/github-publisher');
const kartei = require('./lib/stream-kartei');
const { createStats, streamMetricKeys, streamMetricDefs } = require('./lib/stats');
const { createStreamSession } = require('./lib/stream-session');
const { createStreamReports, reportWarnings, isReportId } = require('./lib/stream-reports');
const { createPredictionTracker, PREDICTION_EVENT_TYPES } = require('./lib/prediction-state');
const { createPollTracker, POLL_EVENT_TYPES } = require('./lib/poll-state');
const { predictionResultMessage, pollResultMessage, createResultAnnouncer } = require('./lib/result-messages');
const chatBridge = require('./lib/chat-bridge');
const consumerPolls = require('./lib/consumer-polls');
// Kern (ADR 0027): Konfiguration, Speichern, Log, HTTP-Zugriffsschutz
const config = require('./core/config');
const { writeJsonAtomic } = require('./core/store');
const { createLog, redactedValues } = require('./core/log');
const { createAccess } = require('./core/http');
const { createAuth } = require('./core/auth');
const { createModuleHost } = require('./core/modules');
// Module (ADR 0027): melden Endpunkte, Konsolenbefehle und ihren Teil der Webkonsole über core/modules.js an
const { createTopicsModule } = require('./modules/topics');

const app = express();
const {
  SERVER_STARTED_AT,
  APP_VERSION,
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
  ERROR_LOG_MAX_ENTRIES,
} = config;

const RAID_FILE = './raids.json';
const WHITELIST_FILE = './whitelist.json';
const SUBGOAL_FILE = './subgoal_cache.json';
const EVENTLOG_FILE = './events.json';
const EFFECT_MODE_FILE = './effect_mode.json';
const WHITELIST_CHECKS_FILE = './whitelist_checks.json';   // Auffälligkeiten der Aktivitätsprüfung (ADR 0015), Quelle für den Stream-Bericht
const UBOAT_CREW_MAP_FILE = './uboat_crew_map.json';       // Zuordnung Twitch-Login -> Name im Spiel (ADR 0016)
const UBOAT_HISTORY_FILE = './uboat_crew_history.json';    // Verlauf je Kampagne: gesicherte Lebensläufe, Feindfahrten je Person (Stream-Kartei 1c)
const MODULES_FILE = './modules.json';                     // Modul-Schalter (bdu/uboat activate|deactivate), überdauert Neustarts
const STREAM_STATS_FILE = './stream_stats.json';           // laufender oder letzter Stream (ADR 0019)
const STREAM_REPORTS_DIR = './stream_reports';             // je abgeschlossenem Stream eine .json und eine .txt (ADR 0019)
const PRIVACY_FILE = './privacy_optouts.json';             // !privat: User-IDs mit Zeitpunkt (docs/DATENKATALOG.md)
const MODULE_NAMES = { bdu: 'BdU-Chat', uboat: 'UBOAT-Soldbuch', topics: 'Intro-Topics', kartei: 'Stream-Kartei' };   // per Konsole und Webkonsole schaltbare Module, Standard: an
const MODULE_OFF_TEXT = { topics: 'Stream-Deck-Tasten werden ignoriert, das Widget blendet aus',
  kartei: 'es wird nichts mehr hochgeladen, der letzte Stand bleibt online' };   // sonst: Befehle im Chat werden ignoriert

// Stream-Kartei (ADR 0026, docs/specs/stream-kartei.md): letzter Stand der Spielfiguren auf einer öffentlichen Website
const STREAM_KARTEI_BRANCH = 'data';                         // Zweig mit genau einem Commit, verwaltet nur der Server
const STREAM_KARTEI_MIN_GAP_MS = 10 * 60 * 1000;            // höchstens eine Veröffentlichung je 10 min (Ausnahme: Ausblenden nach !privat)
const STREAM_KARTEI_PRIVACY_CACHE_MS = 60 * 60 * 1000;      // Namen der !privat-Zuschauer so lange merken
const STREAM_KARTEI_EXPIRY_WARN_MS = 14 * 24 * 60 * 60 * 1000;   // so lange vor Ablauf des Tokens warnen
const STREAM_KARTEI_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const ADMIN_KARTEI_PUBLISH_PATH = '/api/admin/kartei/publish';

// Stream-Deck-Anbindung (ADR 0020, docs/specs/stream-deck.md); Intro-Topics ist ein Modul (modules/topics, ADR 0027)
const SILENT_EFFECT_TYPES = new Set(['topic_active', 'topic_done', 'topics_complete']);   // in keinem Log, keine Statistik (Nutzer, 12.11.2026)
const DECK_PATH = '/api/deck';

// !privat: Zuschauer schalten selbst um, ob sie in der Statistik mit Namen erscheinen (ADR 0022)
const PRIVACY_COMMAND = '!privat';
const PRIVACY_ANON_NAME = 'anonymer Schlaumeier';
const PRIVACY_COMMAND_COOLDOWN_MS = 10 * 1000;     // je Zuschauer, gegen versehentliches Doppelt-Umschalten
const PRIVACY_OPTOUTS_PATH = '/api/privacy/optouts';
const PRIVACY_TEXT_ON = `Privatmodus an: In der Stream-Statistik erscheinst du ab jetzt und rückwirkend nur noch als „${PRIVACY_ANON_NAME}“. Mit ${PRIVACY_COMMAND} schaltest du ihn wieder aus.`;
const PRIVACY_TEXT_OFF = `Privatmodus aus: In der Stream-Statistik erscheinst du ab jetzt wieder mit Namen. Frühere Einträge bleiben anonym. Mit ${PRIVACY_COMMAND} schaltest du ihn wieder ein.`;

// Bot-Account „DerBdu“ (ADR 0017, docs/specs/bot-account.md): Datei, Scopes und Freigabe in core/auth.js
// Absender je Chat-Funktion (Spec bot-account.md, „Absender je Funktion“): Bot oder Broadcaster, einstellbar per Konsole und Webkonsole
const CHAT_SENDERS_FILE = './chat_senders.json';
const CHAT_FEATURES = { bdu: 'BdU-Chat', uboat: 'UBOAT-Soldbuch', raid: 'Raid-Begrüßung', whitelist: 'Whitelist-Begrüßung', raidstats: '!raidstats', privacy: '!privat-Antwort',
  prediction: 'Wett-Ergebnis', poll: 'Abstimmungs-Ergebnis', rimworld: 'RimWorld', coinflip: 'CoinFlip' };
// Chat-Brücke für lokale Verbraucher (Spec chat-bruecke.md, ADR 0025): diese Chat-Funktionen dürfen über POST /api/chat/send senden
const CHAT_BRIDGE_FEATURES = ['rimworld', 'coinflip'];
const CHAT_BRIDGE_STREAM_PATH = '/api/chat/stream';
const CHAT_BRIDGE_SEND_PATH = '/api/chat/send';
const CHAT_BRIDGE_MIN_GAP_MS = 1000;              // je Funktion höchstens eine Nachricht je Sekunde
const CHAT_BRIDGE_PING_MS = 30 * 1000;            // Lebenszeichen auf dem Ereignisstrom
const CHAT_BRIDGE_JSON_LIMIT = '2kb';             // eine Chat-Nachricht hat höchstens 500 Zeichen
// Aktive Chatter und Kategorie für lokale Verbraucher (Spec chat-bruecke.md, Teil B, Issue #79)
const CHAT_ACTIVE_PATH = '/api/chat/active';
const CHAT_ACTIVE_WINDOW_MS = 60 * 60 * 1000;     // wer in dieser Zeit geschrieben hat, zählt als aktiv
const CHAT_ACTIVE_MAX = 2000;                     // Obergrenze der Liste im Arbeitsspeicher
const CHANNEL_INFO_PATH = '/api/twitch/channel';
// Abstimmung im Auftrag eines Verbrauchers (Spec chat-bruecke.md, Teil C, Issue #81); braucht channel:manage:polls in SCOPES
const POLL_START_PATH = '/api/twitch/poll/start';
const POLL_START_MIN_GAP_MS = 5000;               // höchstens ein Startversuch je 5 s, damit Wiederholungen Twitch nicht fluten
const POLL_REQUEST_MAX_AGE_MS = 2 * 60 * 60 * 1000;   // offene Aufträge ohne Endstand so lange merken (Abstimmung höchstens 30 min)
// Ergebniszeilen über den Server (Spec wetten-abstimmungen.md, Schritt 3b): je Zeile ein Schalter, Vorgabe an
// (Nutzer, 14.11.2026). Aus nur, solange ein älteres Widget seine Zeile noch selbst sendet.
const CHAT_RESULTS_FILE = './chat_results.json';
const CHAT_RESULT_LINES = { prediction: 'Wett-Ergebnis', poll: 'Abstimmungs-Ergebnis' };
const CHAT_SENDER_DEFAULTS = { bdu: 'bot', uboat: 'bot', rimworld: 'bot' };   // alle übrigen: Broadcaster (rimworld: Nutzer, 20.11.2026)
const CHAT_SENDER_VALUES = ['bot', 'broadcaster'];
// Login-, Token-, Bot- und Twitch-API-Konstanten (ADR 0013, 0017, 0024) stehen in core/config.js

// Erreichbarkeit (Nutzer, 14.11.2026; ADR 0013, Nachtrag): nur auf diesem PC. Home Assistant bekommt nur Webhooks und fragt nicht ab.
// IPv6-Loopback zusätzlich, weil manche Programme „localhost“ als ::1 auflösen. Zugang aus dem LAN später nur mit Schlüssel (#57).
const SERVER_HOST = '127.0.0.1';
const SERVER_HOST_V6 = '::1';

const RAIDSTATS_COOLDOWN_MS = 30 * 1000;
const RAID_GREETING_MIN_GAP_MS = 90 * 1000;
const RAID_SHOUTOUT_MIN_VIEWERS = 3;              // Shoutout nach einem Raid erst ab so vielen Zuschauern; später in den Einstellungen (OFFEN.md, Abschnitt 4)
const RAID_YEARLY_FROM_YEAR = 2027;               // Raid-Statistik ab diesem Jahr je Kalenderjahr statt je Quartal (ADR 0012)
const SHOUTOUT_ACTIVITY_WINDOW_DAYS = 40;         // Whitelist-Shoutout nur, wenn der Kanal in diesem Zeitraum aktiv war (ADR 0015)
const SHOUTOUT_ACTIVITY_STRICT = false;           // Testphase: Aktivität unklar (API-Fehler, kein Video) -> trotzdem Shoutout; später true
const WHITELIST_SHOUTOUT_DELAY_MS = 2000;         // Abstand zwischen Chat-Hinweis und Whitelist-Shoutout (wie beim Raid)
const WHITELIST_CHECKS_MAX = 500;                 // so viele Einträge behält whitelist_checks.json

const EFFECT_BURST_WINDOW_MS = 2500;
const EFFECT_MIN_GAP_MS = 4000;

// Entdoppelung von EventSub-Ereignissen (siehe Abschnitt "ENTDOPPELUNG" weiter unten)
const EVENT_MESSAGE_ID_TTL_MS = 10 * 60 * 1000;   // Twitch-Wiederzustellungen derselben Nachricht
const SUB_DEDUPE_WINDOW_MS = 60 * 1000;           // Sicherheitsnetz: derselbe Nutzer nicht mehrfach als Sub-Effekt
const FOLLOW_DEDUPE_WINDOW_MS = 60 * 1000;        // Follow/Unfollow/Follow desselben Nutzers

// Protokoll der Sub-Ereignisse: Stufen lesbar, Ankündigungen, die anderswo ausgewertet werden, nicht als „nicht ausgewertet“ melden
const SUB_TIER_LABELS = { 1000: 'Stufe 1', 2000: 'Stufe 2', 3000: 'Stufe 3' };
const SUB_GOAL_TYPES = ['subscription', 'subscription_count'];   // Goal-Typen, die als Sub-Goal gelten (wie bisher bei der Abfrage)
const CHAT_NOTICES_HANDLED_ELSEWHERE = ['raid'];   // eingehende Raids kommen über channel.raid

// EventSub-WebSocket
const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const EVENTSUB_RECONNECT_DELAY_MS = 5000;         // Neuaufbau nach unerwartetem Verbindungsende
const EVENTSUB_KEEPALIVE_DEFAULT_S = 10;          // falls session_welcome keinen keepalive_timeout_seconds liefert
const EVENTSUB_KEEPALIVE_GRACE_MS = 5000;         // Zuschlag auf das Keepalive-Intervall, bevor die Verbindung als tot gilt

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
const ADMIN_LOG_PING_MS = 30 * 1000;              // Lebenszeichen auf der Live-Log-Verbindung
const ADMIN_ERROR_LOG_PATH = '/api/admin/log/errors';
const ADMIN_STATS_PATH = '/api/admin/stats';
const STATS_ENABLED = true;                       // false schaltet die ganze Statistik ab (ADR 0019)
const STREAM_CLOSE_GRACE_MS = 2 * 60 * 60 * 1000; // so lange nach dem letzten Offline läuft die Erfassung weiter
const STREAM_SAVE_INTERVAL_MS = 30 * 1000;        // stream_stats.json höchstens so oft schreiben
const STREAM_HEARTBEAT_MS = 5 * 60 * 1000;        // auch ohne Änderung, solange live: Lebenszeichen für den Abgleich nach einem Absturz
const STREAM_TICK_MS = 5 * 1000;                  // so oft Frist und Speichern prüfen
const STREAM_MAX_CHATTERS = 1000;                 // Obergrenze je Stream, damit stream_stats.json klein bleibt
const STREAM_REPORT_SHORT_SECONDS = 60 * 60;      // kürzere Streams bekommen im Bericht einen Hinweis
const ADMIN_REPORTS_PATH = '/api/admin/reports';
const ADMIN_STREAM_CLOSE_PATH = '/api/admin/stream/close';
const STREAM_TOP_CHATTERS = 5;                    // so viele aktivste Chatter werden angezeigt
const STREAM_RECONCILE_MIN_AGE_MS = 5 * 60 * 1000; // jünger: „nicht live“ von Twitch ist vermutlich noch die alte Antwort
const STREAM_VIEWERS_POLL_MS = 30 * 1000;         // Zuschauerzahl so oft bei Twitch abfragen, nur während der Stream läuft (ADR 0023)
const STREAM_VIEWERS_MAX_MINUTES = 48 * 60;       // Obergrenze des Minutenverlaufs je Stream
const STREAM_VIEWERS_PATH = '/api/twitch/stream'; // letzter bekannter Stand für Widgets, ohne eigene Twitch-Abfrage (ADR 0023)
const PREDICTION_PATH = '/api/twitch/prediction/current';  // letzter Stand der Wette aus EventSub (Spec wetten-abstimmungen.md)
const STREAM_LUCKY_PATH = '/api/stream/lucky';    // Glückspilz des Abends aus der Stream-Statistik (Spec wetten-abstimmungen.md, Schritt 4)
// Leseendpunkte, die Widgets im Takt abfragen: erfolgreiche Abrufe erscheinen nicht im HTTP-Protokoll (außer mit "http debug on").
// /token bleibt sichtbar (Token-Ausgabe), ebenso jede Antwort ab 400.
const HTTP_QUIET_WIDGET_PATHS = ['/api/twitch/prediction/current', '/api/twitch/poll/current', '/api/twitch/stream', '/api/twitch/subcounter', '/api/privacy/optouts', '/api/stream/lucky',
  '/api/chat/active', '/api/twitch/channel'];
const PREDICTION_RECHECK_MS = 5 * 60 * 1000;      // offene Wette ohne Ereignis so lange, dann einmal bei Twitch nachsehen
const POLL_PATH = '/api/twitch/poll/current';     // letzter Stand der Abstimmung aus EventSub (Spec wetten-abstimmungen.md)
const POLL_RECHECK_MS = 5 * 60 * 1000;            // laufende Abstimmung ohne Ereignis so lange, dann einmal bei Twitch nachsehen
const STATS_EXCLUDED_CHATTERS = ['nightbot', 'streamelements', 'derbdu'];   // zählen nicht als Chatnachricht; wird später im Reiter „Whitelist“ bearbeitbar
const ADMIN_WHITELIST_PATH = '/api/admin/whitelist';
const ADMIN_MODULES_PATH = '/api/admin/modules';
const ADMIN_CHAT_SENDER_PATH = '/api/admin/chat/sender';   // Absender je Chat-Funktion (Spec bot-account.md)
const ADMIN_CHAT_RESULTS_PATH = '/api/admin/chat/results'; // Ergebniszeilen an/aus (Spec wetten-abstimmungen.md, Schritt 3b)
const ADMIN_EFFECT_MODE_PATH = '/api/admin/effects/mode';
const EFFECT_MODES = ['auto', 'off'];
const ADMIN_JSON_LIMIT = '1kb';                   // Webkonsole-Aktionen senden nur kurze JSON-Objekte
const TWITCH_LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/;
const TWITCH_ID_PATTERN = /^\d{1,20}$/;

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
// Fehler des Widgets oder keine Antwort binnen BDU_ANSWER_TIMEOUT_MS (Issue #99): Störungsmeldung, Anfrage nicht anrechnen
const BDU_ERROR_TEXT = 'Funkspruch nicht durchgekommen, Störung im Äther. Später erneut funken!';
const BDU_ERROR_NOTICE_COOLDOWN_MS = 2 * 60 * 1000;   // Störungsmeldung höchstens einmal je 2 Minuten (gestörte KI, viele Versuche)

// UBOAT-Soldbuch (!soldbuch, siehe ADR 0016 und docs/specs/uboat-personalakte.md)
const UBOAT_COMMAND = '!soldbuch';                // Vergleich ohne Groß-/Kleinschreibung, "!Soldbuch" geht auch
// Befehle, die der Server selbst beantwortet: gehen nicht über die Chat-Brücke an Verbraucher (Nutzer, 20.11.2026)
const SERVER_CHAT_COMMANDS = [BDU_COMMAND, UBOAT_COMMAND, PRIVACY_COMMAND, '!raidstats'];
const UBOAT_USER_COOLDOWN_MS = 60 * 1000;         // je Zuschauer höchstens eine Antwort pro Minute
const UBOAT_CATEGORY_NAMES = ['UBOAT'];           // Twitch-Kategorie, in der der Befehl antwortet (Name im Stream vom 11.11.2026 bestätigt)
const UBOAT_SAVE_SETTLE_MS = 3 * 1000;            // Spielstand erst lesen, wenn er so lange unverändert ist
const UBOAT_POLL_MS = 60 * 1000;                  // zusätzlich zur Dateibeobachtung
const UBOAT_KNOWN_GAME_VERSIONS = ['2026.1 Patch 21'];   // Parser daran erprobt; andere: Hinweis in der Konsole
const UBOAT_HIDDEN_SKILLS = ['Authority', 'Skipper'];    // in der Akte nicht nennen (Spielmechanik bzw. doppelt zum Typ)
const UBOAT_FRESH_MS = 60 * 60 * 1000;           // Spielstand höchstens so alt: "Der Eintrag ist aktuell." im Soldbuch
// Kein Soldbuch zum Namen: keine Antwort im Chat, nur Hinweis in der Konsole
const UBOAT_TEXT_UNAVAILABLE = 'Die Soldbücher sind gerade nicht verfügbar.';
const CHAT_MAX_CHARS = 500;                       // Twitch-Limit je Chat-Nachricht

// ═══════════════════════════════════════════════════════════════════
// STATISTIK UND LIVE-LOG (ADR 0019, ADR 0018); Log-Kern in core/log.js
// ═══════════════════════════════════════════════════════════════════

function loadStreamStats() {
  if (!fs.existsSync(STREAM_STATS_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(STREAM_STATS_FILE, 'utf8')); } catch { return null; }
}

function saveStreamStats(data) {
  writeJsonAtomic(STREAM_STATS_FILE, data);
}

// !privat: { "<userId>": "<ISO-Zeitpunkt>" }; fehlt die Datei oder ist sie ungültig: leer
function loadPrivacyOptouts() {
  if (!fs.existsSync(PRIVACY_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(PRIVACY_FILE, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    console.warn(`[Privat] ${PRIVACY_FILE} ist unlesbar – niemand gilt als privat, bis die Datei repariert ist`);
    return {};
  }
}

function savePrivacyOptouts(data) {
  writeJsonAtomic(PRIVACY_FILE, data);
}

const privacyOptouts = loadPrivacyOptouts();
const isPrivateUser = userId => Object.hasOwn(privacyOptouts, String(userId));

const streamReports = createStreamReports({
  dir: STREAM_REPORTS_DIR,
  metrics: streamMetricDefs(),
  shortSeconds: STREAM_REPORT_SHORT_SECONDS,
  writeJson: writeJsonAtomic,
  log: (message, level = 'log') => console[level](message),
});

const streamSession = createStreamSession({
  keys: streamMetricKeys(),
  enabled: STATS_ENABLED,
  load: loadStreamStats,
  save: saveStreamStats,
  onClose: closed => streamReports.archive(closed),
  log: (message, level = 'log') => console[level](message),
  graceMs: STREAM_CLOSE_GRACE_MS,
  saveIntervalMs: STREAM_SAVE_INTERVAL_MS,
  heartbeatMs: STREAM_HEARTBEAT_MS,
  reconcileMinAgeMs: STREAM_RECONCILE_MIN_AGE_MS,
  maxChatters: STREAM_MAX_CHATTERS,
  topChatters: STREAM_TOP_CHATTERS,
  isPrivate: isPrivateUser,
  anonName: PRIVACY_ANON_NAME,
  maxViewerMinutes: STREAM_VIEWERS_MAX_MINUTES,
});
const stats = createStats({ enabled: STATS_ENABLED, stream: streamSession });   // vor dem Umhüllen von console, zählt die Fehler mit
setInterval(() => streamSession.tick(), STREAM_TICK_MS).unref();
streamSession.ensureArchived();   // z. B. wenn der Abschluss vor dem Speichern des Berichts endete

// Live-Log, Bereinigung, Fehlerprotokoll und logIfChanged (core/log.js); Fehler zählen in der Statistik mit.
// Achtung: logIfChanged gibt es erst ab hier (const, keine hochgezogene Funktion mehr). Code, der beim Laden
// weiter oben läuft, nutzt console.* direkt; Konsolenausgaben davor erscheinen nicht im Live-Log (wie bisher).
const log = createLog({
  redactions: redactedValues({ secrets: [CLIENT_SECRET, STREAM_KARTEI_TOKEN], webhookUrl: HA_WEBHOOK_URL, loopbackHostnames: config.LOOPBACK_HOSTNAMES }),
  redactedText: config.LOG_REDACTED,
  privateAddressText: config.LOG_PRIVATE_ADDRESS,
  bufferLines: config.ADMIN_LOG_BUFFER_LINES,
  maxChars: config.ADMIN_LOG_MAX_CHARS,
  errorLogFile: config.ERROR_LOG_FILE,
  errorLogMax: ERROR_LOG_MAX_ENTRIES,
  writeJson: writeJsonAtomic,
  onError: () => stats.count('errors'),
});
log.installConsole();
const { buffer: logBuffer, clients: logClients, errorLog, writeEntry: writeLogEntry, logIfChanged } = log;

// HTTP-Protokoll und Zugriffsschutz (core/http.js, ADR 0013): Herkunft, CORS, no-store, nur lokale Aufrufe.
// Welche erfolgreichen Abrufe still bleiben, legt diese Regel fest; sie zieht mit den Modulen um (ADR 0027).
let httpDebug = false;   // Konsolenbefehl "http debug on": auch erfolgreiche Abrufe der Widget-Leseendpunkte protokollieren (bis Neustart)

function isQuietRequest(req, res) {
  // Die Webkonsole fragt alle paar Sekunden ab; erfolgreiche Abfragen würden die Konsole fluten.
  if (req.method === 'GET' && [ADMIN_OVERVIEW_PATH, ADMIN_STATS_PATH, ADMIN_REPORTS_PATH].includes(req.path) && res.statusCode === 200) return true;
  // Widgets fragen ihre Leseendpunkte alle 2–5 s ab: erfolgreiche Abrufe nur im Testmodus (http debug on). Fehler bleiben sichtbar.
  if (req.method === 'GET' && HTTP_QUIET_WIDGET_PATHS.includes(req.path) && res.statusCode < 400 && !httpDebug) return true;
  // Module legen eigene stille Abrufe fest, z. B. Intro-Topics (Tastendrücke und Widgets nur mit "topics debug on")
  if (moduleHost.isQuiet(req, res)) return true;
  return false;
}

const access = createAccess({
  port: PORT,
  corsOrigins: CORS_ORIGINS,
  defaultOrigins: config.DEFAULT_CORS_ORIGINS,
  loopbackAddresses: config.LOOPBACK_ADDRESSES,
  loopbackHostnames: config.LOOPBACK_HOSTNAMES,
  logIfChanged,
});
app.use(access.requestLogger(isQuietRequest));
access.install(app);
const { corsAllowAll, allowedOrigins, isLoopbackRequest, hasLoopbackHost, requireLocalRequest, isLocalWidgetRequest } = access;

// ═══════════════════════════════════════════════════════════════════
// TOKENS, LOGIN, BOT-FREIGABE, TWITCH-ZUGRIFF (core/auth.js; ADR 0013, 0017, 0024, 0027)
// ═══════════════════════════════════════════════════════════════════

const auth = createAuth({
  config,
  http: axios,
  writeJson: writeJsonAtomic,
  logIfChanged,
  access,
  // Nach dem Broadcaster-Login: Abstimmungen dürfen wieder bei Twitch starten (Teil C); EventSub verbinden, falls nötig
  onBroadcasterLogin: () => {
    consumerPollScopeMissing = false;
    if (!eventSubWs) connectEventSub();
  },
  onBotAuthorized: () => { botLastError = null; },
  botFeatureLabels: () => botFeatureLabels(),
});
const { tokenStore, twitchApi, loadTokens, getValidAccessToken, loadBotConfig, removeBotConfig } = auth;

let botLastError = null;            // { at, text } – letzter Fehler beim Senden über den Bot

// ── Absender je Chat-Funktion (Spec bot-account.md, „Absender je Funktion“) ──
// Fehlende oder defekte Datei, fehlender oder unbekannter Eintrag: Vorgabe aus CHAT_SENDER_DEFAULTS, sonst Broadcaster
function loadChatSenders() {
  const senders = Object.fromEntries(Object.keys(CHAT_FEATURES).map(f => [f, CHAT_SENDER_DEFAULTS[f] || 'broadcaster']));
  if (!fs.existsSync(CHAT_SENDERS_FILE)) return senders;
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_SENDERS_FILE, 'utf8'));
    for (const f of Object.keys(senders)) if (CHAT_SENDER_VALUES.includes(data[f])) senders[f] = data[f];
  } catch { /* defekte Datei: Vorgaben */ }
  return senders;
}

function saveChatSenders(senders) {
  fs.writeFileSync(CHAT_SENDERS_FILE, JSON.stringify(senders, null, 2), 'utf8');
}

let chatSenders = loadChatSenders();

// Rückgabe: true, wenn sich etwas geändert hat; Prüfung von feature und sender beim Aufrufer
function setChatSender(feature, sender, source) {
  if (chatSenders[feature] === sender) return false;
  chatSenders = { ...chatSenders, [feature]: sender };
  saveChatSenders(chatSenders);
  const botHint = sender === 'bot' && !loadBotConfig() ? ' (noch kein Bot eingerichtet – bis dahin sendet der Broadcaster)' : '';
  console.log(`[Bot] ${source}: ${CHAT_FEATURES[feature]} sendet jetzt ${sender === 'bot' ? 'der Bot' : 'der Broadcaster'}${botHint}`);
  return true;
}

// ── Ergebniszeilen für Wette und Abstimmung (Spec wetten-abstimmungen.md, Schritt 3b) ──
// Fehlende oder defekte Datei, fehlender Eintrag: an
function loadChatResults() {
  const switches = Object.fromEntries(Object.keys(CHAT_RESULT_LINES).map(k => [k, true]));
  if (!fs.existsSync(CHAT_RESULTS_FILE)) return switches;
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_RESULTS_FILE, 'utf8'));
    for (const k of Object.keys(switches)) if (typeof data[k] === 'boolean') switches[k] = data[k];
  } catch { /* defekte Datei: Vorgabe (an) */ }
  return switches;
}

function saveChatResults(switches) {
  fs.writeFileSync(CHAT_RESULTS_FILE, JSON.stringify(switches, null, 2), 'utf8');
}

let chatResults = loadChatResults();

function setChatResult(line, on, source) {
  if (chatResults[line] === on) return false;
  chatResults = { ...chatResults, [line]: on };
  saveChatResults(chatResults);
  console.log(`[Chat] ${source}: Ergebniszeile ${CHAT_RESULT_LINES[line]} ${on ? 'an – der Server schreibt das Ergebnis in den Chat' : 'aus – der Server schreibt kein Ergebnis mehr in den Chat'}`);
  return true;
}

function chatResultList() {
  return Object.keys(CHAT_RESULT_LINES).map(line => ({ line, name: CHAT_RESULT_LINES[line], enabled: chatResults[line] }));
}

function botFeatures() {
  return Object.keys(CHAT_FEATURES).filter(f => chatSenders[f] === 'bot');
}

function botFeatureLabels() {
  const list = botFeatures().map(f => CHAT_FEATURES[f]);
  return list.length ? list.join(', ') : 'nichts';
}

function chatSenderList() {
  return Object.keys(CHAT_FEATURES).map(feature => ({ feature, name: CHAT_FEATURES[feature], sender: chatSenders[feature] }));
}

function printChatSenders() {
  for (const { feature, name, sender } of chatSenderList()) console.log(`[Bot]   ${feature.padEnd(10)} ${name}: ${sender === 'bot' ? 'Bot' : 'Broadcaster'}`);
}

function printBotStatus() {
  const bot = loadBotConfig();
  if (!bot) {
    console.log(`[Bot] Nicht eingerichtet – alle Nachrichten kommen vom Broadcaster. Einrichten: /mod DerBdu im Chat, dann http://localhost:${PORT}/login-bot in einem Browser, in dem DerBdu bei Twitch angemeldet ist`);
    return;
  }
  console.log(`[Bot] ${bot.bot_name || bot.bot_login} (ID ${bot.bot_id}), freigegeben am ${new Date(bot.authorized_at).toLocaleString('de-DE')}`);
  console.log(`[Bot] Sendet: ${botFeatureLabels()}; alles andere sendet der Broadcaster (umstellen: bot sender <funktion> bot|broadcaster)`);
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
  const res = await twitchApi.get(`/users?login=${encodeURIComponent(login)}`);
  return res.data.data[0] || null;
}

async function resolveUserById(id) {
  const res = await twitchApi.get(`/users?id=${encodeURIComponent(id)}`);
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

// Sub-Goal aus den EventSub-Ereignissen channel.goal.begin/progress/end (Issue #60, ADR 0023): keine Abfrage je Sub mehr.
// Twitch kann Begin nach Progress schicken; ein Begin zu einem Ziel, das schon bekannt ist, ändert deshalb nichts.
// Späte Ereignisse (Live-Stream vom 17.11.2026): Nach dem Ende kam noch ein progress des alten Ziels. Ein beendetes Ziel
// wird nicht wieder aktiv, und ein Ereignis eines früher begonnenen Ziels ersetzt kein neueres (startedAt im Cache).
function handleGoalEvent(subType, evt) {
  if (!SUB_GOAL_TYPES.includes(evt.type)) return;
  const cached = loadSubGoalCache();
  const isEnd = subType === 'channel.goal.end';
  if (cached.goalId === evt.id) {
    if (subType === 'channel.goal.begin') return;
    if (!isEnd && (cached.status === 'achieved' || cached.status === 'ended')) return;
  } else if (cached.goalId && Date.parse(evt.started_at) < Date.parse(cached.startedAt)) {
    return;
  }
  const status = isEnd ? (evt.is_achieved ? 'achieved' : 'ended') : 'active';
  const cache = {
    current: evt.current_amount,
    target: evt.target_amount,
    title: evt.description || evt.type,
    goalId: evt.id,
    status,
    startedAt: evt.started_at || (cached.goalId === evt.id ? cached.startedAt : null) || null,
    lastUpdated: new Date().toISOString(),
  };
  saveSubGoalCache(cache);
  logIfChanged('subgoal', `Sub-Goal aktualisiert (${subType.replace('channel.goal.', '')}): ${cache.current}/${cache.target} (${cache.title})${status === 'active' ? '' : `, ${status === 'achieved' ? 'erreicht' : 'beendet'}`}`);
}

async function refreshSubGoalCache() {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    const res = await twitchApi.get(`/goals?broadcaster_id=${tokens.broadcaster_id}`);
    const goals = res.data.data || [];
    const goal = goals.find(g => SUB_GOAL_TYPES.includes(g.type) && g.status === 'active')
              || goals.find(g => SUB_GOAL_TYPES.includes(g.type))
              || null;

    if (goal) {
      const cache = {
        current: goal.current_amount,
        target: goal.target_amount,
        title: goal.description || goal.type,
        goalId: goal.id,
        status: goal.status,
        startedAt: goal.created_at || null,   // für die Reihenfolge späterer Ereignisse (handleGoalEvent)
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
// HILFSFUNKTIONEN – EFFEKT-MODUS (Auto / Off, über Webkonsole und Konsole)
// ═══════════════════════════════════════════════════════════════════

function loadEffectMode() {
  if (!fs.existsSync(EFFECT_MODE_FILE)) return 'auto';
  try {
    const data = JSON.parse(fs.readFileSync(EFFECT_MODE_FILE, 'utf8'));
    return EFFECT_MODES.includes(data.mode) ? data.mode : 'auto';   // auch das frühere "manual" wird zu auto
  } catch { return 'auto'; }
}

function saveEffectMode(mode) {
  fs.writeFileSync(EFFECT_MODE_FILE, JSON.stringify({ mode }, null, 2), 'utf8');
}

let effectMode = loadEffectMode();       // Startet mit dem zuletzt gespeicherten Modus

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

// ═══════════════════════════════════════════════════════════════════
// MODULE (ADR 0027) – Anmeldung über core/modules.js; Topics ist das erste umgezogene Modul
// ═══════════════════════════════════════════════════════════════════

const moduleHost = createModuleHost();
moduleHost.add(createTopicsModule({
  isEnabled: () => moduleSwitches.topics,
  switchModule: on => switchModule('topics', on),
  stateLabel: () => moduleStateLabel('topics'),
  scheduleEffect: (type, meta) => scheduleEffect(type, meta),
  logIfChanged,
  isLocalWidgetRequest,
  requireAdminWrite: (req, res, next) => requireAdminWrite(req, res, next),
  adminJsonLimit: ADMIN_JSON_LIMIT,
  deckPath: DECK_PATH,
}));

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
  console.log(`${name} ${on ? 'aktiviert' : `deaktiviert – ${MODULE_OFF_TEXT[key] || 'Befehle im Chat werden ignoriert'}`} (gespeichert, gilt auch nach Neustart)`);
  return true;
}

// Für Konsole und Webkonsole: Schalter setzen samt den Folgen für das jeweilige Modul
function switchModule(key, on) {
  const changed = setModuleSwitch(key, on);
  if (key === 'bdu' && !on && changed && bduPending.size) {
    // Antworten auf bereits weitergereichte Anfragen nicht mehr posten
    for (const [id, p] of bduPending) { clearTimeout(p.timer); bduPending.delete(id); }
    console.log('[BdU] Offene Anfragen verworfen');
  }
  moduleHost.emit('module.switched', { key, on, changed });   // z. B. Intro-Topics blendet aus bzw. ein
  if (key === 'uboat' && on && !uboatCrew) {
    console.log('[UBOAT] Hinweis: UBOAT_SAVES_DIR ist nicht gesetzt – das Soldbuch antwortet erst, wenn der Ordner in der .env steht (Neustart nötig)');
  }
  if (key === 'kartei' && on) {
    if (!karteiConfigured) console.log('[Kartei] Hinweis: STREAM_KARTEI_REPO und STREAM_KARTEI_TOKEN sind nicht gesetzt – es wird nichts veröffentlicht (.env, Neustart nötig)');
    else if (changed) requestKartei();
  }
  return changed;
}

// Setzt den Effekt-Modus (Webkonsole und Konsole).
function setEffectMode(mode) {
  effectMode = mode;
  saveEffectMode(mode);
  console.log(`Effekt-Modus geändert auf: ${mode.toUpperCase()}`);
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

// Stille Effekte (Intro-Topics): kein Log, kein Event-Log, keine Statistik; mit "topics debug on" im Log sichtbar.
function isSilentEffect(type) {
  return SILENT_EFFECT_TYPES.has(type);
}

function enqueueEffect(type, count, meta) {
  effectQueue.push({ type, count, meta, queuedAt: Date.now() });
  if (!isSilentEffect(type) || moduleHost.silentEffectsVisible()) console.log(`Effekt eingereiht: ${type} (${count}x) - Queue-Länge jetzt: ${effectQueue.length}`);
  processEffectQueue();
}

function describeEffect(type, meta, count) {
  if (type === 'follow') return count > 1 ? `${count} neue Follower, zuletzt @${meta.userName}` : `@${meta.userName}`;
  if (type === 'sub')    return count > 1 ? `${count} neue Subs, zuletzt @${meta.userName}` : `@${meta.userName}`;
  if (type === 'gift')   return `@${meta.userName} verschenkt ${meta.giftCount || 1} Sub(s)`;
  if (type === 'topic_active' || type === 'topic_done') return `Thema ${meta.index + 1}/${meta.total} „${meta.title}“`;
  if (type === 'topics_complete') return `alle ${meta.total} Themen erledigt`;
  return JSON.stringify(meta);
}

async function triggerEffect(job) {
  const { type, count, meta } = job;
  const silent = isSilentEffect(type);
  if (!silent || moduleHost.silentEffectsVisible()) console.log(`Effekt ausgelöst: ${type}${count > 1 ? ` (${count}x gebündelt)` : ''} – ${describeEffect(type, meta, count)}`);
  if (!silent) {
    stats.count('effects');
    appendEvent(type, { ...meta, count });
  }

  if (HA_WEBHOOK_URL) {
    try {
      await axios.post(HA_WEBHOOK_URL, { type, count, meta, timestamp: new Date().toISOString() });
    } catch (err) {
      const detail = err.response?.data || err.message;
      // Stille Effekte: ein kaputter Webhook soll auffallen, aber nicht bei jedem Tastendruck erneut
      if (silent) logIfChanged('topics-ha-error', `Fehler beim Senden an Home Assistant Webhook (Intro-Topics): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, 'error');
      else console.error('Fehler beim Senden an Home Assistant Webhook:', detail);
    }
  }
}

// Arbeitet die effectQueue strikt nacheinander ab, mit Mindestabstand
// zwischen zwei Effekten — verhindert Überlappungen bei Lichteffekten
// und respektiert den aktuell aktiven Modus (Auto/Off).
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
      await triggerEffect(job);
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

// Login, Bot-Freigabe, Rückkehr von Twitch und Token für Widgets: /login, /login-bot, /callback, /token (core/auth.js)
auth.routes(app);

// ── BdU-Chat: Verbindung des Enigma-Widgets (Server-Sent Events); isLocalWidgetRequest liegt in core/http.js ──

// ── Chat-Brücke für lokale Verbraucher (Spec chat-bruecke.md, Teil A, Issue #74, ADR 0025) ──
// Verbraucher melden Befehle oder Präfixe an und bekommen passende Chat-Nachrichten als Ereignis; sie senden über den Server.
const chatBridgeClients = [];             // {res, client, commands, prefixes, ping}
const chatBridgeLastSend = new Map();     // feature -> Zeitpunkt des letzten Versands

function chatBridgeExcludedLogins() {
  const bot = loadBotConfig();
  return [...STATS_EXCLUDED_CHATTERS, ...(bot && bot.bot_login ? [String(bot.bot_login).toLowerCase()] : [])];
}

function writeChatBridgeEvent(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* Verbindung schon zu; close räumt auf */ }
}

function forwardChatToBridge(evt) {
  if (!chatBridgeClients.length) return;
  if (!chatBridge.isForwardable(evt, { excludedLogins: chatBridgeExcludedLogins(), serverCommands: SERVER_CHAT_COMMANDS })) return;
  let payload = null;
  for (const client of chatBridgeClients) {
    if (!chatBridge.matches(client, evt.message.text)) continue;
    payload = payload || chatBridge.chatEvent(evt, { isPrivate: isPrivateUser });
    writeChatBridgeEvent(client, 'chat', payload);
  }
}

// Teil B: wer im eigenen Kanal schreibt (ohne Broadcaster, Bots, fremden geteilten Chat, !privat), für Coins in der RimWorld-Mod
const activeChatters = chatBridge.createActiveChatters({ windowMs: CHAT_ACTIVE_WINDOW_MS, max: CHAT_ACTIVE_MAX });

function noteActiveChatter(evt) {
  if (!isCountedChatter(evt)) return;
  if (chatBridgeExcludedLogins().includes(String(evt.chatter_user_login || '').toLowerCase())) return;
  if (isPrivateUser(String(evt.chatter_user_id))) return;
  activeChatters.note(evt);
}

app.get(CHAT_ACTIVE_PATH, (req, res) => {
  if (!isLocalWidgetRequest(req, CHAT_ACTIVE_PATH)) return res.status(403).json({ error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  res.json(activeChatters.snapshot());
});

app.get(CHANNEL_INFO_PATH, (req, res) => {
  if (!isLocalWidgetRequest(req, CHANNEL_INFO_PATH)) return res.status(403).json({ error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  res.json({ category: currentCategory, categoryChangedAt: currentCategoryChangedAt, live: streamSession.snapshot().status === 'live', updatedAt: currentCategoryConfirmedAt });
});

function notifyPrivacyChange(userId, userLogin, isPrivate) {
  if (isPrivate) activeChatters.remove(userId);   // Teil B: fällt sofort aus der Liste der aktiven Chatter
  const data = { userId: String(userId), userLogin: userLogin || null, private: Boolean(isPrivate), at: new Date().toISOString() };
  for (const client of chatBridgeClients) writeChatBridgeEvent(client, 'privacy', data);
}

// Teil D (#80): eingehender Raid an alle verbundenen Verbraucher; doppelte Zustellung filtert isDuplicateMessage vorher (ADR 0009)
function notifyRaidToBridge(evt, messageId) {
  if (!chatBridgeClients.length) return;
  const data = chatBridge.raidEvent(evt, messageId);
  for (const client of chatBridgeClients) writeChatBridgeEvent(client, 'raid', data);
  console.log(`[Chat-Brücke] Raid von @${data.fromLogin} an ${chatBridgeClients.length} Verbraucher gemeldet`);
}

app.get(CHAT_BRIDGE_STREAM_PATH, (req, res) => {
  if (!isLocalWidgetRequest(req, CHAT_BRIDGE_STREAM_PATH)) {
    return res.status(403).json({ error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  }
  const sub = chatBridge.parseSubscription(req.query);
  if (sub.error) return res.status(400).json({ error: sub.error });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
  res.write('retry: 5000\n\n');
  const client = { res, ...sub, connectedAt: Date.now() };
  const bot = loadBotConfig();
  writeChatBridgeEvent(client, 'hello', { server: 'twitch-companion-js-server', version: APP_VERSION, client: sub.client, commands: sub.commands, prefixes: sub.prefixes, botLogin: bot ? bot.bot_login : null });
  client.ping = setInterval(() => res.write(': ping\n\n'), CHAT_BRIDGE_PING_MS);
  chatBridgeClients.push(client);
  console.log(`[Chat-Brücke] ${sub.client} verbunden (${[...sub.commands, ...sub.prefixes.map(p => `${p}…`)].join(', ')}; verbunden: ${chatBridgeClients.length})`);
  req.on('close', () => {
    clearInterval(client.ping);
    const i = chatBridgeClients.indexOf(client);
    if (i >= 0) chatBridgeClients.splice(i, 1);
    console.log(`[Chat-Brücke] ${sub.client} getrennt (verbunden: ${chatBridgeClients.length})`);
  });
});

app.post(CHAT_BRIDGE_SEND_PATH, express.json({ limit: CHAT_BRIDGE_JSON_LIMIT }), async (req, res) => {
  if (!isLocalWidgetRequest(req, CHAT_BRIDGE_SEND_PATH)) {
    return res.status(403).json({ ok: false, sent: false, error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  }
  if (!req.is('application/json')) return res.status(415).json({ ok: false, sent: false, error: 'Content-Type application/json erwartet' });
  const { feature, message } = req.body || {};
  if (typeof feature !== 'string' || !CHAT_BRIDGE_FEATURES.includes(feature)) return res.status(400).json({ ok: false, sent: false, error: `feature muss eine von ${CHAT_BRIDGE_FEATURES.join(', ')} sein` });
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return res.status(400).json({ ok: false, sent: false, error: 'message fehlt oder ist leer' });
  if (!loadTokens()) return res.status(503).json({ ok: false, sent: false, error: 'Broadcaster nicht angemeldet' });
  const since = Date.now() - (chatBridgeLastSend.get(feature) || 0);
  if (since < CHAT_BRIDGE_MIN_GAP_MS) {
    return res.status(429).json({ ok: false, sent: false, error: 'zu schnell, höchstens eine Nachricht je Sekunde', retryAfterMs: CHAT_BRIDGE_MIN_GAP_MS - since });
  }
  chatBridgeLastSend.set(feature, Date.now());
  const sender = chatSenders[feature] === 'bot' && loadBotConfig() ? 'bot' : 'broadcaster';
  const sent = await sendChatMessage(text, null, feature);
  res.json({ ok: true, sent: Boolean(sent), sender });
});

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

// ── !privat: Liste für Widgets, damit sie ausgenommene Zuschauer weglassen (Issue #44). Nur lokal, wie /token ──
app.get(PRIVACY_OPTOUTS_PATH, (req, res) => {
  if (!isLocalWidgetRequest(req, PRIVACY_OPTOUTS_PATH)) {
    return res.status(403).json({ error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  }
  res.json({ userIds: Object.keys(privacyOptouts) });
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
    stats.count('enigma_answers');
    console.log(`[BdU] Antwort an @${pending.userLogin} gepostet (${Math.round((Date.now() - pending.acceptedAt) / 1000)} s nach Annahme)`);
    return res.json({ ok: true });
  }
  if (status === 'quota') {
    startBduSilence(String(error || ''));
    return res.json({ ok: true, silenceUntil: bduSilenceUntil });
  }
  console.log(`[BdU] Widget meldet Fehler zur Anfrage von @${pending.userLogin}: ${error || status || 'unbekannt'}`);
  failBduRequest(pending);
  res.json({ ok: true });
});

// ── Ergebniszeilen (Spec wetten-abstimmungen.md, Schritt 3b): einmal je Wette/Abstimmung, die dieser Prozess offen
// gesehen hat, auch verspätet über die Kontrolle; gesendet nur mit eingeschaltetem Schalter, sonst nur ins Log ──
const RESULT_LOG_PREFIX = { prediction: '[Wette]', poll: '[Abstimmung]' };

async function announceResult(line, text) {
  if (!text) return;
  if (!chatResults[line]) {
    console.log(`${RESULT_LOG_PREFIX[line]} Ergebniszeile nicht gesendet, Schalter aus (results ${line} on): ${text}`);
    return;
  }
  if (await sendChatMessage(text, null, line)) console.log(`${RESULT_LOG_PREFIX[line]} Ergebniszeile gesendet: ${text}`);
}

const predictionAnnouncer = createResultAnnouncer({
  idKey: 'predictionId', openStatuses: ['ACTIVE', 'LOCKED'], finalStatuses: ['RESOLVED', 'CANCELED'],
  onFinal: s => announceResult('prediction', predictionResultMessage(s, { isPrivate: isPrivateUser })),   // bei CANCELED keine Zeile
});
const pollAnnouncer = createResultAnnouncer({
  idKey: 'pollId', openStatuses: ['ACTIVE'], finalStatuses: ['COMPLETED', 'TERMINATED', 'ARCHIVED'],
  onFinal: s => announceResult('poll', pollResultMessage(s)),
});

// ── Wette (Prediction): Stand aus EventSub, Endpunkt fragt Twitch nicht (ADR 0023, Spec wetten-abstimmungen.md) ──
// Ausgangsstand einmal je Verbindung, Kontrolle nach PREDICTION_RECHECK_MS ohne Ereignis, solange die Wette offen ist.
const predictionTracker = createPredictionTracker({
  fetchLatest: async () => {
    await getValidAccessToken();
    const res = await twitchApi.get(`/predictions?broadcaster_id=${loadTokens().broadcaster_id}&first=1`);
    return res.data?.data?.[0] || null;
  },
  recheckMs: PREDICTION_RECHECK_MS,
  onChange: s => {
    logIfChanged('prediction', s.status === 'WAITING'
      ? '[Wette] keine Wette bekannt – Status: WAITING'
      : `[Wette] „${s.title}“ – Status: ${s.status}`);
    predictionAnnouncer.observe(s);
  },
  onError: err => logIfChanged('prediction', `[Wette] Abruf bei Twitch gescheitert, letzter Stand bleibt: ${err.response?.data?.message || err.message}`, 'warn'),
});

app.get(PREDICTION_PATH, (req, res) => {
  res.json(predictionTracker.snapshot());
});

// ── Abstimmung (Poll): wie die Wette, Stand aus channel.poll.*, Endpunkt fragt Twitch nicht ──
const pollTracker = createPollTracker({
  fetchLatest: async () => {
    await getValidAccessToken();
    const res = await twitchApi.get(`/polls?broadcaster_id=${loadTokens().broadcaster_id}&first=1`);
    return res.data?.data?.[0] || null;
  },
  recheckMs: POLL_RECHECK_MS,
  onChange: s => {
    logIfChanged('poll', s.status === 'WAITING'
      ? '[Abstimmung] keine Abstimmung bekannt – Status: WAITING'
      : `[Abstimmung] „${s.title}“ – Status: ${s.status}`);
    pollAnnouncer.observe(s);
    deliverConsumerPollResult(s);
  },
  onError: err => logIfChanged('poll', `[Abstimmung] Abruf bei Twitch gescheitert, letzter Stand bleibt: ${err.response?.data?.message || err.message}`, 'warn'),
});

app.get(POLL_PATH, (req, res) => {
  res.json(pollTracker.snapshot());
});

// ── Abstimmung im Auftrag eines lokalen Verbrauchers (Spec chat-bruecke.md, Teil C, Issue #81) ──
// Der Server legt die Twitch-Abstimmung an und meldet den Endstand einmal als poll_result an die Verbindungen
// des startenden Verbrauchers im Ereignisstrom. Aufträge nur im Arbeitsspeicher; nach einem Neustart verloren.
const consumerPollRequests = consumerPolls.createPollRequests({ maxAgeMs: POLL_REQUEST_MAX_AGE_MS });
let consumerPollLastStart = 0;
let consumerPollScopeMissing = false;   // Twitch meldete fehlenden Scope; bis zur nächsten Anmeldung nicht erneut fragen

function deliverConsumerPollResult(snapshot) {
  const client = consumerPollRequests.takeFinal(snapshot);
  if (!client) return;
  const targets = chatBridgeClients.filter(c => c.client === client);
  const data = consumerPolls.resultEvent(snapshot);
  for (const target of targets) writeChatBridgeEvent(target, 'poll_result', data);
  console.log(targets.length
    ? `[Abstimmung] Ergebnis an ${client} gemeldet (${snapshot.status})`
    : `[Abstimmung] Ergebnis für ${client} verworfen: nicht verbunden (${snapshot.status})`);
}

function rejectPollStart(res, status, reason, error, extra = {}) {
  return res.status(status).json({ ok: false, reason, error, ...extra });
}

app.post(POLL_START_PATH, express.json({ limit: CHAT_BRIDGE_JSON_LIMIT }), async (req, res) => {
  if (!isLocalWidgetRequest(req, POLL_START_PATH)) return rejectPollStart(res, 403, 'forbidden', 'Nur für lokale Aufrufe über localhost oder 127.0.0.1');
  if (!req.is('application/json')) return rejectPollStart(res, 415, 'invalid', 'Content-Type application/json erwartet');
  const start = consumerPolls.validateStart(req.body);
  if (start.error) return rejectPollStart(res, 400, 'invalid', start.error);
  const tokens = loadTokens();
  if (!tokens) return rejectPollStart(res, 503, 'not_logged_in', 'Broadcaster nicht angemeldet');
  if (consumerPollScopeMissing) return rejectPollStart(res, 403, 'missing_scope', 'Dem Broadcaster-Token fehlt channel:manage:polls (SCOPES ergänzen, /login neu)');
  const current = pollTracker.snapshot();
  const endsMs = Date.parse(current.endsAt);
  if (pollTracker.isOpen() && !(endsMs < Date.now())) {
    return rejectPollStart(res, 409, 'poll_active', 'Es läuft schon eine Abstimmung', { activePollId: current.pollId, endsAt: current.endsAt || null });
  }
  const since = Date.now() - consumerPollLastStart;
  if (since < POLL_START_MIN_GAP_MS) return rejectPollStart(res, 429, 'too_fast', 'höchstens ein Startversuch je 5 Sekunden', { retryAfterMs: POLL_START_MIN_GAP_MS - since });
  consumerPollLastStart = Date.now();
  try {
    await getValidAccessToken();
    const response = await twitchApi.post('/polls', consumerPolls.helixBody(tokens.broadcaster_id, start));
    const created = response.data?.data?.[0];
    if (!created || !created.id) return rejectPollStart(res, 502, 'twitch_error', 'Twitch hat keine Abstimmung zurückgegeben');
    consumerPollRequests.add(created.id, start.client);
    pollTracker.applyHelix(created);   // offen gesehen, auch wenn channel.poll.begin ausbleibt; Kontrolle läuft
    const s = pollTracker.snapshot();
    console.log(`[Abstimmung] ${start.client} startet „${start.title}“ (${start.choices.length} Optionen, ${start.durationS} s${start.channelPointsPerVote ? `, Zusatzstimme ${start.channelPointsPerVote} Kanalpunkte` : ''})`);
    res.json({ ok: true, pollId: created.id, startedAt: created.started_at || null, endsAt: s.pollId === created.id ? s.endsAt : null });
  } catch (err) {
    const c = consumerPolls.classifyCreateError(err);
    if (c.reason === 'missing_scope') consumerPollScopeMissing = true;
    console.warn(`[Abstimmung] Start für ${start.client} abgelehnt (${c.reason}): ${c.error}`);   // höchstens alle 5 s
    rejectPollStart(res, c.status, c.reason, c.error);
  }
});

// ── Zuschauerzahl (ADR 0023): Der Server fragt Twitch im festen Takt, Widgets bekommen nur den letzten Stand ──
const streamViewers = { live: false, viewers: null, updatedAt: null };

async function pollStreamViewers() {
  // Nur während der Erfassung live fragen; ohne Statistik immer, damit Widgets trotzdem eine Zahl bekommen
  if (STATS_ENABLED && streamSession.snapshot().status !== 'live') {
    if (streamViewers.live) Object.assign(streamViewers, { live: false, viewers: null, updatedAt: new Date().toISOString() });
    return;
  }
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    const res = await twitchApi.get(`/streams?user_id=${tokens.broadcaster_id}`);
    const live = res.data?.data?.[0];
    const isLive = Boolean(live && live.type === 'live');
    Object.assign(streamViewers, { live: isLive, viewers: isLive ? live.viewer_count : null, updatedAt: new Date().toISOString() });
    if (isLive) streamSession.noteViewers(live.viewer_count);
    logIfChanged('stream-viewers', '[Zuschauer] Abfrage bei Twitch läuft');
  } catch (err) {
    logIfChanged('stream-viewers', `[Zuschauer] Abfrage bei Twitch gescheitert, letzter Stand bleibt: ${err.response?.data?.message || err.message}`, 'warn');
  }
}
setInterval(pollStreamViewers, STREAM_VIEWERS_POLL_MS).unref();

app.get(STREAM_VIEWERS_PATH, (req, res) => {
  res.json({ live: streamViewers.live, viewers: streamViewers.viewers, updatedAt: streamViewers.updatedAt });
});

// Glückspilz des Abends (Spec wetten-abstimmungen.md, Schritt 4): Stand des erfassten Streams, ohne Twitch-Anfrage.
// Nur Namen und Punkte, keine IDs; !privat erscheint als „anonymer Schlaumeier“.
app.get(STREAM_LUCKY_PATH, (req, res) => {
  const s = streamSession.snapshot();
  res.json({
    stream: s.status,
    startedAt: s.started_at,
    luckyBettors: s.lucky_bettors.map(b => ({ name: b.name, net: b.net, bets: b.bets })),
    bettors: s.bettors,
    predictions: (s.counters && s.counters.predictions) || 0,
  });
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

// Aktuellen Modus + Queue-Status abfragen (z.B. für ein Status-Widget)
app.get('/api/effects/mode', (req, res) => {
  res.json({
    mode: effectMode,
    queueLength: effectQueue.length
  });
});

// ═══════════════════════════════════════════════════════════════════
// INTRO-TOPICS UND STREAM DECK (ADR 0020, ADR 0021) – nur vom eigenen Rechner
// ═══════════════════════════════════════════════════════════════════

// Endpunkte der Module für Widgets und Stream Deck (Intro-Topics: /api/topics, /api/topics/stream, POST /api/topics/:action)
moduleHost.mountRoutes(app, 'widget');

// Übersicht für das Stream-Deck-Plugin (docs/specs/stream-deck.md)
app.get(DECK_PATH, (req, res) => {
  if (!isLocalWidgetRequest(req, DECK_PATH)) return res.status(403).json({ ok: false, error: 'Nur für lokale Aufrufe über localhost oder 127.0.0.1' });
  res.json({
    server: 'twitch-companion-js-server',
    version: APP_VERSION,
    actions: {
      topics: { enabled: Boolean(moduleSwitches.topics) },
      clip: { enabled: false, stream_live: streamSession.snapshot().status === 'live' },   // folgt mit Fahrplan-Schritt 7
    },
  });
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
    bot_features: botFeatures(),
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
    stream: overviewStream(),
    twitch_api: twitchApi.stats(),
    chat_senders: chatSenderList(),
    chat_results: chatResultList(),
    // Chat-Brücke (ADR 0025): wer gerade verbunden ist, für das Licht in der Webkonsole (Name und Version folgen mit #70)
    chat_bridge: { clients: chatBridgeClients.map(c => ({ client: c.client, connectedAt: new Date(c.connectedAt).toISOString() })) },
    kartei: karteiOverview(),   // Stream-Kartei (ADR 0026), ohne Token
    recent_effects: loadEventLog().slice(-ADMIN_RECENT_EFFECTS).reverse().map(e => ({
      type: e.type,
      count: e.count,
      userName: e.userName || null,
      giftCount: e.giftCount || null,
      skipped: Boolean(e.skippedManualTimeout),
      timestamp: e.timestamp
    })),
    subgoal: { current, target, title, status, lastUpdated },
    ...moduleHost.overview(),   // je Modul unter seinem Namen, z. B. topics: {visible, step, total, complete, current, clients}
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

// Wurde der Bericht des letzten Streams gelöscht, keinen toten Link anbieten
function withReportState(s) {
  if (!s || !s.report_id || streamReports.exists(s.report_id)) return s;
  return { ...s, report_id: null, report_deleted: true };
}

function statsWithReportState() {
  const snap = stats.snapshot();
  return { ...snap, stream: withReportState(snap.stream) };
}

// Für die Hauptseite: Stand der Stream-Erfassung, Abschlussmeldung und Hinweise
function overviewStream() {
  const s = withReportState(streamSession.snapshot());
  return {
    status: s.status,
    started_at: s.started_at,
    ended_at: s.ended_at,
    closes_at: s.closes_at,
    close_reason: s.close_reason,
    report_id: s.report_id,
    report_deleted: Boolean(s.report_deleted),
    warnings: s.status === 'closed' ? reportWarnings(s, STREAM_REPORT_SHORT_SECONDS) : [],
    viewers: { current: streamViewers.live ? streamViewers.viewers : null, updated_at: streamViewers.updatedAt, peak: s.viewers.peak, average: s.viewers.average },
  };
}

app.get(ADMIN_STATS_PATH, (req, res) => res.json(statsWithReportState()));

app.get(ADMIN_REPORTS_PATH, (req, res) => res.json({ reports: streamReports.list(), totals: streamReports.totals() }));

// Lesbarer Bericht, zum Öffnen im Browser
app.get(`${ADMIN_REPORTS_PATH}/:id`, (req, res) => {
  if (!isReportId(req.params.id)) return res.status(400).json({ error: 'Ungültige Bericht-ID' });
  const text = streamReports.text(req.params.id);
  if (text === null) return res.status(404).json({ error: 'Bericht nicht gefunden' });
  res.set('X-Content-Type-Options', 'nosniff');
  res.type('text/plain; charset=utf-8').send(text);
});

app.post(`${ADMIN_REPORTS_PATH}/delete`, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), (req, res) => {
  const id = req.body && req.body.id;
  if (!isReportId(id)) return res.status(400).json({ error: 'Ungültige Bericht-ID' });
  if (!streamReports.remove(id)) return res.status(404).json({ error: 'Bericht nicht gefunden' });
  res.json({ ok: true, id });
});

app.post(ADMIN_STREAM_CLOSE_PATH, requireAdminWrite, (req, res) => {
  if (!streamSession.closeManually()) return res.status(409).json({ error: 'Es wird gerade kein Stream erfasst' });
  res.json({ ok: true, stream: statsWithReportState().stream });
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

app.post(ADMIN_MODULES_PATH, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), (req, res) => {
  const { module: key, enabled } = req.body || {};
  if (typeof key !== 'string' || !Object.hasOwn(MODULE_NAMES, key)) return res.status(400).json({ error: 'Unbekanntes Modul' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled muss true oder false sein' });
  const changed = switchModule(key, enabled);
  res.json({ ok: true, changed, modules: { ...moduleSwitches } });
});

// Stream-Kartei: „Jetzt veröffentlichen“ (hält Abstand und Änderungsprüfung ein, ADR 0026)
app.post(ADMIN_KARTEI_PUBLISH_PATH, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), (req, res) => {
  if (!karteiScheduler) return res.status(409).json({ error: 'Stream-Kartei ist nicht eingerichtet (STREAM_KARTEI_REPO und STREAM_KARTEI_TOKEN in .env)' });
  if (!moduleSwitches.kartei) return res.status(409).json({ error: 'Stream-Kartei ist ausgeschaltet' });
  requestKartei();
  res.json({ ok: true, kartei: karteiOverview() });
});

app.post(ADMIN_CHAT_SENDER_PATH, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), (req, res) => {
  const { feature, sender } = req.body || {};
  if (typeof feature !== 'string' || !Object.hasOwn(CHAT_FEATURES, feature)) return res.status(400).json({ error: 'Unbekannte Chat-Funktion' });
  if (!CHAT_SENDER_VALUES.includes(sender)) return res.status(400).json({ error: 'sender muss bot oder broadcaster sein' });
  const changed = setChatSender(feature, sender, 'Webkonsole');
  res.json({ ok: true, changed, chat_senders: chatSenderList() });
});

app.post(ADMIN_CHAT_RESULTS_PATH, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), (req, res) => {
  const { line, enabled } = req.body || {};
  if (typeof line !== 'string' || !Object.hasOwn(CHAT_RESULT_LINES, line)) return res.status(400).json({ error: 'Unbekannte Ergebniszeile' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled muss true oder false sein' });
  const changed = setChatResult(line, enabled, 'Webkonsole');
  res.json({ ok: true, changed, chat_results: chatResultList() });
});

// Endpunkte der Module für die Webkonsole, nach dem Schutz app.use('/api/admin', …) (Intro-Topics: /api/admin/topics…)
moduleHost.mountRoutes(app, 'admin');

app.post(ADMIN_EFFECT_MODE_PATH, requireAdminWrite, express.json({ limit: ADMIN_JSON_LIMIT }), (req, res) => {
  const mode = req.body && req.body.mode;
  if (!EFFECT_MODES.includes(mode)) return res.status(400).json({ error: 'Ungültiger Modus. Erlaubt: auto, off' });
  setEffectMode(mode);
  res.json({ ok: true, mode });
});

let adminExitRequested = false;

function endServerFromAdmin(res, exitCode, message) {
  if (adminExitRequested) return res.status(409).json({ error: 'Der Server wird bereits beendet' });
  adminExitRequested = true;
  console.log(`[Webkonsole] ${message} (PID ${process.pid}).`);
  res.json({ ok: true, pid: process.pid, at: new Date().toISOString() });
  streamSession.flush();
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
      await subscribeToOutgoingRaid(sessionId);
      await subscribeToChat(sessionId);
      await subscribeToStreamOnline(sessionId);
      await subscribeToStreamOffline(sessionId);
      await subscribeToPolls(sessionId);
      await subscribeToPredictions(sessionId);
      await subscribeToShoutoutCreate(sessionId);
      await subscribeToSubscriptions(sessionId);
      await subscribeToChatNotifications(sessionId);
      await subscribeToFollows(sessionId);
      await subscribeToChannelUpdate(sessionId);
      await subscribeToGoals(sessionId);
      await refreshSubGoalCache();   // Ausgangsstand einmal je Verbindung, danach aus den Goal-Ereignissen
      await predictionTracker.refresh();   // ebenso für die Wette
      await pollTracker.refresh();         // und die Abstimmung
      await refreshChannelCategory();
      await syncStreamWithTwitch();
    }

    if (msgType === 'notification') {
      const subType = msg.metadata.subscription_type;

      if (isDuplicateMessage(msg.metadata.message_id)) {
        console.log(`Doppelt zugestellte EventSub-Nachricht ignoriert (${subType}, ID: ${msg.metadata.message_id})`);
        return;
      }

      if (subType === 'channel.raid') {
        const evt = msg.payload.event;
        if (evt.from_broadcaster_user_id === loadTokens()?.broadcaster_id) {
          console.log(`Ausgehender Raid zu @${evt.to_broadcaster_user_login}`);
          streamSession.onRaidOut();
        } else {
          stats.count('raids');
          notifyRaidToBridge(evt, msg.metadata.message_id);   // sofort, die Begrüßung wartet womöglich in der Warteschlange
          enqueueRaidEvent(evt);
        }
      }

      if (subType === 'channel.chat.message') {
        forwardChatToBridge(msg.payload.event);   // zuerst, damit Verbraucher nicht auf die übrigen Befehle warten
        noteActiveChatter(msg.payload.event);
        if (isCountedChatter(msg.payload.event)) {
          stats.count('chat_messages');
          streamSession.noteChatter(msg.payload.event.chatter_user_id, msg.payload.event.chatter_user_name || msg.payload.event.chatter_user_login);
        }
        await handleChatCommand(msg.payload.event);
        await handlePrivacyCommand(msg.payload.event);
        handleBduCommand(msg.payload.event);
        await handleUboatCommand(msg.payload.event);
        await handleWhitelistShoutout(msg.payload.event);
      }

      if (subType === 'channel.update') {
        setCurrentCategory(msg.payload.event.category_name || null, 'channel.update');
      }

      if (subType === 'channel.goal.begin' || subType === 'channel.goal.progress' || subType === 'channel.goal.end') {
        handleGoalEvent(subType, msg.payload.event);
      }

      if (POLL_EVENT_TYPES.includes(subType)) pollTracker.handleEvent(subType, msg.payload.event);
      if (subType === 'channel.poll.end') recordPollEnd(msg.payload.event);
      if (PREDICTION_EVENT_TYPES.includes(subType)) predictionTracker.handleEvent(subType, msg.payload.event);
      if (subType === 'channel.prediction.end') recordPredictionEnd(msg.payload.event);
      if (subType === 'channel.shoutout.create') stats.count('shoutouts');

      if (subType === 'stream.offline') {
        console.log('Twitch meldet: Stream ist offline');
        streamSession.onOffline();
      }

      if (subType === 'stream.online') {
        const onlineEvent = msg.payload.event;
        if (!onlineEvent.type || onlineEvent.type === 'live') {
          const startedBefore = streamSession.snapshot().started_at;
          streamSession.onOnline({ id: onlineEvent.id, startedAt: onlineEvent.started_at });
          pollStreamViewers();   // erster Wert gleich zu Beginn, danach im festen Takt
          // Neue Stream-Session (nicht Wiederaufnahme nach Unterbrechung): Module beginnen von vorn, z. B. Intro-Topics
          if (streamSession.snapshot().started_at !== startedBefore) moduleHost.emit('stream.new');
        }
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
          stats.count('follows');
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
        console.log(`Sub-Event (${subType}): ${evt.user_name || evt.user_login || 'anonym'}${describeSubEvent(subType, evt)}`);

        // Diese Events treffen oft Sekunden VOR der Chat-Ankündigung ein. Sie werden nur protokolliert;
        // die Effekte löst die Chat-Ankündigung aus (channel.chat.notification, handleChatNotification),
        // den Sub-Goal-Stand liefern die Goal-Ereignisse (handleGoalEvent).
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

// EventSub-Abo über die gemeinsame Twitch-API (Drosselung, Token; ADR 0024)
async function createEventSubSubscription(sessionId, type, version, condition) {
  await getValidAccessToken();
  return twitchApi.post('/eventsub/subscriptions',
    { type, version, condition, transport: { method: 'websocket', session_id: sessionId } },
    { headers: { 'Content-Type': 'application/json' } });
}

async function subscribeToRaid(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'channel.raid', '1', { to_broadcaster_user_id: tokens.broadcaster_id });
    console.log('Raid-Subscription aktiv');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.raid:', err.response?.data || err.message);
  }
}

// Twitch erlaubt je Abo nur from_ oder to_broadcaster_user_id, deshalb ein zweites Abo. Ein Raid beendet die Stream-Erfassung (ADR 0019).
async function subscribeToOutgoingRaid(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'channel.raid', '1', { from_broadcaster_user_id: tokens.broadcaster_id });
    console.log('Subscription für ausgehende Raids aktiv');
  } catch (err) {
    console.error('Fehler beim Abonnieren der ausgehenden Raids:', err.response?.data || err.message);
  }
}

async function subscribeToStreamOffline(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'stream.offline', '1', { broadcaster_user_id: tokens.broadcaster_id });
    console.log('Stream-Offline-Subscription aktiv (für die Statistik)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von stream.offline:', err.response?.data || err.message);
  }
}

// Nur für die Statistik: Fehlt ein Scope, steht das einmal im Fehlerprotokoll, der Rest läuft weiter.
async function subscribeForStats(sessionId, type, condition) {
  try {
    await createEventSubSubscription(sessionId, type, '1', condition);
    console.log(`${type}-Subscription aktiv (für die Statistik)`);
  } catch (err) {
    console.error(`Fehler beim Abonnieren von ${type}:`, err.response?.data || err.message);
  }
}

// Mehrere Abos derselben Bedingung; ein fehlendes bricht die übrigen nicht ab
async function subscribeToTypes(sessionId, types) {
  const condition = { broadcaster_user_id: loadTokens().broadcaster_id };
  for (const type of types) {
    try {
      await createEventSubSubscription(sessionId, type, '1', condition);
      console.log(`${type}-Subscription aktiv`);
    } catch (err) {
      console.error(`Fehler beim Abonnieren von ${type}:`, err.response?.data || err.message);
    }
  }
}

// Abstimmung: begin/progress/end für den Stand am Endpunkt, end zusätzlich für die Statistik
async function subscribeToPolls(sessionId) {
  await subscribeToTypes(sessionId, POLL_EVENT_TYPES);
}

// Wette: begin/progress/lock/end für den Stand am Endpunkt, end zusätzlich für die Statistik
async function subscribeToPredictions(sessionId) {
  await subscribeToTypes(sessionId, PREDICTION_EVENT_TYPES);
}

async function subscribeToShoutoutCreate(sessionId) {
  const { broadcaster_id: id } = loadTokens();
  await subscribeForStats(sessionId, 'channel.shoutout.create', { broadcaster_user_id: id, moderator_user_id: id });
}

function recordPollEnd(evt) {
  if (evt.status !== 'completed' && evt.status !== 'terminated') return;   // „archived“ meldet dieselbe Abstimmung noch einmal
  const choices = evt.choices || [];
  stats.count('polls');
  stats.count('poll_votes', choices.reduce((sum, c) => sum + (c.votes || 0), 0));
  const perVote = evt.channel_points_voting?.amount_per_vote || 0;
  stats.count('channel_points', choices.reduce((sum, c) => sum + (c.channel_points_votes || 0), 0) * perVote);
}

function recordPredictionEnd(evt) {
  if (evt.status !== 'resolved') return;   // bei „canceled“ gibt Twitch die Punkte zurück
  const outcomes = evt.outcomes || [];
  stats.count('predictions');
  stats.count('prediction_users', outcomes.reduce((sum, o) => sum + (o.users || 0), 0));
  stats.count('channel_points', outcomes.reduce((sum, o) => sum + (o.channel_points || 0), 0));
  streamSession.notePrediction(evt);   // Glückspilz des Abends (Spec wetten-abstimmungen.md, Schritt 4)
}

// Beim Verbinden: Ereignisse während einer Lücke könnten fehlen (ADR 0019).
async function syncStreamWithTwitch() {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    const res = await twitchApi.get(`/streams?user_id=${tokens.broadcaster_id}`);
    const live = res.data?.data?.[0];
    streamSession.reconcile(live && live.type === 'live' ? { id: live.id, startedAt: live.started_at } : null);
  } catch (err) {
    console.warn('[Statistik] Abgleich des Stream-Status gescheitert:', err.response?.data || err.message);
  }
}

async function subscribeToChat(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'channel.chat.message', '1', { broadcaster_user_id: tokens.broadcaster_id, user_id: tokens.broadcaster_id });
    console.log('Chat-Message-Subscription aktiv (für Mod-Befehle & Whitelist)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.chat.message:', err.response?.data || err.message);
  }
}

async function subscribeToStreamOnline(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'stream.online', '1', { broadcaster_user_id: tokens.broadcaster_id });
    console.log('Stream-Online-Subscription aktiv (für Whitelist-Reset & Sub-Goal-Refresh)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von stream.online:', err.response?.data || err.message);
  }
}

async function subscribeToSubscriptions(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    const condition = { broadcaster_user_id: tokens.broadcaster_id };

    const subTypes = ['channel.subscribe', 'channel.subscription.gift', 'channel.subscription.message'];
    for (const type of subTypes) {
      await createEventSubSubscription(sessionId, type, '1', condition);
      console.log(`${type}-Subscription aktiv`);
    }
  } catch (err) {
    console.error('Fehler beim Abonnieren der Sub-Events:', err.response?.data || err.message);
  }
}

async function subscribeToChatNotifications(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'channel.chat.notification', '1', { broadcaster_user_id: tokens.broadcaster_id, user_id: tokens.broadcaster_id });
    console.log('Chat-Notification-Subscription aktiv (löst Sub-/Gift-Effekte aus, sobald die Meldung im Chat erscheint)');
  } catch (err) {
    console.error('Fehler beim Abonnieren von channel.chat.notification (ohne diese Subscription gibt es KEINE Sub-/Gift-Effekte!):', err.response?.data || err.message);
  }
}

// Wertet Chat-Ankündigungen aus und speist die Effekte ein – exakt dann, wenn
// Twitch die Meldung im Chat anzeigt. Effekt-Typen und Metadaten bleiben
// identisch zu früher ('sub' mit userName, 'gift' mit userName/giftCount),
// damit die Home-Assistant-Webhooks unverändert ankommen.
// Broadcaster, genutzte Chat-Bots und Nachrichten aus fremden Kanälen (Shared Chat) zählen nicht (ADR 0019)
function isCountedChatter(evt) {
  if (evt.source_broadcaster_user_id && evt.source_broadcaster_user_id !== evt.broadcaster_user_id) return false;
  if (evt.chatter_user_id === evt.broadcaster_user_id) return false;
  return !STATS_EXCLUDED_CHATTERS.includes(String(evt.chatter_user_login).toLowerCase());
}

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
    console.log(`Chat-Ankündigung (${noticeType}): @${userName}${describeSubNotice(evt[noticeType])}`);
    stats.count('subs');
    scheduleEffect('sub', { userName });
    return;
  }

  // Gift-Bomb: EINE Kopfzeile pro Verschenk-Vorgang -> genau ein Gift-Effekt
  if (noticeType === 'community_sub_gift') {
    const total = (evt.community_sub_gift && evt.community_sub_gift.total) || 1;
    console.log(`Chat-Ankündigung (Gift-Bomb): @${userName} verschenkt ${total} Sub(s)`);
    stats.count('gifts', total);
    scheduleEffect('gift', { userName, giftCount: total });
    return;
  }

  // Einzelne Gift-Meldungen: gehören sie zu einem Gift-Bomb (community_gift_id gesetzt),
  // werden sie ignoriert; echte Einzel-Gifts lösen selbst einen Gift-Effekt aus.
  if (noticeType === 'sub_gift') {
    if (evt.sub_gift && evt.sub_gift.community_gift_id) return;
    console.log(`Chat-Ankündigung (Einzel-Gift): @${userName}`);
    stats.count('gifts');
    scheduleEffect('gift', { userName, giftCount: 1 });
    return;
  }

  // Nur protokollieren, damit sichtbar wird, was Twitch sonst noch meldet (z. B. gift_paid_upgrade)
  if (!CHAT_NOTICES_HANDLED_ELSEWHERE.includes(noticeType)) {
    console.log(`Chat-Ankündigung (${noticeType}) von @${userName} – nicht ausgewertet`);
  }
}

const subTierLabel = tier => SUB_TIER_LABELS[tier] || (tier ? `Stufe ${tier}` : null);

// Zusatzangaben für das Protokoll der EventSub-Sub-Ereignisse, z. B. „ – Stufe 1, nicht geschenkt“
function describeSubEvent(subType, evt) {
  const parts = [subTierLabel(evt.tier)];
  if (subType === 'channel.subscribe') parts.push(evt.is_gift ? 'geschenkt' : 'nicht geschenkt');
  if (subType === 'channel.subscription.gift') parts.unshift(`verschenkt ${evt.total || 1}`);
  if (subType === 'channel.subscription.message') {
    if (evt.cumulative_months) parts.push(`${evt.cumulative_months} Monate insgesamt`);
    if (evt.duration_months > 1) parts.push(`für ${evt.duration_months} Monate gekauft`);
  }
  const text = parts.filter(Boolean).join(', ');
  return text ? ` – ${text}` : '';
}

// Zusatzangaben aus der Chat-Ankündigung sub/resub, z. B. „, Prime“ oder „, Stufe 1, 8 Monate insgesamt“
function describeSubNotice(info) {
  if (!info) return '';
  const parts = [info.is_prime ? 'Prime' : subTierLabel(info.sub_tier)];
  if (info.cumulative_months) parts.push(`${info.cumulative_months} Monate insgesamt`);
  const text = parts.filter(Boolean).join(', ');
  return text ? `, ${text}` : '';
}

async function subscribeToFollows(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'channel.follow', '2', { broadcaster_user_id: tokens.broadcaster_id, moderator_user_id: tokens.broadcaster_id });
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
// Absender der Funktion feature ist der Bot (chatSenders) und der Bot ist eingerichtet: über den Bot (App-Token, ADR 0017),
// bei HTTP-Fehler Rückfall auf den Broadcaster.
// Sonst als Broadcaster. Fehler werden geloggt; Rückgabe true, wenn Twitch die Nachricht angenommen hat.
// options.broadcasterPrefix: nur beim Versand als Broadcaster vor den Text setzen (Absenderangabe, z. B. "FT vom BdU: ").
async function sendChatMessage(text, replyToMessageId = null, feature = null, options = {}) {
  const cut = t => (t.length > CHAT_MAX_CHARS ? t.slice(0, CHAT_MAX_CHARS - 1) + '…' : t);
  const logPrefix = { bdu: '[BdU] ', uboat: '[UBOAT] ', prediction: '[Wette] ', poll: '[Abstimmung] ', rimworld: '[RimWorld] ', coinflip: '[CoinFlip] ' }[feature] || '';
  const bot = feature && chatSenders[feature] === 'bot' ? loadBotConfig() : null;
  if (bot) {
    const result = await sendChatMessageAsBot(bot, cut(text), replyToMessageId, logPrefix);
    if (result !== 'fallback') return result;
  }
  const message = cut((options.broadcasterPrefix || '') + text);
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    const body = { broadcaster_id: tokens.broadcaster_id, sender_id: tokens.broadcaster_id, message };
    if (replyToMessageId) body.reply_parent_message_id = replyToMessageId;
    const response = await twitchApi.post('/chat/messages', body, { headers: { 'Content-Type': 'application/json' } });
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
  try {
    // App-Token; bei 401 holt twitchApi einmal einen neuen (abgelaufen oder widerrufen)
    const response = await twitchApi.post('/chat/messages', body, { auth: 'app', headers: { 'Content-Type': 'application/json' } });
    const sent = checkChatSendResult(response, message, logPrefix);
    if (sent) stats.count('bot_messages');
    return sent;
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
    await getValidAccessToken();
    const tokens = loadTokens();

    // 429 heißt hier „Shoutout-Wartezeit läuft“, nicht „zu viele Anfragen“: nicht warten und neu versuchen
    await twitchApi.post('/chat/shoutouts', null, {
      params: { from_broadcaster_id: tokens.broadcaster_id, to_broadcaster_id: toBroadcasterId, moderator_id: tokens.broadcaster_id },
      retryOn429: false,
    });
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
  if (await sendChatMessage(getLeaderboardText(), null, 'raidstats')) console.log('Leaderboard auf !raidstats-Befehl gesendet');
}

// ═══════════════════════════════════════════════════════════════════
// !PRIVAT – Zuschauer schalten um, ob sie in der Statistik mit Namen erscheinen (ADR 0022)
// An: bisherige Einträge im laufenden Stream und in allen Berichten werden anonymisiert,
// neue Nachrichten zählen als „anonymer Schlaumeier“. Aus: ab jetzt wieder mit Namen.
// ═══════════════════════════════════════════════════════════════════

const lastPrivacyCommandByUser = new Map();   // user_id -> Zeitpunkt

async function handlePrivacyCommand(evt) {
  const text = (evt.message?.text || '').trim().toLowerCase();
  if (text !== PRIVACY_COMMAND) return;
  // Shared Chat: Zuschauer anderer Kanäle erfasst der Server ohnehin nicht
  if (evt.source_broadcaster_user_id && evt.source_broadcaster_user_id !== evt.broadcaster_user_id) return;
  const userId = String(evt.chatter_user_id || '');
  if (!userId) return;

  const now = Date.now();
  if (now - (lastPrivacyCommandByUser.get(userId) || 0) < PRIVACY_COMMAND_COOLDOWN_MS) {
    console.log(`[Privat] ${PRIVACY_COMMAND} von @${evt.chatter_user_login} ignoriert – kurz zuvor schon umgeschaltet`);
    return;
  }
  lastPrivacyCommandByUser.set(userId, now);

  const turnOn = !isPrivateUser(userId);
  if (turnOn) privacyOptouts[userId] = new Date(now).toISOString();
  else delete privacyOptouts[userId];
  notifyPrivacyChange(userId, evt.chatter_user_login, turnOn);   // Chat-Brücke: Verbraucher löschen ggf. gespeicherte Daten
  rememberPrivacyName(userId, evt.chatter_user_login, evt.chatter_user_name);
  requestKartei({ urgent: turnOn });   // Stream-Kartei: Ausblenden sofort, Wiedereinblenden im normalen Takt
  try {
    savePrivacyOptouts(privacyOptouts);
  } catch (err) {
    console.error(`[Privat] ${PRIVACY_FILE} konnte nicht gespeichert werden: ${err.message}`);
  }

  if (turnOn) {
    const inStream = streamSession.anonymize(userId) ? 1 : 0;
    let reports = 0;
    try {
      reports = streamReports.anonymize(userId, PRIVACY_ANON_NAME);
    } catch (err) {
      console.error(`[Privat] Berichte konnten nicht anonymisiert werden: ${err.message}`);
    }
    console.log(`[Privat] @${evt.chatter_user_login} hat den Privatmodus eingeschaltet (anonymisiert: laufender Stream ${inStream ? 'ja' : 'nein'}, Berichte ${reports})`);
  } else {
    console.log(`[Privat] @${evt.chatter_user_login} hat den Privatmodus ausgeschaltet`);
  }
  await sendChatMessage(turnOn ? PRIVACY_TEXT_ON : PRIVACY_TEXT_OFF, evt.message_id, 'privacy');
}

// ═══════════════════════════════════════════════════════════════════
// BDU-CHAT – Funksprüche aus dem Chat an das Enigma-Widget (ADR 0014)
// Der Server erkennt "!BdU …", prüft Limits und Funkstille und postet die
// Antwort. Die Antwort selbst erzeugt das Widget mit seiner KI und seinem Kontext.
// ═══════════════════════════════════════════════════════════════════

const bduClients = [];                  // offene Events-Verbindungen der Widgets (zuletzt verbundenes erhält Anfragen)
const bduPending = new Map();           // id -> { messageId, userLogin, userKey, acceptedAt, prevLastAcceptedAt, dailyKey, timer }
const bduAcceptedByUser = new Map();    // user_id -> [Zeitpunkte angenommener Anfragen]
let bduLastAcceptedAt = 0;
let bduLastWarningAt = 0;
let bduLastErrorNoticeAt = 0;
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

// Anfrage gescheitert (Fehler des Widgets oder keine Antwort, Issue #99): nicht anrechnen, also globales Limit,
// Nutzerlimit und Tageszähler zurücknehmen, und höchstens alle BDU_ERROR_NOTICE_COOLDOWN_MS eine Störungsmeldung posten.
function failBduRequest(pending) {
  const times = bduAcceptedByUser.get(pending.userKey);
  if (times) {
    const i = times.indexOf(pending.acceptedAt);
    if (i >= 0) times.splice(i, 1);
    if (!times.length) bduAcceptedByUser.delete(pending.userKey);
  }
  if (bduLastAcceptedAt === pending.acceptedAt) bduLastAcceptedAt = pending.prevLastAcceptedAt;   // nur, wenn seitdem keine andere angenommen wurde
  if (bduDailyKey === pending.dailyKey && bduDailyCount > 0) bduDailyCount--;
  const now = Date.now();
  if (isBduSilenceActive(now)) {
    console.log(`[BdU] Anfrage von @${pending.userLogin} nicht angerechnet; keine Störungsmeldung während der Funkstille`);
    return;
  }
  if (now - bduLastErrorNoticeAt < BDU_ERROR_NOTICE_COOLDOWN_MS) {
    console.log(`[BdU] Anfrage von @${pending.userLogin} nicht angerechnet; keine Störungsmeldung (letzte vor ${Math.round((now - bduLastErrorNoticeAt) / 1000)} s)`);
    return;
  }
  bduLastErrorNoticeAt = now;
  console.log(`[BdU] Anfrage von @${pending.userLogin} nicht angerechnet; Störungsmeldung gepostet`);
  sendBduChatMessage(BDU_ERROR_TEXT, pending.messageId);
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

  // 6. Annehmen: zählt sofort; scheitert die KI, nimmt failBduRequest die Zählung zurück (Issue #99)
  const prevLastAcceptedAt = bduLastAcceptedAt;
  bduLastAcceptedAt = now;
  recent.push(now);
  bduAcceptedByUser.set(userKey, recent);
  bduDailyCount++;
  const id = `bdu-${now}-${++bduRequestCounter}`;
  const entry = { messageId: evt.message_id, userLogin: login, userKey, acceptedAt: now, prevLastAcceptedAt, dailyKey: bduDailyKey };
  entry.timer = setTimeout(() => {
    if (bduPending.get(id) !== entry) return;
    bduPending.delete(id);
    console.log(`[BdU] Keine Antwort des Widgets binnen ${BDU_ANSWER_TIMEOUT_MS / 1000} s – Anfrage von @${login} verworfen`);
    failBduRequest(entry);
  }, BDU_ANSWER_TIMEOUT_MS);
  bduPending.set(id, entry);
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
  await sendChatMessage(buildWhitelistShoutoutMessage(chatterName, activity), null, 'whitelist');
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
  await getValidAccessToken();
  const id = encodeURIComponent(userId);
  const [streamRes, videoRes, channelRes] = await Promise.all([
    twitchApi.get(`/streams?user_id=${id}`),
    twitchApi.get(`/videos?user_id=${id}&type=all&sort=time&first=20`),
    twitchApi.get(`/channels?broadcaster_id=${id}`)
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

  try {
    await getValidAccessToken();
  } catch (err) {
    console.error('Konnte Access-Token für Raid-Verarbeitung nicht laden:', err.message);
    return;
  }

  let game = null;   // null = unbekannt, Text dafür in buildGameMessage
  let durationStr = '';
  let startedAt = null;

  try {
    const [chanRes, streamRes] = await Promise.all([
      twitchApi.get(`/channels?broadcaster_id=${fromId}`),
      twitchApi.get(`/streams?user_id=${fromId}`)
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

  // Absender nach chatSenders.raid (Vorgabe Broadcaster). Shoutout nur, wenn Twitch die Begrüßung angenommen hat.
  if (!(await sendChatMessage(message, null, 'raid'))) {
    console.error(`Raid-Begrüßung für @${fromName} nicht gesendet – kein Shoutout`);
  } else {
    console.log(`Raid-Begrüßung erfolgreich gesendet für @${fromName}`);

    if (viewers >= RAID_SHOUTOUT_MIN_VIEWERS) {
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
      console.log(`Kein Shoutout – nur ${viewers} Viewer (Schwelle: ${RAID_SHOUTOUT_MIN_VIEWERS})`);
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

// Verlauf je Kampagne (Stream-Kartei 1c): Lebensläufe, die das Spiel später löscht, und Feindfahrten je Person.
// Geschrieben nur bei Änderung (neuer Lebenslauf, neue Feindfahrt), also selten.
function loadUboatHistory() {
  try { return uboatHistoryLib.normalize(JSON.parse(fs.readFileSync(UBOAT_HISTORY_FILE, 'utf8'))); }
  catch { return uboatHistoryLib.emptyHistory(); }
}
function saveUboatHistory(h) {
  fs.writeFileSync(UBOAT_HISTORY_FILE, JSON.stringify(h, null, 2));
}
let uboatHistory = loadUboatHistory();
let uboatHistoryPreview = null;   // Nachlesen: Vorschau bis "uboat nachlesen übernehmen" (nur im Arbeitsspeicher)
const uboatHistoryAdapter = {
  observe(res) { if (uboatHistoryLib.observe(uboatHistory, res)) saveUboatHistory(uboatHistory); },
  figure(key, name, birthTicks) { return uboatHistoryLib.figureOf(uboatHistory, key, name, birthTicks); },
};

const uboatCrew = uboatSavesDir
  ? createUboatCrew({
    savesDir: uboatSavesDir,
    knownGameVersions: UBOAT_KNOWN_GAME_VERSIONS,
    hiddenSkills: UBOAT_HIDDEN_SKILLS,
    settleMs: UBOAT_SAVE_SETTLE_MS,
    pollMs: UBOAT_POLL_MS,
    freshMs: UBOAT_FRESH_MS,
    onLoad: () => requestKartei(),   // Stream-Kartei: neuer Spielstand
    history: uboatHistoryAdapter,
  })
  : null;

// Nachlesen alter Spielstände derselben Kampagne: erst Vorschau, gespeichert erst nach Bestätigung (Nutzer, 22.11.2026)
async function uboatHistoryScan() {
  if (!uboatCrew) { console.log('UBOAT-Soldbuch: aus (UBOAT_SAVES_DIR in .env setzen)'); return; }
  if (!uboatCrew.getState().campaign) { console.log('[UBOAT] Kein Spielstand mit Kampagne gelesen – erst "uboat reload"'); return; }
  console.log(`[UBOAT] Nachlesen: Spielstände der Kampagne ${uboatCrew.getState().campaign} werden gelesen (je Datei etwa 1 s) …`);
  const scan = await uboatCrew.scanCampaignSaves();
  const pv = uboatHistoryLib.preview(uboatHistory, scan.saves.map(s => s.res));
  uboatHistoryPreview = { ...pv, campaign: scan.campaign, results: scan.saves.map(s => s.res) };
  console.log(`[UBOAT] Gelesen: ${scan.saves.length} Spielstände dieser Kampagne${scan.skipped.length ? `, ${scan.skipped.length} nicht lesbar` : ''}`);
  for (const s of scan.saves) {
    const k = s.res.career;
    console.log(`  ${formatDateDe(new Date(s.mtimeMs))}  ${s.name}  – Feindfahrt ${k.assignmentIndex}${k.atSea ? ', auf See' : ', im Hafen (zählt nicht)'}`);
  }
  const camp = pv.history.campaigns[scan.campaign] || { patrols: {}, persons: [] };
  console.log(`  Feindfahrten: ${Object.entries(camp.patrols).map(([n, d]) => `${n} (ab ${d || '?'})`).join(', ') || '–'}`);
  if (!pv.diff.length) { console.log('[UBOAT] Nichts Neues gegenüber dem Verlauf – nichts zu übernehmen'); uboatHistoryPreview = null; return; }
  console.log('[UBOAT] Würde übernommen (Name [früher …]: Feindfahrten an Bord; + neu; L = Lebenslauf gesichert):');
  for (const d of pv.diff) {
    const former = d.names.filter(n => n !== d.name);
    console.log(`  ${d.name}${former.length ? ` [früher ${former.join(', ')}]` : ''}: ${d.patrols.join(', ') || '–'}${d.newPatrols.length ? ` (+${d.newPatrols.join(', ')})` : ''}${d.newBackground ? ' L' : ''}`);
  }
  console.log('[UBOAT] Prüfen und mit "uboat nachlesen übernehmen" speichern oder mit "uboat nachlesen verwerfen" verwerfen');
}

function uboatHistoryApply() {
  if (!uboatHistoryPreview) { console.log('[UBOAT] Keine Vorschau – erst "uboat nachlesen"'); return; }
  // Auf den aktuellen Verlauf anwenden: Was seit der Vorschau aus neuen Spielständen dazukam, bleibt erhalten
  uboatHistory = uboatHistoryLib.preview(uboatHistory, uboatHistoryPreview.results).history;
  saveUboatHistory(uboatHistory);
  console.log(`[UBOAT] Nachlesen übernommen: ${uboatHistoryPreview.diff.length} Figuren ergänzt`);
  uboatHistoryPreview = null;
  if (uboatCrew) uboatCrew.rebuild();   // Crew mit Verlauf neu aufbauen; stößt die Stream-Kartei an
}

// Kontrolle einer Person: frühere Namen, Feindfahrten, Lebenslauf (Wunsch des Nutzers, 22.11.2026).
// Liest aus der Vorschau, solange eine offen ist, sonst aus dem gespeicherten Verlauf. Nur lokal in der Konsole,
// frühere Namen gehen nicht auf die Website.
function uboatHistoryShow(query) {
  if (!uboatCrew) { console.log('UBOAT-Soldbuch: aus (UBOAT_SAVES_DIR in .env setzen)'); return; }
  const campaign = uboatCrew.getState().campaign;
  if (!campaign) { console.log('[UBOAT] Kein Spielstand mit Kampagne gelesen – erst "uboat reload"'); return; }
  const fromPreview = Boolean(uboatHistoryPreview && uboatHistoryPreview.campaign === campaign);
  const h = fromPreview ? uboatHistoryPreview.history : uboatHistory;
  const hits = uboatHistoryLib.findPersons(h, campaign, query, normalizeCrewName);
  const where = fromPreview ? 'Vorschau, noch nicht übernommen' : 'gespeicherter Verlauf';
  if (!hits.length) { console.log(`[UBOAT] Verlauf: niemand mit Namen „${query}“ (${where}, Kampagne ${campaign})`); return; }
  console.log(`[UBOAT] Verlauf „${query}“ (${where}, Kampagne ${campaign}): ${hits.length} ${hits.length === 1 ? 'Person' : 'Personen'}`);
  for (const p of hits) {
    const d = uboatCrew.personDetails(p.name, p.birth, p.background);
    const former = p.names.filter(n => n !== p.name);
    const born = uboatHistoryLib.birthDate(p.birth);
    const head = [
      former.length ? `früher ${former.join(', ')}` : null,
      born ? `geboren ${formatDateDe(born)}` : null,
      d.member ? [d.member.typeLabel, d.member.statusLabel].filter(Boolean).join(', ') : 'nicht im aktuellen Spielstand',
    ].filter(Boolean).join('; ');
    console.log(`  ${p.name} – ${head}`);
    console.log(`    Feindfahrten an Bord: ${p.patrols.length ? `${p.patrols.join(', ')} (${p.patrols.length})` : 'keine'}`);
    const src = { save: 'steht im Spielstand', kept: 'gesichert, im Spielstand nicht mehr vorhanden' }[d.backgroundSource];
    if (!d.background) console.log('    Lebenslauf: keiner, weder im Spielstand noch im Verlauf (Offiziere haben im Spiel oft keinen)');
    else console.log(`    Lebenslauf (${src}): ${d.background.replace(/\s*\n\s*/g, ' / ')}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// STREAM-KARTEI (ADR 0026, docs/specs/stream-kartei.md) – letzter Stand der UBOAT-Crew öffentlich im Zweig
// „data“ von STREAM_KARTEI_REPO. Format und Takt in lib/stream-kartei.js, GitHub in lib/github-publisher.js.
// ═══════════════════════════════════════════════════════════════════

const karteiRepo = (STREAM_KARTEI_REPO || '').trim();
const karteiConfigured = Boolean((STREAM_KARTEI_TOKEN || '').trim()) && STREAM_KARTEI_REPO_PATTERN.test(karteiRepo);
const karteiPublisher = karteiConfigured
  ? createGithubPublisher({ http: axios, repo: karteiRepo, token: STREAM_KARTEI_TOKEN.trim(), branch: STREAM_KARTEI_BRANCH })
  : null;
const karteiPrivacyNames = new Map();   // Twitch-ID -> {login, name, at}; nur im Arbeitsspeicher

function rememberPrivacyName(userId, login, name) {
  karteiPrivacyNames.set(String(userId), { login: login ? String(login).toLowerCase() : null, name: name || null, at: Date.now() });
}

// Login und Anzeigename aller !privat-Zuschauer; null, wenn das gerade nicht geht (dann nicht veröffentlichen)
async function karteiPrivateNames() {
  const ids = Object.keys(privacyOptouts);
  const stale = ids.filter(id => { const e = karteiPrivacyNames.get(id); return !e || Date.now() - e.at > STREAM_KARTEI_PRIVACY_CACHE_MS; });
  if (stale.length) {
    if (!loadTokens()) return null;
    try {
      await getValidAccessToken();
      for (let i = 0; i < stale.length; i += 100) {
        const chunk = stale.slice(i, i + 100);
        const res = await twitchApi.get(`/users?${chunk.map(id => `id=${encodeURIComponent(id)}`).join('&')}`);
        const found = new Map((res.data?.data || []).map(u => [String(u.id), u]));
        for (const id of chunk) { const u = found.get(id); rememberPrivacyName(id, u ? u.login : null, u ? u.display_name : null); }   // gelöschte Konten: ohne Namen
      }
    } catch (err) {
      logIfChanged('kartei-privacy', `[Kartei] Namen der !privat-Zuschauer nicht abrufbar: ${err.response?.data?.message || err.message}`, 'warn');
      return null;
    }
  }
  return ids.map(id => karteiPrivacyNames.get(id)).filter(Boolean);
}

// Figuren der !privat-Zuschauer: nach denselben Regeln wie !soldbuch (Zuordnungsdatei, Login, Anzeigename)
function karteiHiddenNames(privateNames) {
  const map = loadUboatCrewMap();
  const hidden = new Set();
  for (const { login, name } of privateNames) {
    for (const n of [login && map[login], login, name]) { const key = normalizeCrewName(n); if (key) hidden.add(key); }
  }
  return hidden;
}

async function buildKarteiData() {
  if (!uboatCrew || !uboatCrew.hasData()) return { skip: 'noch kein UBOAT-Spielstand gelesen' };
  const privateNames = await karteiPrivateNames();
  if (!privateNames) return { skip: 'Namen der !privat-Zuschauer nicht ermittelbar' };
  const hidden = karteiHiddenNames(privateNames);
  return { data: kartei.buildUboatCrew(uboatCrew.getState(), { isHidden: m => hidden.has(normalizeCrewName(m.name)) }) };
}

const karteiScheduler = karteiPublisher
  ? kartei.createKarteiScheduler({
    minGapMs: STREAM_KARTEI_MIN_GAP_MS,
    isEnabled: () => moduleSwitches.kartei,
    build: buildKarteiData,
    readRemoteHash: async () => {
      const text = await karteiPublisher.readFile(kartei.UBOAT_PATH);
      return text ? kartei.contentHash(JSON.parse(text)) : null;
    },
    publish: async data => {
      const res = await karteiPublisher.publish(kartei.uboatFiles(data, new Date().toISOString()), `Stream-Kartei: UBOAT-Crew, Spielstand ${data.savedAt}`);
      console.log(`[Kartei] UBOAT-Crew veröffentlicht (${data.crew.length} an Bord oder in Reserve, ${data.fallen.length} gefallen)${res.created ? ` – Zweig ${STREAM_KARTEI_BRANCH} angelegt` : ''}`);
      karteiWarnExpiry();
    },
    log: (level, msg) => logIfChanged('kartei-state', msg, level),
  })
  : null;

function requestKartei(options) {
  if (karteiScheduler) karteiScheduler.request(options);
}

function karteiTokenExpiring() {
  const at = karteiPublisher && Date.parse(karteiPublisher.tokenExpiresAt());
  return Number.isFinite(at) && at - Date.now() <= STREAM_KARTEI_EXPIRY_WARN_MS;
}

function karteiWarnExpiry() {
  if (!karteiTokenExpiring()) return;
  logIfChanged('kartei-expiry', `[Kartei] Das GitHub-Token läuft am ${formatDateDe(karteiPublisher.tokenExpiresAt())} ab – bei GitHub erneuern und STREAM_KARTEI_TOKEN in der .env ersetzen`, 'warn');
}

function karteiOverview() {
  const s = karteiScheduler ? karteiScheduler.snapshot() : null;
  return {
    configured: karteiConfigured,
    repo: karteiConfigured ? karteiRepo : null,
    site_url: karteiConfigured ? `https://${karteiRepo.split('/')[0].toLowerCase()}.github.io/${karteiRepo.split('/')[1]}/` : null,
    last_published_at: s ? s.lastPublishedAt : null,
    pending: s ? s.pending : false,
    last_error: s ? s.lastError : null,
    last_skip: s ? s.lastSkip : null,
    auth_failed: s ? s.authFailed : false,
    token_expires_at: karteiPublisher ? karteiPublisher.tokenExpiresAt() : null,
    token_expiring: karteiTokenExpiring(),
  };
}

// !privat-Zuschauer sind nicht verknüpfbar (Nutzer, 21.11.2026). true/false, null = unbekannt
async function isPrivateLogin(login) {
  const ids = Object.keys(privacyOptouts);
  if (!ids.length) return false;
  if (ids.some(id => (karteiPrivacyNames.get(id) || {}).login === login)) return true;
  if (!loadTokens()) return null;
  try {
    await getValidAccessToken();
    const res = await twitchApi.get(`/users?login=${encodeURIComponent(login)}`);
    const user = res.data?.data?.[0];
    if (!user) return false;
    if (isPrivateUser(String(user.id))) { rememberPrivacyName(user.id, user.login, user.display_name); return true; }
    return false;
  } catch {
    return null;
  }
}
const uboatLastAnswerByUser = new Map();   // user_id -> Zeitpunkt der letzten Antwort
let currentCategory = null;                // Twitch-Kategorie des eigenen Kanals, null = unbekannt
let currentCategoryChangedAt = null;       // wann sich die Kategorie zuletzt geändert hat (ISO), für /api/twitch/channel
let currentCategoryConfirmedAt = null;     // wann der Server sie zuletzt bestätigt hat (Abruf oder channel.update)

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
  currentCategoryConfirmedAt = new Date().toISOString();
  if (name === currentCategory) return;
  currentCategory = name;
  currentCategoryChangedAt = currentCategoryConfirmedAt;
  streamSession.setCategory(name);
  console.log(`[Kategorie] Twitch-Kategorie: ${name || 'unbekannt'} (${source})${uboatCrew ? ` – UBOAT-Soldbuch ${!moduleSwitches.uboat ? 'deaktiviert' : isUboatCategoryActive() ? 'aktiv' : 'inaktiv'}` : ''}`);
}

// Kategorie beim Verbindungsaufbau holen; danach hält channel.update sie aktuell.
async function refreshChannelCategory() {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    const res = await twitchApi.get(`/channels?broadcaster_id=${tokens.broadcaster_id}`);
    setCurrentCategory(res.data?.data?.[0]?.game_name || null, 'Abruf');
  } catch (err) {
    console.warn('[Kategorie] Abruf der Twitch-Kategorie gescheitert:', err.response?.data || err.message);
  }
}

// Sub-Goal über EventSub (Issue #60); Scope channel:read:goals
async function subscribeToGoals(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    for (const type of ['channel.goal.begin', 'channel.goal.progress', 'channel.goal.end']) {
      await createEventSubSubscription(sessionId, type, '1', { broadcaster_user_id: tokens.broadcaster_id });
    }
    console.log('Goal-Subscriptions aktiv (Sub-Goal ohne Abfrage je Sub)');
  } catch (err) {
    console.error('Fehler beim Abonnieren der Goal-Ereignisse:', err.response?.data || err.message);
  }
}

async function subscribeToChannelUpdate(sessionId) {
  try {
    await getValidAccessToken();
    const tokens = loadTokens();
    await createEventSubSubscription(sessionId, 'channel.update', '2', { broadcaster_user_id: tokens.broadcaster_id });
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
  if (s.mods) console.log(`Mods im Spielstand (${s.mods.length}, davon ${s.mods.filter(m => m.kind === 'workshop').length} aus dem Steam Workshop): ${s.mods.map(m => m.name).join(', ')}`);
  else if (s.source) console.log('Mods im Spielstand: keine Liste (ältere Spielstände)');
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

function printKarteiStatus() {
  const o = karteiOverview();
  if (!o.configured) { console.log('Stream-Kartei: nicht eingerichtet (STREAM_KARTEI_REPO und STREAM_KARTEI_TOKEN in .env)'); return; }
  console.log(`Stream-Kartei: ${moduleStateLabel('kartei')}, Repository ${o.repo}, Website ${o.site_url}`);
  console.log(`Zuletzt veröffentlicht: ${o.last_published_at ? new Date(o.last_published_at).toLocaleString('de-DE') : 'in diesem Serverlauf noch nicht'}${o.pending ? ' – Änderung wartet' : ''}`);
  if (o.last_skip) console.log(`Zuletzt ausgelassen: ${o.last_skip}`);
  if (o.last_error) console.log(`Letzter Fehler: ${o.last_error}${o.auth_failed ? ' (Token abgelehnt, kein neuer Versuch bis zum Neustart)' : ''}`);
  if (o.token_expires_at) console.log(`Token läuft ab: ${formatDateDe(o.token_expires_at)}${o.token_expiring ? ' – bald erneuern!' : ''}`);
}

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
  console.log(' effects mode <auto|off>   - Effekte ein- bzw. ausschalten');
  console.log(' effects show               - Aktuellen Effekt-Modus & Queue-Status anzeigen');
  console.log(' bdu show                   - BdU-Chat: Widget-Verbindung, Funkstille, Limits anzeigen');
  console.log(' bdu silence off            - BdU-Chat: Funkstille sofort aufheben');
  console.log(' bdu activate|deactivate    - BdU-Chat ein- bzw. ausschalten (bleibt nach Neustart)');
  console.log(' uboat show                 - UBOAT: gelesener Spielstand, Kategorie, Crew und Zuordnungen anzeigen');
  console.log(' uboat reload               - UBOAT: neuesten Spielstand sofort einlesen');
  console.log(' uboat map <login> <Name>   - UBOAT: Twitch-Login einem Crewmitglied (Name im Spiel) zuordnen');
  console.log(' uboat nachlesen            - UBOAT: ältere Spielstände der Kampagne lesen (Feindfahrten, Lebensläufe), nur Vorschau');
  console.log(' uboat nachlesen übernehmen - UBOAT: Vorschau in den Verlauf speichern (… verwerfen: Vorschau verwerfen)');
  console.log(' uboat verlauf <Name>       - UBOAT: frühere Namen, Feindfahrten und Lebenslauf einer Person (aus der Vorschau, sonst dem Verlauf)');
  console.log(' uboat unmap <login>        - UBOAT: Zuordnung entfernen');
  console.log(' uboat activate|deactivate  - UBOAT-Soldbuch ein- bzw. ausschalten (bleibt nach Neustart)');
  console.log(' kartei show|publish        - Stream-Kartei: Stand der Website bzw. jetzt veröffentlichen (nur bei Änderung, Abstand 10 min)');
  console.log(' kartei activate|deactivate - Stream-Kartei ein- bzw. ausschalten (bleibt nach Neustart)');
  moduleHost.helpLines().forEach(line => console.log(line));   // Befehle der Module, z. B. topics
  console.log(' http debug on|off          - Testmodus: auch erfolgreiche Widget-Abrufe im HTTP-Protokoll zeigen (bis Neustart)');
  console.log(' bot show                   - Bot-Account DerBdu: eingerichtet?, was er sendet, letzter Fehler');
  console.log(' bot remove                 - Bot-Account vergessen (danach sendet wieder der Broadcaster)');
  console.log(' bot sender [<f> bot|broadcaster] - Absender je Chat-Funktion zeigen bzw. umstellen');
  console.log(' results show | results <prediction|poll> on|off - Ergebniszeilen für Wette/Abstimmung über den Server');
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
      if (!EFFECT_MODES.includes(newMode)) {
        console.log('Nutzung: effects mode <auto|off>');
        return;
      }
      setEffectMode(newMode);
      return;
    }

    if (sub === 'show') {
      console.log(`Effekt-Modus: ${effectMode.toUpperCase()} | Queue-Länge: ${effectQueue.length}`);
      return;
    }

    console.log('Nutzung: effects mode <auto|off> | effects show');
    return;
  }

  if (cmd === 'http') {
    const sub = (parts[1] || '').toLowerCase();
    const value = (parts[2] || '').toLowerCase();
    if (sub === 'debug' && (value === 'on' || value === 'off')) {
      httpDebug = value === 'on';
      console.log(`[HTTP] Testmodus ${httpDebug ? 'an – auch erfolgreiche Widget-Abrufe erscheinen im Protokoll (bis "http debug off" oder Neustart)' : 'aus – erfolgreiche Widget-Abrufe erscheinen nicht im Protokoll, Fehler weiterhin'}`);
      return;
    }
    console.log('Nutzung: http debug on|off');
    return;
  }

  // Befehle der Module (ADR 0027), z. B. "topics …"
  if (moduleHost.handleConsole(cmd, parts)) return;

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
      switchModule('bdu', true);
      return;
    }
    if (sub === 'deactivate') {
      switchModule('bdu', false);
      return;
    }
    console.log('Nutzung: bdu show | bdu silence off | bdu activate | bdu deactivate');
    return;
  }

  if (cmd === 'kartei') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'show') { printKarteiStatus(); return; }
    if (sub === 'publish') {
      if (!karteiScheduler) { console.log('Stream-Kartei: nicht eingerichtet (STREAM_KARTEI_REPO und STREAM_KARTEI_TOKEN in .env)'); return; }
      if (!moduleSwitches.kartei) { console.log(`Stream-Kartei: ${moduleStateLabel('kartei')}`); return; }
      console.log('[Kartei] Veröffentlichung angestoßen (nur bei geändertem Inhalt, frühestens 10 min nach der letzten)');
      requestKartei();
      return;
    }
    if (sub === 'activate') { switchModule('kartei', true); return; }
    if (sub === 'deactivate') { switchModule('kartei', false); return; }
    console.log('Nutzung: kartei show | kartei publish | kartei activate | kartei deactivate');
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
      // !privat-Zuschauer sind nicht verknüpfbar (Stream-Kartei, Nutzer 21.11.2026)
      const isPrivate = await isPrivateLogin(login);
      if (isPrivate) { console.log(`[UBOAT] @${login} hat !privat eingeschaltet – keine Zuordnung gespeichert`); return; }
      const map = loadUboatCrewMap();
      map[login] = name;
      saveUboatCrewMap(map);
      const known = uboatCrew && uboatCrew.getState().crew.some(m => m.name.toLowerCase() === name.toLowerCase());
      console.log(`[UBOAT] @${login} → ${name} gespeichert${uboatCrew && !known ? ' (Hinweis: im gelesenen Spielstand gibt es kein Crewmitglied mit diesem Namen)' : ''}`
        + `${isPrivate === null ? ' (Hinweis: !privat ließ sich gerade nicht prüfen; die Website blendet !privat-Zuschauer trotzdem aus)' : ''}`);
      requestKartei();
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
      switchModule('uboat', true);
      return;
    }
    if (sub === 'deactivate') {
      switchModule('uboat', false);
      return;
    }
    if (sub === 'nachlesen') {
      const what = (parts[2] || '').toLowerCase();
      if (!what) { await uboatHistoryScan(); return; }
      if (what === 'übernehmen' || what === 'uebernehmen') { uboatHistoryApply(); return; }
      if (what === 'verwerfen') { console.log(uboatHistoryPreview ? '[UBOAT] Vorschau verworfen' : '[UBOAT] Keine Vorschau'); uboatHistoryPreview = null; return; }
    }
    if (sub === 'verlauf' && parts[2]) {
      uboatHistoryShow(parts.slice(2).join(' '));
      return;
    }
    console.log('Nutzung: uboat show | uboat reload | uboat map <login> <Name im Spiel> | uboat unmap <login> | uboat nachlesen [übernehmen|verwerfen] | uboat verlauf <Name> | uboat activate | uboat deactivate');
    return;
  }

  if (cmd === 'results') {
    const line = (parts[1] || '').toLowerCase();
    const value = (parts[2] || '').toLowerCase();
    if (!line || line === 'show') {
      for (const { line: key, name, enabled } of chatResultList()) {
        console.log(`[Chat]   ${key.padEnd(10)} ${name}: ${enabled ? 'an (sendet der Server)' : 'aus'}, Absender ${chatSenders[key] === 'bot' ? 'Bot' : 'Broadcaster'}`);
      }
      return;
    }
    if (!Object.hasOwn(CHAT_RESULT_LINES, line) || !['on', 'off'].includes(value)) {
      console.log(`Nutzung: results show | results <zeile> on|off – Zeilen: ${Object.keys(CHAT_RESULT_LINES).join(', ')}`);
      return;
    }
    if (!setChatResult(line, value === 'on', 'Konsole')) console.log(`[Chat] Ergebniszeile ${CHAT_RESULT_LINES[line]} ist schon ${value === 'on' ? 'an' : 'aus'}`);
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
      removeBotConfig();
      console.log('[Bot] Bot-Account vergessen – alle Nachrichten kommen wieder vom Broadcaster. Die Freigabe bei Twitch entziehst du als DerBdu unter twitch.tv → Einstellungen → Verbindungen.');
      return;
    }
    if (sub === 'sender') {
      const feature = (parts[2] || '').toLowerCase();
      const sender = (parts[3] || '').toLowerCase();
      if (!feature) {
        console.log('[Bot] Absender je Chat-Funktion:');
        printChatSenders();
        return;
      }
      if (!Object.hasOwn(CHAT_FEATURES, feature) || !CHAT_SENDER_VALUES.includes(sender)) {
        console.log(`Nutzung: bot sender <funktion> bot|broadcaster – Funktionen: ${Object.keys(CHAT_FEATURES).join(', ')}`);
        return;
      }
      if (!setChatSender(feature, sender, 'Konsole')) console.log(`[Bot] ${CHAT_FEATURES[feature]} sendet schon ${sender === 'bot' ? 'der Bot' : 'der Broadcaster'}`);
      return;
    }
    console.log('Nutzung: bot show | bot remove | bot sender [<funktion> bot|broadcaster]');
    return;
  }

  console.log(`Unbekannter Befehl "${trimmed}". Tippe "help" für eine Übersicht.`);
});

// ═══════════════════════════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════════════════════════

const PORT_NUM = parseInt(PORT);

// Zweiter Zugang über den IPv6-Loopback. Fehlt IPv6 oder ist ::1 belegt, läuft der Server über 127.0.0.1 weiter.
function listenOnIpv6Loopback() {
  const v6 = http.createServer(app);
  v6.on('error', err => console.warn(`[Start] Kein Zugang über ${SERVER_HOST_V6} (${err.code || err.message}); der Server ist über ${SERVER_HOST} erreichbar.`));
  v6.listen(PORT_NUM, SERVER_HOST_V6);
}
// Express 5 ruft diese Funktion auch bei einem Startfehler auf (z. B. Port belegt), dann mit `err`.
// Ohne diese Prüfung liefe ein zweiter Server ohne HTTP-Teil, aber mit eigener EventSub-Verbindung
// (doppelte Chat-Ausgaben, Widgets verbunden mit dem anderen Server).
app.listen(PORT_NUM, SERVER_HOST, (err) => {
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`FEHLER: Port ${PORT_NUM} ist bereits belegt. Läuft der Server schon in einem anderen Fenster? Dieser Start wird abgebrochen, damit nicht zwei Server parallel laufen.`);
    } else {
      console.error(`FEHLER: Server konnte nicht starten: ${err.message}`);
    }
    process.exit(1);
    return;
  }
  listenOnIpv6Loopback();
  console.log('');
  console.log('═════════════════════════════════════════════');
  console.log('Twitch Companion JS server');
  console.log('═════════════════════════════════════════════');
  console.log(`Server läuft auf: http://localhost:${PORT_NUM} (nur auf diesem PC erreichbar)`);
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
  if (karteiConfigured) console.log(`Stream-Kartei: an (Repository ${karteiRepo}, Zweig ${STREAM_KARTEI_BRANCH})${moduleSwitches.kartei ? '' : ' – deaktiviert ("kartei activate" schaltet ein)'}`);
  else if ((STREAM_KARTEI_TOKEN || '').trim() || karteiRepo) console.warn('Stream-Kartei: aus – STREAM_KARTEI_REPO (Form Besitzer/Name) und STREAM_KARTEI_TOKEN müssen beide gesetzt sein');
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
