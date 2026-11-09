// K3-Test: Effekt-Modus OFF verwirft wartende manuelle Bestätigung.
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
const confirmEffect = () => post('/api/admin/effects/confirm', {});
let msgN = 0;
function follow(user) {
  sockets[0].emit('message', JSON.stringify({
    metadata: { message_type: 'notification', subscription_type: 'channel.follow', message_id: `m${++msgN}` },
    payload: { event: { user_login: user, user_id: `u-${user}` } } }));
}
const events = () => fs.existsSync('events.json') ? JSON.parse(fs.readFileSync('events.json', 'utf8')) : [];
async function waitPending(maxMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if ((await get('/api/effects/mode')).pendingConfirmation) return true; await sleep(200); }
  return false;
}
const results = [];
function check(name, cond, info = '') { results.push({ name, ok: !!cond, info }); }

(async () => {
  await sleep(300);
  // 1) HTTP: manual -> wartet -> off -> confirm
  await setMode('manual');
  follow('alice');
  check('1a Bestätigung wartet (manual)', await waitPending());
  const off1 = await setMode('off');
  check('1b Moduswechsel per HTTP ok', off1.ok && off1.mode === 'off');
  await sleep(50);
  const st1 = await get('/api/effects/mode');
  check('1c nach OFF keine wartende Bestätigung', st1.pendingConfirmation === null, JSON.stringify(st1));
  const c1 = await confirmEffect();
  check('1d confirm nach OFF liefert ok:false', c1.ok === false, JSON.stringify(c1));
  await sleep(300);
  check('1e kein Webhook an HA', haPosts.length === 0, `${haPosts.length} Posts`);
  check('1f kein Event-Log-Eintrag', events().length === 0, JSON.stringify(events()));

  // 2) Konsole: manual -> wartet -> effects mode off -> confirm
  rlEmitter.emit('line', 'effects mode manual');
  await sleep(50);
  follow('bob');
  check('2a Bestätigung wartet (manual, Konsole)', await waitPending());
  rlEmitter.emit('line', 'effects mode off');
  await sleep(50);
  const c2 = await confirmEffect();
  check('2b confirm nach Konsolen-OFF liefert ok:false', c2.ok === false, JSON.stringify(c2));
  await sleep(300);
  check('2c kein Webhook an HA', haPosts.length === 0, `${haPosts.length} Posts`);
  check('2d kein Event-Log-Eintrag', events().length === 0);
  check('2e Modus in effect_mode.json gespeichert', JSON.parse(fs.readFileSync('effect_mode.json', 'utf8')).mode === 'off');

  // 3) OFF verwirft neue Effekte, Queue leer
  follow('carol');
  await sleep(7000);
  const st3 = await get('/api/effects/mode');
  check('3a OFF: neuer Effekt verworfen, Queue leer', st3.queueLength === 0 && haPosts.length === 0, JSON.stringify(st3));

  // 4) manual + Bestätigung löst weiterhin aus, Payload unverändert
  await setMode('manual');
  follow('dave');
  check('4a Bestätigung wartet', await waitPending());
  const c4 = await confirmEffect();
  await sleep(300);
  const p = haPosts[0] || {};
  check('4b confirm ok:true und genau ein Webhook', c4.ok === true && haPosts.length === 1, JSON.stringify(c4));
  check('4c Payload {type,count,meta,timestamp}', JSON.stringify(Object.keys(p)) === '["type","count","meta","timestamp"]'
    && p.type === 'follow' && p.count === 1 && p.meta.userName === 'dave', JSON.stringify(p));

  // 5) manual ohne Bestätigung: nach 30 s Timeout-Eintrag wie bisher
  follow('erin');
  check('5a Bestätigung wartet', await waitPending());
  await sleep(31000);
  const ev5 = events().filter(e => e.userName === 'erin');
  check('5b Timeout: Eintrag mit skippedManualTimeout', ev5.length === 1 && ev5[0].skippedManualTimeout === true, JSON.stringify(ev5));
  check('5c Timeout: kein Webhook', haPosts.length === 1);

  // 6) auto löst direkt aus
  await setMode('auto');
  follow('frank');
  await sleep(8000);
  check('6a auto: Webhook ohne Bestätigung', haPosts.length === 2 && haPosts[1].meta.userName === 'frank', `${haPosts.length} Posts`);

  console.log = realLog;
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  realLog(`\n${results.filter(r => r.ok).length}/${results.length} bestanden`);
  realLog('Log-Auszug Effekt-Modus:\n' + logs.filter(l => /Effekt-Modus|verworfen/.test(l)).map(l => '  ' + l).join('\n'));
  process.chdir(os.tmpdir()); fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
})().catch(e => { console.log = realLog; console.error(e); process.exit(2); });
