// K9: /status zeigt nach Ablauf der Funkstille null; Hilfe nennt "whitelist add <id>". Attrappen, eigenes Arbeitsverzeichnis.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 37000 + Math.floor(Math.random() * 500);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k9-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: Date.now(), expires_in: 999999, expires_at: Date.now() + 999999000 }));
process.chdir(dir);
const sockets = []; class WS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() {} terminate() {} } WS.OPEN = 1;
const chatPosts = [];
const axios = { post: async (url, body) => { if (url.includes('chat/messages')) chatPosts.push(body.message); return { data: { data: [{ is_sent: true }] } }; }, get: async () => ({ data: { data: [] } }) };
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return axios; if (r === 'readline') return { createInterface: () => new EventEmitter() }; return orig.call(this, r, ...a); };
const logs = []; const real = console.log; console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
require(serverPath);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const req = (method, p, body) => new Promise(res => { const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json' } }, rs => { let d = ''; rs.on('data', c => d += c); rs.on('end', () => res(JSON.parse(d))); }); if (body) r.write(JSON.stringify(body)); r.end(); });
(async () => {
  await sleep(300);
  let lastId = null;
  http.get({ host: '127.0.0.1', port: PORT, path: '/api/bdu/stream' }, rs => rs.on('data', c => { const m = /event: request\ndata: (.*)\n/.exec(c.toString()); if (m) lastId = JSON.parse(m[1]).id; }));
  await sleep(300);
  sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: 'channel.chat.message', message_id: 'm1' }, payload: { event: { chatter_user_id: '5', chatter_user_login: 'zuschauer', broadcaster_user_id: '1', message_id: 'cm1', message: { text: '!BdU Feindkontakt' }, badges: [] } } }));
  await sleep(300);
  await req('POST', '/api/bdu/answer', { id: lastId, status: 'quota', error: 'Rate limit per minute' });
  const s1 = await req('GET', '/status');
  offset = 31 * 60 * 1000;
  const s2 = await req('GET', '/status');
  console.log = real;
  const res = [
    ['Funkstille gestartet, /status zeigt Uhrzeit', typeof s1.bdu_silence_until === 'string' && s1.bdu_silence_until.includes('T')],
    ['nach 31 min: /status zeigt null (K9)', s2.bdu_silence_until === null, s2.bdu_silence_until],
    ['Hilfe nennt "whitelist add <id>"', logs.some(l => /^ whitelist add <id> {9}- /.test(l))],
  ];
  for (const [n, ok, i] of res) real(`${ok ? 'OK  ' : 'FAIL'} ${n}${ok ? '' : '  -> ' + JSON.stringify(i)}`);
  fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})();
