// Webkonsole Stufe 1 (ADR 0018, docs/specs/webkonsole.md): Seite und /api/admin/overview nur lokal, strenge Herkunft,
// keine Secrets, nichts außerhalb von public/admin abrufbar, /status unverändert.
// Stufe 2: Server beenden und neu starten (process.exit wird dabei nur aufgezeichnet).
// Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis. Aufruf: node admin-test.js <server.js> [ablauf|alle-herkuenfte|ohne-tokens|server-beenden|server-neustart|live-log|fehler-protokoll|fehler-defekt|whitelist|module|effekte|effekte-alt|statistik]
// Nicht abgedeckt: Aufruf von einer fremden IP-Adresse (Test läuft über 127.0.0.1; geprüft wird der fremde Host-Header).
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const scenario = process.argv[3] || 'ablauf';
const PORT = 40300 + Math.floor(Math.random() * 250);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-'));
const SECRETS = ['CLIENT-SECRET-ATTRAPPE', 'ACCESS-TOKEN-ATTRAPPE', 'REFRESH-TOKEN-ATTRAPPE'];
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=${SECRETS[0]}\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\n`
  + (scenario === 'alle-herkuenfte' ? 'CORS_ORIGINS=*\nHA_WEBHOOK_URL=http://ha-attrappe.invalid/hook\n' : '')
  + (scenario === 'live-log' ? 'HA_WEBHOOK_URL=http://ha-attrappe.invalid:8123/api/webhook/geheime-webhook-id\n' : ''));
if (scenario !== 'ohne-tokens') {
  fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: SECRETS[1], refresh_token: SECRETS[2], broadcaster_id: '4711', broadcaster_name: 'testkanal',
    obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
}
const effects = ['eins', 'zwei', 'drei', 'vier', 'fuenf', 'sechs'].map((userName, i) => ({ type: 'follow', userName, userId: String(i), count: 1, timestamp: new Date(1000 + i).toISOString() }));
fs.writeFileSync(path.join(workDir, 'events.json'), JSON.stringify(effects));
fs.writeFileSync(path.join(workDir, 'subgoal_cache.json'), JSON.stringify({ current: 7, target: 10, title: 'Ziel', goalId: 'g', status: 'active', lastUpdated: 'x' }));
if (scenario === 'fehler-protokoll') fs.writeFileSync(path.join(workDir, 'error_log.json'), JSON.stringify([{ at: '2026-11-01T10:00:00.000Z', pid: 1, text: '[Test] Fehler aus einem früheren Lauf' }]));
if (scenario === 'whitelist') fs.writeFileSync(path.join(workDir, 'whitelist.json'), JSON.stringify({ 111: 'zeta', 222: 'Alpha' }));
if (scenario === 'effekte-alt') fs.writeFileSync(path.join(workDir, 'effect_mode.json'), JSON.stringify({ mode: 'manual' }));
if (scenario === 'fehler-defekt') fs.writeFileSync(path.join(workDir, 'error_log.json'), '{ keine gültige Liste');
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() {} terminate() {} }
FakeWS.OPEN = 1;
const WHITELIST_USERS = { 'login=neuer_streamer': { id: '333', login: 'neuer_streamer' }, 'login=12345': { id: '777', login: '12345' }, 'id=444': { id: '444', login: 'per_id' }, 'login=zeta': { id: '111', login: 'zeta' } };
const subscribed = [];
const fakeAxios = {
  post: async (url, body) => {
    if (url.includes('eventsub/subscriptions')) subscribed.push(body.type === 'channel.raid' ? `channel.raid:${body.condition.from_broadcaster_user_id ? 'from' : 'to'}` : body.type);
    return { data: { data: [] } };
  },
  get: async url => {
    if (url.includes('login=twitchfehler')) throw new Error('Twitch nicht erreichbar');
    const key = Object.keys(WHITELIST_USERS).find(k => url.endsWith(`?${k}`));
    return { data: { data: url.includes('helix/users') && key ? [WHITELIST_USERS[key]] : [] } };
  },
};
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => new EventEmitter() }; return orig.call(this, r, ...a); };
const realLog = console.log, logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const realExit = process.exit.bind(process), exits = [];
if (scenario.startsWith('server-')) process.exit = code => { exits.push(code); };
if (scenario === 'server-neustart') process.env.TWITCH_COMPANION_SUPERVISED = '1';
else delete process.env.TWITCH_COMPANION_SUPERVISED;
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const request = (p, headers = {}, method = 'GET', body) => new Promise((res, rej) => {
  http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: d }));
  }).on('error', rej).end(body);
});
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const PAGE = '/TwitchCompanionAdmin';
const OVERVIEW = '/api/admin/overview';
const SHUTDOWN = '/api/admin/server/shutdown';
const RESTART = '/api/admin/server/restart';
const LOG_STREAM = '/api/admin/log/stream';
const ERROR_LOG = '/api/admin/log/errors';
const WHITELIST = '/api/admin/whitelist';
const MODULES = '/api/admin/modules';
const EFFECT_MODE = '/api/admin/effects/mode';
const STATS = '/api/admin/stats';
const EFFECT_CONFIRM = '/api/admin/effects/confirm';
const JSON_TYPE = { 'Content-Type': 'application/json' };
const EXIT_WAIT_MS = 500;
const OWN =[`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
const STATUS_KEYS = ['authenticated', 'broadcaster_id', 'broadcaster_name', 'token_valid', 'expires_in_seconds', 'expires_in_minutes', 'auto_refresh', 'eventsub_connected', 'raid_queue_length',
  'whitelist_count', 'effect_mode', 'effect_queue_length', 'allowed_origins', 'modules', 'bot_configured', 'bot_login', 'bot_features', 'bdu_widget_connected', 'bdu_silence_until',
  'uboat_enabled', 'uboat_active', 'uboat_save', 'uboat_saved_at', 'pid', 'started_at'];

