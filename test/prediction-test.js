// /api/twitch/prediction/current gibt die Helix-Felder richtig weiter (Issue #38). Attrappen, eigenes Arbeitsverzeichnis.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 38900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'));
fs.writeFileSync(path.join(dir, '.env'), `CLIENT_ID=x\nCLIENT_SECRET=x\nREDIRECT_URI=x\nPORT=${PORT}\nSCOPES=x\n`);
fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({ access_token: 'a', refresh_token: 'r', broadcaster_id: '1', broadcaster_name: 't', obtained_at: Date.now(), expires_in: 9999, expires_at: Date.now() + 9999000 }));
process.chdir(dir);
class WS extends EventEmitter { constructor() { super(); this.readyState = 1; } close() {} } WS.OPEN = 1;

// Beispiel nach Twitch-Doku „Get Predictions“ (aufgelöste Wette, Außenseiter gewinnt)
const resolved = {
  id: 'p1', broadcaster_id: '1', title: 'Versenkt Fritz den Tanker?', winning_outcome_id: 'o2',
  outcomes: [
    { id: 'o1', title: 'Ja', users: 10, channel_points: 15000, color: 'BLUE', top_predictors: [] },
    { id: 'o2', title: 'Nein', users: 2, channel_points: 500, color: 'PINK',
      top_predictors: [{ user_id: '9', user_name: 'Wombat', user_login: 'wombat', channel_points_used: 400, channel_points_won: 15400 }] }
  ],
  prediction_window: 120, status: 'RESOLVED',
  created_at: '2026-11-10T20:00:00Z', ended_at: '2026-11-10T20:10:00Z', locked_at: '2026-11-10T20:02:00Z'
};
const active = {
  id: 'p2', title: 'Aal trifft?', winning_outcome_id: null,
  outcomes: [{ id: 'a', title: 'Ja', users: 0, channel_points: 0, color: 'BLUE', top_predictors: null },
             { id: 'b', title: 'Nein', users: 0, channel_points: 0, color: 'PINK', top_predictors: null }],
  prediction_window: 60, status: 'ACTIVE', created_at: '2026-11-10T21:00:00Z', ended_at: null, locked_at: null
};
let current = [resolved];
const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'ws') return WS;
  if (r === 'axios') return { post: async () => ({ data: {} }), get: async (url) => url.includes('/helix/predictions') ? { data: { data: current } } : { data: { data: [] } } };
  if (r === 'readline') return { createInterface: () => new EventEmitter() };
  return orig.call(this, r, ...a);
};
const real = console.log; console.log = console.error = console.warn = () => {};
require(serverPath);
const get = () => new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: '/api/twitch/prediction/current' }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }));
setTimeout(async () => {
  const a = await get(); current = [active]; const b = await get(); current = []; const c = await get();
  const res = [
    ['Aufgelöst: bisherige Felder bleiben', a.predictionId === 'p1' && a.title && a.status === 'RESOLVED' && a.createdAt === '2026-11-10T20:00:00Z' && a.outcomes.length === 2],
    ['locksAt = created_at + prediction_window', a.locksAt === '2026-11-10T20:02:00.000Z' && b.locksAt === '2026-11-10T21:01:00.000Z'],
    ['lockedAt, endedAt, predictionWindow, winningOutcomeId', a.lockedAt === '2026-11-10T20:02:00Z' && a.endedAt === '2026-11-10T20:10:00Z' && a.predictionWindow === 120 && a.winningOutcomeId === 'o2'],
    ['endsAt (bisheriger Name) = endedAt', a.endsAt === '2026-11-10T20:10:00Z' && b.endsAt === null],
    ['channelPoints je Ausgang aus channel_points', a.outcomes[0].channelPoints === 15000 && a.outcomes[1].channelPoints === 500],
    ['color und topPredictors je Ausgang', a.outcomes[0].color === 'BLUE' && a.outcomes[1].color === 'PINK' && a.outcomes[1].topPredictors.length === 1
      && a.outcomes[1].topPredictors[0].userName === 'Wombat' && a.outcomes[1].topPredictors[0].channelPointsUsed === 400 && a.outcomes[1].topPredictors[0].channelPointsWon === 15400],
    ['Laufende Wette: Sieger und Sperre null, top_predictors null -> []', b.winningOutcomeId === null && b.lockedAt === null && b.endedAt === null && Array.isArray(b.outcomes[0].topPredictors) && b.outcomes[0].topPredictors.length === 0],
    ['Keine Wette: WAITING unverändert', c.status === 'WAITING' && Object.keys(c).length === 1],
  ];
  for (const [n, ok] of res) real(`${ok ? 'OK  ' : 'FAIL'} ${n}`);
  process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); process.exit(res.every(x => x[1]) ? 0 : 1);
}, 500);
