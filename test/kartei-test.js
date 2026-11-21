// Stream-Kartei (ADR 0026, Spec stream-kartei.md) im Server: erzeugter UBOAT-Spielstand, Attrappe der GitHub-API und von Twitch.
// Prüft Veröffentlichung in den Zweig data, !privat (sofort ausblenden, Verknüpfen gesperrt), Takt, Webkonsole, keine Secrets.
// Attrappen: ws, axios, readline. Eigenes Arbeitsverzeichnis. Aufruf: node kartei-test.js <server.js> <szenario: an | ohne>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const fx = require('./uboat-fixture');
const [serverPath, scenario] = [path.resolve(process.argv[2]), process.argv[3] || 'an'];
const PORT = 39500 + Math.floor(Math.random() * 300);
const TOKEN = 'github_pat_ATTRAPPE_0123456789abcdefghij';
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kartei-'));
const savesDir = path.join(workDir, 'UBOAT', 'Saves');
fs.mkdirSync(savesDir, { recursive: true });
fs.mkdirSync(path.join(workDir, 'UBOAT', 'Data Sheets'));
fs.writeFileSync(path.join(workDir, 'UBOAT', 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
fs.writeFileSync(path.join(savesDir, 'Geheimer Spielstand.save'), fx.buildSave({ crew: fx.DEFAULT_CREW }));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\nUBOAT_SAVES_DIR=${savesDir}\n`
  + (scenario === 'an' ? `STREAM_KARTEI_REPO=BombingFritz/StreamKartei\nSTREAM_KARTEI_TOKEN=${TOKEN}\n` : ''));
fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: 'fake', refresh_token: 'fake', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
// Zuschauer 555 hat schon !privat; laut Twitch heißt er kobold. zwergi ist Zwergwildsau zugeordnet.
fs.writeFileSync(path.join(workDir, 'privacy_optouts.json'), JSON.stringify({ 555: '2026-11-20T20:00:00.000Z' }));
fs.writeFileSync(path.join(workDir, 'uboat_crew_map.json'), JSON.stringify({ zwergi: 'Zwergwildsau' }));
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() { this.emit('close'); } terminate() { this.emit('close'); } }
FakeWS.OPEN = 1;
// Ablaufdatum des Tokens in 5 Tagen (Header wie bei GitHub), damit der Test von der Uhr unabhängig ist
const EXPIRES = new Date(Date.now() + 5 * 86400e3);
const EXPIRES_HEADER = `${EXPIRES.toISOString().slice(0, 10)} ${EXPIRES.toISOString().slice(11, 19)} UTC`;
const EXPIRES_DE = EXPIRES.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const USERS = { 555: { id: '555', login: 'kobold', display_name: 'Kobold' }, 777: { id: '777', login: 'neuling', display_name: 'Neuling' } };
// GitHub-Attrappe: Zweig, Commits, Bäume als Dateilisten
const github = { ref: null, commits: {}, trees: {}, calls: [], n: 0 };
const ghFiles = () => (github.ref ? github.trees[github.commits[github.ref].tree] : {});
const notFound = () => Object.assign(new Error('Request failed with status code 404'), { response: { status: 404, data: { message: 'Not Found' } } });
function fakeGithub(method, url, body, cfg) {
  github.calls.push({ method, url, body, auth: cfg && cfg.headers && cfg.headers.Authorization });
  const p = url.replace('https://api.github.com/repos/BombingFritz/StreamKartei', '');
  if (method === 'get' && p === '/git/ref/heads/data') { if (!github.ref) throw notFound(); return { data: { object: { sha: github.ref } }, headers: {} }; }
  if (method === 'get' && p.startsWith('/git/commits/')) return { data: { tree: { sha: github.commits[p.split('/').pop()].tree } }, headers: {} };
  if (method === 'get' && p.startsWith('/contents/')) { const f = ghFiles()[p.slice(10).split('?')[0]]; if (!f) throw notFound(); return { data: { content: Buffer.from(f).toString('base64') }, headers: {} }; }
  if (method === 'post' && p === '/git/trees') {
    const sha = `t${++github.n}`;
    github.trees[sha] = { ...(body.base_tree ? github.trees[body.base_tree] : {}), ...Object.fromEntries(body.tree.map(t => [t.path, t.content])) };
    return { data: { sha }, headers: {} };
  }
  if (method === 'post' && p === '/git/commits') { const sha = `c${++github.n}`; github.commits[sha] = { tree: body.tree, parents: body.parents, message: body.message }; return { data: { sha }, headers: {} }; }
  if (method === 'post' && p === '/git/refs') { github.ref = body.sha; return { data: {}, headers: {} }; }
  if (method === 'patch' && p === '/git/refs/heads/data') { if (!body.force) throw new Error('ohne force'); github.ref = body.sha; return { data: {}, headers: { 'github-authentication-token-expiration': EXPIRES_HEADER } }; }
  throw notFound();
}
let streamChecks = 0, helixUserCalls = 0;
const chatPosts = [];
const fakeAxios = {
  post: async (url, body, cfg) => {
    if (url.startsWith('https://api.github.com')) return fakeGithub('post', url, body, cfg);
    if (url.includes('/chat/messages')) chatPosts.push(body);
    return { data: { data: [] } };
  },
  patch: async (url, body, cfg) => fakeGithub('patch', url, body, cfg),
  get: async (url, cfg) => {
    if (url.startsWith('https://api.github.com')) return fakeGithub('get', url, null, cfg);
    if (url.includes('/helix/streams')) streamChecks += 1;
    if (url.includes('/helix/users')) {
      helixUserCalls += 1;
      const q = new URL(url).searchParams;
      const list = q.getAll('id').map(id => USERS[id]).concat(q.getAll('login').map(l => Object.values(USERS).find(u => u.login === l))).filter(Boolean);
      return { data: { data: list } };
    }
    return url.includes('/helix/channels') ? { data: { data: [{ game_name: 'UBOAT' }] } } : { data: { data: [] } };
  },
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (cond, timeoutMs, stepMs = 50) => { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (await cond()) return true; await sleep(stepMs); } return cond(); };
let n = 0;
const send = (message_type, subType, payload) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type, subscription_type: subType, message_id: `m${++n}` }, payload }));
const chat = (id, login, text) => send('notification', 'channel.chat.message', { event: {
  chatter_user_id: id, chatter_user_login: login, chatter_user_name: login, broadcaster_user_id: '1', message_id: `c${n + 1}`, message: { text }, badges: [] } });
const request = (p, { method = 'GET', body, headers = {} } = {}) => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Origin: `http://localhost:${PORT}`, ...headers } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
  });
  req.on('error', rej); req.end(body);
});
const overview = async () => JSON.parse((await request('/api/admin/overview')).body);
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const crewFile = () => { const f = ghFiles()['uboat/crew.json']; return f ? JSON.parse(f) : null; };
const commitCount = () => github.calls.filter(c => c.method === 'post' && c.url.endsWith('/git/commits')).length;

