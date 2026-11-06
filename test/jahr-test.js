// Raid-Statistik: Quartal bis 2026, Jahr ab 2027. Attrappen, steuerbare Uhr, eigenes Arbeitsverzeichnis.
// Aufruf: node jahr-test.js <server.js> <ISO-Zeit> <erwarteter Schlüssel> <erwartetes Wort>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const { EventEmitter } = require('events');
const [serverPath, iso, expKey, expWord] = [path.resolve(process.argv[2]), process.argv[3], process.argv[4], process.argv[5]];
const fakeNow = new Date(iso).getTime(); const RealDate = Date; const start = RealDate.now();
global.Date = class extends RealDate { constructor(...a) { a.length ? super(...a) : super(fakeNow + (RealDate.now() - start)); } static now() { return fakeNow + (RealDate.now() - start); } };
Math.random = () => 0.4;   // feste Textvariante (Index 1, enthält das Zeitraum-Wort)
const PORT = 36000 + Math.floor(Math.random() * 0 + process.pid % 500);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jahr-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: fakeNow, expires_in: 99999, expires_at: fakeNow + 99999000 }));
const seed = { '2026-Q4': { '77': { name: 'stammraider', count: 3, totalViewers: 30 } }, '2027': { '77': { name: 'stammraider', count: 1, totalViewers: 10 } } };
fs.writeFileSync(path.join(dir, 'raids.json'), JSON.stringify(seed));
process.chdir(dir);
const sockets = []; class WS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() {} terminate() {} } WS.OPEN = 1;
const chat = [];
const axios = { post: async (url, body) => { if (url.includes('chat/messages')) chat.push(body.message); return { data: { data: [{}] } }; }, get: async () => ({ data: { data: [] } }) };
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return axios; if (r === 'readline') return { createInterface: () => new EventEmitter() }; return orig.call(this, r, ...a); };
const logs = []; const real = console.log; console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
require(serverPath);
setTimeout(() => {
  sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: 'channel.raid', message_id: 'r1' }, payload: { event: { from_broadcaster_user_id: '77', from_broadcaster_user_login: 'stammraider', to_broadcaster_user_id: '1', viewers: 2 } } }));
  setTimeout(() => {
    console.log = real;
    const raids = JSON.parse(fs.readFileSync('raids.json', 'utf8'));
    const keyLine = logs.find(l => l.includes('Zeitraum-Key')) || '';
    const msg = chat[0] || '';
    const expCount = seed[expKey] ? seed[expKey]['77'].count + 1 : 1;
    const res = [
      [`${iso}: Schlüssel ${expKey}`, keyLine.includes(expKey) && raids[expKey]['77'].count === expCount, keyLine],
      [`${iso}: Chat-Text sagt „in diesem ${expWord}“`, msg.includes(`in diesem ${expWord}`), msg],
      [`${iso}: andere Zeiträume unverändert`, Object.keys(seed).filter(k => k !== expKey).every(k => JSON.stringify(raids[k]) === JSON.stringify(seed[k]))],
    ];
    for (const [n, ok, i] of res) real(`${ok ? 'OK  ' : 'FAIL'} ${n}${ok ? '' : '  -> ' + JSON.stringify(i)}`);
    process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
  }, 600);
}, 300);
