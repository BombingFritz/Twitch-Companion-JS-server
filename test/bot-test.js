// Bot-Account „DerBdu“ (ADR 0017): /login-bot, /callback mit state, bot.json, Senden mit App-Token, 401-Erneuerung,
// Rückfall bei 403, kein Rückfall bei is_sent:false, bot show/remove, /status, Startanzeige.
// Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis, erzeugter Spielstand (test/uboat-fixture.js), Enigma-Widget als SSE-Client.
// Aufruf: node bot-test.js <server.js> <szenario: ablauf | eingerichtet | ohne-bot>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const fx = require('./uboat-fixture');
const [serverPath, scenario] = [path.resolve(process.argv[2]), process.argv[3] || 'ablauf'];
const PORT = 39700 + Math.floor(Math.random() * 250);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-'));
const savesDir = path.join(workDir, 'UBOAT', 'Saves');
fs.mkdirSync(savesDir, { recursive: true });
fs.mkdirSync(path.join(workDir, 'UBOAT', 'Data Sheets'));
fs.writeFileSync(path.join(workDir, 'UBOAT', 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
fs.writeFileSync(path.join(savesDir, 'Versenkung.save'), fx.buildSave({ crew: fx.DEFAULT_CREW }));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\nUBOAT_SAVES_DIR=${savesDir}\n`);
const TOKENS = JSON.stringify({ access_token: 'fake', refresh_token: 'fake', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 });
fs.writeFileSync(path.join(workDir, 'tokens.json'), TOKENS);
if (scenario === 'eingerichtet') fs.writeFileSync(path.join(workDir, 'bot.json'), JSON.stringify({ bot_id: '99', bot_login: 'derbdu', bot_name: 'DerBdu', authorized_at: '2026-11-07T10:00:00.000Z' }));
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() { this.emit('close'); } terminate() { this.emit('close'); } }
FakeWS.OPEN = 1;
const chatPosts = [];          // jeder Versuch: { auth, body, ok }
let appTokenCount = 0;
let failMode = null;           // null | '401once' | '403' | 'dropped'
let nextUser = null;           // was der Code-Tausch liefert: { token, scope }
const httpError = (status, message) => { const e = new Error('HTTP ' + status); e.response = { status, data: { message } }; return e; };
const fakeAxios = {
  post: async (url, body, cfg) => {
    if (url.includes('/oauth2/token')) {
      const grant = body.get('grant_type');
      if (grant === 'client_credentials') { appTokenCount++; return { data: { access_token: 'app-' + appTokenCount, expires_in: 5000000 } }; }
      if (grant === 'authorization_code') return { data: { access_token: nextUser.token, refresh_token: 'r', expires_in: 14000, scope: nextUser.scope } };
    }
    if (url.includes('/chat/messages')) {
      const auth = cfg.headers.Authorization;
      const viaApp = auth.startsWith('Bearer app-');
      const entry = { auth, body, ok: true };
      chatPosts.push(entry);
      if (viaApp && failMode === '401once' && auth === 'Bearer app-1') { entry.ok = false; throw httpError(401, 'invalid token'); }
      if (viaApp && failMode === '403') { entry.ok = false; throw httpError(403, 'user is not a moderator'); }
      if (viaApp && failMode === 'dropped') { entry.ok = false; return { data: { data: [{ message_id: '', is_sent: false, drop_reason: { code: 'automod', message: 'held by AutoMod' } }] } }; }
      return { data: { data: [{ message_id: 'x', is_sent: true }] } };
    }
    return { data: { data: [] } };
  },
  get: async (url, cfg) => {
    if (url.includes('/helix/channels')) return { data: { data: [{ game_name: 'UBOAT' }] } };
    if (url.endsWith('/helix/users')) {
      const auth = cfg.headers.Authorization;
      if (auth === 'Bearer botuser') return { data: { data: [{ id: '99', login: 'derbdu', display_name: 'DerBdu' }] } };
      if (auth === 'Bearer bcuser') return { data: { data: [{ id: '1', login: 'test', display_name: 'Test' }] } };
    }
    return { data: { data: [] } };
  },
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const realLog = console.log, logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
process.env.TWITCH_COMPANION_NO_THROTTLE = '1';   // viele Anfragen in kurzer Zeit; die Drosselung prüft twitch-api-test.js
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
const send = (message_type, subType, payload) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type, subscription_type: subType, message_id: `m${++n}` }, payload }));
const chat = (login, display, text) => send('notification', 'channel.chat.message', { event: {
  chatter_user_id: 'u-' + login, chatter_user_login: login, chatter_user_name: display || login, broadcaster_user_id: '1', message_id: `c${n + 1}`, message: { text }, badges: [] } });
const request = (p, opts = {}) => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: opts.method || 'GET', headers: opts.headers || {} }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: d }));
  });
  req.on('error', rej); req.end(opts.body);
});
const getJson = async p => JSON.parse((await request(p)).body);
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const has = re => logs.some(l => re.test(l));
const botFile = () => { try { return JSON.parse(fs.readFileSync('bot.json', 'utf8')); } catch { return null; } };
const cmd = async line => { rl.emit('line', line); await sleep(50); };
async function say(login, display, text) { const before = chatPosts.length; chat(login, display, text); await sleep(250); return chatPosts.slice(before); }
async function startBotLogin() {
  const r = await request('/login-bot');
  const loc = r.headers.location || '';
  return { r, loc, state: new URL(loc).searchParams.get('state') };
}

const sseRequests = [];
let sseReq = null;
function connectWidget() {
  return new Promise(resolve => {
    sseReq = http.get({ host: '127.0.0.1', port: PORT, path: '/api/bdu/stream' }, res => {
      let buf = '';
      res.on('data', c => {
        buf += c; let i;
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

  if (scenario === 'ablauf') {
    check('A1 Startanzeige ohne Bot: Hinweis auf /login-bot', has(new RegExp(`^Bot-Account: nicht eingerichtet – http://localhost:${PORT}/login-bot`)));
    let posts = await say('kobold', 'Kobold', '!soldbuch');
    check('A2 ohne Bot: Soldbuch als Broadcaster, kein App-Token', posts.length === 1 && posts[0].auth === 'Bearer fake' && posts[0].body.sender_id === '1' && appTokenCount === 0, JSON.stringify(posts));

    const foreign = await request('/login-bot', { headers: { Host: 'example.com' } });
    check('A3 /login-bot mit fremdem Host: 403', foreign.status === 403);
    let login = await startBotLogin();
    const u = new URL(login.loc);
    check('A4 /login-bot: Weiterleitung mit Bot-Scopes, force_verify, state', login.r.status === 302 && u.host === 'id.twitch.tv'
      && u.searchParams.get('scope') === 'user:bot user:write:chat' && u.searchParams.get('force_verify') === 'true' && /^[0-9a-f]{32}$/.test(login.state || ''), login.loc);

    let cb = await request(`/callback?code=c1&state=falsch`);
    check('A5 falscher state: 400, keine bot.json, tokens.json unverändert', cb.status === 400 && !botFile() && fs.readFileSync('tokens.json', 'utf8') === TOKENS);
    nextUser = { token: 'bcuser', scope: ['user:bot', 'user:write:chat'] };
    cb = await request(`/callback?code=c2&state=${login.state}`);
    check('A6 Broadcaster statt Bot angemeldet: 400 mit Hinweis', cb.status === 400 && /als test \(Broadcaster\)/.test(cb.body) && !botFile(), cb.body);
    cb = await request(`/callback?code=c3&state=${login.state}`);
    check('A7 state gilt nur einmal', cb.status === 400 && /ungültig oder abgelaufen/.test(cb.body));
    login = await startBotLogin();
    nextUser = { token: 'botuser', scope: ['user:bot'] };
    cb = await request(`/callback?code=c4&state=${login.state}`);
    check('A8 fehlender Scope user:write:chat: 400', cb.status === 400 && /user:write:chat/.test(cb.body) && !botFile(), cb.body);
    login = await startBotLogin();
    nextUser = { token: 'botuser', scope: ['user:bot', 'user:write:chat'] };
    cb = await request(`/callback?code=c5&state=${login.state}`);
    const bf = botFile();
    check('A9 Bot-Freigabe: bot.json mit ID/Name, ohne Token; tokens.json unverändert', cb.status === 200 && bf && bf.bot_id === '99' && bf.bot_login === 'derbdu'
      && !JSON.stringify(bf).includes('botuser') && fs.readFileSync('tokens.json', 'utf8') === TOKENS && has(/\[Bot\] Bot-Account eingerichtet: DerBdu \(ID 99\)/), cb.body);

    posts = await say('alpaka', 'Alpaka', '!soldbuch');
    check('A10 Soldbuch über den Bot: App-Token, sender_id Bot, Reply', posts.length === 1 && posts[0].auth === 'Bearer app-1' && posts[0].body.sender_id === '99'
      && posts[0].body.broadcaster_id === '1' && posts[0].body.reply_parent_message_id && posts[0].body.message.startsWith('Soldbuch Alpaka'), JSON.stringify(posts));

    await connectWidget(); await sleep(100);
    chat('anna', 'Anna', '!BdU Lage?'); await sleep(200);
    const before = chatPosts.length;
    const ans = await request('/api/bdu/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sseRequests[0] && sseRequests[0].id, status: 'ok', text: 'Weiter so.' }) });
    await sleep(200);
    posts = chatPosts.slice(before);
    check('A11 BdU-Antwort über den Bot als Reply, ohne „FT vom BdU:“', ans.status === 200 && posts.length === 1 && posts[0].auth === 'Bearer app-1' && posts[0].body.sender_id === '99'
      && posts[0].body.message === 'Weiter so.' && posts[0].body.reply_parent_message_id, JSON.stringify(posts));
    posts = await say('bert', 'Bert', '!BdU Noch eine Frage');
    check('A12 BdU-Warnung (Limit) über den Bot', posts.length === 1 && posts[0].body.sender_id === '99' && posts[0].body.message === 'Funkverkehr einschränken, Feind peilt ein!', JSON.stringify(posts));
    check('A13 App-Token für mehrere Nachrichten nur einmal geholt', appTokenCount === 1, String(appTokenCount));

    failMode = '401once';
    posts = await say('majormac', 'MajorMac', '!soldbuch');
    check('A14 401: App-Token einmal neu, dann über den Bot gesendet, kein Rückfall', posts.length === 2 && posts[1].auth === 'Bearer app-2' && posts[1].ok
      && posts.every(p => p.body.sender_id === '99') && appTokenCount === 2, JSON.stringify(posts));
    failMode = '403';
    posts = await say('juergenmueller', 'JuergenMueller', '!soldbuch');
    check('A15 403: Rückfall auf den Broadcaster, Hinweis auf Moderator', posts.length === 2 && posts[0].body.sender_id === '99' && !posts[0].ok
      && posts[1].auth === 'Bearer fake' && posts[1].body.sender_id === '1' && has(/Senden über den Bot derbdu fehlgeschlagen \(403: user is not a moderator\) – Ist DerBdu Moderator/), JSON.stringify(posts));
    failMode = 'dropped';
    posts = await say('zw3rg', 'Zwergwildsau', '!soldbuch');
    check('A16 is_sent:false (AutoMod): kein Rückfall, Warnung', posts.length === 1 && posts[0].body.sender_id === '99' && has(/\[UBOAT\] Twitch hat die Nachricht nicht gesendet \(held by AutoMod\)/), JSON.stringify(posts));
    failMode = null;

    await cmd('bot show');
    check('A17 bot show: Name, ID, Funktionen, letzter Fehler', has(/^\[Bot\] DerBdu \(ID 99\)/) && has(/^\[Bot\] Sendet: BdU-Chat, UBOAT-Soldbuch/) && has(/Letzter Sendefehler: .*403: user is not a moderator/));
    const st = await getJson('/status');
    check('A18 /status: bot_configured, bot_login, bot_features', st.bot_configured === true && st.bot_login === 'derbdu' && JSON.stringify(st.bot_features) === '["bdu","uboat"]', JSON.stringify(st));
    await cmd('bot remove');
    posts = await say('gefallenergustav', 'GefallenerGustav', '!soldbuch');
    check('A19 bot remove: Datei weg, nächste Nachricht vom Broadcaster', !fs.existsSync('bot.json') && posts.length === 1 && posts[0].auth === 'Bearer fake' && posts[0].body.sender_id === '1', JSON.stringify(posts));
    await cmd('bot remove');
    check('A20 bot remove ohne Bot: Hinweis', has(/Es ist kein Bot-Account eingerichtet/));
    await cmd('help');
    check('A21 Hilfe listet bot show/remove', has(/^ bot show /) && has(/^ bot remove /));
  }

  // BdU-Antwort durchspielen: Anfrage im Chat, Antwort des Widgets; Rückgabe: alle Sendeversuche danach
  async function bduRoundTrip(login, text, answer) {
    if (!sseReq) { await connectWidget(); await sleep(100); }
    const known = sseRequests.length;
    chat(login, login, '!BdU ' + text); await sleep(200);
    const before = chatPosts.length;
    await request('/api/bdu/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sseRequests[known] && sseRequests[known].id, status: 'ok', text: answer }) });
    await sleep(200);
    return chatPosts.slice(before);
  }

  if (scenario === 'eingerichtet') {
    check('E1 Startanzeige mit Bot', has(/^Bot-Account: DerBdu \(BdU-Chat, UBOAT-Soldbuch\)$/));
    const posts = await say('kobold', 'Kobold', '!soldbuch');
    check('E2 gespeicherter Bot sendet nach Neustart', posts.length === 1 && posts[0].body.sender_id === '99' && posts[0].auth === 'Bearer app-1', JSON.stringify(posts));
    failMode = '403';
    const bdu = await bduRoundTrip('anna', 'Lage?', 'Halten Sie Kurs.');
    check('E3 Rückfall bei BdU-Antwort: Bot ohne, Broadcaster mit „FT vom BdU:“', bdu.length === 2 && bdu[0].body.sender_id === '99' && bdu[0].body.message === 'Halten Sie Kurs.'
      && bdu[1].body.sender_id === '1' && bdu[1].body.message === 'FT vom BdU: Halten Sie Kurs.' && bdu[1].body.reply_parent_message_id, JSON.stringify(bdu));
    failMode = null;

    // Nicht in BOT_FEATURES: bleibt beim Broadcaster, auch wenn der Bot eingerichtet ist
    let before = chatPosts.length;
    send('notification', 'channel.chat.message', { event: { chatter_user_id: 'u-mod', chatter_user_login: 'mod', chatter_user_name: 'Mod', broadcaster_user_id: '1',
      message_id: 'c-raidstats', message: { text: '!raidstats' }, badges: [{ set_id: 'moderator' }] } });
    await sleep(250);
    const stats = chatPosts.slice(before);
    check('E4 !raidstats bei eingerichtetem Bot: als Broadcaster', stats.length === 1 && stats[0].auth === 'Bearer fake' && stats[0].body.sender_id === '1', JSON.stringify(stats));
    before = chatPosts.length;
    send('notification', 'channel.raid', { event: { from_broadcaster_user_id: '77', from_broadcaster_user_login: 'raider', to_broadcaster_user_id: '1', viewers: 1 } });
    await sleep(500);
    const greet = chatPosts.slice(before);
    check('E5 Raid-Begrüßung bei eingerichtetem Bot: als Broadcaster', greet.length === 1 && greet[0].auth === 'Bearer fake' && greet[0].body.sender_id === '1' && greet[0].body.message.includes('raider'), JSON.stringify(greet));
  }

  if (scenario === 'ohne-bot') {
    // ein Durchlauf je Testlauf (globales BdU-Limit 3 min); lange Antwort prüft zugleich die Kürzung inklusive Präfix
    const bdu = await bduRoundTrip('anna', 'Lage?', 'Halten Sie Kurs. ' + 'x'.repeat(600));
    check('O1 ohne Bot: BdU-Antwort als Broadcaster mit „FT vom BdU:“, gekürzt auf 500 Zeichen', bdu.length === 1 && bdu[0].auth === 'Bearer fake' && bdu[0].body.sender_id === '1'
      && bdu[0].body.message.startsWith('FT vom BdU: Halten Sie Kurs.') && bdu[0].body.message.length === 500 && appTokenCount === 0, JSON.stringify(bdu.map(p => p.body.message.slice(0, 40))));
  }

  console.log = realLog;
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} [${scenario}] ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  if (sseReq) sseReq.destroy();
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
