// Whitelist-Shoutout: Aktivität 40 Tage (Testphase: unklar -> trotzdem), Chat-Hinweis mit Spiel/Datum; Grammatik Raid.
// Aufruf: node aktiv-test.js <server.js> aktiv | grammatik <zufallswert>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const { EventEmitter } = require('events');
const [serverPath, mode, rnd] = [path.resolve(process.argv[2]), process.argv[3], parseFloat(process.argv[4] || '0')];
if (mode === 'grammatik') Math.random = () => rnd;
const PORT = 35000 + (process.pid % 900);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akt-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
const names = { 200: 'aktiv10', 201: 'alt50', 202: 'live', 203: 'leer', 204: 'fehler', 205: 'grenze39', 206: 'grenze41', 207: 'highlight' };
fs.writeFileSync(path.join(dir, 'whitelist.json'), JSON.stringify(names));
process.chdir(dir);
const sockets = []; class WS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() {} terminate() {} } WS.OPEN = 1;
const day = 86400000, ago = d => new Date(Date.now() - d * day).toISOString();
const de = iso => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const v200 = ago(10), v207arch = ago(25);
const videos = { 200: [{ created_at: v200, type: 'archive' }], 201: [{ created_at: ago(50), type: 'highlight' }], 202: [{ created_at: ago(90), type: 'archive' }], 203: [],
  205: [{ created_at: ago(39.9), type: 'upload' }], 206: [{ created_at: ago(40.1), type: 'archive' }], 207: [{ created_at: ago(2), type: 'highlight' }, { created_at: v207arch, type: 'archive' }] };
