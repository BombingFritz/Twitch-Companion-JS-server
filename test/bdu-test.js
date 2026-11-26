// BdU-Chat (Spec bdu-chat.md, Issue #99): Fehler des Widgets oder keine Antwort → Störungsmeldung im Chat (höchstens alle 2 min),
// Anfrage nicht angerechnet (globales Limit, Nutzerlimit, Tageszähler). Erfolgreiche Antworten zählen weiter.
// Attrappen: ws, axios, readline; eigenes Arbeitsverzeichnis; Uhr per Versatz; die 120-s-Wartezeit auf das Widget wird auf 300 ms verkürzt.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 38100 + Math.floor(Math.random() * 400);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: Date.now(), expires_in: 999999, expires_at: Date.now() + 999999000 }));
process.chdir(dir);

const sockets = []; class WS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() {} terminate() {} } WS.OPEN = 1;
const posts = [];   // {message, reply}
const axios = {
  post: async (url, body) => { if (url.includes('chat/messages')) posts.push({ message: body.message, reply: body.reply_parent_message_id || null }); return { data: { data: [{ is_sent: true }] } }; },
  get: async () => ({ data: { data: [] } }),
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return axios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const logs = []; const real = console.log; console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 120 * 1000 ? 300 : ms, ...a);   // BDU_ANSWER_TIMEOUT_MS
require(serverPath);

const sleep = ms => new Promise(r => realSetTimeout(r, ms));
const waitFor = async (cond, ms = 3000) => { const end = realNow() + ms; while (!cond() && realNow() < end) await sleep(20); return cond(); };
const req = (method, p, body) => new Promise(res => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { 'Content-Type': 'application/json' } }, rs => { let d = ''; rs.on('data', c => d += c); rs.on('end', () => res({ status: rs.statusCode, body: d })); });
  if (body) r.write(JSON.stringify(body)); r.end();
});
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const has = re => logs.some(l => re.test(l));

let n = 0;
const requests = [];   // Anfragen an das Widget
function chat(userId, login, text) {
  const id = `cm${++n}`;
  sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: 'channel.chat.message', message_id: `m${n}` },
    payload: { event: { chatter_user_id: userId, chatter_user_login: login, broadcaster_user_id: '1', message_id: id, message: { text }, badges: [] } } }));
  return id;
}
async function ask(userId, login, text) {
  const before = requests.length;
  const msgId = chat(userId, login, '!BdU ' + text);
  await waitFor(() => requests.length > before || logs.some(l => l.includes(`!BdU von @${login} abgelehnt`)), 1000);
  return { msgId, request: requests.length > before ? requests[requests.length - 1] : null };
}
const answer = (id, status, extra = {}) => req('POST', '/api/bdu/answer', { id, status, ...extra });
const dailyCount = () => { rl.emit('line', 'bdu show'); const l = logs.filter(x => x.includes('heute angenommen:')).pop() || ''; const m = /heute angenommen: (\d+)/.exec(l); return m ? Number(m[1]) : null; };