async function ablauf() {
  let r = await request(`${PAGE}/`);
  check('A1 Seite lokal: mit Schutz-Headern', r.status === 200 && /text\/html/.test(r.headers['content-type']) && /Twitch Companion Admin/.test(r.body)
    && /frame-ancestors 'none'/.test(r.headers['content-security-policy'] || '') && r.headers['cache-control'] === 'no-store', JSON.stringify(r.headers));
  r = await request(PAGE);
  check('A2 Adresse ohne Schrägstrich führt zur Seite (relative Dateipfade)', r.status >= 301 && r.status <= 308 && r.headers.location === `${PAGE}/`, `${r.status} ${r.headers.location}`);
  r = await request(`${PAGE.toLowerCase()}/`);
  check('A2b Adresse in Kleinbuchstaben funktioniert', r.status === 200, String(r.status));
  r = await request('/admin/');
  check('A2c Alte Adresse /admin antwortet nicht mehr', r.status === 404, String(r.status));
  for (const [file, type] of [['admin.js', /javascript/], ['admin.css', /css/], ['favicon.svg', /svg/]]) {
    r = await request(`${PAGE}/${file}`);
    check(`A3 ${file} wird ausgeliefert`, r.status === 200 && type.test(r.headers['content-type']), `${r.status} ${r.headers['content-type']}`);
  }

  r = await request(`${PAGE}/`, { Host: 'example.com' });
  check('A4 Seite mit fremdem Host: 403', r.status === 403);
  r = await request(OVERVIEW, { Host: 'example.com' });
  check('A5 Overview mit fremdem Host: 403', r.status === 403);

  r = await request(OVERVIEW);
  const d = JSON.parse(r.body);
  check('A6 Overview lokal: Laufzeitwerte und Ergänzungen', r.status === 200 && d.authenticated === true && d.broadcaster_name === 'testkanal' && d.pid === process.pid
    && d.poll_ms === 5000 && d.port === PORT && /^\d+\.\d+\.\d+/.test(d.version) && 'category' in d && !('pending_confirmation' in d) && d.modules.bdu === true, r.body);
  check('A6b Overview ohne Webhook: ha_webhook_configured ist false', d.ha_webhook_configured === false, r.body);
  check('A7 Overview ohne allowed_origins und broadcaster_id', !('allowed_origins' in d) && !('broadcaster_id' in d));
  check('A8 Overview enthält keinen Token und kein Secret', !SECRETS.some(s => r.body.includes(s)) && !/access_token|refresh_token/.test(r.body));
  check('A9 Letzte Effekte: höchstens 5, neuester zuerst', d.recent_effects.length === 5 && d.recent_effects[0].userName === 'sechs' && d.recent_effects[4].userName === 'zwei', JSON.stringify(d.recent_effects));
  check('A10 Sub-Goal aus dem Cache', d.subgoal.current === 7 && d.subgoal.target === 10 && d.subgoal.title === 'Ziel' && !('goalId' in d.subgoal));

  for (const origin of OWN) {
    r = await request(OVERVIEW, { Origin: origin });
    check(`A11 Eigene Herkunft ${origin}: 200`, r.status === 200, String(r.status));
  }
  for (const origin of ['null', 'http://absolute', 'https://fremd.example']) {
    r = await request(OVERVIEW, { Origin: origin });
    check(`A12 Herkunft ${origin}: 403`, r.status === 403, String(r.status));
  }

  for (const p of ['/../.env', '/%2e%2e/.env', '/..%2f.env', '/%2e%2e%2ftokens.json', '/.env', '/../tokens.json', '/../server.js'].map(x => PAGE + x)) {
    r = await request(p);
    check(`A13 ${p} liefert keine Datei außerhalb`, r.status !== 200 && !SECRETS.some(s => r.body.includes(s)), `${r.status}`);
  }

  r = await request(OVERVIEW, {}, 'POST');
  check('A14 POST auf Overview ändert nichts: 404', r.status === 404, String(r.status));

  r = await request('/status');
  const s = JSON.parse(r.body);
  check('A15 /status behält genau seine Felder', JSON.stringify(Object.keys(s).sort()) === JSON.stringify([...STATUS_KEYS].sort()), Object.keys(s).join(','));

  check('A16 Erfolgreiche Abfragen fluten die Konsole nicht', !logs.some(l => /\[HTTP\] GET \/api\/admin\/overview -> 200/.test(l)));
  check('A17 Abgelehnte Abfragen stehen in der Konsole', logs.some(l => /\[HTTP\] GET \/api\/admin\/overview -> 403/.test(l)));
  check('A18 Startanzeige nennt die Webkonsole', logs.some(l => l.includes(`Webkonsole: http://localhost:${PORT}${PAGE}`)));
}

async function alleHerkuenfte() {
  let r = await request('/status', { Origin: 'https://fremd.example' });
  check('B1 CORS_ORIGINS=*: /status nimmt fremde Herkunft an (Vorbedingung)', r.status === 200, String(r.status));
  r = await request(OVERVIEW, { Origin: 'https://fremd.example' });
  check('B2 CORS_ORIGINS=*: Overview lehnt fremde Herkunft ab', r.status === 403, String(r.status));
  r = await request(OVERVIEW, { Origin: 'null' });
  check('B3 CORS_ORIGINS=*: Overview lehnt Herkunft null ab', r.status === 403, String(r.status));
  r = await request(SHUTDOWN, { Origin: 'https://fremd.example', ...JSON_TYPE }, 'POST', '{}');
  check('B4 CORS_ORIGINS=*: Beenden lehnt fremde Herkunft ab', r.status === 403, String(r.status));
  r = await request(OVERVIEW);
  check('B5 Mit Webhook: nur die Angabe, nicht die Adresse', JSON.parse(r.body).ha_webhook_configured === true && !r.body.includes('ha-attrappe'), r.body);
}

