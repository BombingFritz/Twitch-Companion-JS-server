// Erreichbarkeit (ADR 0013, Nachtrag 14.11.2026): Der Server antwortet über 127.0.0.1 und ::1, aber nicht über eine Netzwerkadresse des Rechners.
// Attrappen: ws, axios, readline per Module._load. Eigenes Arbeitsverzeichnis. Aufruf: node bind-test.js <server.js>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 38500 + Math.floor(Math.random() * 400);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
process.chdir(dir);
class WS extends EventEmitter { constructor() { super(); this.readyState = 1; } close() {} terminate() {} } WS.OPEN = 1;
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return { post: async () => ({ data: {} }), get: async () => ({ data: { data: [] } }) }; if (r === 'readline') return { createInterface: () => new EventEmitter() }; return orig.call(this, r, ...a); };
const real = console.log, logs = [];
console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
require(serverPath);

const get = host => new Promise(resolve => {
  const req = http.request({ host, port: PORT, path: '/status', timeout: 1500, headers: { Host: `localhost:${PORT}` } }, res => { res.resume(); resolve(res.statusCode); });
  req.on('timeout', () => { req.destroy(); resolve('timeout'); });
  req.on('error', err => resolve(err.code || 'error'));
  req.end();
});

// Erste IPv4-Adresse des Rechners, die nicht Loopback ist (gibt es in der CI und zu Hause in der Regel)
const lanIp = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const hasIpv6Loopback = Object.values(os.networkInterfaces()).flat().some(i => i && i.family === 'IPv6' && i.internal);

setTimeout(async () => {
  const results = [];
  const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info });
  check('B1 über 127.0.0.1 erreichbar', (await get('127.0.0.1')) === 200);
  if (hasIpv6Loopback) {
    const v6 = await get('::1');
    check('B2 über ::1 erreichbar (IPv6-Loopback)', v6 === 200, String(v6));
  } else {
    check('B2 kein IPv6-Loopback auf diesem Rechner, übersprungen', true);
  }
  if (lanIp) {
    const lan = await get(lanIp);
    check('B3 über die Netzwerkadresse des Rechners nicht erreichbar', lan !== 200, String(lan));
  } else {
    check('B3 keine Netzwerkadresse auf diesem Rechner, übersprungen', true);
  }
  check('B4 Startanzeige nennt „nur auf diesem PC erreichbar“', logs.some(l => /nur auf diesem PC erreichbar/.test(l)));
  for (const r of results) real(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
}, 800);
