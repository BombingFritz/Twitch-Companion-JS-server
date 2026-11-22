// UBOAT-Soldbuch (!soldbuch, ADR 0016): Parser, Zuordnung, Kategorie, Cooldown, Verwundung, neuer und defekter Spielstand,
// Endpoint, /status, Konsole. Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis, erzeugte Spielstände (test/uboat-fixture.js).
// Aufruf: node uboat-test.js <server.js> <szenario: an | aus | verlauf>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const fx = require('./uboat-fixture');
const { parseSave } = require('../lib/uboat-save');
const { createUboatCrew } = require('../lib/uboat-crew');
const [serverPath, scenario] = [path.resolve(process.argv[2]), process.argv[3] || 'an'];
const PORT = 39100 + Math.floor(Math.random() * 300);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-'));
const savesDir = path.join(workDir, 'UBOAT', 'Saves');
fs.mkdirSync(savesDir, { recursive: true });
fs.mkdirSync(path.join(workDir, 'UBOAT', 'Data Sheets'));
fs.writeFileSync(path.join(workDir, 'UBOAT', 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
fs.writeFileSync(path.join(savesDir, 'Alt.save'), fx.buildSave({ crew: [{ name: 'Kobold', type: 0, level: 9 }] }));
fs.utimesSync(path.join(savesDir, 'Alt.save'), new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
if (scenario === 'verlauf') {
  // Kampagne U-68: älterer Stand auf Feindfahrt 1 (Kobold noch mit Lebenslauf), neuester auf Feindfahrt 2
  const koboldBg = fx.AKTE_CREW.map(c => (c.name === 'Kobold' ? { ...c, background: { key: 'UI/RecruitmentUI/Backgrounds/Story 7', args: ['Karl Klein'] } } : c));
  fs.writeFileSync(path.join(savesDir, 'Frueher.save'), fx.buildSave({ crew: koboldBg, career: { ...fx.DEFAULT_CAREER, assignmentIndex: 1, patrolStart: '1941-08-05' } }));
  fs.utimesSync(path.join(savesDir, 'Frueher.save'), new Date(Date.now() - 1800e3), new Date(Date.now() - 1800e3));
  fs.writeFileSync(path.join(savesDir, 'Versenkung.save'), fx.buildSave({ crew: fx.AKTE_CREW, career: fx.DEFAULT_CAREER }));
} else {
  fs.writeFileSync(path.join(savesDir, 'Versenkung.save'), fx.buildSave({ crew: fx.DEFAULT_CREW }));
}
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
let streamChecks = 0;   // helix/streams: letzte Anfrage nach session_welcome (Stream-Abgleich)
const fakeAxios = {
  post: async (url, body) => {
    if (url.includes('/eventsub/subscriptions')) subscriptions.push(`${body.type}@${body.version}`);
    if (url.includes('/chat/messages')) chatPosts.push(body);
    return { data: { data: [] } };
  },
  get: async (url) => {
    if (url.includes('/helix/streams')) streamChecks += 1;
    return url.includes('/helix/channels') ? { data: { data: [{ game_name: category }] } } : { data: { data: [] } };
  },
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const realLog = console.log, logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Wartet, bis cond() wahr ist, höchstens timeoutMs: robust gegen langsamere Rechner (CI), ohne die Prüfung aufzuweichen
const waitFor = async (cond, timeoutMs, stepMs = 250) => { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (await cond()) return true; await sleep(stepMs); } return cond(); };
let n = 0;
const send = (message_type, subType, payload) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type, subscription_type: subType, message_id: `m${++n}` }, payload }));
const chat = (login, display, text = '!soldbuch') => send('notification', 'channel.chat.message', { event: {
  chatter_user_id: 'u-' + login, chatter_user_login: login, chatter_user_name: display || login, broadcaster_user_id: '1', message_id: `c${n + 1}`, message: { text }, badges: [] } });
const getJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const has = re => logs.some(l => re.test(l));
const last = () => chatPosts[chatPosts.length - 1];
async function ask(login, display, text) { const before = chatPosts.length; chat(login, display, text); await sleep(200); return chatPosts.length > before ? last() : null; }

