// Webkonsole Stufe 1 (ADR 0018, docs/specs/webkonsole.md): Seite und /api/admin/overview nur lokal, strenge Herkunft,
// keine Secrets, nichts außerhalb von public/admin abrufbar, /status unverändert.
// Stufe 2: Server beenden und neu starten (process.exit wird dabei nur aufgezeichnet).
// Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis. Aufruf: node admin-test.js <server.js> [ablauf|alle-herkuenfte|ohne-tokens|server-beenden|server-neustart]
// Nicht abgedeckt: Aufruf von einer fremden IP-Adresse (Test läuft über 127.0.0.1; geprüft wird der fremde Host-Header).
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const scenario = process.argv[3] || 'ablauf';
const PORT = 40300 + Math.floor(Math.random() * 250);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-'));
const SECRETS = ['CLIENT-SECRET-ATTRAPPE', 'ACCESS-TOKEN-ATTRAPPE', 'REFRESH-TOKEN-ATTRAPPE'];
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=${SECRETS[0]}\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\n`
  + (scenario === 'alle-herkuenfte' ? 'CORS_ORIGINS=*\nHA_WEBHOOK_URL=http://ha-attrappe.invalid/hook\n' : ''));
if (scenario !== 'ohne-tokens') {
  fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: SECRETS[1], refresh_token: SECRETS[2], broadcaster_id: '4711', broadcaster_name: 'testkanal',
    obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
}
const effects = ['eins', 'zwei', 'drei', 'vier', 'fuenf', 'sechs'].map((userName, i) => ({ type: 'follow', userName, userId: String(i), count: 1, timestamp: new Date(1000 + i).toISOString() }));
fs.writeFileSync(path.join(workDir, 'events.json'), JSON.stringify(effects));
fs.writeFileSync(path.join(workDir, 'subgoal_cache.json'), JSON.stringify({ current: 7, target: 10, title: 'Ziel', goalId: 'g', status: 'active', lastUpdated: 'x' }));
process.chdir(workDir);

class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; } close() {} terminate() {} }
FakeWS.OPEN = 1;
const fakeAxios = { post: async () => ({ data: { data: [] } }), get: async () => ({ data: { data: [] } }) };
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
  else await ablauf();

  console.log = realLog;
  for (const x of results) realLog(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  realExit(results.every(x => x.ok) ? 0 : 1);
})();
