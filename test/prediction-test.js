// lib/prediction-state.js: Stand der Wette aus EventSub und Helix (Spec wetten-abstimmungen.md, Schritt 1; früher Issue #38).
// Reiner Modultest mit künstlicher Uhr und künstlichen Timern, ohne Server und Netzwerk.
const path = require('path');
const { createPredictionTracker } = require(path.join(__dirname, '..', 'lib', 'prediction-state'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

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

// EventSub-Ereignisse nach der Referenz (Farben klein, channel_points_won bei progress/lock null)
const base = { id: 'e1', broadcaster_user_id: '1', title: 'Taucht er rechtzeitig?', started_at: '2026-11-14T20:00:00Z' };
const outcomes = (won = null, users = [0, 0], points = [0, 0]) => [
  { id: 'x', title: 'Ja', color: 'blue', users: users[0], channel_points: points[0],
    top_predictors: users[0] ? [{ user_id: '11', user_login: 'kalle', user_name: 'Kalle', channel_points_used: points[0], channel_points_won: won }] : null },
  { id: 'y', title: 'Nein', color: 'pink', users: users[1], channel_points: points[1], top_predictors: null },
];
const begin = { ...base, outcomes: outcomes().map(({ id, title, color }) => ({ id, title, color })), locks_at: '2026-11-14T20:02:00Z' };
const progress = { ...base, outcomes: outcomes(null, [3, 1], [3000, 1000]), locks_at: '2026-11-14T20:02:00Z' };
const lock = { ...base, outcomes: outcomes(null, [3, 1], [3000, 1000]), locked_at: '2026-11-14T20:02:00Z' };
const end = { ...base, outcomes: outcomes(4000, [3, 1], [3000, 1000]), status: 'resolved', winning_outcome_id: 'x', ended_at: '2026-11-14T20:30:00Z' };

// Künstliche Timer: merken Wartezeit und Rückruf, laufen nur auf fire()
function fakeTimers() {
  const pending = new Map(); let next = 1;
  return {
    setTimer: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimer: id => pending.delete(id),
    list: () => [...pending.values()],
    fire: async () => { const all = [...pending.entries()]; pending.clear(); for (const [, t] of all) t.fn(); await new Promise(r => setImmediate(r)); },
  };
}

(async () => {
  let helix = [resolved]; let fetches = 0; let fail = false; const errors = [];
  let clock = Date.parse('2026-11-14T20:00:05Z');
  const timers = fakeTimers();
  const t = createPredictionTracker({
    fetchLatest: async () => { fetches += 1; if (fail) throw new Error('Twitch nicht erreichbar'); return helix[0] || null; },
    recheckMs: 300000, now: () => clock, onError: e => errors.push(e.message),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });

  // Helix-Abbildung (wie bisher am Endpunkt, Issue #38)
  check('P1 Ohne Stand: WAITING', JSON.stringify(t.snapshot()) === '{"status":"WAITING"}', JSON.stringify(t.snapshot()));
  await t.refresh();
  let a = t.snapshot();
  check('P2 Aufgelöst: bisherige Felder', a.predictionId === 'p1' && a.title && a.status === 'RESOLVED' && a.createdAt === '2026-11-10T20:00:00Z' && a.outcomes.length === 2, JSON.stringify(a));
  check('P3 locksAt = created_at + prediction_window', a.locksAt === '2026-11-10T20:02:00.000Z');
  check('P4 lockedAt, endedAt, endsAt, predictionWindow, winningOutcomeId', a.lockedAt === '2026-11-10T20:02:00Z' && a.endedAt === '2026-11-10T20:10:00Z' && a.endsAt === a.endedAt && a.predictionWindow === 120 && a.winningOutcomeId === 'o2');
  check('P5 Ausgänge: channelPoints, color, topPredictors mit userId', a.outcomes[0].channelPoints === 15000 && a.outcomes[1].color === 'PINK'
    && JSON.stringify(a.outcomes[1].topPredictors) === '[{"userId":"9","userName":"Wombat","userLogin":"wombat","channelPointsUsed":400,"channelPointsWon":15400}]', JSON.stringify(a.outcomes[1]));
  check('P6 updatedAt = Zeitpunkt der Übernahme', a.updatedAt === '2026-11-14T20:00:05.000Z', a.updatedAt);
  check('P7 Beendete Wette: keine Kontrolle geplant', timers.list().length === 0);

  helix = [active]; await t.refresh();
  a = t.snapshot();
  check('P8 Laufende Wette aus Helix: top_predictors null -> [], Sieger null', a.status === 'ACTIVE' && a.winningOutcomeId === null && a.lockedAt === null && a.endsAt === null && a.outcomes[0].topPredictors.length === 0);
  check('P9 Offene Wette: Kontrolle nach 5 min geplant', timers.list().length === 1 && timers.list()[0].ms === 300000, JSON.stringify(timers.list()));

  // EventSub-Ablauf
  fetches = 0;
  t.handleEvent('channel.prediction.begin', begin);
  a = t.snapshot();
  check('E1 begin: ACTIVE, Ausgänge, locksAt, predictionWindow aus locks_at − started_at', a.predictionId === 'e1' && a.status === 'ACTIVE' && a.outcomes.length === 2
    && a.locksAt === '2026-11-14T20:02:00Z' && a.predictionWindow === 120 && a.createdAt === '2026-11-14T20:00:00Z', JSON.stringify(a));
  check('E2 Farben in Großbuchstaben wie bei Helix', a.outcomes[0].color === 'BLUE' && a.outcomes[1].color === 'PINK');
  clock += 1000;
  t.handleEvent('channel.prediction.progress', progress);
  a = t.snapshot();
  check('E3 progress: users, channelPoints, Top-Tipper (won null -> 0)', a.outcomes[0].users === 3 && a.outcomes[0].channelPoints === 3000 && a.outcomes[0].topPredictors[0].channelPointsWon === 0 && a.outcomes[0].topPredictors[0].userId === '11', JSON.stringify(a.outcomes[0]));
  check('E4 updatedAt folgt dem Ereignis', a.updatedAt === '2026-11-14T20:00:06.000Z', a.updatedAt);
  t.handleEvent('channel.prediction.begin', begin);
  check('E5 Verspätetes begin derselben Wette ändert nichts', t.snapshot().outcomes[0].users === 3);
  check('E6 Ereignisse fragen Twitch nicht', fetches === 0, String(fetches));
  check('E7 Kontrolle nach jedem Ereignis neu angesetzt (eine geplant)', timers.list().length === 1);

  t.handleEvent('channel.prediction.lock', lock);
  a = t.snapshot();
  check('E8 lock: LOCKED, lockedAt, locksAt und predictionWindow bleiben', a.status === 'LOCKED' && a.lockedAt === '2026-11-14T20:02:00Z' && a.locksAt === '2026-11-14T20:02:00Z' && a.predictionWindow === 120, JSON.stringify(a));
  t.handleEvent('channel.prediction.progress', { ...progress, outcomes: outcomes(null, [9, 9], [9, 9]) });
  check('E9 Verspätetes progress nach lock: Status und Zahlen bleiben', t.snapshot().status === 'LOCKED' && t.snapshot().outcomes[0].users === 3);

  // Lange Sperre ohne Ereignis: Kontrolle fragt Twitch, Twitch kennt die Wette noch gesperrt
  helix = [{ ...active, id: 'e1', status: 'LOCKED', locked_at: '2026-11-14T20:02:00Z' }];
  await timers.fire();
  check('K1 Kontrolle nach 5 min ohne Ereignis: eine Anfrage, Stand LOCKED', fetches === 1 && t.snapshot().status === 'LOCKED', `${fetches} ${t.snapshot().status}`);
  check('K2 Weiter offen: nächste Kontrolle geplant', timers.list().length === 1);
  fail = true; await timers.fire(); fail = false;
  check('K3 Twitch nicht erreichbar: letzter Stand bleibt, Fehler gemeldet, Kontrolle bleibt', t.snapshot().status === 'LOCKED' && errors.length === 1 && timers.list().length === 1, JSON.stringify(errors));
  // Verlorenes end: Kontrolle übernimmt das Ende
  helix = [{ ...resolved, id: 'e1' }];
  await timers.fire();
  check('K4 Verlorenes end: Kontrolle übernimmt RESOLVED, keine weitere Kontrolle', t.snapshot().status === 'RESOLVED' && timers.list().length === 0, t.snapshot().status);

  // end per Ereignis, danach verspätete Zustände
  t.handleEvent('channel.prediction.begin', { ...begin, id: 'e2' });
  t.handleEvent('channel.prediction.end', { ...end, id: 'e2' });
  a = t.snapshot();
  check('E10 end resolved: RESOLVED, Sieger, endedAt, echte channelPointsWon', a.status === 'RESOLVED' && a.winningOutcomeId === 'x' && a.endedAt === '2026-11-14T20:30:00Z' && a.endsAt === a.endedAt
    && a.outcomes[0].topPredictors[0].channelPointsWon === 4000, JSON.stringify(a));
  check('E11 Nach end keine Kontrolle mehr', timers.list().length === 0);
  t.handleEvent('channel.prediction.lock', { ...lock, id: 'e2' });
  check('E12 Verspätetes lock nach end: bleibt RESOLVED', t.snapshot().status === 'RESOLVED');
  helix = [{ ...active, id: 'e2', status: 'LOCKED' }]; await t.refresh();
  check('E13 Helix hinkt hinterher (noch LOCKED): bleibt RESOLVED', t.snapshot().status === 'RESOLVED');
  t.handleEvent('channel.prediction.begin', { ...begin, id: 'e3' });
  t.handleEvent('channel.prediction.end', { ...end, id: 'e3', status: 'canceled', winning_outcome_id: null });
  check('E14 end canceled: CANCELED ohne Sieger', t.snapshot().status === 'CANCELED' && t.snapshot().winningOutcomeId === null);
  check('E15 Unbekannter Typ oder Ereignis ohne ID: ignoriert', t.handleEvent('channel.prediction.foo', begin) === false && t.handleEvent('channel.prediction.begin', {}) === false && t.snapshot().predictionId === 'e3');

  helix = []; await t.refresh();
  check('P10 Twitch kennt keine Wette: WAITING unverändert', JSON.stringify(t.snapshot()) === '{"status":"WAITING"}');
  t.stop();

  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