// Offene Live-Log-Verbindung: sammelt alle Ereignisse in events.
function openLogStream() {
  const stream = { events: [], status: null, close: () => {} };
  const req = http.get({ host: '127.0.0.1', port: PORT, path: LOG_STREAM }, res => {
    stream.status = res.statusCode;
    stream.type = res.headers['content-type'];
    let rest = '';
    res.setEncoding('utf8');
    res.on('data', chunk => {
      rest += chunk;
      const blocks = rest.split('\n\n');
      rest = blocks.pop();
      for (const block of blocks) {
        const event = (block.match(/^event: (.*)$/m) || [])[1];
        const data = (block.match(/^data: (.*)$/m) || [])[1];
        if (event) stream.events.push({ event, data: JSON.parse(data) });
      }
    });
  });
  req.on('error', () => {});
  stream.close = () => req.destroy();
  return stream;
}

async function liveLog() {
  const lines = s => s.events.filter(e => e.event === 'line').map(e => e.data);
  const findLine = (s, text) => lines(s).find(l => l.text.includes(text));
  let r = await request(LOG_STREAM, { Host: 'example.com' });
  check('G1 Live-Log mit fremdem Host: 403', r.status === 403, String(r.status));
  r = await request(LOG_STREAM, { Origin: 'https://fremd.example' });
  check('G2 Live-Log von fremder Herkunft: 403', r.status === 403, String(r.status));

  console.log('[Test] Zeile vor der Verbindung');
  const stream = openLogStream();
  await sleep(200);
  check('G3 Ereignis-Strom', stream.status === 200 && /text\/event-stream/.test(stream.type), `${stream.status} ${stream.type}`);
  check('G4 Beginnt mit Prozess-ID', stream.events[0] && stream.events[0].event === 'hello' && stream.events[0].data.pid === process.pid, JSON.stringify(stream.events[0]));
  check('G5 Liefert Zeilen von vor der Verbindung', !!findLine(stream, 'Zeile vor der Verbindung') && !!findLine(stream, 'Webkonsole: http://localhost'));

  console.log('[Test] neue Zeile');
  console.warn('[Test] Warnzeile');
  console.error('[Test] Fehlerzeile', { code: 7 });
  await sleep(100);
  const fresh = findLine(stream, 'neue Zeile');
  check('G6 Neue Zeile kommt live an', fresh && fresh.level === 'info' && !Number.isNaN(Date.parse(fresh.at)), JSON.stringify(fresh));
  check('G7 Stufe warn', (findLine(stream, 'Warnzeile') || {}).level === 'warn');
  check('G8 Stufe error und Objekte als Text', (findLine(stream, 'Fehlerzeile') || {}).level === 'error' && findLine(stream, 'Fehlerzeile').text.includes('code: 7'));
  const ids = lines(stream).map(l => l.id);
  check('G9 Zeilen haben aufsteigende ids', ids.every((id, i) => i === 0 || id > ids[i - 1]), ids.join(','));

  console.log(`[Test] Secret ${SECRETS[0]}`);
  console.error('[Test] Antwort', { access_token: 'token-abc', refresh_token: 'token-def' });
  console.log('[Test] Kopf Authorization: Bearer token-ghi OAuth token-jkl');
  console.log('[Test] Link ?client_secret=wert-mno&x=1');
  console.error('[Test] Webhook http://ha-attrappe.invalid:8123/api/webhook/geheime-webhook-id');
  console.error('[Test] getaddrinfo ENOTFOUND ha-attrappe.invalid');
  console.error('[Test] Pfad /api/webhook/geheime-webhook-id');
  console.error('[Test] connect 192.168.1.5:8123 und 10.0.0.2 und 172.20.1.1 und öffentlich 172.15.1.1 und 127.0.0.1');
  await sleep(100);
  const all = lines(stream).map(l => l.text).join('\n');
  check('G10 Client-Secret nicht im Live-Log', !all.includes(SECRETS[0]) && all.includes('[Test] Secret <entfernt>'), all);
  check('G11 Tokens nicht im Live-Log', !/token-abc|token-def|token-ghi|token-jkl|wert-mno/.test(all), all);
  check('G12 Webhook-Adresse, Host und ID nicht im Live-Log', !/ha-attrappe|geheime-webhook-id/.test(all), all);
  const addresses = findLine(stream, 'connect ');
  check('G13 Private Adressen ersetzt, andere bleiben', addresses && !/192\.168|10\.0\.0\.2|172\.20/.test(addresses.text) && addresses.text.includes('172.15.1.1') && addresses.text.includes('127.0.0.1'), addresses && addresses.text);
  check('G14 Das Konsolenfenster bleibt unverändert', logs.some(l => l.includes(`[Test] Secret ${SECRETS[0]}`)));

  console.log(`[Test] lang ${'x'.repeat(5000)}`);
  console.log('[Test] mehrzeilig\nzweite Zeile');
  await sleep(100);
  const long = findLine(stream, 'lang xxx');
  check('G15 Sehr lange Zeilen werden gekürzt', long && long.text.length < 4100 && long.text.endsWith('(gekürzt)'), long && long.text.length);
  check('G16 Zeilenumbrüche bleiben erhalten', (findLine(stream, 'mehrzeilig') || { text: '' }).text.includes('\nzweite Zeile'));

  const second = openLogStream();
  await sleep(150);
  stream.close();
  second.close();
  await sleep(100);
  for (let i = 0; i < 1010; i++) console.log(`[Test] Massenzeile ${i}`);
  console.log('[Test] nach dem Trennen');
  const third = openLogStream();
  await sleep(300);
  const buffered = lines(third);
  check('G17 Puffer begrenzt auf 1000 Zeilen, älteste fallen weg', buffered.length === 1000 && !findLine(third, 'Massenzeile 0') && !!findLine(third, 'Massenzeile 1009'), String(buffered.length));
  check('G18 Getrennte Verbindungen stören nicht', !!findLine(third, 'nach dem Trennen'));
  third.close();
}

