// Login nur lokal (ADR 0013, Nachtrag 07.11.2026): /login und /callback nur über localhost/127.0.0.1,
// state für Broadcaster- und Bot-Login (einmal gültig), OAuth-Code nicht im HTTP-Protokoll.
// Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis. Aufruf: node login-test.js <server.js>
// Nicht abgedeckt: Aufruf von einer fremden IP-Adresse (Test läuft über 127.0.0.1; geprüft wird der fremde Host-Header)
// und Ablauf des state nach 10 min.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 40000 + Math.floor(Math.random() * 250);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-'));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read+user:write:chat\n`);
const TOKENS = JSON.stringify({ access_token: 'alt', refresh_token: 'alt', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 });
fs.writeFileSync(path.join(workDir, 'tokens.json'), TOKENS);
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() { this.emit('close'); } terminate() { this.emit('close'); } }
FakeWS.OPEN = 1;
const CODES = { geheimcode: { token: 'neu', scope: ['chat:read', 'user:write:chat'] }, botcode: { token: 'botuser', scope: ['user:bot', 'user:write:chat'] } };
let codeExchanges = 0;
const fakeAxios = {
  post: async (url, body) => {
    if (url.includes('/oauth2/token') && body.get('grant_type') === 'authorization_code') {
      codeExchanges++;
      const c = CODES[body.get('code')];
      return { data: { access_token: c.token, refresh_token: 'r-' + c.token, expires_in: 14000, scope: c.scope } };
    }
    if (url.includes('/oauth2/token')) return { data: { access_token: 'app-1', expires_in: 5000000 } };
    return { data: { data: [] } };
  },
  get: async (url, cfg) => {
    if (url.endsWith('/helix/users')) {
      const auth = cfg.headers.Authorization;
      if (auth === 'Bearer neu') return { data: { data: [{ id: '1', login: 'test', display_name: 'Test' }] } };
      if (auth === 'Bearer botuser') return { data: { data: [{ id: '99', login: 'derbdu', display_name: 'DerBdu' }] } };
    }
    return { data: { data: [] } };
  },
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const realLog = console.log, logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const request = (p, headers = {}) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p, headers }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: d }));
  }).on('error', rej);
});
const stateFrom = r => new URL(r.headers.location).searchParams.get('state');
const tokensNow = () => fs.readFileSync('tokens.json', 'utf8');
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const has = re => logs.some(l => re.test(l));

(async () => {
  await sleep(500);

  let r = await request('/login');
  const loc = r.headers.location ? new URL(r.headers.location) : null;
  check('L1 /login lokal: Weiterleitung mit state und Scopes aus SCOPES', r.status === 302 && loc && /^[0-9a-f]{32}$/.test(loc.searchParams.get('state') || '')
    && loc.searchParams.get('scope') === 'chat:read user:write:chat', r.headers.location);
  const firstState = stateFrom(r);

  r = await request('/login', { Host: 'example.com' });
  check('L2 /login mit fremdem Host: 403', r.status === 403 && has(/\[Zugriffsschutz\] \/login abgelehnt/));
  r = await request(`/callback?code=geheimcode&state=${firstState}`, { Host: 'example.com' });
  check('L3 /callback mit fremdem Host: 403, tokens.json unverändert, kein Code-Tausch', r.status === 403 && tokensNow() === TOKENS && codeExchanges === 0);

  r = await request('/callback?code=geheimcode');
  check('L4 /callback ohne state: 400, nichts gespeichert (vorher: Tokens überschrieben)', r.status === 400 && tokensNow() === TOKENS && codeExchanges === 0, r.body);
  r = await request('/callback?code=geheimcode&state=0123456789abcdef0123456789abcdef');
  check('L5 /callback mit fremdem state: 400, nichts gespeichert', r.status === 400 && tokensNow() === TOKENS && codeExchanges === 0);

  // Broadcaster- und Bot-Login gleichzeitig offen: jeder state führt zu seinem Login
  const botState = stateFrom(await request('/login-bot'));
  r = await request(`/callback?code=botcode&state=${botState}`);
  const bot = fs.existsSync('bot.json') ? JSON.parse(fs.readFileSync('bot.json', 'utf8')) : null;
  check('L6 Bot-state: bot.json geschrieben, tokens.json unverändert', r.status === 200 && bot && bot.bot_id === '99' && tokensNow() === TOKENS, r.body);
  r = await request(`/callback?code=geheimcode&state=${firstState}`);
  const t = JSON.parse(tokensNow());
  check('L7 Broadcaster-state: Tokens gespeichert', r.status === 200 && t.access_token === 'neu' && t.broadcaster_id === '1', r.body);
  r = await request(`/callback?code=geheimcode&state=${firstState}`);
  check('L8 derselbe state ein zweites Mal: 400', r.status === 400 && /ungültig oder abgelaufen/.test(r.body));
  r = await request('/callback?error=access_denied&state=' + stateFrom(await request('/login')));
  check('L9 Anmeldung bei Twitch abgebrochen: 400, nichts gespeichert', r.status === 400 && /abgebrochen/.test(r.body) && JSON.parse(tokensNow()).access_token === 'neu');

  check('L10 HTTP-Protokoll ohne Code und state', !logs.some(l => l.includes('geheimcode') || l.includes(firstState)) && has(/\[HTTP\] GET \/callback\?code=…&state=… -> 200/));

  console.log = realLog;
  for (const x of results) realLog(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
