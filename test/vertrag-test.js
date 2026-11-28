// Vertragsschnappschuss (ADR 0027, Nachtrag, Abschnitt 1): hält fest, was der Server nach außen zeigt, und vergleicht es mit
// dem Ausgangsstand des Umbaus (5e44516, Datei test/vertrag/5e44516.json). Abweichungen sind nur erlaubt, wenn sie unten in
// ERLAUBT mit dem PR stehen, der sie eingeführt hat; eine erlaubte Abweichung, die nicht mehr auftritt, ist ebenfalls ein Fehler.
// Festgehalten werden: Ausgabe von "help", Routen (Methode, Pfad, Reihenfolge), EventSub-Abos (Typ, Version, Bedingung),
// Felder von /api/admin/overview (nur Namen und Typen), Home-Assistant-Payloads je Effekttyp (Felder), Startlog (Zahlen normalisiert).
// Attrappen: ws, axios, readline; express wird nur umhüllt, um die App zu sehen. Eigenes Arbeitsverzeichnis.
// Aufruf: node test/vertrag-test.js <server.js>                     vergleichen
//         node test/vertrag-test.js <server.js> aufnehmen <datei>   Schnappschuss schreiben (z. B. auf einem alten Stand)
'use strict';
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');

const serverPath = path.resolve(process.argv[2]);
const mode = process.argv[3] || 'vergleichen';
const outFile = process.argv[4] && path.resolve(process.argv[4]);   // vor dem Wechsel ins Arbeitsverzeichnis
const BASELINE = path.join(__dirname, 'vertrag', '5e44516.json');

// Bewusste Abweichungen gegenüber 5e44516, je mit dem PR, der sie eingeführt hat
const ERLAUBT = {
  'overview: neues Feld unhandled_errors': 'PR #113, unbehandelte asynchrone Fehler (Spec Webkonsole)',
};

const PORT = 40600 + Math.floor(Math.random() * 250);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vertrag-'));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=GEHEIM-ATTRAPPE\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\nHA_WEBHOOK_URL=http://ha-attrappe.invalid/hook\n`);
fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: 'TOKEN-ATTRAPPE', refresh_token: 'REFRESH-ATTRAPPE', broadcaster_id: '4711', broadcaster_name: 'testkanal',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() {} terminate() {} }
FakeWS.OPEN = 1;
const subscriptions = [];
const haPosts = [];
let streamRequests = 0;
const fakeAxios = {
  post: async (url, body) => {
    if (url.includes('eventsub/subscriptions')) subscriptions.push({ type: body.type, version: String(body.version), condition: body.condition });
    if (url.includes('ha-attrappe.invalid')) haPosts.push(body);
    return { data: { data: [] } };
  },
  get: async url => {
    if (url.includes('helix/streams')) streamRequests += 1;
    return { data: { data: [] } };
  },
  patch: async () => ({ data: { data: [] } }),
  delete: async () => ({ data: {} }),
};
const apps = [];
const orig = Module._load;
const rl = new EventEmitter();
Module._load = function (request, ...rest) {
  if (request === 'ws') return FakeWS;
  if (request === 'axios') return fakeAxios;
  if (request === 'readline') return { createInterface: () => rl };
  if (request === 'express') {
    const real = orig.call(this, request, ...rest);
    const wrapped = function (...a) { const app = real(...a); apps.push(app); return app; };
    return Object.assign(wrapped, real);
  }
  return orig.call(this, request, ...rest);
};
const realLog = console.log, logs = [];
console.log = console.info = console.warn = console.error = (...a) => logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (cond, ms) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await sleep(25); return cond(); };
const request = (p, headers = {}, method = 'GET', body) => new Promise((res, rej) => {
  http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, r => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res({ status: r.statusCode, body: d }));
  }).on('error', rej).end(body);
});
let msgId = 0;
const notify = (subType, event) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'notification', subscription_type: subType, message_id: `v${++msgId}` }, payload: { event } }));

// Zahlen, Ports, Pfade und IDs ändern sich je Lauf; die Form der Zeile bleibt
function normalize(line) {
  return line.split(workDir).join('<arbeitsordner>')
    .replace(/Session: \S+/g, 'Session: <id>')
    .replace(/\/\/ tip: .*$/, '// tip: <wechselnder Hinweis von dotenv>')
    .replace(/\d+/g, '#');
}

// Feldnamen und Typen, ohne Werte; Listen mit der Form ihres ersten Eintrags
function shape(value) {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, shape(value[k])]));
  return value === null ? 'null' : typeof value;
}