const games = { 200: 'UBOAT', 202: 'Silent Hunter', 207: 'Cold Waters' };
const shoutouts = [], chat = []; let videoCalls = 0;
const axios = {
  get: async (url) => {
    const id = (/(?:user_id|broadcaster_id)=(\d+)/.exec(url) || [])[1];
    if (id === '204') throw { response: { status: 500, data: { message: 'Testfehler' } } };
    if (url.includes('/helix/videos')) { videoCalls++; return { data: { data: videos[id] || [] } }; }
    if (url.includes('/helix/streams')) return { data: { data: id === '202' ? [{ started_at: ago(0.05), game_name: 'Silent Hunter' }] : [] } };
    if (url.includes('/helix/channels')) return { data: { data: games[id] ? [{ game_name: games[id] }] : [{ game_name: '' }] } };
    return { data: { data: [] } };
  },
  post: async (url, body, cfg) => { if (url.includes('shoutouts')) shoutouts.push(cfg.params.to_broadcaster_id); if (url.includes('chat/messages')) chat.push(body.message); return { data: { data: [{}] } }; },
};
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return WS; if (r === 'axios') return axios; if (r === 'readline') return { createInterface: () => (global.__rl = new EventEmitter()) }; return orig.call(this, r, ...a); };
const logs = []; const real = console.log; console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
process.env.TWITCH_COMPANION_NO_THROTTLE = '1';   // viele Anfragen in kurzer Zeit; die Drosselung prüft twitch-api-test.js
require(serverPath);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
const send = (t, e) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: t, message_id: 'm' + (++n) }, payload: { event: e } }));
const chatMsg = id => send('channel.chat.message', { chatter_user_id: String(id), chatter_user_login: names[id], broadcaster_user_id: '1', message: { text: 'hallo' }, badges: [] });
const results = []; const check = (nm, c, i = '') => results.push({ nm, ok: !!c, i });
const chatFor = name => chat.filter(m => m.includes('@' + name));
(async () => {
  await sleep(300);
  if (mode === 'aktiv') {
    const rl = global.__rl;
    for (const id of [200, 201, 202, 203, 204, 205, 206, 207]) { chatMsg(id); await sleep(100); }
    await sleep(2300);
    const has = id => shoutouts.includes(String(id));
    const checks = fs.existsSync('whitelist_checks.json') ? JSON.parse(fs.readFileSync('whitelist_checks.json', 'utf8')) : [];
    const rec = name => checks.filter(c => c.userName === name);
    const exact = 'Welch netter Besuch! Wir begrüßen @aktiv10! Dort gab es zuletzt UBOAT. Lasst gern mal nen Follow da!';
    check('A1 aktiv: genau der vorgegebene Hinweis, dann Shoutout', has(200) && chatFor('aktiv10')[0] === exact, chatFor('aktiv10')[0]);
    check('A1b kein Datum in irgendeinem Hinweis', !chat.some(m => /\d\d\.\d\d\.\d{4}/.test(m)), chat);
    check('A1c aktiv: kein Eintrag im Prüfprotokoll', rec('aktiv10').length === 0);
    check('A2 inaktiv (Highlight vor 50 Tagen): kein Hinweis, kein Shoutout, Protokoll „inaktiv“', !has(201) && chatFor('alt50').length === 0 && rec('alt50')[0]?.result === 'inaktiv' && rec('alt50')[0]?.shoutout === false, rec('alt50'));
    check('A3 selbst live beim Chatten: kein Hinweis, kein Shoutout, Protokoll „live“ mit Spiel', !has(202) && chatFor('live').length === 0 && rec('live')[0]?.result === 'live' && rec('live')[0]?.game === 'Silent Hunter', rec('live'));
    check('A4 keine Videos: Testphase -> Shoutout, Hinweis ohne Spielsatz, Protokoll „unklar“', has(203) && chatFor('leer')[0] === 'Welch netter Besuch! Wir begrüßen @leer! Lasst gern mal nen Follow da!' && rec('leer')[0]?.result === 'unklar' && rec('leer')[0]?.shoutout === true, [chatFor('leer')[0], rec('leer')]);
    check('A5 API-Fehler: Testphase -> Shoutout, Protokoll „unklar“ mit Fehler', has(204) && rec('fehler')[0]?.result === 'unklar' && /Testfehler/.test(rec('fehler')[0]?.error || ''), rec('fehler'));
    check('A6 Grenzfall 39,9 Tage (Upload): Shoutout, kein Protokolleintrag', has(205) && rec('grenze39').length === 0);
    check('A7 Grenzfall 40,1 Tage: kein Shoutout, Protokoll „inaktiv“', !has(206) && rec('grenze41')[0]?.result === 'inaktiv');
    check('A8 neuestes = Highlight vor 2 Tagen: aktiv, Hinweis mit Spiel', has(207) && (chatFor('highlight')[0] || '').includes('Dort gab es zuletzt Cold Waters.'));
    const before = videoCalls, sBefore = shoutouts.length, cBefore = chat.length; chatMsg(201); chatMsg(202); chatMsg(200); await sleep(2300);
    check('A9 zweite Nachricht: keine neue Prüfung, kein Hinweis, kein Shoutout, kein neuer Protokolleintrag', videoCalls === before && shoutouts.length === sBefore && chat.length === cBefore && JSON.parse(fs.readFileSync('whitelist_checks.json', 'utf8')).length === checks.length);
    const logStart = logs.length; rl.emit('line', 'whitelist checks'); await sleep(100);
    const out = logs.slice(logStart).join('\n');
    check('A10 Konsole „whitelist checks“ listet live, inaktiv, unklar', /@live .*selbst live/.test(out) && /@alt50 .*nicht aktiv/.test(out) && /@leer .*nicht feststellbar.*Testphase/.test(out), out);
    check('A11 Hilfe nennt „whitelist checks“', logs.some(l => /^ whitelist checks +- /.test(l)));
    send('channel.raid', { from_broadcaster_user_id: '201', from_broadcaster_user_login: 'alt50', to_broadcaster_user_id: '1', viewers: 5 });
    await sleep(2700);
    check('A12 Raid-Shoutout ohne Aktivitätsprüfung (Raider ist live)', has(201));
    send('stream.online', { broadcaster_user_id: '1' }); await sleep(200);
    const before2 = videoCalls; chatMsg(203); await sleep(300);
    check('A13 nach stream.online: neue Prüfung', videoCalls === before2 + 1);
  } else {
    send('channel.raid', { from_broadcaster_user_id: '300', from_broadcaster_user_login: 'raider', to_broadcaster_user_id: '1', viewers: 2 });
    await sleep(600);
    const msg = chat[0] || '';
    const idx = Math.floor(rnd * 3);
    const expect = ['Dort gab es zuletzt ein unbekanntes Spiel.', 'Zuletzt lief bei ihnen ein unbekanntes Spiel.', 'Gerade kommt ihr von einer Session mit einem unbekannten Spiel.'][idx];
    check(`G${idx + 1} „${expect}“`, msg.includes(expect), msg);
  }
  console.log = real;
  for (const r of results) real(`${r.ok ? 'OK  ' : 'FAIL'} ${r.nm}${r.ok ? '' : '  -> ' + JSON.stringify(r.i)}`);
  if (mode === 'aktiv') { real('--- Chat-Hinweise im Test:'); chat.forEach(m => real('  ' + m)); }
  process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
})();