(async () => {
  await sleep(300);
  send('session_welcome', null, { session: { id: 's1', keepalive_timeout_seconds: 600 } });
  await waitFor(() => streamChecks > 0, 15000);
  await sleep(100);

  if (scenario === 'ohne') {
    const o = await overview();
    check('O1 Ohne Token: Modul nicht eingerichtet, keine Anfrage an GitHub', o.kartei.configured === false && github.calls.length === 0, JSON.stringify(o.kartei));
    const r = await request('/api/admin/kartei/publish', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    check('O2 „Jetzt veröffentlichen“ ohne Einrichtung: 409', r.status === 409, `${r.status} ${r.body}`);
    rl.emit('line', 'kartei show');
    await sleep(50);
    check('O3 kartei show nennt die fehlende Einrichtung', logs.some(l => l.startsWith('Stream-Kartei: nicht eingerichtet')));
  }

  if (scenario === 'an') {
    await waitFor(() => crewFile(), 10000);
    const crew = crewFile();
    const index = ghFiles()['index.json'] && JSON.parse(ghFiles()['index.json']);
    check('K1 Erster Spielstand: Zweig data mit index.json und uboat/crew.json angelegt', crew && index && index.games[0].path === 'uboat/crew.json' && github.calls.some(c => c.url.endsWith('/git/refs')),
      JSON.stringify(Object.keys(ghFiles())));
    check('K2 Crew sortiert mit Kommandant zuerst, Gefallene in der Ehrentafel', crew.crew[0].name === 'Fritz Unsinkbar' && crew.fallen.map(f => f.name).join() === 'Gefallener Gustav' && crew.fallen[0].died === '1941-03-12',
      JSON.stringify(crew.crew.map(m => m.name)));
    check('K3 !privat-Zuschauer (laut Twitch kobold) fehlt; Zuordnungen und Dateiname nicht in den Daten',
      !crew.crew.some(m => m.name === 'Kobold') && !JSON.stringify(crew).includes('zwergi') && !JSON.stringify(crew).includes('Geheimer') && crew.crew.some(m => m.name === 'Zwergwildsau'), JSON.stringify(crew.crew.map(m => m.name)));
    const firstCommit = github.commits[github.ref];
    check('K4 Commit ohne Vorgänger, Token nur im Kopf an GitHub', JSON.stringify(firstCommit.parents) === '[]' && github.calls.every(c => c.auth === `Bearer ${TOKEN}`));
    let o = await overview();
    check('K5 Übersicht: eingerichtet, veröffentlicht, Website-Adresse; kein Token', o.kartei.configured && o.kartei.repo === 'BombingFritz/StreamKartei' && o.kartei.last_published_at
      && o.kartei.site_url === 'https://bombingfritz.github.io/StreamKartei/' && !JSON.stringify(o).includes(TOKEN), JSON.stringify(o.kartei));
    check('K6 Startanzeige nennt Repository', logs.some(l => l.startsWith('Stream-Kartei: an (Repository BombingFritz/StreamKartei')));

    // !privat: sofort ausblenden, auch innerhalb der 10 min
    const before = commitCount();
    chat('u-alpaka', 'alpaka', '!privat');
    await waitFor(() => commitCount() > before, 5000);
    check('K7 !privat eingeschaltet: Figur sofort von der Website, ohne auf den Abstand zu warten', commitCount() === before + 1 && !crewFile().crew.some(m => m.name === 'Alpaka'),
      JSON.stringify(crewFile().crew.map(m => m.name)));
    check('K8 Weiterhin genau ein Commit im Zweig', JSON.stringify(github.commits[github.ref].parents) === '[]');

    // Neuer Spielstand binnen 10 min: wartet
    fs.writeFileSync(path.join(savesDir, 'Neuer.save'), fx.buildSave({ crew: fx.DEFAULT_CREW.filter(c => c.name !== 'Major Mac') }));
    rl.emit('line', 'uboat reload');
    await waitFor(async () => (await overview()).kartei.pending, 3000);
    o = await overview();
    check('K9 Neuer Spielstand binnen 10 min: wartet, nichts hochgeladen', o.kartei.pending === true && commitCount() === before + 1 && crewFile().crew.some(m => m.name === 'Major Mac'), JSON.stringify(o.kartei));

    // Verknüpfen gesperrt für !privat
    rl.emit('line', 'uboat map kobold Hans Peter');
    rl.emit('line', 'uboat map @neuling Hanspeter');
    await waitFor(() => logs.some(l => l.startsWith('[UBOAT] @neuling')), 3000);
    const map = JSON.parse(fs.readFileSync(path.join(workDir, 'uboat_crew_map.json'), 'utf8'));
    check('K10 uboat map für !privat-Zuschauer abgelehnt, für andere gespeichert', !('kobold' in map) && map.neuling === 'Hanspeter'
      && logs.some(l => l.includes('@kobold hat !privat eingeschaltet – keine Zuordnung gespeichert')), JSON.stringify(map));

    const r = await request('/api/admin/kartei/publish', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    check('K11 Webkonsole „Jetzt veröffentlichen“: angenommen, hält den Abstand', r.status === 200 && JSON.parse(r.body).ok === true && commitCount() === before + 1, r.body);
    const foreign = await request('/api/admin/kartei/publish', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: 'https://fremd.example' } });
    check('K12 Fremde Herkunft: abgelehnt', foreign.status === 403, String(foreign.status));
    rl.emit('line', 'kartei show');
    await sleep(50);
    check('K13 kartei show: Repository, Website, wartende Änderung, Ablaufdatum des Tokens', logs.some(l => l.includes('Repository BombingFritz/StreamKartei, Website https://bombingfritz.github.io/StreamKartei/'))
      && logs.some(l => l.includes('Änderung wartet')) && logs.some(l => l.startsWith(`Token läuft ab: ${EXPIRES_DE}`)));
    check('K14 Warnung vor Ablauf des Tokens (binnen 14 Tagen)', logs.some(l => l.includes(`[Kartei] Das GitHub-Token läuft am ${EXPIRES_DE} ab`)));
    check('K15 Token nie im Log', !logs.some(l => l.includes(TOKEN)));
    rl.emit('line', 'kartei deactivate');
    await sleep(50);
    o = await overview();
    check('K16 Ausschalten: gespeichert, Übersicht kennt es', o.modules.kartei === false && JSON.parse(fs.readFileSync(path.join(workDir, 'modules.json'), 'utf8')).kartei === false);
  }

  for (const x of results) process.stdout.write(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}\n`);
  if (results.some(x => !x.ok)) process.stdout.write(logs.filter(l => /Kartei|UBOAT|Privat/.test(l)).slice(-25).join('\n') + '\n');
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