function routesOf(app) {
  const stack = (app.router && app.router.stack) || (app._router && app._router.stack) || [];
  return stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods).filter(m => l.route.methods[m]).map(m => m.toUpperCase()).sort().join(',')} ${l.route.path}`);
}

async function record() {
  await waitFor(() => logs.some(l => l.includes('Server läuft auf')) && sockets.length > 0, 10000);
  const before = streamRequests;
  sockets[0].emit('message', JSON.stringify({ metadata: { message_type: 'session_welcome', message_id: 'w' }, payload: { session: { id: 'sitzung', keepalive_timeout_seconds: 3600 } } }));
  await waitFor(() => streamRequests > before, 20000);
  await sleep(200);
  const startlog = logs.map(normalize);

  const helpStart = logs.length;
  rl.emit('line', 'help');
  await sleep(50);
  const help = logs.slice(helpStart);

  const routes = apps.flatMap(routesOf);
  const overview = shape(JSON.parse((await request('/api/admin/overview')).body));

  // Effekte: je Typ einer; die Warteschlange hält Abstände ein (EFFECT_MIN_GAP_MS)
  notify('channel.follow', { user_id: '501', user_login: 'folger', user_name: 'Folger', broadcaster_user_id: '4711' });
  notify('channel.chat.notification', { notice_type: 'sub', chatter_user_id: '502', chatter_user_login: 'abonnent', chatter_user_name: 'Abonnent', broadcaster_user_id: '4711', sub: { sub_tier: '1000', is_gift: false, duration_months: 1 } });
  notify('channel.chat.notification', { notice_type: 'community_sub_gift', chatter_user_id: '503', chatter_user_login: 'schenker', chatter_user_name: 'Schenker', broadcaster_user_id: '4711', community_sub_gift: { id: 'g1', total: 3, sub_tier: '1000' } });
  // erstes next blendet nur ein, das zweite aktiviert das erste Thema (Effekt topic_active)
  await request('/api/topics/next', { 'Content-Type': 'application/json' }, 'POST', '{}');
  await request('/api/topics/next', { 'Content-Type': 'application/json' }, 'POST', '{}');
  await waitFor(() => haPosts.length >= 4, 40000);
  const ha = haPosts.map(p => ({ type: p.type, fields: Object.keys(p).sort(), meta: Object.keys(p.meta || {}).sort(), count: typeof p.count, timestamp: typeof p.timestamp }))
    .sort((a, b) => a.type.localeCompare(b.type));

  return { help, routes, subscriptions, overview, ha, startlog };
}

// Unterschiede als lesbare Einträge, je Abschnitt
function differences(base, now) {
  const out = [];
  const list = (name, a, b) => {
    const missing = a.filter(x => !b.includes(x)); const added = b.filter(x => !a.includes(x));
    for (const x of missing) out.push(`${name}: fehlt ${x}`);
    for (const x of added) out.push(`${name}: neu ${x}`);
    if (!missing.length && !added.length && JSON.stringify(a) !== JSON.stringify(b)) out.push(`${name}: andere Reihenfolge`);
  };
  list('help', base.help, now.help);
  list('routes', base.routes, now.routes);
  list('subscriptions', base.subscriptions.map(s => JSON.stringify(s)), now.subscriptions.map(s => JSON.stringify(s)));
  list('ha', base.ha.map(s => JSON.stringify(s)), now.ha.map(s => JSON.stringify(s)));
  list('startlog', base.startlog, now.startlog);
  const walk = (prefix, a, b) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (!(k in (b || {}))) out.push(`overview: Feld fehlt ${p}`);
      else if (!(k in (a || {}))) out.push(`overview: neues Feld ${p}`);
      else if (typeof a[k] === 'object' && typeof b[k] === 'object' && !Array.isArray(a[k])) walk(p, a[k], b[k]);
      else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`overview: anderer Typ ${p} (${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])})`);
    }
  };
  walk('', base.overview, now.overview);
  return out;
}

(async () => {
  let snap;
  try { snap = await record(); } catch (err) { realLog(`FAIL Aufnahme: ${err.stack || err.message}`); process.exit(1); }
  console.log = realLog;
  const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
  check('V1 Aufnahme vollständig: Hilfe, Routen, Abos, Übersicht, vier Home-Assistant-Payloads', snap.help.length > 10 && snap.routes.length > 20 && snap.subscriptions.length > 10
    && Object.keys(snap.overview).length > 10 && snap.ha.length >= 4, JSON.stringify({ help: snap.help.length, routes: snap.routes.length, subs: snap.subscriptions.length, ha: snap.ha.length }));
  if (mode === 'aufnehmen') {
    fs.writeFileSync(outFile, JSON.stringify(snap, null, 2));
    realLog(`Schnappschuss geschrieben: ${outFile}`);
  } else {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const diffs = differences(base, snap);
    const unexpected = diffs.filter(d => !ERLAUBT[d]);
    const stale = Object.keys(ERLAUBT).filter(d => !diffs.includes(d));
    check('V2 Keine unerwartete Abweichung gegenüber 5e44516 (Hilfe, Routen, Abos, Übersicht, Home Assistant, Startlog)', unexpected.length === 0, unexpected.slice(0, 15).join(' | '));
    check('V3 Jede erlaubte Abweichung tritt auch auf (Liste ERLAUBT ist aktuell)', stale.length === 0, stale.join(' | '));
  }
  for (const r of results) realLog(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
  process.chdir(os.tmpdir());
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* egal */ }
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
