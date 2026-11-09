// Webkonsole Stufe 1 (ADR 0018, docs/specs/webkonsole.md): Seite und /api/admin/overview nur lokal, strenge Herkunft,
// keine Secrets, nichts außerhalb von public/admin abrufbar, /status unverändert.
// Stufe 2: Server beenden und neu starten (process.exit wird dabei nur aufgezeichnet).
// Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis. Aufruf: node admin-test.js <server.js> [ablauf|alle-herkuenfte|ohne-tokens|server-beenden|server-neustart|live-log|fehler-protokoll|fehler-defekt|whitelist]
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
if (scenario === 'fehler-defekt') fs.writeFileSync(path.join(workDir, 'error_log.json'), '{ keine gültige Liste');
process.chdir(workDir);

class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; } close() {} terminate() {} }
FakeWS.OPEN = 1;
const WHITELIST_USERS = { 'login=neuer_streamer': { id: '333', login: 'neuer_streamer' }, 'login=12345': { id: '777', login: '12345' }, 'id=444': { id: '444', login: 'per_id' }, 'login=zeta': { id: '111', login: 'zeta' } };
const fakeAxios = {
  post: async () => ({ data: { data: [] } }),
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
    && d.poll_ms === 5000 && d.port === PORT && /^\d+\.\d+\.\d+/.test(d.version) && 'category' in d && d.pending_confirmation === null && d.modules.bdu === true, r.body);
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
  else await ablauf();

  console.log = realLog;
  for (const x of results) realLog(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  realExit(results.every(x => x.ok) ? 0 : 1);
})();
