// /status liefert pid und started_at; Startanzeige nennt die Prozess-ID. Attrappen, eigenes Arbeitsverzeichnis.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]); const withTokens = process.argv[3] !== 'ohne-tokens';
const PORT = 38800 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
if (withTokens) fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: Date.now(), expires_in: 9999, expires_at: Date.now() + 9999000 }));
process.chdir(dir);
class WS extends EventEmitter { constructor() { super(); this.readyState = 1; } close() {} } WS.OPEN = 1;
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return { post: async () => ({ data: {} }), get: async () => ({ data: { data: [] } }) }; if (r === 'readline') return { createInterface: () => new EventEmitter() }; return orig.call(this, r, ...a); };
const logs = []; const real = console.log; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
const t0 = Date.now();
require(serverPath);
setTimeout(() => http.get({ host: '127.0.0.1', port: PORT, path: '/status' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
  console.log = real; const s = JSON.parse(d); const tag = withTokens ? 'mit Tokens' : 'ohne Tokens';
  const res = [
    [`/status (${tag}) liefert pid = process.pid`, s.pid === process.pid],
    [`/status (${tag}) liefert started_at als Startzeit`, typeof s.started_at === 'string' && Math.abs(Date.parse(s.started_at) - t0) < 2000],
    [`/status (${tag}) bisherige Felder unverändert`, withTokens ? s.authenticated === true && 'effect_mode' in s && 'bdu_widget_connected' in s : s.authenticated === false && !!s.message],
    ['Startanzeige nennt Prozess-ID', logs.some(l => l.includes(`Prozess-ID: ${process.pid}`))],
  ];
  for (const [n, ok] of res) real(`${ok ? 'OK  ' : 'FAIL'} ${n}`);
  process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); process.exit(res.every(x => x[1]) ? 0 : 1);
}); }), 500);