const readErrorFile = () => JSON.parse(fs.readFileSync(path.join(workDir, 'error_log.json'), 'utf8'));

async function fehlerProtokoll() {
  let r = await request(ERROR_LOG, { Host: 'example.com' });
  check('H1 Fehlerprotokoll mit fremdem Host: 403', r.status === 403, String(r.status));
  r = await request(ERROR_LOG, { Origin: 'https://fremd.example' });
  check('H2 Fehlerprotokoll von fremder Herkunft: 403', r.status === 403, String(r.status));
  r = await request(ERROR_LOG, { Origin: OWN[0], ...JSON_TYPE }, 'POST', '{}');
  check('H3 POST ändert nichts: 404', r.status === 404, String(r.status));
  r = await request(ERROR_LOG);
  let d = JSON.parse(r.body);
  check('H4 Fehler aus einem früheren Lauf bleiben erhalten', r.status === 200 && d.limit === 1000 && d.entries.length === 1 && d.entries[0].text.includes('früheren Lauf'), r.body);

  console.log('[Test] nur Info');
  console.warn('[Test] nur Warnung');
  console.error('[Test] echter Fehler', { code: 42 });
  console.error(`[Test] Secret ${SECRETS[0]} an 192.168.1.5`);
  r = await request(ERROR_LOG);
  d = JSON.parse(r.body);
  check('H5 Neuester Fehler zuerst, mit Zeit und Prozess-ID', d.entries.length === 3 && d.entries[1].text.includes('echter Fehler') && d.entries[1].text.includes('code: 42') && !Number.isNaN(Date.parse(d.entries[1].at)) && d.entries[1].pid === process.pid, r.body);
  check('H6 Info und Warnungen nicht im Fehlerprotokoll', !/nur Info|nur Warnung/.test(r.body), r.body);
  const file = readErrorFile();
  check('H7 Sofort in der Datei, älteste zuerst', file.length === 3 && file[0].text.includes('früheren Lauf') && file[2].text.includes('Secret'), JSON.stringify(file));
  const raw = fs.readFileSync(path.join(workDir, 'error_log.json'), 'utf8');
  check('H8 Keine Secrets und privaten Adressen in der Datei', !raw.includes(SECRETS[0]) && !raw.includes('192.168.1.5') && raw.includes('<entfernt>') && raw.includes('<privat>'), raw);
  check('H9 Keine Hilfsdatei bleibt liegen', !fs.existsSync(path.join(workDir, 'error_log.json.tmp')));

  for (let i = 0; i < 1010; i++) console.error(`[Test] Massenfehler ${i}`);
  const full = readErrorFile();
  check('H10 Datei behält nur die letzten 1000 Fehler', full.length === 1000 && full[0].text === '[Test] Massenfehler 10' && full[999].text === '[Test] Massenfehler 1009', `${full.length} ${full[0].text}`);
  r = await request(ERROR_LOG);
  d = JSON.parse(r.body);
  check('H11 Abruf ebenso begrenzt', d.entries.length === 1000 && d.entries[0].text === '[Test] Massenfehler 1009', String(d.entries.length));
}

async function fehlerDefekt() {
  let r = await request(ERROR_LOG);
  check('I1 Defekte Datei: leere Liste, kein Absturz', r.status === 200 && JSON.parse(r.body).entries.length === 0, r.body);
  console.error('[Test] nach defekter Datei');
  check('I2 Der nächste Fehler schreibt eine gültige Datei', readErrorFile().length === 1);
}

