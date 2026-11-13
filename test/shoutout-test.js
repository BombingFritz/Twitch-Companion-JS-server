// Test Shoutout-Entdoppelung und Startanzeige. Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis.
// Aufruf: node shoutout-test.js <server.js> <szenario: raid-ok | raid-fail | offline | start-ohne-ha>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const { EventEmitter } = require('events');
const [serverPath, scenario] = [path.resolve(process.argv[2]), process.argv[3]];
const PORT = 39500 + Math.floor(Math.random() * 400);
const HA_URL = 'http://ha.invalid/api/webhook/<WEBHOOK_ID>';
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-'));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\n` + (scenario === 'start-ohne-ha' ? '' : `HA_WEBHOOK_URL=${HA_URL}\n`));
const expired = scenario === 'start-ohne-ha';
fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: 'fake', refresh_token: 'fake', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: expired ? Date.now() - 978 * 60000 : Date.now() + 99999000 }));
fs.writeFileSync(path.join(workDir, 'whitelist.json'), JSON.stringify({ '100': 'raider', '200': 'offlinefreund' }));
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor(u) { super(); this.readyState = 1; sockets.push(this); } close() { this.emit('close'); } }
FakeWS.OPEN = 1;
const shoutouts = []; let shoutoutBehavior = () => ({});
const fakeAxios = {
  post: async (url, body, cfg) => {
    if (url.includes('oauth2/token')) return { data: { access_token: 'neu', refresh_token: 'neu', expires_in: 14000 } };
    if (url.includes('/chat/shoutouts')) { shoutouts.push(cfg.params.to_broadcaster_id); const err = shoutoutBehavior(shoutouts.length); if (err.status) throw { response: { status: err.status, data: err } }; }
    return { data: { data: [] } };
  },
  get: async (url) => url.includes('/helix/videos') ? { data: { data: [{ created_at: new Date(Date.now() - 3 * 86400000).toISOString(), type: 'archive' }] } } : { data: { data: [] } },   // Test-Streamer haben ein aktuelles Video (für eine Aktivitätsprüfung)
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const realLog = console.log, logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Wartet, bis cond() wahr ist, höchstens timeoutMs: robust gegen langsamere Rechner (CI), ohne die Prüfung aufzuweichen
const waitFor = async (cond, timeoutMs, stepMs = 100) => { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (await cond()) return true; await sleep(stepMs); } return cond(); };
let n = 0;
const send = (subType, event) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: subType, message_id: `m${++n}` }, payload: { event } }));
const raid = (id, login, viewers) => send('channel.raid', { from_broadcaster_user_id: id, from_broadcaster_user_login: login, to_broadcaster_user_id: '1', viewers });
const chat = (id, login) => send('channel.chat.message', { chatter_user_id: id, chatter_user_login: login, broadcaster_user_id: '1', message: { text: 'hallo' }, badges: [] });
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const has = re => logs.some(l => re.test(l));

(async () => {
  await sleep(300);
  if (scenario === 'raid-ok') {
    raid('100', 'raider', 5); await sleep(500); chat('100', 'raider');     // Chat noch vor dem Raid-Shoutout (2 s)
    await sleep(2500); chat('100', 'raider'); await sleep(2300);
    check('A1 genau ein Shoutout (Raid), keiner aus der Whitelist', shoutouts.length === 1, JSON.stringify(shoutouts));
    check('A2 kein 429-Fehler im Log', !has(/429|Too Many/));
  }
  if (scenario === 'raid-fail') {
    shoutoutBehavior = i => i === 1 ? { status: 429, message: 'The broadcaster may not give another Shoutout to the specified streamer until the cooldown period expires.' } : {};
    raid('100', 'raider', 5); await sleep(2700);
    check('B1 Raid-Shoutout abgelehnt, kurzer Hinweis statt Fehler', has(/Twitch-Wartezeit läuft/) && !has(/Fehler beim Senden des Shoutouts/));
    chat('100', 'raider'); await waitFor(() => shoutouts.length >= 2, 8000);
    check('B2 nach gescheitertem Raid-Shoutout versucht die Whitelist erneut', shoutouts.length === 2, JSON.stringify(shoutouts));
  }
  if (scenario === 'offline') {
    shoutoutBehavior = () => ({ status: 400, error: 'Bad Request', message: 'The broadcaster is not streaming live or does not have one or more viewers.' });
    chat('200', 'offlinefreund'); await sleep(2300); chat('200', 'offlinefreund'); await sleep(2300);
    check('C1 Hinweis „noch nicht live“ statt Fehlerausgabe', has(/noch nicht live/) && !has(/Fehler beim Senden des Shoutouts/));
    check('C2 kein erneuter Versuch bei jeder Nachricht vor dem Start', shoutouts.length === 1, JSON.stringify(shoutouts));
    shoutoutBehavior = () => ({});
    send('stream.online', { broadcaster_user_id: '1' }); await sleep(300);
    chat('200', 'offlinefreund'); await sleep(2300);
    check('C3 nach stream.online neuer Versuch, erfolgreich', shoutouts.length === 2 && has(/Shoutout erfolgreich gesendet für @offlinefreund/));
    raid('300', 'kleinerraid', 2); await sleep(2700);
    check('C4 Raid unter 3 Zuschauern: kein Shoutout', shoutouts.length === 2 && has(/Kein Shoutout – nur 2 Viewer/));
  }
  if (scenario === 'start-ohne-ha' || scenario === 'raid-ok') {
    const ha = scenario === 'raid-ok';
    check(`S1 Startanzeige HA-Webhook ${ha ? 'eingetragen' : 'NICHT eingetragen'}`, has(ha ? /Home-Assistant-Webhook: eingetragen/ : /Home-Assistant-Webhook: NICHT eingetragen/));
    check(`S2 Token-Anzeige ${ha ? 'mit Minuten' : '„abgelaufen“ statt negativer Minuten'}`, ha ? has(/Token gültig für: \d+ Minuten/) : has(/Token abgelaufen – wird beim ersten Zugriff/) && !has(/-\d+ Minuten/));
  }
  console.log = realLog;
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} [${scenario}] ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  process.chdir(os.tmpdir()); fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
