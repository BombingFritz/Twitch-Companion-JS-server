// Kern (ADR 0027): core/log.js und core/http.js als Modultest, ohne Server. Eigenes Arbeitsverzeichnis.
const path = require('path'), fs = require('fs'), os = require('os');
const root = path.join(__dirname, '..');
const { createLog, redactedValues } = require(path.join(root, 'core', 'log'));
const { createAccess } = require(path.join(root, 'core', 'http'));
const { writeJsonAtomic } = require(path.join(root, 'core', 'store'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-'));
process.chdir(dir);   // eigenes Arbeitsverzeichnis: core/config.js liest sonst die echte .env im Projektordner

// store
const file = path.join(dir, 'x.json');
writeJsonAtomic(file, { a: 1 });
check('S1 writeJsonAtomic schreibt, keine Hilfsdatei bleibt', JSON.parse(fs.readFileSync(file, 'utf8')).a === 1 && !fs.existsSync(`${file}.tmp`));
// Format wie früher mit fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8'): zwei Leerzeichen, kein Zeilenende am Schluss
check('S2 Format der Laufzeitdateien unverändert', fs.readFileSync(file, 'utf8') === JSON.stringify({ a: 1 }, null, 2));
const { writeTextAtomic } = require(path.join(root, 'core', 'store'));
const txt = path.join(dir, 'bericht.txt');
writeTextAtomic(txt, 'Zeile 1\r\nÄußerung 2');
check('S3 writeTextAtomic: Text unverändert (auch Umlaute, Windows-Zeilenenden), keine Hilfsdatei', fs.readFileSync(txt, 'utf8') === 'Zeile 1\r\nÄußerung 2' && !fs.existsSync(`${txt}.tmp`));

// redactedValues
const r = redactedValues({ secrets: ['GEHEIM', undefined], webhookUrl: 'http://ha-host.invalid:8123/api/webhook/hook-id-123', loopbackHostnames: ['localhost'] });
check('R1 Secrets, Webhook-Adresse, Host und Webhook-ID werden entfernt, längste zuerst', r.includes('GEHEIM') && r.includes('ha-host.invalid:8123') && r.includes('hook-id-123')
  && r[0].length >= r[r.length - 1].length && !r.includes(undefined), JSON.stringify(r));
check('R2 Ohne Webhook-Adresse: nur Secrets', JSON.stringify(redactedValues({ secrets: ['A'] })) === '["A"]');

// createLog
let errors = 0;
const errorLogFile = path.join(dir, 'error_log.json');
const log = createLog({ redactions: ['GEHEIM'], redactedText: '<entfernt>', privateAddressText: '<privat>', bufferLines: 3, maxChars: 20,
  errorLogFile, errorLogMax: 2, writeJson: writeJsonAtomic, onError: () => { errors += 1; } });
const clean = log.sanitize('GEHEIM access_token=abc Bearer xyz 192.168.1.5 ghp_' + 'a'.repeat(24));
check('L1 Bereinigung: Secret, Token-Felder, Bearer, private Adresse, GitHub-Token', !clean.includes('GEHEIM') && !clean.includes('abc') && !clean.includes('xyz')
  && clean.includes('<privat>') && !clean.includes('ghp_'), clean);

const realLog = console.log, realErr = console.error, realWarn = console.warn, realInfo = console.info;
const seen = [];
console.log = console.info = console.warn = console.error = (...a) => seen.push(a.join(' '));
log.installConsole();
console.log('eins'); console.log('zwei'); console.log('drei'); console.log('vier ' + 'x'.repeat(30));
console.error('fehler 1'); console.error('fehler 2'); console.error('fehler 3');
log.logIfChanged('k', 'gleich'); log.logIfChanged('k', 'gleich'); log.logIfChanged('k', 'anders');
console.log = realLog; console.error = realErr; console.warn = realWarn; console.info = realInfo;

check('L2 Konsole unverändert durchgereicht', seen.includes('eins') && seen.includes('fehler 3'));
check('L3 Puffer begrenzt (3) und lange Zeilen gekürzt', log.buffer.length === 3 && log.buffer.every(e => e.text.length <= 20 + ' … (gekürzt)'.length), JSON.stringify(log.buffer.map(e => e.text)));
const saved = JSON.parse(fs.readFileSync(errorLogFile, 'utf8'));
check('L4 Fehlerprotokoll: nur Fehler, begrenzt auf 2, gespeichert, Zähler', saved.length === 2 && saved[1].text === 'fehler 3' && errors === 3, JSON.stringify(saved));
check('L5 logIfChanged: gleiche Nachricht je Schlüssel nur einmal', seen.filter(s => s === 'gleich').length === 1 && seen.includes('anders'));

// createAccess
const warnings = [];
const access = createAccess({ port: 3000, corsOrigins: '', defaultOrigins: ['null'], loopbackAddresses: ['127.0.0.1', '::1'], loopbackHostnames: ['localhost', '127.0.0.1', '[::1]'],
  logIfChanged: (k, m) => warnings.push(m) });
check('H1 Standard-Herkünfte und eigener Port erlaubt, fremde nicht, ohne Origin erlaubt', access.isAllowedOrigin('null') && access.isAllowedOrigin('http://localhost:3000')
  && !access.isAllowedOrigin('https://fremd.example') && access.isAllowedOrigin(undefined));
const req = (remoteAddress, host) => ({ socket: { remoteAddress }, headers: { host } });
check('H2 Lokal nur mit Loopback-Adresse und Loopback-Host (gegen DNS-Rebinding)', access.isLocalWidgetRequest(req('127.0.0.1', 'localhost:3000'), 'x')
  && access.isLocalWidgetRequest(req('::1', '[::1]:3000'), 'x') && !access.isLocalWidgetRequest(req('127.0.0.1', 'boese.example:3000'), 'x')
  && !access.isLocalWidgetRequest(req('192.0.2.7', 'localhost:3000'), 'x') && warnings.length === 2, warnings.join(' | '));
let status = null;
const res = { status(s) { status = s; return this; }, send() { return this; } };
check('H3 requireLocalRequest antwortet selbst mit 403', access.requireLocalRequest(req('192.0.2.7', 'localhost'), res, '/login') === false && status === 403);
const all = createAccess({ port: 3000, corsOrigins: '*', defaultOrigins: [], loopbackAddresses: [], loopbackHostnames: [], logIfChanged: () => {} });
check('H4 CORS_ORIGINS=*: jede Herkunft (Notschalter)', all.corsAllowAll && all.isAllowedOrigin('https://fremd.example'));
const listed = createAccess({ port: 4000, corsOrigins: 'http://a.example, http://b.example', defaultOrigins: ['null'], loopbackAddresses: [], loopbackHostnames: [], logIfChanged: () => {} });
check('H5 Eigene Liste ersetzt die Standard-Herkünfte', listed.isAllowedOrigin('http://b.example') && !listed.isAllowedOrigin('null') && listed.isAllowedOrigin('http://127.0.0.1:4000'));

// createAuth (Schritt 3a): ohne Tokens, Bot-Datei speichern, lesen, entfernen; ohne Server und ohne Netz
(async () => {
  const { createAuth } = require(path.join(root, 'core', 'auth'));
  const cfg = { ...require(path.join(root, 'core', 'config')), TOKEN_FILE: path.join(dir, 'tokens.json'), BOT_FILE: path.join(dir, 'bot.json'), PORT: 3999, TOKEN_CHECK_INTERVAL_MS: 60 * 60 * 1000 };
  const auth = createAuth({ config: cfg, http: { post: async () => { throw new Error('kein Netz im Test'); }, get: async () => { throw new Error('kein Netz im Test'); } },
    writeJson: writeJsonAtomic, logIfChanged: () => {}, access, onBroadcasterLogin: () => {}, onBotAuthorized: () => {}, botFeatureLabels: () => 'nichts' });
  let msg = '';
  try { await auth.getValidAccessToken(); } catch (err) { msg = err.message; }
  check('A1 Ohne tokens.json: keine Tokens, Hinweis auf /login mit Port', auth.loadTokens() === null && msg.includes('http://localhost:3999/login'), msg);
  auth.saveBotConfig({ bot_id: '99', bot_login: 'derbdu' });
  const bot = auth.loadBotConfig();
  auth.removeBotConfig();
  check('A2 Bot-Datei speichern, lesen, entfernen', bot && bot.bot_id === '99' && auth.loadBotConfig() === null);
  fs.writeFileSync(cfg.BOT_FILE, '{ kaputt');
  check('A3 Defekte Bot-Datei: kein Bot', auth.loadBotConfig() === null);
  check('A4 Twitch-Zugriff und Endpunkte angelegt', typeof auth.twitchApi.get === 'function' && typeof auth.routes === 'function');

  // createChat (Schritt 3b): Absender je Funktion, Bot mit Rückfall auf den Broadcaster, Kürzung, is_sent:false
  const { createChat } = require(path.join(root, 'core', 'chat'));
  const posts = []; let botFails = false; let botMsgs = 0;
  const fakeAuth = {
    loadTokens: () => ({ broadcaster_id: '1' }),
    getValidAccessToken: async () => 'tok',
    loadBotConfig: () => ({ bot_id: '99', bot_login: 'derbdu' }),
    twitchApi: { post: async (url, body, opts) => {
      posts.push({ sender: body.sender_id, message: body.message, app: opts.auth === 'app', reply: body.reply_parent_message_id || null });
      if (opts.auth === 'app' && botFails) throw Object.assign(new Error('x'), { response: { status: 403, data: { message: 'user is not a moderator' } } });
      return { data: { data: [{ is_sent: !body.message.startsWith('BLOCK') }] } };
    } },
  };
  const chatCfg = { ...cfg, CHAT_SENDERS_FILE: path.join(dir, 'chat_senders.json') };
  const chat = createChat({ config: chatCfg, features: { bdu: 'BdU-Chat', raid: 'Raid-Begrüßung' }, defaults: { bdu: 'bot' }, logPrefixes: { bdu: '[BdU] ' }, auth: fakeAuth, onBotMessageSent: () => { botMsgs += 1; } });
  check('C1 Vorgaben: bdu Bot, raid Broadcaster', chat.senderOf('bdu') === 'bot' && chat.senderOf('raid') === 'broadcaster' && chat.botFeatureLabels() === 'BdU-Chat');
  let ok = await chat.sendChatMessage('Hallo', 'm1', 'bdu', { broadcasterPrefix: 'FT vom BdU: ' });
  check('C2 Bot sendet ohne Präfix als Antwort, zählt', ok && posts.length === 1 && posts[0].sender === '99' && posts[0].app && posts[0].message === 'Hallo' && posts[0].reply === 'm1' && botMsgs === 1, JSON.stringify(posts));
  botFails = true; posts.length = 0;
  ok = await chat.sendChatMessage('Hallo', null, 'bdu', { broadcasterPrefix: 'FT vom BdU: ' });
  check('C3 Bot-Fehler: Rückfall auf den Broadcaster mit Präfix', ok && posts.length === 2 && posts[1].sender === '1' && posts[1].message === 'FT vom BdU: Hallo', JSON.stringify(posts));
  posts.length = 0;
  ok = await chat.sendChatMessage('x'.repeat(600), null, 'raid');
  check('C4 Broadcaster, gekürzt auf 500 Zeichen', ok && posts[0].sender === '1' && posts[0].message.length === 500 && posts[0].message.endsWith('…'));
  posts.length = 0;
  ok = await chat.sendChatMessage('BLOCK das', null, 'raid');
  check('C5 is_sent:false: kein Erfolg, kein zweiter Versuch', ok === false && posts.length === 1);
  const changed = chat.setChatSender('raid', 'bot', 'Test');
  const saved = JSON.parse(fs.readFileSync(chatCfg.CHAT_SENDERS_FILE, 'utf8'));
  check('C6 Absender umstellen wird gespeichert', changed && saved.raid === 'bot' && chat.setChatSender('raid', 'bot', 'Test') === false);

  // createState (Schritt 3c): Modul-Schalter, Kategorie, !privat-Liste, Stream live
  const { createState } = require(path.join(root, 'core', 'state'));
  const { createEvents } = require(path.join(root, 'core', 'events'));
  const stateCfg = { ...cfg, MODULES_FILE: path.join(dir, 'modules.json'), PRIVACY_FILE: path.join(dir, 'privacy_optouts.json') };
  fs.writeFileSync(stateCfg.MODULES_FILE, JSON.stringify({ b: false, fremd: false, a: 'kaputt' }));
  const bus = createEvents(); const switched = [];
  bus.on('module.switched', 'test', p => switched.push(p));
  let live = false;
  const stateLogs = []; const keepLog = console.log, keepWarn = console.warn;
  console.log = console.warn = (...a) => stateLogs.push(a.join(' '));
  const st = createState({ config: stateCfg, modules: { a: 'Modul A', b: 'Modul B' }, offTexts: { b: 'B ruht' }, events: bus, writeJson: writeJsonAtomic, isLive: () => live });
  const loaded = st.moduleSwitches();
  const ch1 = st.switchModule('b', true);
  const ch2 = st.switchModule('b', true);
  st.switchModule('a', false);
  console.log = keepLog; console.warn = keepWarn;
  const savedSwitches = JSON.parse(fs.readFileSync(stateCfg.MODULES_FILE, 'utf8'));
  check('Z1 Schalter laden: Reihenfolge der Module, ungültige Werte und fremde Einträge ignoriert', JSON.stringify(loaded) === '{"a":true,"b":false}', JSON.stringify(loaded));
  check('Z2 Umschalten: speichert, Logzeilen wie bisher, meldet module.switched auch ohne Änderung', ch1 === true && ch2 === false && JSON.stringify(savedSwitches) === '{"a":false,"b":true}'
    && stateLogs.includes('Modul B aktiviert (gespeichert, gilt auch nach Neustart)') && stateLogs.includes('Modul B ist bereits aktiviert')
    && stateLogs.includes('Modul A deaktiviert – Befehle im Chat werden ignoriert (gespeichert, gilt auch nach Neustart)')
    && JSON.stringify(switched) === '[{"key":"b","on":true,"changed":true},{"key":"b","on":true,"changed":false},{"key":"a","on":false,"changed":true}]', JSON.stringify({ stateLogs, switched }));
  check('Z3 Zustandstext und Abfrage', st.stateLabel('b') === 'aktiviert' && st.stateLabel('a') === 'deaktiviert ("a activate" schaltet ein)' && st.isEnabled('a') === false && st.isEnabled('b') === true);
  const before = st.categoryConfirmedAt();
  const c1 = st.setCategory('UBOAT'); const changedAt = st.categoryChangedAt();
  while (new Date().toISOString() === changedAt) await new Promise(r => setImmediate(r));   // bis die Uhr weiter ist
  const c2 = st.setCategory('UBOAT');
  check('Z4 Kategorie: Änderung gemeldet, Bestätigung ohne Änderung erneuert nur den Bestätigungszeitpunkt', before === null && c1 === true && c2 === false && st.category() === 'UBOAT'
    && st.categoryChangedAt() === changedAt && st.categoryConfirmedAt() > changedAt);
  st.setPrivate(42, true, Date.UTC(2026, 10, 28)); st.setPrivate('7', true); st.setPrivate('7', false);
  st.savePrivacyOptouts();
  const savedPrivacy = JSON.parse(fs.readFileSync(stateCfg.PRIVACY_FILE, 'utf8'));
  check('Z5 !privat: setzen, entfernen, speichern, Abfrage mit Zahl oder Text', st.isPrivateUser(42) && st.isPrivateUser('42') && !st.isPrivateUser('7')
    && JSON.stringify(st.privateUserIds()) === '["42"]' && savedPrivacy['42'] === '2026-11-28T00:00:00.000Z' && Object.keys(savedPrivacy).length === 1, JSON.stringify(savedPrivacy));
  fs.writeFileSync(stateCfg.PRIVACY_FILE, '{ kaputt'); fs.rmSync(stateCfg.MODULES_FILE);
  const warns = []; console.warn = m => warns.push(m);
  const st2 = createState({ config: stateCfg, modules: { a: 'Modul A' }, events: bus, writeJson: writeJsonAtomic, isLive: () => live });
  console.warn = keepWarn;
  live = true;
  check('Z6 Defekte !privat-Datei: niemand privat, Warnung; fehlende modules.json: alle an; Stream live aus der Quelle', st2.privateUserIds().length === 0
    && warns.some(w => w.includes('ist unlesbar – niemand gilt als privat')) && st2.isEnabled('a') === true && st2.isLive() === true && st.isLive() === true, JSON.stringify(warns));

  for (const x of results) realLog(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}`);
  process.chdir(os.tmpdir());
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* egal */ }
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