async function whitelist() {
  const own = { Origin: OWN[0], ...JSON_TYPE };
  const file = () => JSON.parse(fs.readFileSync(path.join(workDir, 'whitelist.json'), 'utf8'));
  const post = (p, body, headers = own) => request(`${WHITELIST}/${p}`, headers, 'POST', typeof body === 'string' ? body : JSON.stringify(body));
  const before = JSON.stringify(file());

  let r = await request(WHITELIST);
  let d = JSON.parse(r.body);
  check('W1 Liste nach Namen sortiert, mit IDs', r.status === 200 && d.count === 2 && d.entries[0].name === 'Alpha' && d.entries[0].id === '222' && d.entries[1].name === 'zeta', r.body);
  r = await request(WHITELIST, { Host: 'example.com' });
  check('W2 Liste mit fremdem Host: 403', r.status === 403, String(r.status));
  r = await request(WHITELIST, { Origin: 'null' });
  check('W3 Liste von Herkunft null: 403', r.status === 403, String(r.status));

  r = await post('add', { user: 'neuer_streamer' }, JSON_TYPE);
  check('W4 Hinzufügen ohne Herkunft: 403', r.status === 403, String(r.status));
  r = await post('add', { user: 'neuer_streamer' }, { Origin: 'https://fremd.example', ...JSON_TYPE });
  check('W5 Hinzufügen von fremder Herkunft: 403', r.status === 403, String(r.status));
  r = await post('add', '{"user":"neuer_streamer"}', { Origin: OWN[0], 'Content-Type': 'text/plain' });
  check('W6 Hinzufügen ohne JSON: 415', r.status === 415, String(r.status));
  r = await post('remove', { id: '111' }, JSON_TYPE);
  check('W7 Entfernen ohne Herkunft: 403', r.status === 403, String(r.status));
  r = await request(`${WHITELIST}/add`);
  check('W8 GET auf Hinzufügen: 404', r.status === 404, String(r.status));

  for (const user of ['', '   ', 'zwei worte', '../datei', 'x'.repeat(26), 5, null]) {
    r = await post('add', { user });
    check(`W9 Ungültige Eingabe ${JSON.stringify(user).slice(0, 12)}: 400`, r.status === 400, String(r.status));
  }
  r = await post('add', { user: 'gibtsnicht' });
  check('W10 Unbekanntes Konto: 404', r.status === 404 && JSON.parse(r.body).error.includes('gibtsnicht'), r.body);
  r = await post('add', { user: 'twitchfehler' });
  check('W11 Twitch-Fehler: 502', r.status === 502, String(r.status));
  r = await post('add', { user: 'zeta' });
  check('W12 Schon vorhanden: 409', r.status === 409, String(r.status));
  r = await post('add', '{kaputt');
  check('W13 Kaputtes JSON: 400', r.status === 400, String(r.status));
  r = await post('add', { user: 'x'.repeat(2000) });
  check('W14 Zu große Anfrage: 413', r.status === 413, String(r.status));
  check('W15 Fehlversuche ändern die Datei nicht', JSON.stringify(file()) === before, JSON.stringify(file()));

  r = await post('add', { user: '  @Neuer_Streamer ' });
  check('W16 Hinzufügen per @Name', r.status === 200 && JSON.parse(r.body).entry.id === '333' && file()['333'] === 'neuer_streamer', r.body);
  check('W17 Hinzufügen steht in der Konsole', logs.some(l => l.includes('@neuer_streamer (ID: 333) zur Whitelist hinzugefügt')));
  r = await post('add', { user: '444' });
  check('W18 Hinzufügen per ID', r.status === 200 && file()['444'] === 'per_id', r.body);
  r = await post('add', { user: '@12345' });
  check('W19 @ mit Ziffern ist ein Name', r.status === 200 && file()['777'] === '12345', r.body);

  for (const id of ['abc', '__proto__', '', 5]) {
    r = await post('remove', { id });
    check(`W20 Ungültige ID ${JSON.stringify(id)}: 400`, r.status === 400, String(r.status));
  }
  r = await post('remove', { id: '999' });
  check('W21 Unbekannte ID: 404', r.status === 404, String(r.status));
  r = await post('remove', { id: '111' });
  check('W22 Entfernen', r.status === 200 && !('111' in file()) && file()['222'] === 'Alpha', r.body);
  check('W23 Entfernen steht in der Konsole', logs.some(l => l.includes('@zeta (ID: 111) aus der Whitelist entfernt')));
  r = await request(OVERVIEW);
  check('W24 Die Übersicht kennt die neue Anzahl', JSON.parse(r.body).whitelist_count === 4, r.body.slice(0, 80));
}

async function module_() {
  const own = { Origin: OWN[0], ...JSON_TYPE };
  const post = (body, headers = own) => request(MODULES, headers, 'POST', typeof body === 'string' ? body : JSON.stringify(body));
  const modulesFile = path.join(workDir, 'modules.json');

  let r = await request(MODULES);
  check('M1 GET schaltet nicht: 404', r.status === 404, String(r.status));
  r = await post({ module: 'bdu', enabled: false }, JSON_TYPE);
  check('M2 POST ohne Herkunft: 403', r.status === 403, String(r.status));
  r = await post({ module: 'bdu', enabled: false }, { Origin: 'null', ...JSON_TYPE });
  check('M3 POST von Herkunft null: 403', r.status === 403, String(r.status));
  r = await post({ module: 'bdu', enabled: false }, { Origin: OWN[0], ...JSON_TYPE, Host: 'example.com' });
  check('M4 POST mit fremdem Host: 403', r.status === 403, String(r.status));
  r = await post('{"module":"bdu","enabled":false}', { Origin: OWN[0], 'Content-Type': 'text/plain' });
  check('M5 POST ohne JSON: 415', r.status === 415, String(r.status));
  for (const body of [{ module: 'gibtsnicht', enabled: false }, { module: '__proto__', enabled: false }, { module: 5, enabled: false }, { enabled: false }]) {
    r = await post(body);
    check(`M6 Unbekanntes Modul ${JSON.stringify(body.module)}: 400`, r.status === 400, String(r.status));
  }
  for (const enabled of ['false', 0, null, undefined]) {
    r = await post({ module: 'bdu', enabled });
    check(`M7 enabled ${JSON.stringify(enabled)}: 400`, r.status === 400, String(r.status));
  }
  r = await post({ module: 'bdu', enabled: false, x: 'y'.repeat(2000) });
  check('M8 Zu große Anfrage: 413', r.status === 413, String(r.status));
  r = await post('{kaputt');
  check('M9 Kaputtes JSON: 400', r.status === 400, String(r.status));
  check('M10 Fehlversuche schreiben keine Datei', !fs.existsSync(modulesFile));

  r = await post({ module: 'bdu', enabled: false });
  let d = JSON.parse(r.body);
  check('M11 Ausschalten', r.status === 200 && d.ok === true && d.changed === true && d.modules.bdu === false && d.modules.uboat === true, r.body);
  check('M12 Gespeichert', JSON.parse(fs.readFileSync(modulesFile, 'utf8')).bdu === false);
  check('M13 Steht in der Konsole', logs.some(l => l.includes('BdU-Chat deaktiviert')));
  r = await request(OVERVIEW);
  check('M14 Übersicht kennt den neuen Stand', JSON.parse(r.body).modules.bdu === false, r.body.slice(0, 120));
  r = await post({ module: 'bdu', enabled: false });
  d = JSON.parse(r.body);
  check('M15 Nochmal ausschalten ändert nichts', r.status === 200 && d.changed === false, r.body);
  r = await post({ module: 'bdu', enabled: true });
  check('M16 Wieder einschalten', r.status === 200 && JSON.parse(r.body).modules.bdu === true, r.body);

  r = await post({ module: 'uboat', enabled: false });
  check('M17 UBOAT-Soldbuch ausschalten', r.status === 200 && JSON.parse(r.body).modules.uboat === false, r.body);
  r = await post({ module: 'uboat', enabled: true });
  check('M18 Einschalten ohne Ordner: Hinweis in der Konsole', r.status === 200 && logs.some(l => l.includes('UBOAT_SAVES_DIR ist nicht gesetzt')), r.body);
}

