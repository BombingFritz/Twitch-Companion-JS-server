// Effekt-Modus: auto und off über Webkonsole und Konsole; off verwirft neue Effekte, manual gibt es nicht mehr.
// Attrappen: ws, axios, readline per Module._load. Eigenes Arbeitsverzeichnis, Fake-tokens.json.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');

const serverPath = path.resolve(process.argv[2]);
const PORT = 39000 + Math.floor(Math.random() * 500);
const HA_URL = 'http://ha.invalid/api/webhook/<WEBHOOK_ID>';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'k3-'));
fs.writeFileSync(path.join(workDir, '.env'),
  `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\nHA_WEBHOOK_URL=${HA_URL}\n`);
fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({
  access_token: 'fake', refresh_token: 'fake', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter {
  constructor(url) { super(); this.url = url; this.readyState = 1; sockets.push(this); }
  close() { this.readyState = 3; this.emit('close'); }
}
FakeWS.OPEN = 1;
const haPosts = [];
const fakeAxios = {
  post: async (url, body) => { if (url === HA_URL) haPosts.push(body); return { data: { data: [] } }; },
  get: async () => ({ data: { data: [] } }),
};
const rlEmitter = new EventEmitter();
const fakeReadline = { createInterface: () => rlEmitter };

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'ws') return FakeWS;
  if (req === 'axios') return fakeAxios;
  if (req === 'readline') return fakeReadline;
  return origLoad.call(this, req, ...rest);
};
const realLog = console.log;
const logs = [];
console.log = (...a) => logs.push(a.join(' '));
console.warn = console.log;

require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));
const post = (p, body) => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { Origin: `http://localhost:${PORT}`, 'Content-Type': 'application/json' } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  });
  req.on('error', rej);
  req.end(JSON.stringify(body));
});
const setMode = mode => post('/api/admin/effects/mode', { mode });
let msgN = 0;
function follow(user) {
  sockets[0].emit('message', JSON.stringify({
    metadata: { message_type: 'notification', subscription_type: 'channel.follow', message_id: `m${++msgN}` },
    payload: { event: { user_login: user, user_id: `u-${user}` } } }));
}
const events = () => fs.existsSync('events.json') ? JSON.parse(fs.readFileSync('events.json', 'utf8')) : [];
const results = [];
function check(name, cond, info = '') { results.push({ name, ok: !!cond, info }); }

(async () => {
  await sleep(300);
  const savedMode = () => JSON.parse(fs.readFileSync('effect_mode.json', 'utf8')).mode;

  // 1) Webkonsole: off verwirft neue Effekte
  const off1 = await setMode('off');
  check('1a Moduswechsel per Webkonsole ok', off1.ok && off1.mode === 'off', JSON.stringify(off1));
  follow('alice');
  await sleep(7000);
  const st1 = await get('/api/effects/mode');
  check('1b OFF: Effekt verworfen, Queue leer', st1.queueLength === 0 && haPosts.length === 0 && events().length === 0, JSON.stringify(st1));
  check('1c Keine Bestätigung mehr in der Antwort', !('pendingConfirmation' in st1), JSON.stringify(st1));

  // 2) Konsole: auto löst sofort aus, Payload unverändert
  rlEmitter.emit('line', 'effects mode auto');
  await sleep(50);
  check('2a Modus auto gespeichert', savedMode() === 'auto');
  follow('bob');
  await sleep(8000);
  const p = haPosts[0] || {};
  check('2b auto: genau ein Webhook ohne Bestätigung', haPosts.length === 1, `${haPosts.length} Posts`);
  check('2c Payload {type,count,meta,timestamp}', JSON.stringify(Object.keys(p)) === '["type","count","meta","timestamp"]'
    && p.type === 'follow' && p.count === 1 && p.meta.userName === 'bob', JSON.stringify(p));

  // 3) Konsole: off
  rlEmitter.emit('line', 'effects mode off');
  await sleep(50);
  check('3a Modus off gespeichert', savedMode() === 'off');

  // 4) manual gibt es nicht mehr
  rlEmitter.emit('line', 'effects mode manual');
  await sleep(50);
  check('4a Konsole lehnt manual ab', savedMode() === 'off' && logs.some(l => l === 'Nutzung: effects mode <auto|off>'));
  const m = await setMode('manual');
  check('4b Webkonsole lehnt manual ab', !m.ok && !!m.error && savedMode() === 'off', JSON.stringify(m));

  console.log = realLog;
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  realLog(`\n${results.filter(r => r.ok).length}/${results.length} bestanden`);
  realLog('Log-Auszug Effekt-Modus:\n' + logs.filter(l => /Effekt-Modus|verworfen/.test(l)).map(l => '  ' + l).join('\n'));
  process.chdir(os.tmpdir()); fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
})().catch(e => { console.log = realLog; console.error(e); process.exit(2); });
