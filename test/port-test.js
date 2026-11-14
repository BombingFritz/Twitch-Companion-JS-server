// Start bei belegtem Port: kein "Server läuft auf", keine EventSub-Verbindung, Fehlermeldung, Exit 1.
// Attrappen: ws, axios, readline per Module._load. Eigenes Arbeitsverzeichnis.
// Aufruf: node port-test.js <server.js>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 39900 + Math.floor(Math.random() * 90);
// Der blockierende Server bindet wie ein zweiter Server-Start an 127.0.0.1 (ADR 0013, Nachtrag 14.11.2026)
const blocker = http.createServer((q, r) => r.end('ANDERER SERVER')).listen(PORT, '127.0.0.1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'port-'));
  fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
  fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: Date.now(), expires_in: 9999, expires_at: Date.now() + 9999000 }));
  process.chdir(dir);
  let wsCount = 0;
  class WS extends EventEmitter { constructor() { super(); wsCount++; this.readyState = 1; } close() {} terminate() {} } WS.OPEN = 1;
  const orig = Module._load;
  Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return { post: async () => ({ data: {} }), get: async () => ({ data: { data: [] } }) }; if (r === 'readline') return { createInterface: () => new EventEmitter() }; return orig.call(this, r, ...a); };
  const logs = []; const real = console.log; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  let exitCode = null; const realExit = process.exit; process.exit = c => { exitCode = c; };
  require(serverPath);
  setTimeout(() => {
    console.log = real;
    const res = [
      ['P1 keine Startmeldung „Server läuft auf“', !logs.some(l => /Server läuft auf/.test(l))],
      ['P2 keine EventSub-Verbindung', wsCount === 0],
      ['P3 Fehlermeldung „Port … ist bereits belegt“', logs.some(l => /Port \d+ ist bereits belegt/.test(l))],
      ['P4 Exit-Code 1', exitCode === 1],
    ];
    for (const [n, ok] of res) real(`${ok ? 'OK  ' : 'FAIL'} ${n}`);
    process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); blocker.close(); realExit(0);
  }, 800);
});