async function effekte() {
  const own = { Origin: OWN[0], ...JSON_TYPE };
  const post = (p, body, headers = own) => request(p, headers, 'POST', typeof body === 'string' ? body : JSON.stringify(body));
  const modeFile = path.join(workDir, 'effect_mode.json');

  for (const old of ['/api/effects/mode/off', '/api/effects/confirm']) {
    const res = await request(old);
    check(`N1 Alte Adresse ${old}: 404`, res.status === 404, String(res.status));
  }
  check('N2 Die alten Adressen ändern nichts', !fs.existsSync(modeFile));
  let r = await request('/api/effects/mode');
  check('N3 Lesen bleibt möglich', r.status === 200 && JSON.parse(r.body).mode === 'auto', r.body);

  r = await request(EFFECT_MODE);
  check('N4 GET schaltet nicht: 404', r.status === 404, String(r.status));
  r = await post(EFFECT_MODE, { mode: 'off' }, JSON_TYPE);
  check('N5 POST ohne Herkunft: 403', r.status === 403, String(r.status));
  r = await post(EFFECT_MODE, { mode: 'off' }, { Origin: 'http://absolute', ...JSON_TYPE });
  check('N6 POST von OBS-Herkunft: 403', r.status === 403, String(r.status));
  r = await post(EFFECT_MODE, { mode: 'off' }, { Origin: OWN[0], ...JSON_TYPE, Host: 'example.com' });
  check('N7 POST mit fremdem Host: 403', r.status === 403, String(r.status));
  r = await post(EFFECT_MODE, '{"mode":"off"}', { Origin: OWN[0], 'Content-Type': 'text/plain' });
  check('N8 POST ohne JSON: 415', r.status === 415, String(r.status));
  for (const mode of ['manual', 'AUTO', 'irgendwas', 5, null, ['off']]) {
    r = await post(EFFECT_MODE, { mode });
    check(`N9 Ungültiger Modus ${JSON.stringify(mode)}: 400`, r.status === 400, String(r.status));
  }
  r = await post(EFFECT_CONFIRM, {});
  check('N10 Bestätigen gibt es nicht mehr: 404', r.status === 404, String(r.status));
  check('N11 Fehlversuche ändern den Modus nicht', !fs.existsSync(modeFile));

  for (const mode of ['off', 'auto']) {
    r = await post(EFFECT_MODE, { mode });
    const d = JSON.parse(r.body);
    check(`N12 Modus ${mode}`, r.status === 200 && d.ok === true && d.mode === mode && JSON.parse(fs.readFileSync(modeFile, 'utf8')).mode === mode, r.body);
  }
  check('N13 Wechsel steht in der Konsole', logs.some(l => l.includes('Effekt-Modus geändert auf: OFF')));
}

