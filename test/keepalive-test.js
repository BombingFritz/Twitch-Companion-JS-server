// EventSub-Keepalive: stiller Abbruch wird erkannt und neu aufgebaut. Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 38000 + Math.floor(Math.random() * 500);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
process.chdir(dir);
const sockets = [];
class WS extends EventEmitter {
  constructor(url) { super(); this.url = url; this.readyState = 1; this.terminated = 0; this.closed = 0; sockets.push(this); }
  terminate() { this.terminated++; this.readyState = 3; setImmediate(() => this.emit('close')); }
  close() { this.closed++; this.readyState = 3; setImmediate(() => this.emit('close')); }
}
WS.OPEN = 1;
let subPosts = 0;
const axios = { post: async (url) => { if (url.includes('eventsub/subscriptions')) subPosts++; return { data: {} }; }, get: async () => ({ data: { data: [] } }) };
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return axios; if (r === 'readline') return { createInterface: () => new EventEmitter() }; return orig.call(this, r, ...a); };
const logs = []; const real = console.log; console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
require(serverPath);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const msg = (ws, type, payload = {}) => ws.emit('message', JSON.stringify({ metadata: { message_type: type, message_id: Math.random().toString(36) }, payload }));
const welcome = (ws, ka = 1) => msg(ws, 'session_welcome', { session: { id: 's' + sockets.indexOf(ws), keepalive_timeout_seconds: ka } });
async function keepAlive(ws, ms) { const end = Date.now() + ms; while (Date.now() < end) { msg(ws, 'session_keepalive'); await sleep(500); } }
const results = []; const check = (n, c, i = '') => results.push({ n, ok: !!c, i });

(async () => {
  await sleep(300);
  const s0 = sockets[0];
  welcome(s0); await sleep(300);
  check('1 Start: 17 Subscriptions angelegt (14 + 3 Goal-Abos, Issue #60)', subPosts === 17, subPosts);
  await keepAlive(s0, 7000);
  check('2 Keepalives halten die Verbindung (7 s bei 1 s + 5 s Zuschlag)', s0.terminated === 0 && sockets.length === 1);
  // Notifications zählen ebenfalls
  for (let i = 0; i < 8; i++) { msg(s0, 'notification', { subscription: {}, event: {} }); s0.emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: 'x', message_id: 'n' + i }, payload: { event: {} } })); await sleep(500); }
  check('3 Ereignisse zählen als Lebenszeichen', s0.terminated === 0);
  await sleep(6500);
  check('4 Stille: Verbindung nach ~6 s hart getrennt', s0.terminated === 1, `terminated=${s0.terminated}`);
  check('5 Hinweis im Log', logs.some(l => /keine Nachricht.*neu aufgebaut/.test(l)));
  await sleep(5300);
  const s1 = sockets[1];
  check('6 nach 5 s frische Verbindung zur Standard-URL', s1 && s1.url === 'wss://eventsub.wss.twitch.tv/ws', sockets.map(s => s.url));
  welcome(s1); await sleep(300);
  check('7 frische Verbindung legt Subscriptions neu an', subPosts === 34, subPosts);
  // session_reconnect
  msg(s1, 'session_reconnect', { session: { reconnect_url: 'wss://reconnect.example/ws' } }); await sleep(100);
  const s2 = sockets[2];
  check('8 Reconnect öffnet Verbindung zur reconnect_url', s2 && s2.url === 'wss://reconnect.example/ws');
  welcome(s2); await sleep(300);
  check('9 Reconnect: alte geschlossen, keine neuen Subscriptions', s1.closed === 1 && subPosts === 34, `closed=${s1.closed} subs=${subPosts}`);
  await keepAlive(s2, 7000);
  check('10 nach Reconnect: kein Fehlalarm, alte Verbindung nicht nachträglich getrennt', s1.terminated === 0 && s2.terminated === 0 && sockets.length === 3);
  await sleep(6500);
  check('11 Stille auf der neuen Verbindung wird erkannt', s2.terminated === 1);
  await sleep(5300);
  check('12 danach frische Verbindung', sockets.length === 4 && sockets[3].url === 'wss://eventsub.wss.twitch.tv/ws');
  console.log = real;
  for (const r of results) real(`${r.ok ? 'OK  ' : 'FAIL'} ${r.n}${r.ok ? '' : '  -> ' + JSON.stringify(r.i)}`);
  real(`${results.filter(r => r.ok).length}/${results.length} bestanden`);
  process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})();
