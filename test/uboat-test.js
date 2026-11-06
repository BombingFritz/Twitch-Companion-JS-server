// UBOAT-Personalakte (!personalakte, ADR 0016): Parser, Zuordnung, Kategorie, Cooldown, neuer und defekter Spielstand,
// Endpoint, /status, Konsole. Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis, erzeugte Spielstände (test/uboat-fixture.js).
// Aufruf: node uboat-test.js <server.js> <szenario: an | aus>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const fx = require('./uboat-fixture');
const { parseSave } = require('../lib/uboat-save');
const [serverPath, scenario] = [path.resolve(process.argv[2]), process.argv[3] || 'an'];
const PORT = 39100 + Math.floor(Math.random() * 300);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-'));
const savesDir = path.join(workDir, 'UBOAT', 'Saves');
fs.mkdirSync(savesDir, { recursive: true });
fs.mkdirSync(path.join(workDir, 'UBOAT', 'Data Sheets'));
fs.writeFileSync(path.join(workDir, 'UBOAT', 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
fs.writeFileSync(path.join(savesDir, 'Alt.save'), fx.buildSave({ crew: [{ name: 'Kobold', type: 0, level: 9 }] }));
fs.utimesSync(path.join(savesDir, 'Alt.save'), new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
fs.writeFileSync(path.join(savesDir, 'Versenkung.save'), fx.buildSave({ crew: fx.DEFAULT_CREW }));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\n`
  + (scenario === 'aus' ? '' : `UBOAT_SAVES_DIR=${savesDir}\n`));
fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: 'fake', refresh_token: 'fake', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() { this.emit('close'); } terminate() { this.emit('close'); } }
FakeWS.OPEN = 1;
let category = 'UBOAT';
const chatPosts = [], subscriptions = [];
const fakeAxios = {
  post: async (url, body) => {
    if (url.includes('/eventsub/subscriptions')) subscriptions.push(`${body.type}@${body.version}`);
    if (url.includes('/chat/messages')) chatPosts.push(body);
    return { data: { data: [] } };
  },
  get: async (url) => url.includes('/helix/channels') ? { data: { data: [{ game_name: category }] } } : { data: { data: [] } },
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
const chat = (login, display, text = '!personalakte') => send('notification', 'channel.chat.message', { event: {
  chatter_user_id: 'u-' + login, chatter_user_login: login, chatter_user_name: display || login, broadcaster_user_id: '1', message_id: `c${n + 1}`, message: { text }, badges: [] } });
const getJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const has = re => logs.some(l => re.test(l));
const last = () => chatPosts[chatPosts.length - 1];
async function ask(login, display, text) { const before = chatPosts.length; chat(login, display, text); await sleep(200); return chatPosts.length > before ? last() : null; }

(async () => {
  await sleep(500);
  send('session_welcome', null, { session: { id: 's1', keepalive_timeout_seconds: 600 } });
  await sleep(300);

  if (scenario === 'aus') {
    check('A1 Startanzeige: UBOAT-Personalakte aus', has(/UBOAT-Personalakte: aus/));
    const r = await ask('kobold');
    check('A2 ohne UBOAT_SAVES_DIR keine Antwort', r === null);
    const api = await getJson('/api/uboat/crew');
    check('A3 /api/uboat/crew meldet enabled:false', api.enabled === false && api.crew.length === 0, JSON.stringify(api));
    const st = await getJson('/status');
    check('A4 /status uboat_enabled:false', st.uboat_enabled === false);
  }

  if (scenario === 'an') {
    // Parser direkt
    const parsed = parseSave(fs.readFileSync(path.join(savesDir, 'Versenkung.save')));
    check('P1 Parser: 9 Crewmitglieder, Fremdcharakter und nicht Angeheuerte ausgefiltert', parsed.crew.length === 9 && !parsed.crew.some(c => /Arthur|Nicht/.test(c.name)), parsed.crew.map(c => c.name).join(','));
    check('P2 Parser: Spielversion und Rolle', parsed.gameVersion === '2026.1 Patch 21' && parsed.crew.find(c => c.name === 'Alpaka').role === 'Chief Boatswain');

    check('S1 Startanzeige: UBOAT-Personalakte an', has(/UBOAT-Personalakte: an/));
    check('S2 neuester Spielstand eingelesen (nicht der ältere)', has(/Spielstand „Versenkung.save“ eingelesen/) && !has(/„Alt.save“ eingelesen/));
    check('S3 channel.update v2 abonniert, Kategorie abgerufen', subscriptions.includes('channel.update@2') && has(/Twitch-Kategorie: UBOAT \(Abruf\).*aktiv/));

    let r = await ask('kobold', 'Kobold');
    check('B1 Matrose: Akte als Reply', r && r.reply_parent_message_id && r.message === 'Personalakte Kobold – Matrose: Stufe 0, 0 EP. Charakter: Ängstlich. Fähigkeiten: Hart im Nehmen. Stand: ' + r.message.split('Stand: ')[1], r && r.message);
    check('B2 Stand mit Datum und Uhrzeit', r && /Stand: \d\d\.\d\d\. \d\d:\d\d Uhr$/.test(r.message), r && r.message);
    r = await ask('alpaka');
    check('B3 Offizier: Klasse deutsch, EP letzte Feindfahrt, Auszeichnung, interne Werte und Klassen-Fähigkeit ausgeblendet',
      r && r.message.startsWith('Personalakte Alpaka – Offizier (Funker): Stufe 3, 484 EP (+140 letzte Feindfahrt), 1 Auszeichnung. Charakter: Ängstlich. Fähigkeiten: Gutes Gehör. Stand:'), r && r.message);
    r = await ask('gefallenergustav', 'GefallenerGustav');
    check('B4 Gefallener: Todesdatum', r && r.message.includes('Gefallen am 12.03.1941.'), r && r.message);
    check('B5 höchstens 500 Zeichen', chatPosts.every(p => p.message.length <= 500));

    r = await ask('majormac', 'MajorMac');
    check('Z1 Zuordnung trotz Leerzeichen/Groß-Klein (Major Mac)', r && r.message.startsWith('Personalakte Major Mac'), r && r.message);
    r = await ask('juergenmueller', 'JuergenMueller');
    check('Z2 Zuordnung mit Umlauten (Jürgen Müller)', r && r.message.startsWith('Personalakte Jürgen Müller'), r && r.message);
    r = await ask('zw3rg', 'Zwergwildsau');
    check('Z3 Zuordnung über den Anzeigenamen', r && r.message.startsWith('Personalakte Zwergwildsau'), r && r.message);
    rl.emit('line', 'uboat map @Fritz_TV Fritz Unsinkbar'); await sleep(50);
    check('Z4 Konsole uboat map schreibt Zuordnungsdatei', JSON.parse(fs.readFileSync('uboat_crew_map.json', 'utf8')).fritz_tv === 'Fritz Unsinkbar');
    r = await ask('fritz_tv', 'Fritz_TV');
    check('Z5 Zuordnung über Datei (Kommandant, Fähigkeit Kommandant ausgeblendet)', r && r.message.startsWith('Personalakte Fritz Unsinkbar – Kommandant (Befehlshaber): Stufe 4, 281 EP (+200 letzte Feindfahrt), 4 Auszeichnungen. Charakter: Gesundheitsprobleme. Fähigkeiten: Spanischsprachig.'), r && r.message);
    r = await ask('hanspeter', 'HansPeter');
    check('Z6 mehrdeutiger Name: keine Akte, Hinweis in der Konsole', r && r.message === 'Zu deinem Namen liegt keine Personalakte vor.' && has(/passt auf mehrere Crewmitglieder \(Hans Peter, Hanspeter\)/), r && r.message);
    r = await ask('fremder');
    check('Z7 unbekannter Zuschauer: Hinweis', r && r.message === 'Zu deinem Namen liegt keine Personalakte vor.');
    rl.emit('line', 'uboat unmap fritz_tv'); await sleep(50);
    check('Z8 Konsole uboat unmap entfernt Zuordnung', !('fritz_tv' in JSON.parse(fs.readFileSync('uboat_crew_map.json', 'utf8'))));

    r = await ask('kobold', 'Kobold');
    check('C1 Cooldown: zweiter Befehl binnen 60 s ohne Antwort', r === null && has(/von @kobold ignoriert – Cooldown/));
    r = await ask('neuling', 'Neuling', '!Personalakte bitte');
    check('C2 Groß-/Kleinschreibung und Text dahinter', r && r.message === 'Zu deinem Namen liegt keine Personalakte vor.');
    r = await ask('neuling2', 'Neuling2', '!personalakten');
    check('C3 ähnlicher Befehl löst nicht aus', r === null);

    category = 'Just Chatting';
    send('notification', 'channel.update', { event: { broadcaster_user_id: '1', category_name: 'Just Chatting' } }); await sleep(100);
    r = await ask('kategorie1', 'Kobold');
    check('K1 andere Kategorie: keine Antwort', r === null && has(/Twitch-Kategorie: Just Chatting \(channel\.update\).*inaktiv/));
    send('notification', 'channel.update', { event: { broadcaster_user_id: '1', category_name: 'UBOAT' } }); await sleep(100);
    r = await ask('kategorie2', 'Kobold');
    check('K2 zurück zu UBOAT: Antwort', r && r.message.startsWith('Personalakte Kobold'));

    let api = await getJson('/api/uboat/crew');
    check('E1 /api/uboat/crew: aktiv, Quelle, 9 Crewmitglieder mit deutschen Eigenschaften', api.enabled && api.active && api.source === 'Versenkung.save' && api.crew.length === 9
      && api.crew.find(c => c.name === 'Kobold').traits[0] === 'Ängstlich', JSON.stringify({ ...api, crew: api.crew.length }));
    const st = await getJson('/status');
    check('E2 /status: uboat_enabled, uboat_active, uboat_save', st.uboat_enabled === true && st.uboat_active === true && st.uboat_save === 'Versenkung.save' && !!st.uboat_saved_at);

    // neuer Spielstand: wird nach der Ruhezeit eingelesen
    const changed = fx.DEFAULT_CREW.map(c => c.name === 'Kobold' ? { ...c, level: 1, xp: 30, xpLP: 30 } : c);
    fs.writeFileSync(path.join(savesDir, 'Autosave_1.save'), fx.buildSave({ crew: changed }));
    await sleep(1000);
    api = await getJson('/api/uboat/crew');
    check('N1 neuer Spielstand nicht vor Ablauf der Ruhezeit gelesen', api.source === 'Versenkung.save');
    await sleep(6500);
    api = await getJson('/api/uboat/crew');
    const kob = api.crew.find(c => c.name === 'Kobold');
    check('N2 neuer Spielstand nach Ruhezeit eingelesen', api.source === 'Autosave_1.save' && kob.level === 1 && kob.experiencePoints === 30, JSON.stringify({ source: api.source, kob }));
    fs.writeFileSync(path.join(savesDir, 'Kaputt.save'), Buffer.from('kein deflate'));
    await sleep(7500);
    api = await getJson('/api/uboat/crew');
    check('N3 defekter Spielstand: letzter gültiger Stand bleibt, Hinweis', api.source === 'Autosave_1.save' && api.crew.length === 9 && has(/„Kaputt.save“ nicht lesbar/), api.source);
    check('N4 Saves-Ordner unverändert (nur gelesen)', fs.readdirSync(savesDir).sort().join(',') === 'Alt.save,Autosave_1.save,Kaputt.save,Versenkung.save');
    rl.emit('line', 'uboat show'); await sleep(50);
    check('K3 Konsole uboat show zeigt Spielstand und Crew', has(/Spielstand: Autosave_1.save \(Stand/) && has(/Crew \(9\):/));
  }

  console.log = realLog;
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} [${scenario}] ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