async function statistik() {
  let n = 0;
  sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'session_welcome', message_id: 'w' }, payload: { session: { id: 's', keepalive_timeout_seconds: 3600 } } }));
  await sleep(100);
  const send = (subType, event, id = `s${++n}`) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: subType, message_id: id }, payload: { event } }));
  const chat = (login, id, extra = {}) => send('channel.chat.message', { chatter_user_id: id, chatter_user_login: login, chatter_user_name: login, broadcaster_user_id: '4711', message_id: `c${n}`, message: { text: 'hallo' }, badges: [], ...extra });
  const notice = (notice_type, extra) => send('channel.chat.notification', { notice_type, broadcaster_user_id: '4711', chatter_user_id: `u${n}`, chatter_user_login: `gast${n}`, chatter_user_name: `gast${n}`, ...extra });
  const values = async () => Object.fromEntries(JSON.parse((await request(STATS)).body).instance.metrics.map(m => [m.key, m.value]));

  let r = await request(STATS, { Host: 'example.com' });
  check('S1 Statistik mit fremdem Host: 403', r.status === 403, String(r.status));
  r = await request(STATS, { Origin: 'null' });
  check('S2 Statistik von Herkunft null: 403', r.status === 403, String(r.status));
  r = await request(STATS);
  const first = JSON.parse(r.body);
  check('S3 Antwort mit Laufzeit und Kennzahlen', r.status === 200 && first.enabled === true && first.instance.uptime_seconds >= 0 && !Number.isNaN(Date.parse(first.instance.started_at)) && first.instance.metrics.length === 6, r.body);
  check('S4 Beginnt bei 0', first.instance.metrics.every(m => m.value === 0), r.body);

  send('channel.follow', { user_login: 'folgt', user_id: 'f1' }, 'doppelt');
  send('channel.follow', { user_login: 'folgt', user_id: 'f1' }, 'doppelt');
  send('channel.follow', { user_login: 'folgt', user_id: 'f1' });
  send('channel.follow', { user_login: 'folgt2', user_id: 'f2' });
  await sleep(50);
  let v = await values();
  check('S5 Follows: doppelte Zustellung und Wiederholung zählen nicht', v.follows === 2, JSON.stringify(v));

  chat('zuschauer', 'z1');
  chat('zuschauer', 'z1');
  chat('testkanal', '4711');
  chat('NightBot', 'b1');
  chat('streamelements', 'b2');
  chat('derbdu', 'b3');
  chat('gast_anderswo', 'z2', { source_broadcaster_user_id: '999' });
  await sleep(100);
  v = await values();
  check('S6 Chat: nur echte Zuschauer im eigenen Kanal', v.chat_messages === 2, JSON.stringify(v));

  notice('sub', { sub: { is_gift: false } });
  notice('resub', { resub: { is_gift: false } });
  notice('sub', { sub: { is_gift: true } });
  notice('community_sub_gift', { community_sub_gift: { total: 5 } });
  notice('sub_gift', { sub_gift: { community_gift_id: 'x' } });
  notice('sub_gift', { sub_gift: {} });
  await sleep(50);
  v = await values();
  check('S7 Subs ohne Gift-Empfänger', v.subs === 2, JSON.stringify(v));
  check('S8 Gifts: Bomb nach Anzahl, Einzel-Gift dazu, Teil-Meldungen nicht', v.gifts === 6, JSON.stringify(v));

  console.warn('[Test] nur Warnung');
  console.error('[Test] echter Fehler');
  v = await values();
  check('S9 Fehler zählen, Warnungen nicht', v.errors === 1, JSON.stringify(v));

  await sleep(3500);
  v = await values();
  check('S10 Ausgelöste Effekte zählen', v.effects >= 1, JSON.stringify(v));
  check('S11 Erfolgreiche Abrufe fluten die Konsole nicht', !logs.some(l => /\[HTTP\] GET \/api\/admin\/stats -> 200/.test(l)));
  check('S12 Abgelehnte Abrufe stehen in der Konsole', logs.some(l => /\[HTTP\] GET \/api\/admin\/stats -> 403/.test(l)));

  const stream = async () => JSON.parse((await request(STATS)).body).stream;
  const streamValues = async () => Object.fromEntries((await stream()).metrics.map(m => [m.key, m.value]));
  check('S13 Ohne Live-Ereignis kein Stream', (await stream()).status === 'none');
  check('S14 Abos für Offline und ausgehende Raids', subscribed.includes('stream.offline') && subscribed.some(s => s === 'channel.raid:from') && subscribed.some(s => s === 'channel.raid:to'), subscribed.join(','));
  send('stream.online', { id: 'st1', type: 'playlist', started_at: new Date().toISOString() });
  await sleep(30);
  check('S15 Nur echte Live-Streams starten die Erfassung', (await stream()).status === 'none');
  send('stream.online', { id: 'st1', type: 'live', started_at: new Date().toISOString() });
  await sleep(50);
  let st = await stream();
  check('S16 stream.online startet und schreibt sofort', st.status === 'live' && JSON.parse(fs.readFileSync(path.join(workDir, 'stream_stats.json'), 'utf8')).status === 'live', JSON.stringify(st));
  send('channel.follow', { user_login: 'folgt3', user_id: 'f3' });
  chat('zuschauer', 'z1');
  send('channel.raid', { from_broadcaster_user_id: '77', from_broadcaster_user_login: 'raider', from_broadcaster_user_name: 'raider', to_broadcaster_user_id: '4711', to_broadcaster_user_login: 'testkanal', viewers: 1 });
  await sleep(100);
  let sv = await streamValues();
  check('S17 Stream zählt Follows, Chat und eingehende Raids', sv.follows === 1 && sv.chat_messages === 1 && sv.raids === 1, JSON.stringify(sv));
  const instanceFollows = (await values()).follows;
  check('S18 Server-Instanz zählt weiter getrennt', instanceFollows === 3, String(instanceFollows));
  send('channel.poll.end', { id: 'p1', status: 'completed', choices: [{ votes: 3, channel_points_votes: 2 }, { votes: 4, channel_points_votes: 1 }], channel_points_voting: { is_enabled: true, amount_per_vote: 100 } });
  send('channel.poll.end', { id: 'p1', status: 'archived', choices: [{ votes: 3, channel_points_votes: 2 }], channel_points_voting: { is_enabled: true, amount_per_vote: 100 } });
  send('channel.poll.end', { id: 'p2', status: 'terminated', choices: [{ votes: 1, channel_points_votes: 0 }], channel_points_voting: { is_enabled: false, amount_per_vote: 0 } });
  send('channel.prediction.end', { id: 'w1', status: 'resolved', outcomes: [{ users: 2, channel_points: 500 }, { users: 3, channel_points: 700 }] });
  send('channel.prediction.end', { id: 'w2', status: 'canceled', outcomes: [{ users: 9, channel_points: 9000 }] });
  send('channel.shoutout.create', { to_broadcaster_user_login: 'freund' });
  await sleep(50);
  sv = await streamValues();
  check('S17a Abstimmungen: archived zählt nicht doppelt', sv.polls === 2 && sv.poll_votes === 8, JSON.stringify(sv));
  check('S17b Wetten: abgebrochene zählen nicht', sv.predictions === 1 && sv.prediction_users === 5, JSON.stringify(sv));
  check('S17c Kanalpunkte aus Abstimmungen und Wetten', sv.channel_points === 1500, JSON.stringify(sv));
  check('S17d Shoutouts über das Twitch-Ereignis', sv.shoutouts === 1, JSON.stringify(sv));
  st = await stream();
  check('S17e Verschiedene und aktivste Chatter', st.unique_chatters === 1 && st.top_chatters[0].name === 'zuschauer' && st.top_chatters[0].count === 1, JSON.stringify(st.top_chatters));
  check('S17f Abos für Abstimmungen, Wetten und Shoutouts', ['channel.poll.end', 'channel.prediction.end', 'channel.shoutout.create'].every(t => subscribed.includes(t)), subscribed.join(','));

  send('stream.offline', { id: 'st1' });
  await sleep(50);
  st = await stream();
  check('S19 Offline: Frist läuft', st.status === 'offline' && !!st.closes_at, JSON.stringify(st));
  const greetingsBefore = logs.filter(l => l.includes('in Warteschlange eingereiht')).length;
  send('channel.raid', { from_broadcaster_user_id: '4711', from_broadcaster_user_login: 'testkanal', to_broadcaster_user_id: '88', to_broadcaster_user_login: 'freund', viewers: 5 });
  await sleep(50);
  st = await stream();
  check('S20 Ausgehender Raid schließt ab und begrüßt niemanden', st.status === 'closed' && st.close_reason === 'raid' && logs.filter(l => l.includes('in Warteschlange eingereiht')).length === greetingsBefore, JSON.stringify(st));
  sv = await streamValues();
  check('S21 Ausgehender Raid zählt nicht als Raid', sv.raids === 1, JSON.stringify(sv));
}

