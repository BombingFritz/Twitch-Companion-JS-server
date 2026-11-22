// lib/stream-kartei.js und lib/github-publisher.js (ADR 0026, Spec stream-kartei.md): Format, Hash, Takt, GitHub-Zweig.
// Reiner Modultest mit künstlicher Uhr und GitHub-Attrappe, keine Anfrage ins Netz.
const path = require('path');
const kartei = require(path.join(__dirname, '..', 'lib', 'stream-kartei'));
const { createGithubPublisher, parseExpiration } = require(path.join(__dirname, '..', 'lib', 'github-publisher'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

(async () => {
  // ── Format ──
  const member = (name, type, extra = {}) => ({ name, type, typeLabel: ['Matrose', 'Offizier', 'Kommandant'][type], characterClass: type ? 'Leader' : null, classLabel: type ? 'Befehlshaber' : null,
    level: 1, experiencePoints: 10, experiencePointsFromLastPatrol: 2, born: '1915-01-01', decorations: 0, died: null, traits: ['Seewolf'], skills: [], status: 1, statusLabel: 'an Bord', wounded: false, woundLabel: null, ...extra });
  const state = { source: 'Geheim.save', savedAt: Date.parse('2026-11-21T10:00:00Z'), gameVersion: '2026.1 Patch 21', crew: [
    member('Zander', 0), member('Alpaka', 1), member('Kapitän', 2), member('Berta', 0, { status: 0, statusLabel: 'in Reserve' }),
    member('Gustav', 1, { died: '1941-03-12', status: 2, statusLabel: 'gefallen' }), member('Privatmann', 0) ] };
  const data = kartei.buildUboatCrew(state, { isHidden: m => m.name === 'Privatmann' });
  check('F1 Crew sortiert: Kommandant, Offiziere, Matrosen, je nach Name', data.crew.map(m => m.name).join() === 'Kapitän,Alpaka,Berta,Zander', data.crew.map(m => m.name).join());
  check('F2 Gefallene in fallen, nicht in crew, mit Todesdatum', data.fallen.length === 1 && data.fallen[0].name === 'Gustav' && data.fallen[0].died === '1941-03-12' && !data.crew.some(m => m.name === 'Gustav'));
  check('F3 !privat-Figur fehlt überall', !JSON.stringify(data).includes('Privatmann'));
  check('F4 Kopf: Version, Spiel, Spielstand als ISO, Spielversion; kein publishedAt vor dem Veröffentlichen',
    data.schemaVersion === 1 && data.game === 'uboat' && data.savedAt === '2026-11-21T10:00:00.000Z' && data.gameVersion === '2026.1 Patch 21' && !('publishedAt' in data));
  const json = JSON.stringify(data);
  check('F5 Kein Dateiname, keine internen Schlüssel', !json.includes('Geheim.save') && !/"type"|"characterClass"|"status"|"wounded"/.test(json), json.slice(0, 300));
  check('F6 Felder je Person wie in der Spec (mit Akte, Stufe 1b)', JSON.stringify(Object.keys(data.crew[0])) === '["name","typeLabel","classLabel","level","experiencePoints","experiencePointsFromLastPatrol","born","decorations","statusLabel","woundLabel","traits","skills","background","decorationNames","accomplishments"]'
    && JSON.stringify(Object.keys(data.fallen[0])) === '["name","typeLabel","classLabel","level","born","died","decorations","traits","skills","background","decorationNames","accomplishments"]'
    && JSON.stringify(Object.keys(data)) === '["schemaVersion","game","savedAt","gameVersion","crew","fallen","boat","career","plaques","sinkings"]', Object.keys(data));

  const files = kartei.uboatFiles(data, '2026-11-21T10:05:00.000Z');
  const crewFile = JSON.parse(files['uboat/crew.json']), indexFile = JSON.parse(files['index.json']);
  check('F7 Dateien: crew.json mit publishedAt, index.json mit Spiel und Pfad', crewFile.publishedAt === '2026-11-21T10:05:00.000Z' && indexFile.games[0].path === 'uboat/crew.json'
    && indexFile.games[0].savedAt === data.savedAt && indexFile.games[0].title === 'UBOAT' && indexFile.schemaVersion === 1);
  check('F8 Hash ohne publishedAt: Datei und Daten gleich, Änderung ändert ihn', kartei.contentHash(crewFile) === kartei.contentHash(data)
    && kartei.contentHash(kartei.buildUboatCrew({ ...state, gameVersion: 'x' })) !== kartei.contentHash(data));

  // ── Takt ──
  let clock = 0; const timers = [];
  const fakeTimer = { setTimer: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; }, clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } };
  const advance = async ms => { clock += ms; for (const t of timers.filter(x => x.at <= clock)) { fakeTimer.clearTimer(t); t.fn(); } await new Promise(r => setImmediate(r)); };
  let content = { v: 1 }, published = [], failNext = null, skip = null, enabled = true;
  const logs = [];
  const sch = kartei.createKarteiScheduler({ minGapMs: 600000, now: () => clock, ...fakeTimer, isEnabled: () => enabled,
    build: async () => (skip ? { skip } : { data: { ...content } }),
    publish: async d => { if (failNext) { const e = failNext; failNext = null; throw e; } published.push(d); },
    readRemoteHash: async () => kartei.contentHash({ v: 1 }),
    log: (level, msg) => logs.push(msg) });
  await sch.request();
  check('T1 Start: veröffentlichter Stand gleich, nichts hochgeladen', published.length === 0 && !sch.snapshot().pending);
  content = { v: 2 };
  await sch.request();
  check('T2 Änderung: sofort veröffentlicht', published.length === 1 && published[0].v === 2 && sch.snapshot().lastPublishedAt);
  content = { v: 3 };
  await sch.request();
  check('T3 Zweite Änderung binnen 10 min: wartet', published.length === 1 && sch.snapshot().pending && timers.length === 1);
  content = { v: 4 };
  await sch.request();
  await advance(600000);
  check('T4 Nach Ablauf: nur der neueste Stand', published.length === 2 && published[1].v === 4, JSON.stringify(published));
  await sch.request();
  check('T5 Unveränderter Inhalt: nichts', published.length === 2);
  content = { v: 5 };
  await sch.request({ urgent: true });
  check('T6 Dringend (!privat): ohne Abstand', published.length === 3 && published[2].v === 5);
  await advance(600000);
  content = { v: 6 }; failNext = Object.assign(new Error('Netz weg'), {});
  await sch.request();
  check('T7 Netzfehler: Fehler gemerkt, neuer Versuch geplant', published.length === 3 && /Netz weg/.test(sch.snapshot().lastError) && timers.length === 1);
  await advance(600000);
  check('T8 Neuer Versuch klappt, Fehler gelöscht', published.length === 4 && published[3].v === 6 && sch.snapshot().lastError === null);
  await advance(600000);
  content = { v: 7 }; skip = 'Namen der !privat-Zuschauer nicht ermittelbar';
  await sch.request({ urgent: true });
  check('T9 Sicher im Zweifel: ausgelassen mit Grund, nichts hochgeladen', published.length === 4 && sch.snapshot().lastSkip === skip && logs.some(l => l.includes(skip)));
  skip = null;
  await advance(600000);
  check('T10 Danach automatisch nachgeholt', published.length === 5 && published[4].v === 7);
  await advance(600000);
  content = { v: 8 }; failNext = Object.assign(new Error('x'), { response: { status: 401, data: { message: 'Bad credentials' } } });
  await sch.request();
  content = { v: 9 };
  await sch.request();
  await advance(600000);
  check('T11 Token abgelehnt: gesperrt bis zum Neustart', published.length === 5 && sch.snapshot().authFailed && /401/.test(sch.snapshot().lastError));
  const sch2 = kartei.createKarteiScheduler({ minGapMs: 1000, now: () => clock, ...fakeTimer, isEnabled: () => enabled, build: async () => ({ data: { v: 1 } }), publish: async d => published.push(d), log: () => {} });
  enabled = false;
  const before = published.length;
  await sch2.request();
  check('T12 Modul aus: nichts', published.length === before && !sch2.snapshot().pending);

  // ── GitHub-Zweig ──
  check('G1 Ablaufdatum des Tokens aus dem Header', parseExpiration('2027-11-21 10:00:00 UTC') === '2027-11-21T10:00:00.000Z'
    && parseExpiration('2027-11-21 10:00:00 +0100') === '2027-11-21T09:00:00.000Z' && parseExpiration('Unsinn') === null);
  const calls = [];
  let refSha = null; const commits = {}, trees = {};
  const notFound = () => Object.assign(new Error('404'), { response: { status: 404, data: { message: 'Not Found' } } });
  const gh = {
    get: async (url, cfg) => {
      calls.push(['GET', url, cfg]);
      if (url.endsWith('/git/ref/heads/data')) { if (!refSha) throw notFound(); return { data: { object: { sha: refSha } }, headers: { 'github-authentication-token-expiration': '2027-01-01 00:00:00 UTC' } }; }
      if (url.includes('/git/commits/')) return { data: { tree: { sha: commits[url.split('/').pop()].tree } } };
      if (url.includes('/contents/')) { if (!refSha) throw notFound(); return { data: { content: Buffer.from('{"a":1}').toString('base64') } }; }
      throw notFound();
    },
    post: async (url, body, cfg) => {
      calls.push(['POST', url, body, cfg]);
      if (url.endsWith('/git/trees')) { const sha = `t${Object.keys(trees).length + 1}`; trees[sha] = body; return { data: { sha } }; }
      if (url.endsWith('/git/commits')) { const sha = `c${Object.keys(commits).length + 1}`; commits[sha] = body; return { data: { sha } }; }
      if (url.endsWith('/git/refs')) { refSha = body.sha; return { data: {} }; }
      throw notFound();
    },
    patch: async (url, body, cfg) => { calls.push(['PATCH', url, body, cfg]); refSha = body.sha; return { data: {} }; },
  };
  const pub = createGithubPublisher({ http: gh, repo: 'BombingFritz/StreamKartei', token: 'github_pat_TESTTOKEN' });
  check('G2 Datei im fehlenden Zweig: null', await pub.readFile('uboat/crew.json') === null);
  let r = await pub.publish({ 'index.json': '{}', 'uboat/crew.json': '{"x":1}' }, 'erste');
  const firstTree = trees.t1, firstCommit = commits.c1;
  check('G3 Erster Lauf: Zweig angelegt, Commit ohne Vorgänger, Baum ohne base_tree',
    r.created && refSha === 'c1' && JSON.stringify(firstCommit.parents) === '[]' && !('base_tree' in firstTree) && firstTree.tree.map(t => t.path).join() === 'index.json,uboat/crew.json'
    && calls.some(c => c[0] === 'POST' && c[1].endsWith('/git/refs') && c[2].ref === 'refs/heads/data'), JSON.stringify(calls.map(c => c.slice(0, 2))));
  r = await pub.publish({ 'uboat/crew.json': '{"x":2}' }, 'zweite');
  const patch = calls.find(c => c[0] === 'PATCH');
  check('G4 Folgelauf: base_tree des bisherigen Commits, wieder ohne Vorgänger, Zweig mit force ersetzt',
    !r.created && trees.t2.base_tree === 't1' && JSON.stringify(commits.c2.parents) === '[]' && patch && patch[2].sha === 'c2' && patch[2].force === true && refSha === 'c2');
  check('G5 Token als Bearer, API-Version, allgemeiner User-Agent; Ablaufdatum gemerkt',
    calls.every(c => { const cfg = c[c.length - 1]; return cfg.headers.Authorization === 'Bearer github_pat_TESTTOKEN' && cfg.headers['X-GitHub-Api-Version'] && cfg.headers['User-Agent'] === 'twitch-companion-js-server'; })
    && pub.tokenExpiresAt() === '2027-01-01T00:00:00.000Z');
  check('G6 Datei lesen aus dem Zweig', await pub.readFile('uboat/crew.json') === '{"a":1}' && calls.some(c => c[1].endsWith('/contents/uboat/crew.json?ref=data')));
  check('G7 Nur Repository StreamKartei angesprochen', calls.every(c => c[1].startsWith('https://api.github.com/repos/BombingFritz/StreamKartei/')));

  for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}`);
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
