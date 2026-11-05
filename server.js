const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const readline = require('readline');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const SERVER_STARTED_AT = new Date().toISOString();   // für /status und Startanzeige (welcher Prozess antwortet?)

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  PORT = 3000,
  SCOPES,
  HA_WEBHOOK_URL,
  CORS_ORIGINS,
} = process.env;

const TOKEN_FILE = './tokens.json';
const RAID_FILE = './raids.json';
const WHITELIST_FILE = './whitelist.json';
const SUBGOAL_FILE = './subgoal_cache.json';
const EVENTLOG_FILE = './events.json';
const EFFECT_MODE_FILE = './effect_mode.json';

const RAIDSTATS_COOLDOWN_MS = 30 * 1000;
const RAID_GREETING_MIN_GAP_MS = 90 * 1000;

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
const BDU_REPLY_PREFIX = 'FT vom BdU: ';
const BDU_CHAT_MAX_CHARS = 500;                   // Twitch-Limit je Chat-Nachricht
const BDU_WARNING_TEXT = 'Funkverkehr einschränken, Feind peilt ein!';

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
    const durationMs = Date.now() - startedAt;
    const line = `[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`;
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
// HILFSFUNKTIONEN – RAID-TRACKING
// ═══════════════════════════════════════════════════════════════════

function loadRaidLog() {
  if (!fs.existsSync(RAID_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(RAID_FILE, 'utf8')); } catch { return {}; }
}

function saveRaidLog(log) {
  fs.writeFileSync(RAID_FILE, JSON.stringify(log, null, 2), 'utf8');
}