async function effekteAlt() {
  const r = await request(OVERVIEW);
  check('O1 Gespeichertes "manual" wird zu auto', JSON.parse(r.body).effect_mode === 'auto', r.body.slice(0, 200));
}

async function serverBeenden() {
  let r = await request(OVERVIEW);
  check('D1 Ohne AuthServer.cmd: can_restart ist false', JSON.parse(r.body).can_restart === false, r.body);
  r = await request(SHUTDOWN);
  check('D2 GET beendet nicht: 404', r.status === 404, String(r.status));
  r = await request(SHUTDOWN, JSON_TYPE, 'POST', '{}');
  check('D3 POST ohne Herkunft: 403', r.status === 403, String(r.status));
  for (const origin of ['null', 'http://absolute', 'https://fremd.example']) {
    r = await request(SHUTDOWN, { Origin: origin, ...JSON_TYPE }, 'POST', '{}');
    check(`D4 POST von Herkunft ${origin}: 403`, r.status === 403, String(r.status));
  }
  r = await request(SHUTDOWN, { Origin: OWN[0], ...JSON_TYPE, Host: 'example.com' }, 'POST', '{}');
  check('D5 POST mit fremdem Host: 403', r.status === 403, String(r.status));
  r = await request(SHUTDOWN, { Origin: OWN[0], 'Content-Type': 'text/plain' }, 'POST', '{}');
  check('D6 POST ohne JSON: 415', r.status === 415, String(r.status));
  r = await request(SHUTDOWN, { Origin: OWN[0] }, 'POST');
  check('D7 POST ohne Inhalt: 415', r.status === 415, String(r.status));
  r = await request(RESTART, { Origin: OWN[0], ...JSON_TYPE }, 'POST', '{}');
  check('D8 Neustart ohne AuthServer.cmd: 409', r.status === 409, String(r.status));
  await sleep(EXIT_WAIT_MS);
  check('D9 Keine dieser Anfragen beendet den Server', exits.length === 0, JSON.stringify(exits));

  r = await request(SHUTDOWN, { Origin: OWN[0], ...JSON_TYPE }, 'POST', '{}');
  const d = JSON.parse(r.body);
  check('D10 Beenden: Antwort mit Prozess-ID und Uhrzeit', r.status === 200 && d.ok === true && d.pid === process.pid && !Number.isNaN(Date.parse(d.at)), r.body);
  check('D11 Die Antwort kommt vor dem Ende', exits.length === 0, JSON.stringify(exits));
  r = await request(SHUTDOWN, { Origin: OWN[0], ...JSON_TYPE }, 'POST', '{}');
  check('D12 Zweiter Auftrag: 409', r.status === 409, String(r.status));
  await sleep(EXIT_WAIT_MS);
  check('D13 Der Server endet genau einmal mit Code 0', JSON.stringify(exits) === '[0]', JSON.stringify(exits));
  check('D14 Das Ende steht in der Konsole', logs.some(l => l.includes(`[Webkonsole] Server wird beendet (PID ${process.pid})`)));
}

async function serverNeustart() {
  let r = await request(OVERVIEW);
  check('E1 Mit AuthServer.cmd: can_restart ist true', JSON.parse(r.body).can_restart === true, r.body);
  r = await request(RESTART, JSON_TYPE, 'POST', '{}');
  check('E2 POST ohne Herkunft: 403', r.status === 403, String(r.status));
  r = await request(RESTART, { Origin: OWN[1], ...JSON_TYPE }, 'POST', '{}');
  const d = JSON.parse(r.body);
  check('E3 Neustart: Antwort mit Prozess-ID und Uhrzeit', r.status === 200 && d.ok === true && d.pid === process.pid && !Number.isNaN(Date.parse(d.at)), r.body);
  r = await request(SHUTDOWN, { Origin: OWN[1], ...JSON_TYPE }, 'POST', '{}');
  check('E4 Beenden während des Neustarts: 409', r.status === 409, String(r.status));
  await sleep(EXIT_WAIT_MS);
  check('E5 Der Server endet genau einmal mit Code 75', JSON.stringify(exits) === '[75]', JSON.stringify(exits));
  check('E6 Der Neustart steht in der Konsole', logs.some(l => l.includes(`[Webkonsole] Server wird neu gestartet (PID ${process.pid})`)));
}

async function ohneTokens() {
  let r = await request(OVERVIEW);
  const d = JSON.parse(r.body);
  check('C1 Ohne Login: Overview antwortet mit dem, was der Server weiß', r.status === 200 && d.authenticated === false && d.pid === process.pid && !('token_valid' in d) && 'effect_mode' in d, r.body);
  r = await request('/status');
  const s = JSON.parse(r.body);
  check('C2 Ohne Login: /status wie bisher', s.authenticated === false && !!s.message && s.pid === process.pid && !('effect_mode' in s), r.body);
}

(async () => {
  await sleep(500);
  if (scenario === 'alle-herkuenfte') await alleHerkuenfte();
  else if (scenario === 'ohne-tokens') await ohneTokens();
  else if (scenario === 'server-beenden') await serverBeenden();
  else if (scenario === 'server-neustart') await serverNeustart();
  else if (scenario === 'live-log') await liveLog();
  else if (scenario === 'fehler-protokoll') await fehlerProtokoll();
  else if (scenario === 'fehler-defekt') await fehlerDefekt();
  else if (scenario === 'whitelist') await whitelist();
  else if (scenario === 'module') await module_();
  else if (scenario === 'effekte') await effekte();
  else if (scenario === 'effekte-alt') await effekteAlt();
  else if (scenario === 'statistik') await statistik();
  else await ablauf();

  console.log = realLog;
  for (const x of results) realLog(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  realExit(results.every(x => x.ok) ? 0 : 1);
})();