(async () => {
  await sleep(300);
  http.get({ host: '127.0.0.1', port: PORT, path: '/api/bdu/stream' }, rs => {
    let buf = '';
    rs.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^event: request\ndata: (.*)$/m.exec(block); if (m) requests.push(JSON.parse(m[1])); } });
  });
  await waitFor(() => has(/Enigma-Widget verbunden/));

  // D1: Fehler des Widgets → Störungsmeldung als Antwort auf die Nachricht
  const a1 = await ask('10', 'anna', 'Lage?');
  let r = await answer(a1.request && a1.request.id, 'error', { error: 'This model is currently experiencing high demand.' });
  await waitFor(() => posts.length >= 1);
  check('D1 Fehler: Störungsmeldung als Antwort auf die !BdU-Nachricht', r.status === 200 && posts.length === 1
    && posts[0].message === 'Funkspruch nicht durchgekommen, Störung im Äther. Später erneut funken!' && posts[0].reply === a1.msgId
    && has(/Anfrage von @anna nicht angerechnet; Störungsmeldung gepostet/), JSON.stringify(posts));

  // D2: Globales Limit zurückgenommen → ein anderer Zuschauer wird sofort angenommen, keine Limit-Warnung
  const b1 = await ask('11', 'bert', 'Befehle?');
  check('D2 Globales Limit nicht angerechnet: nächste Anfrage sofort angenommen', b1.request && !has(/!BdU von @bert abgelehnt/) && posts.length === 1, logs.slice(-3).join(' | '));

  // D3: zweiter Fehler binnen 2 min → keine zweite Störungsmeldung
  await answer(b1.request && b1.request.id, 'error', { error: 'Warteschlange voll' });
  await sleep(100);
  check('D3 Zweiter Fehler binnen 2 min: keine zweite Meldung, nur Log', posts.length === 1 && has(/Anfrage von @bert nicht angerechnet; keine Störungsmeldung \(letzte vor \d+ s\)/), JSON.stringify(posts));

  // D4: Nutzerlimit zurückgenommen → derselbe Zuschauer viermal hintereinander angenommen
  let accepted = 0;
  for (let i = 0; i < 4; i++) {
    const x = await ask('10', 'anna', `Frage ${i}`);
    if (x.request) { accepted += 1; await answer(x.request.id, 'error', { error: 'kaputt' }); await sleep(50); }
  }
  check('D4 Nutzerlimit nicht angerechnet: vier Anfragen in Folge angenommen', accepted === 4 && !has(/!BdU von @anna abgelehnt/), String(accepted));
  check('D5 Tageszähler nicht angerechnet: heute 0', dailyCount() === 0, logs.filter(x => x.includes('heute angenommen')).pop());

  // D6: keine Antwort des Widgets → nach Ablauf verworfen, nicht angerechnet, Störungsmeldung (2 min später)
  offset += 2 * 60 * 1000 + 1000;
  const c1 = await ask('12', 'cora', 'Hallo?');
  await waitFor(() => posts.length >= 2, 2000);
  check('D6 Keine Antwort: verworfen, Störungsmeldung als Antwort, nicht angerechnet', c1.request && posts.length === 2 && posts[1].reply === c1.msgId
    && has(/Keine Antwort des Widgets binnen 120 s – Anfrage von @cora verworfen/) && has(/Anfrage von @cora nicht angerechnet; Störungsmeldung gepostet/) && dailyCount() === 0, JSON.stringify(posts));
  r = await answer(c1.request && c1.request.id, 'ok', { text: 'zu spät' });
  check('D7 Späte Antwort nach Ablauf: 404, kein Post', r.status === 404 && posts.length === 2, r.status);

  // D8: erfolgreiche Antwort zählt weiter: danach greift das globale Limit mit Warnung
  const d1 = await ask('13', 'dora', 'Kurs?');
  await answer(d1.request && d1.request.id, 'ok', { text: 'Halten Sie Kurs.' });
  await waitFor(() => posts.length >= 3);
  const e1 = await ask('14', 'emil', 'Noch was?');
  await waitFor(() => posts.length >= 4, 1000);
  check('D8 Erfolg zählt: Antwort gepostet, nächste Anfrage abgelehnt mit Warnung, Tageszähler 1', posts[2] && posts[2].message === 'FT vom BdU: Halten Sie Kurs.' && !e1.request
    && posts[3] && posts[3].message === 'Funkverkehr einschränken, Feind peilt ein!' && dailyCount() === 1, JSON.stringify(posts.slice(2)));

  // D9: Funkstille: Fehler während der Funkstille → keine Störungsmeldung
  offset += 3 * 60 * 1000 + 1000;
  const f1 = await ask('15', 'fritz', 'Quota?');
  await answer(f1.request && f1.request.id, 'quota', { error: 'Rate limit per minute' });
  await waitFor(() => posts.length >= 5);
  check('D9 quota startet weiter die Funkstille (eine Ansage)', posts.length === 5 && /^BdU befiehlt Funkstille bis/.test(posts[4].message), JSON.stringify(posts.slice(4)));

  console.log = real;
  for (const x of results) real(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}`);
  process.chdir(os.tmpdir()); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows hält Dateien evtl. noch */ }
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