// Aktueller Zeitraum-Schlüssel.
// Aktuell Quartal-basiert (z.B. "2026-Q3").
// Ab 2027 ggf. auf Jahres-Basis umstellen:
// function getPeriodKey(date) { return `${date.getFullYear()}`; }
function getPeriodKey(date) {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
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

function buildGameMessage(game, durationStr) {
  const variants = [
    `Dort gab es zuletzt ${game}${durationStr}.`,
    `Zuletzt lief bei ihnen ${game}${durationStr}.`,
    `Gerade kommt ihr von einer Session mit ${game}${durationStr}.`
  ];
  return pick(variants);
}

function buildRankRepeatMessage(countRank, fromName, count) {
  const variants = [
    `Platz ${countRank} der treuesten Raider geht an @${fromName}, der schon zum ${count}. Mal raidet.`,
    `@${fromName} sichert sich Platz ${countRank} der häufigsten Raider – bereits der ${count}. Raid in diesem Quartal!`,
    `Rang ${countRank} bei den treuesten Raidern: @${fromName}, mittlerweile zum ${count}. Mal hier!`
  ];
  return pick(variants);
}

function buildRepeatOnlyMessage(fromName, count) {
  const variants = [
    `@${fromName} raidet schon zum ${count}. Mal in diesem Quartal!`,
    `Schon der ${count}. Raid von @${fromName} in diesem Quartal!`,
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

app.get('/login', (req, res) => {
  const scope = SCOPES.replace(/\+/g, ' ');
  const authUrl = `https://id.twitch.tv/oauth2/authorize`
    + `?response_type=code`
    + `&client_id=${CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&scope=${encodeURIComponent(scope)}`;
  console.log('Leite zu Twitch Login weiter...');
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Kein Code erhalten');

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
    await sendBduChatMessage(BDU_REPLY_PREFIX + text.trim(), pending.messageId);
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

app.get('/status', (req, res) => {
  const tokens = loadTokens();
  if (!tokens) {
    return res.json({ authenticated: false, message: 'Keine Tokens vorhanden. Bitte login durchführen.', pid: process.pid, started_at: SERVER_STARTED_AT });
  }

  const now = Date.now();
  const expiresAt = tokens.expires_at || (tokens.obtained_at + tokens.expires_in * 1000);
  const remainingSeconds = Math.floor((expiresAt - now) / 1000);

  res.json({
    authenticated: true,
    broadcaster_id: tokens.broadcaster_id,
    broadcaster_name: tokens.broadcaster_name,
    token_valid: remainingSeconds > 0,
    expires_in_seconds: remainingSeconds,
    expires_in_minutes: Math.floor(remainingSeconds / 60),
    auto_refresh: true,
    eventsub_connected: eventSubWs !== null && eventSubWs.readyState === WebSocket.OPEN,
    raid_queue_length: raidQueue.length,
    whitelist_count: Object.keys(loadWhitelist()).length,
    effect_mode: effectMode,
    effect_queue_length: effectQueue.length,
    allowed_origins: corsAllowAll ? '*' : [...allowedOrigins],
    bdu_widget_connected: bduClients.length > 0,
    // isBduSilenceActive() räumt eine abgelaufene Funkstille ab, sonst stünde hier die alte Uhrzeit (K9)
    bdu_silence_until: isBduSilenceActive() ? (bduSilenceUntil === Infinity ? 'bis Streamstart' : new Date(bduSilenceUntil).toISOString()) : null,
    pid: process.pid,
    started_at: SERVER_STARTED_AT
  });
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
        await handleWhitelistShoutout(msg.payload.event);
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

  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();

    await axios.post(
      'https://api.twitch.tv/helix/chat/messages',
      {
        broadcaster_id: tokens.broadcaster_id,
        sender_id: tokens.broadcaster_id,
        message: getLeaderboardText()
      },
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } }
    );
    console.log('Leaderboard auf !raidstats-Befehl gesendet');
  } catch (err) {
    console.error('Fehler bei !raidstats:', err.response?.data || err.message);
  }
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

// Postet eine Nachricht als Broadcaster, optional als Antwort auf eine Chat-Nachricht.
async function sendBduChatMessage(text, replyToMessageId) {
  const message = text.length > BDU_CHAT_MAX_CHARS ? text.slice(0, BDU_CHAT_MAX_CHARS - 1) + '…' : text;
  try {
    const accessToken = await getValidAccessToken();
    const tokens = loadTokens();
    const body = { broadcaster_id: tokens.broadcaster_id, sender_id: tokens.broadcaster_id, message };
    if (replyToMessageId) body.reply_parent_message_id = replyToMessageId;
    const response = await axios.post('https://api.twitch.tv/helix/chat/messages', body,
      { headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' } });
    const result = response.data?.data?.[0];
    if (result && result.is_sent === false) {
      console.warn(`[BdU] Twitch hat die Nachricht nicht gesendet (${result.drop_reason?.message || 'ohne Grund'}): ${message}`);
    }
  } catch (err) {
    console.error('[BdU] Fehler beim Senden in den Chat:', err.response?.data || err.message, '– Text:', message);
  }
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
  const recent = (bduAcceptedByUser.get(userKey) || []).filter(t => now - t < BDU_USER_WINDOW_MS);
  bduAcceptedByUser.set(userKey, recent);
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
  console.log(`[BdU] Widget verbunden: ${bduClients.length > 0 ? 'ja (' + bduClients.length + ')' : 'nein'} | Funkstille: ${silence} | offene Anfragen: ${bduPending.size} | heute angenommen: ${bduDailyCount}${BDU_DAILY_LIMIT ? '/' + BDU_DAILY_LIMIT : ''} | nächste Annahme frühestens in ${nextFree} s`);
}

async function handleWhitelistShoutout(evt) {
  const chatterId = evt.chatter_user_id;
  const chatterName = evt.chatter_user_login;

  const whitelist = loadWhitelist();
  if (!whitelist[chatterId]) return;
  if (shoutedOutThisSession.has(chatterId)) return;

  shoutedOutThisSession.add(chatterId);
  console.log(`Erstnachricht von gelistetem Streamer @${chatterName} (ID: ${chatterId}) erkannt – sende Shoutout`);
  await sendShoutout(chatterId, chatterName);
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

  let accessToken, tokens, headers;
  try {
    accessToken = await getValidAccessToken();
    tokens = loadTokens();
    headers = { 'Authorization': `Bearer ${accessToken}`, 'Client-ID': CLIENT_ID };
  } catch (err) {
    console.error('Konnte Access-Token für Raid-Verarbeitung nicht laden:', err.message);
    return;
  }

  let game = 'einem unbekannten Spiel';
  let durationStr = '';
  let startedAt = null;

  try {
    const [chanRes, streamRes] = await Promise.all([
      axios.get(`https://api.twitch.tv/helix/channels?broadcaster_id=${fromId}`, { headers }),
      axios.get(`https://api.twitch.tv/helix/streams?user_id=${fromId}`, { headers })
    ]);

    game = chanRes.data.data[0]?.game_name || game;
    startedAt = streamRes.data.data[0]?.started_at || null;

    if (startedAt) {
      const ms = Date.now() - new Date(startedAt).getTime();
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      durationStr = h > 0 ? ` (${h}h ${m}min)` : ` (${m} Minuten)`;
    } else {
      console.warn(`Kein aktiver Stream-Datensatz für ${fromName} gefunden (evtl. bereits offline) – Streamdauer nicht verfügbar`);
    }

    console.log(' Ermitteltes Spiel:', game);
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

  if (countRank && data.count >= 2) {
    msgParts.push(buildRankRepeatMessage(countRank, fromName, data.count));
  } else if (data.count >= 2) {
    msgParts.push(buildRepeatOnlyMessage(fromName, data.count));
  }

  if (viewerRank) {
    msgParts.push(buildViewerRankMessage(viewerRank, fromName));
  }

  msgParts.push(buildClosingMessage());

  const message = msgParts.join(' ');
  console.log(' Finale Chat-Nachricht:', message);

  try {
    await axios.post(
      'https://api.twitch.tv/helix/chat/messages',
      {
        broadcaster_id: tokens.broadcaster_id,
        sender_id: tokens.broadcaster_id,
        message
      },
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
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
  } catch (e) {
    console.error('Fehler beim Senden der Raid-Chat-Nachricht:', e.response?.data || e.message);
  }

  console.log('=== RAID-EVENT VERARBEITUNG ABGESCHLOSSEN ===');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════
// KONSOLEN-BEFEHLE (readline) – WHITELIST, SUB-GOAL & EVENTS VERWALTEN
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
  console.log(' subgoal refresh            - Sub-Goal-Stand jetzt von Twitch laden');
  console.log(' subgoal show               - Aktuellen gecachten Sub-Goal-Stand anzeigen');
  console.log(' events show                - Letzte 10 Follow/Sub/Gift-Ereignisse anzeigen');
  console.log(' effects mode <auto|manual|off> - Effekt-Modus setzen');
  console.log(' effects show               - Aktuellen Effekt-Modus & Queue-Status anzeigen');
  console.log(' bdu show                   - BdU-Chat: Widget-Verbindung, Funkstille, Limits anzeigen');
  console.log(' bdu silence off            - BdU-Chat: Funkstille sofort aufheben');
  console.log(' help                       - Diese Hilfe anzeigen');
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
    console.log('Nutzung: bdu show | bdu silence off');
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
  console.log('═════════════════════════════════════════════');
  console.log(`Effekt-Modus beim Start: ${effectMode.toUpperCase()}`);
  console.log(`Erlaubte Widget-Herkünfte: ${corsAllowAll ? '* (ALLE – Notschalter aktiv, unsicher!)' : [...allowedOrigins].join(', ')}`);
  console.log(`Home-Assistant-Webhook: ${HA_WEBHOOK_URL ? 'eingetragen' : 'NICHT eingetragen – Effekte werden nur lokal geloggt (HA_WEBHOOK_URL in .env)'}`);
  console.log('═════════════════════════════════════════════');

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
