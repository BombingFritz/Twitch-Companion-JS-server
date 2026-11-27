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

  for (const x of results) realLog(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}`);
  process.chdir(os.tmpdir());
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* egal */ }
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