(async () => {
  await sleep(500);
  send('session_welcome', null, { session: { id: 's1', keepalive_timeout_seconds: 600 } });
  // Verbindungsaufbau abwarten (echte Drosselung, ADR 0024): Chat-Antworten stünden sonst hinter den Abos
  await waitFor(() => streamChecks > 0, 15000, 50);
  await sleep(100);

  if (scenario === 'aus') {
    check('A1 Startanzeige: UBOAT-Soldbuch aus', has(/UBOAT-Soldbuch: aus/));
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
    // Aktualität: Hinweis nur, wenn der Spielstand höchstens 60 min alt ist
    const oldDir = path.join(workDir, 'alt', 'Saves'); fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'Alt.save'), fx.buildSave({ crew: fx.DEFAULT_CREW }));
    fs.utimesSync(path.join(oldDir, 'Alt.save'), new Date(Date.now() - 61 * 60000), new Date(Date.now() - 61 * 60000));
    const old = createUboatCrew({ savesDir: oldDir, log: () => {} }); old.reload();
    const oldText = old.formatAkte(old.findMember('kobold', '').member);
    // ohne Data Sheets in diesem Ordner keine deutschen Namen, daher ohne Charakter/Fähigkeiten
    check('P3 Spielstand älter als 60 min: kein Hinweis „aktuell“, keine Zeitangabe; Jahrgang hinter dem Namen', oldText === 'Soldbuch Kobold, Jahrgang 1911 – Matrose, an Bord.', oldText);
    // Verwundung: Zustände mit IWoundedStatus im Spielcode (Bleeding, Treatment, Hospitalization); Status 2 = gefallen
    const woundRoot = path.join(workDir, 'wund'), woundDir = path.join(woundRoot, 'Saves');
    fs.mkdirSync(woundDir, { recursive: true }); fs.mkdirSync(path.join(woundRoot, 'Data Sheets'));
    fs.writeFileSync(path.join(woundRoot, 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
    fs.writeFileSync(path.join(woundDir, 'Gefecht.save'), fx.buildSave({ crew: [
      { name: 'Kobold', type: 0, born: '1911-02-14', statuses: ['AnxiousPersonality', 'Sailor', 'Tough', 'Bleeding'] },
      { name: 'Sani', type: 0, statuses: ['Sailor', 'Treatment', 'Runner'] },
      { name: 'Lazarett', type: 0, status: 0, statuses: ['SeaWolf', 'Sailor', 'Bleeding', 'Hospitalization'] },
      { name: 'Tot', type: 1, cls: 'Leader', level: 1, xp: 5, status: 2, died: '1941-05-01', statuses: ['Bleeding'] },
    ] }));
    const wound = createUboatCrew({ savesDir: woundDir, log: () => {} }); wound.reload();
    const wt = login => wound.formatAkte(wound.findMember(login, '').member);
    check('W1 blutend: „an Bord, verwundet“', wt('kobold') === 'Soldbuch Kobold, Jahrgang 1911 – Matrose, an Bord, verwundet. Charakter: Ängstlich. Fähigkeiten: Hart im Nehmen. Der Eintrag ist aktuell.', wt('kobold'));
    check('W2 in Behandlung: „verwundet“, Zustand nicht als Fähigkeit', wt('sani') === 'Soldbuch Sani, Jahrgang 1910 – Matrose, an Bord, verwundet. Fähigkeiten: Läufer. Der Eintrag ist aktuell.', wt('sani'));
    check('W3 Krankenhaus hat Vorrang vor „verwundet“', wt('lazarett') === 'Soldbuch Lazarett, Jahrgang 1910 – Matrose, in Reserve, im Krankenhaus. Charakter: Seewolf. Der Eintrag ist aktuell.', wt('lazarett'));
    check('W4 Gefallener: weder Status noch Verwundung', wt('tot') === 'Soldbuch Tot, Jahrgang 1910 – Offizier (Befehlshaber): Stufe 1, 5 EP. Gefallen am 01.05.1941. Der Eintrag ist aktuell.', wt('tot'));
    check('W5 /api-Daten: wounded und woundLabel', wound.getState().crew.find(c => c.name === 'Kobold').wounded === true && wound.getState().crew.find(c => c.name === 'Lazarett').woundLabel === 'im Krankenhaus');

    check('S1 Startanzeige: UBOAT-Soldbuch an', has(/UBOAT-Soldbuch: an/));
    check('S2 neuester Spielstand eingelesen (nicht der ältere)', has(/Spielstand „Versenkung.save“ eingelesen/) && !has(/„Alt.save“ eingelesen/));
    check('S3 channel.update v2 abonniert, Kategorie abgerufen', subscriptions.includes('channel.update@2') && has(/Twitch-Kategorie: UBOAT \(Abruf\).*aktiv/));

    let r = await ask('kobold', 'Kobold');
    check('B1 Matrose an Bord: Akte als Reply', r && r.reply_parent_message_id && r.message === 'Soldbuch Kobold, Jahrgang 1911 – Matrose, an Bord. Charakter: Ängstlich. Fähigkeiten: Hart im Nehmen. Der Eintrag ist aktuell.', r && r.message);
    check('B2 Matrose ohne Stufe/EP, ohne Datum und Uhrzeit, Hinweis „aktuell“', r && !/Stufe|EP|\d\d:\d\d/.test(r.message) && r.message.endsWith('Der Eintrag ist aktuell.'), r && r.message);
    r = await ask('alpaka');
    check('B3 Offizier: Klasse deutsch, EP letzte Feindfahrt, Auszeichnung, interne Werte und Klassen-Fähigkeit ausgeblendet',
      r && r.message.startsWith('Soldbuch Alpaka, Jahrgang 1910 – Offizier (Funker), an Bord: Stufe 3, 484 EP (+140 letzte Feindfahrt), 1 Auszeichnung. Charakter: Ängstlich. Fähigkeiten: Gutes Gehör. Der Eintrag ist aktuell.'), r && r.message);
    r = await ask('gefallenergustav', 'GefallenerGustav');
    check('B4 Gefallener: Todesdatum, nicht als „an Bord“ geführt', r && r.message.includes('Gefallen am 12.03.1941.') && r.message.startsWith('Soldbuch Gefallener Gustav, Jahrgang 1910 – Offizier (Befehlshaber): Stufe 2, 50 EP.'), r && r.message);
    check('B5 höchstens 500 Zeichen', chatPosts.every(p => p.message.length <= 500));

    r = await ask('majormac', 'MajorMac');
    check('Z1 Zuordnung trotz Leerzeichen/Groß-Klein (Major Mac); Matrose mit EP: trotzdem keine EP', r && r.message.startsWith('Soldbuch Major Mac, Jahrgang 1910 – Matrose, an Bord. Charakter: Seewolf. Fähigkeiten: Läufer.'), r && r.message);
    r = await ask('juergenmueller', 'JuergenMueller');
    check('Z2 Zuordnung mit Umlauten (Jürgen Müller)', r && r.message.startsWith('Soldbuch Jürgen Müller'), r && r.message);
    r = await ask('zw3rg', 'Zwergwildsau');
    check('Z3 Zuordnung über den Anzeigenamen; Reserve', r && r.message.startsWith('Soldbuch Zwergwildsau, Jahrgang 1910 – Matrose, in Reserve. Charakter: Seewolf.'), r && r.message);
    rl.emit('line', 'uboat map @Fritz_TV Fritz Unsinkbar'); await sleep(50);
    check('Z4 Konsole uboat map schreibt Zuordnungsdatei', JSON.parse(fs.readFileSync('uboat_crew_map.json', 'utf8')).fritz_tv === 'Fritz Unsinkbar');
    r = await ask('fritz_tv', 'Fritz_TV');
    check('Z5 Zuordnung über Datei (Kommandant, Fähigkeit Kommandant ausgeblendet)', r && r.message.startsWith('Soldbuch Fritz Unsinkbar, Jahrgang 1910 – Kommandant (Befehlshaber), an Bord: Stufe 4, 281 EP (+200 letzte Feindfahrt), 4 Auszeichnungen. Charakter: Gesundheitsprobleme. Fähigkeiten: Spanischsprachig.'), r && r.message);
    r = await ask('hanspeter', 'HansPeter');
    check('Z6 mehrdeutiger Name: nichts im Chat, Hinweis in der Konsole', r === null && has(/passt auf mehrere Crewmitglieder \(Hans Peter, Hanspeter\)/) && has(/Kein Soldbuch für @hanspeter/), r && r.message);
    r = await ask('fremder');
    check('Z7 unbekannter Zuschauer: nichts im Chat, nur Konsole', r === null && has(/Kein Soldbuch für @fremder .*keine Antwort im Chat/), r && r.message);
    rl.emit('line', 'uboat unmap fritz_tv'); await sleep(50);
    check('Z8 Konsole uboat unmap entfernt Zuordnung', !('fritz_tv' in JSON.parse(fs.readFileSync('uboat_crew_map.json', 'utf8'))));

    r = await ask('kobold', 'Kobold');
    check('C1 Cooldown: zweiter Befehl binnen 60 s ohne Antwort', r === null && has(/von @kobold ignoriert – Cooldown/));
    r = await ask('neuling', 'Zwergwildsau', '!Soldbuch bitte');
    check('C2 „!Soldbuch“ mit Großbuchstaben und Text dahinter', r && r.message.startsWith('Soldbuch Zwergwildsau'), r && r.message);
    r = await ask('neuling2', 'Kobold', '!soldbuchs');
    check('C3 ähnlicher Befehl löst nicht aus', r === null && !has(/@neuling2/));
    r = await ask('neuling3', 'Kobold', '!personalakte');
    check('C4 alter Befehl !personalakte löst nicht mehr aus', r === null && !has(/@neuling3/));

    category = 'Just Chatting';
    send('notification', 'channel.update', { event: { broadcaster_user_id: '1', category_name: 'Just Chatting' } }); await sleep(100);
    r = await ask('kategorie1', 'Kobold');
    check('K1 andere Kategorie: keine Antwort', r === null && has(/Twitch-Kategorie: Just Chatting \(channel\.update\).*inaktiv/));
    send('notification', 'channel.update', { event: { broadcaster_user_id: '1', category_name: 'UBOAT' } }); await sleep(100);
    r = await ask('kategorie2', 'Kobold');
    check('K2 zurück zu UBOAT: Antwort', r && r.message.startsWith('Soldbuch Kobold'));

    let api = await getJson('/api/uboat/crew');
    check('E1 /api/uboat/crew: aktiv, Quelle, 9 Crewmitglieder mit deutschen Eigenschaften', api.enabled && api.active && api.source === 'Versenkung.save' && api.crew.length === 9
      && api.crew.find(c => c.name === 'Kobold').traits[0] === 'Ängstlich'
      && api.crew.find(c => c.name === 'Kobold').statusLabel === 'an Bord' && api.crew.find(c => c.name === 'Zwergwildsau').statusLabel === 'in Reserve', JSON.stringify({ ...api, crew: api.crew.length }));
    const st = await getJson('/status');
    check('E2 /status: uboat_enabled, uboat_active, uboat_save', st.uboat_enabled === true && st.uboat_active === true && st.uboat_save === 'Versenkung.save' && !!st.uboat_saved_at);

    // neuer Spielstand: wird nach der Ruhezeit eingelesen
    const changed = fx.DEFAULT_CREW.map(c => c.name === 'Kobold' ? { ...c, level: 1, xp: 30, xpLP: 30 } : c);
    fs.writeFileSync(path.join(savesDir, 'Autosave_1.save'), fx.buildSave({ crew: changed }));
    await sleep(1000);
    api = await getJson('/api/uboat/crew');
    check('N1 neuer Spielstand nicht vor Ablauf der Ruhezeit gelesen', api.source === 'Versenkung.save');
    await waitFor(async () => (api = await getJson('/api/uboat/crew')).source === 'Autosave_1.save', 20000);
    const kob = api.crew.find(c => c.name === 'Kobold');
    check('N2 neuer Spielstand nach Ruhezeit eingelesen', api.source === 'Autosave_1.save' && kob.level === 1 && kob.experiencePoints === 30, JSON.stringify({ source: api.source, kob }));
    fs.writeFileSync(path.join(savesDir, 'Kaputt.save'), Buffer.from('kein deflate'));
    await waitFor(() => has(/„Kaputt.save“ nicht lesbar/), 20000);
    api = await getJson('/api/uboat/crew');
    check('N3 defekter Spielstand: letzter gültiger Stand bleibt, Hinweis', api.source === 'Autosave_1.save' && api.crew.length === 9 && has(/„Kaputt.save“ nicht lesbar/), api.source);
    check('N4 Saves-Ordner unverändert (nur gelesen)', fs.readdirSync(savesDir).sort().join(',') === 'Alt.save,Autosave_1.save,Kaputt.save,Versenkung.save');
    rl.emit('line', 'uboat show'); await sleep(50);
    check('K3 Konsole uboat show zeigt Spielstand und Crew', has(/Spielstand: Autosave_1.save \(Stand/) && has(/Crew \(9\):/));
    // Nachlesen (Stream-Kartei 1c): Spielstände ohne Karriere haben keine Kampagne; der volle Ablauf steht in uboat-history-test
    rl.emit('line', 'uboat nachlesen'); await sleep(50);
    rl.emit('line', 'uboat nachlesen übernehmen'); await sleep(50);
    check('K4 uboat nachlesen ohne Kampagne: Hinweis; übernehmen ohne Vorschau: Hinweis', has(/Kein Spielstand mit Kampagne gelesen/) && has(/Keine Vorschau – erst "uboat nachlesen"/));
    check('K5 Ohne Kampagne kein Verlauf geschrieben', !fs.existsSync(path.join(workDir, 'uboat_crew_history.json')));
    rl.emit('line', 'uboat verlauf Kobold'); await sleep(50);
    check('K6 uboat verlauf ohne Kampagne: Hinweis', logs.filter(l => /Kein Spielstand mit Kampagne gelesen/.test(l)).length === 2);
  }

  // Konsole "uboat verlauf <Name>": frühere Namen, Feindfahrten, Lebenslauf; aus der Vorschau, sonst dem Verlauf
  if (scenario === 'verlauf') {
    const after = mark => logs.slice(mark);
    const run = async line => { const mark = logs.length; rl.emit('line', line); await waitFor(() => logs.length > mark, 5000, 20); await sleep(50); return after(mark); };
    let out = await run('uboat verlauf alpaka');
    check('H1 Treffer unabhängig von Groß-/Kleinschreibung, aus dem gespeicherten Verlauf',
      out[0] === '[UBOAT] Verlauf „alpaka“ (gespeicherter Verlauf, Kampagne U-68|1941-08-01): 1 Person', out.join(' | '));
    check('H2 Kopfzeile mit Geburtsdatum, Typ und Status', /^ {2}Alpaka – geboren \d\d\.\d\d\.1910; Offizier, an Bord$/.test(out[1] || ''), out[1]);
    check('H3 Feindfahrten an Bord aus dem Verlauf', out[2] === '    Feindfahrten an Bord: 2 (1)', out[2]);
    check('H4 Lebenslauf aus dem Spielstand, mit heutigem Namen', out[3] === '    Lebenslauf (steht im Spielstand): Alpaka stammt aus Kiel und liest gern.', out[3]);
    out = await run('uboat verlauf Fritz Unsinkbar');
    check('H5 Name mit Leerzeichen; ohne Lebenslauf: Hinweis auf Offiziere', out.some(l => l === '    Lebenslauf: keiner, weder im Spielstand noch im Verlauf (Offiziere haben im Spiel oft keinen)'), out.join(' | '));
    out = await run('uboat verlauf Hanspeter');
    check('H6 Mehrere passende Personen: alle', /: 2 Personen$/.test(out[0] || '') && out.some(l => l.startsWith('  Hans Peter – ')) && out.some(l => l.startsWith('  Hanspeter – ')), out.join(' | '));
    out = await run('uboat verlauf Zwergwild');
    check('H7 Teil des Namens; Reserve ohne Feindfahrt', out.some(l => l.startsWith('  Zwergwildsau – ') && /in Reserve$/.test(l)) && out.includes('    Feindfahrten an Bord: keine'), out.join(' | '));
    out = await run('uboat verlauf Niemand');
    check('H8 Kein Treffer: Hinweis', /^\[UBOAT\] Verlauf: niemand mit Namen „Niemand“ \(gespeicherter Verlauf/.test(out[0] || ''), out.join(' | '));
    out = await run('uboat verlauf');
    check('H9 Ohne Namen: Nutzung nennt uboat verlauf <Name>', out.some(l => /^Nutzung: .*uboat verlauf <Name>/.test(l)), out.join(' | '));
    out = await run('uboat nachlesen');
    await waitFor(() => has(/Prüfen und mit "uboat nachlesen übernehmen"/), 10000, 50);
    out = await run('uboat verlauf Kobold');
    check('H10 Offene Vorschau: Feindfahrten und gesicherter Lebenslauf aus der Vorschau',
      /Vorschau, noch nicht übernommen/.test(out[0] || '') && out.includes('    Feindfahrten an Bord: 1, 2 (2)')
      && out.includes('    Lebenslauf (gesichert, im Spielstand nicht mehr vorhanden): Kobold stammt aus Kiel und liest gern.'), out.join(' | '));
    const saved = JSON.parse(fs.readFileSync('uboat_crew_history.json', 'utf8'));
    check('H11 Anzeigen der Vorschau speichert nichts', JSON.stringify(saved.campaigns['U-68|1941-08-01'].persons.find(p => p.name === 'Kobold').patrols) === '[2]');
    await run('uboat nachlesen verwerfen');
    out = await run('uboat verlauf Kobold');
    check('H12 Nach dem Verwerfen wieder aus dem gespeicherten Verlauf', /gespeicherter Verlauf/.test(out[0] || '') && out.includes('    Feindfahrten an Bord: 2 (1)'), out.join(' | '));
  }

  console.log = realLog;
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} [${scenario}] ${r.name}${r.ok ? '' : '  -> ' + r.info}`);
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
