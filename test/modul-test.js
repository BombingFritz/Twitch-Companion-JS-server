// Modul-Schalter (bdu/uboat activate|deactivate, modules.json): Konsole, Chat-Befehle, /status, Startanzeige, Neustart.
// Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis, erzeugter Spielstand (test/uboat-fixture.js), Enigma-Widget als SSE-Client.
// Aufruf: node modul-test.js <server.js> <szenario: schalten | gespeichert | defekt>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const fx = require('./uboat-fixture');
const [serverPath, scenario] = [path.resolve(process.argv[2]), process.argv[3] || 'schalten'];
const PORT = 39400 + Math.floor(Math.random() * 300);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-'));
const savesDir = path.join(workDir, 'UBOAT', 'Saves');
fs.mkdirSync(savesDir, { recursive: true });
fs.mkdirSync(path.join(workDir, 'UBOAT', 'Data Sheets'));
fs.writeFileSync(path.join(workDir, 'UBOAT', 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
fs.writeFileSync(path.join(savesDir, 'Versenkung.save'), fx.buildSave({ crew: fx.DEFAULT_CREW }));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\nUBOAT_SAVES_DIR=${savesDir}\n`);
fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: 'fake', refresh_token: 'fake', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
if (scenario === 'gespeichert') fs.writeFileSync(path.join(workDir, 'modules.json'), JSON.stringify({ bdu: false, uboat: false }));
if (scenario === 'defekt') fs.writeFileSync(path.join(workDir, 'modules.json'), '{ kaputt');
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() { this.emit('close'); } terminate() { this.emit('close'); } }
FakeWS.OPEN = 1;
const chatPosts = [];
const fakeAxios = {
  post: async (url, body) => { if (url.includes('/chat/messages')) chatPosts.push(body); return { data: { data: [] } }; },
  get: async (url) => url.includes('/helix/channels') ? { data: { data: [{ game_name: 'UBOAT' }] } } : { data: { data: [] } },
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const realLog = console.log, logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
const send = (message_type, subType, payload) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type, subscription_type: subType, message_id: `m${++n}` }, payload }));
const chat = (login, text) => send('notification', 'channel.chat.message', { event: {
  chatter_user_id: 'u-' + login, chatter_user_login: login, chatter_user_name: login, broadcaster_user_id: '1', message_id: `c${n + 1}`, message: { text }, badges: [] } });
const getJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
const postJson = (p, body) => new Promise((res, rej) => { const data = JSON.stringify(body); const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); }); req.on('error', rej); req.end(data); });
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const has = re => logs.some(l => re.test(l));
const fileState = () => { try { return JSON.parse(fs.readFileSync('modules.json', 'utf8')); } catch { return null; } };
const cmd = async line => { rl.emit('line', line); await sleep(50); };
async function ask(login, text) { const before = chatPosts.length; chat(login, text); await sleep(200); return chatPosts.length > before ? chatPosts[chatPosts.length - 1] : null; }

// Enigma-Widget-Attrappe: sammelt "request"-Ereignisse
const sseRequests = [];
let sseReq = null;
function connectWidget() {
  return new Promise(resolve => {
    sseReq = http.get({ host: '127.0.0.1', port: PORT, path: '/api/bdu/stream' }, res => {
      let buf = '';
      res.on('data', c => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith('event: request')) sseRequests.push(JSON.parse(block.split('\ndata: ')[1]));
        }
      });
      resolve();
    });
    sseReq.on('error', () => {});
  });
}

(async () => {
  await sleep(500);
  send('session_welcome', null, { session: { id: 's1', keepalive_timeout_seconds: 600 } });
  await sleep(300);
  await connectWidget(); await sleep(100);

  if (scenario === 'schalten') {
    check('M1 ohne modules.json: Startanzeige BdU-Chat aktiviert', has(/^BdU-Chat: aktiviert$/) && has(/^UBOAT-Soldbuch: an \(Spielstände: .*\)$/));
    let st = await getJson('/status');
    check('M2 /status modules: beide an', st.modules && st.modules.bdu === true && st.modules.uboat === true, JSON.stringify(st.modules));

    await cmd('bdu deactivate');
    check('M3 bdu deactivate: gespeichert, Meldung', fileState()?.bdu === false && fileState()?.uboat === true && has(/BdU-Chat deaktiviert – Befehle im Chat werden ignoriert \(gespeichert/), JSON.stringify(fileState()));
    let r = await ask('anna', '!BdU Feindkontakt');
    check('M4 deaktiviert: !BdU ignoriert, nichts ans Widget, kein Chat', r === null && sseRequests.length === 0 && has(/!BdU von @anna ignoriert – BdU-Chat deaktiviert/));
    await cmd('bdu deactivate');
    check('M5 doppelt deaktivieren: Hinweis „bereits“', has(/BdU-Chat ist bereits deaktiviert/));
    st = await getJson('/status');
    check('M6 /status modules.bdu false', st.modules.bdu === false && st.modules.uboat === true);
    await cmd('bdu show');
    check('M7 bdu show nennt den Schalter', has(/\[BdU\] Modul: deaktiviert \("bdu activate" schaltet ein\)/));

    await cmd('bdu activate');
    check('M8 bdu activate: gespeichert', fileState()?.bdu === true && has(/BdU-Chat aktiviert \(gespeichert/));
    r = await ask('bert', '!BdU Lage?');
    check('M9 wieder aktiv: Anfrage ans Widget', sseRequests.length === 1 && sseRequests[0].text === 'Lage?', JSON.stringify(sseRequests));
    await cmd('bdu deactivate');
    check('M10 deaktivieren verwirft offene Anfragen', has(/\[BdU\] Offene Anfragen verworfen/));
    const ans = await postJson('/api/bdu/answer', { id: sseRequests[0] && sseRequests[0].id, status: 'ok', text: 'Weitermachen.' });
    await sleep(100);
    check('M11 späte Antwort des Widgets wird nicht gepostet', ans.status === 404 && !chatPosts.some(p => p.message.startsWith('FT vom BdU')), `${ans.status} ${JSON.stringify(chatPosts)}`);

    r = await ask('kobold', '!soldbuch');
    check('M12 Soldbuch aktiv: Antwort', r && r.message.startsWith('Soldbuch Kobold'), r && r.message);
    await cmd('uboat deactivate');
    check('M13 uboat deactivate: gespeichert', fileState()?.uboat === false && has(/UBOAT-Soldbuch deaktiviert – Befehle im Chat werden ignoriert/));
    r = await ask('alpaka', '!soldbuch');
    check('M14 deaktiviert: !soldbuch ignoriert, Hinweis nur in der Konsole', r === null && has(/!soldbuch von @alpaka ignoriert – UBOAT-Soldbuch deaktiviert/));
    await cmd('uboat show');
    check('M15 uboat show nennt den Schalter', has(/^UBOAT-Soldbuch: deaktiviert \("uboat activate" schaltet ein\)$/));
    send('notification', 'channel.update', { event: { broadcaster_user_id: '1', category_name: 'Korea. IL-2 Series' } }); await sleep(100);
    send('notification', 'channel.update', { event: { broadcaster_user_id: '1', category_name: 'UBOAT' } }); await sleep(100);
    check('M16 Kategoriewechsel meldet „deaktiviert“', has(/Twitch-Kategorie: UBOAT \(channel\.update\) – UBOAT-Soldbuch deaktiviert/));
    await cmd('uboat activate');
    check('M17 uboat activate: gespeichert', fileState()?.uboat === true && has(/UBOAT-Soldbuch aktiviert \(gespeichert/));
    r = await ask('majormac', '!soldbuch');
    check('M18 wieder aktiv: Soldbuch kommt (Spielstand blieb eingelesen)', r && r.message.startsWith('Soldbuch Major Mac'), r && r.message);
    await cmd('bdu foo');
    check('M19 Nutzungshinweis nennt activate/deactivate', has(/Nutzung: bdu show \| bdu silence off \| bdu activate \| bdu deactivate/));
    await cmd('help');
    check('M20 Hilfe listet beide Schalter', has(/bdu activate\|deactivate/) && has(/uboat activate\|deactivate/));
  }

  if (scenario === 'gespeichert') {
    check('G1 Startanzeige übernimmt gespeicherte Schalter', has(/^BdU-Chat: deaktiviert \("bdu activate" schaltet ein\)$/) && has(/^UBOAT-Soldbuch: an \(Spielstände: .*\) – deaktiviert \("uboat activate" schaltet ein\)$/));
    const st = await getJson('/status');
    check('G2 /status modules: beide aus', st.modules.bdu === false && st.modules.uboat === false, JSON.stringify(st.modules));
    const r1 = await ask('anna', '!BdU Hallo');
    const r2 = await ask('kobold', '!soldbuch');
    check('G3 nach Neustart beide Befehle ignoriert', r1 === null && r2 === null && sseRequests.length === 0);
  }

  if (scenario === 'defekt') {
    check('D1 defekte modules.json: beide Module an', has(/^BdU-Chat: aktiviert$/) && !has(/– deaktiviert/));
    const r = await ask('kobold', '!soldbuch');
    check('D2 Soldbuch antwortet', r && r.message.startsWith('Soldbuch Kobold'), r && r.message);
  }

  console.log = realLog;
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} [${scenario}] ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  if (sseReq) sseReq.destroy();
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
