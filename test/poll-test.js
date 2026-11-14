// lib/poll-state.js: Stand der Abstimmung aus EventSub und Helix (Spec wetten-abstimmungen.md, Schritt 2).
// Reiner Modultest mit künstlicher Uhr und künstlichen Timern, ohne Server und Netzwerk.
const path = require('path');
const { createPollTracker } = require(path.join(__dirname, '..', 'lib', 'poll-state'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

// Beispiel nach Twitch-Doku „Get Polls“
const helixActive = {
  id: 'h1', broadcaster_id: '1', title: 'Welche Ostfront?', status: 'ACTIVE', duration: 300,
  started_at: '2026-11-14T20:00:00Z', ended_at: null,
  bits_voting_enabled: false, bits_per_vote: 0, channel_points_voting_enabled: true, channel_points_per_vote: 100,
  choices: [{ id: 'a', title: 'Nord', votes: 4, channel_points_votes: 1, bits_votes: 0 }, { id: 'b', title: 'Süd', votes: 2, channel_points_votes: 0, bits_votes: 0 }],
};
const helixDone = { ...helixActive, id: 'h0', status: 'COMPLETED', ended_at: '2026-11-14T19:05:00Z', started_at: '2026-11-14T19:00:00Z' };

// EventSub nach der Referenz (begin oft nur mit id und title je Auswahl)
const base = { id: 'e1', broadcaster_user_id: '1', title: 'Längster Spargel?', started_at: '2026-11-14T21:00:00Z',
  bits_voting: { is_enabled: false, amount_per_vote: 0 }, channel_points_voting: { is_enabled: true, amount_per_vote: 50 } };
const choices = (x, y) => [{ id: 'x', title: 'Weiß', votes: x, channel_points_votes: 0, bits_votes: 0 }, { id: 'y', title: 'Grün', votes: y, channel_points_votes: 1, bits_votes: 0 }];
const begin = { ...base, choices: [{ id: 'x', title: 'Weiß' }, { id: 'y', title: 'Grün' }], ends_at: '2026-11-14T21:02:00Z' };
const progress = { ...base, choices: choices(3, 1), ends_at: '2026-11-14T21:02:00Z' };
const end = { ...base, choices: choices(5, 2), status: 'completed', ended_at: '2026-11-14T21:02:00Z' };

function fakeTimers() {
  const pending = new Map(); let next = 1;
  return {
    setTimer: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimer: id => pending.delete(id),
    list: () => [...pending.values()],
    fire: async () => { const all = [...pending.values()]; pending.clear(); for (const t of all) t.fn(); await new Promise(r => setImmediate(r)); },
  };
}

(async () => {
  let helix = [helixDone]; let fetches = 0; let fail = false; const errors = [];
  const clock = Date.parse('2026-11-14T21:00:01Z');
  const timers = fakeTimers();
  const t = createPollTracker({
    fetchLatest: async () => { fetches += 1; if (fail) throw new Error('Twitch nicht erreichbar'); return helix[0] || null; },
    recheckMs: 300000, now: () => clock, onError: e => errors.push(e.message),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });

  check('A1 Ohne Stand: WAITING', JSON.stringify(t.snapshot()) === '{"status":"WAITING"}');
  await t.refresh();
  let p = t.snapshot();
  check('A2 Beendete Abstimmung aus Helix: Felder, keine Kontrolle', p.pollId === 'h0' && p.status === 'COMPLETED' && p.endedAt === '2026-11-14T19:05:00Z' && timers.list().length === 0, JSON.stringify(p));
  helix = [helixActive]; await t.refresh();
  p = t.snapshot();
  check('A3 Laufende Abstimmung aus Helix: endsAt = started_at + duration', p.status === 'ACTIVE' && p.endsAt === '2026-11-14T20:05:00.000Z' && p.duration === 300, JSON.stringify(p));
  check('A4 Auswahl: votes, channelPointsVotes, bitsVotes', JSON.stringify(p.choices[0]) === '{"id":"a","title":"Nord","votes":4,"channelPointsVotes":1,"bitsVotes":0}', JSON.stringify(p.choices[0]));
  check('A5 Abstimmung per Kanalpunkte und Bits', JSON.stringify(p.channelPointsVoting) === '{"isEnabled":true,"amountPerVote":100}' && JSON.stringify(p.bitsVoting) === '{"isEnabled":false,"amountPerVote":0}');
  check('A6 Laufend: Kontrolle geplant, updatedAt gesetzt', timers.list().length === 1 && timers.list()[0].ms === 300000 && p.updatedAt === '2026-11-14T21:00:01.000Z');

  fetches = 0;
  t.handleEvent('channel.poll.begin', begin);
  p = t.snapshot();
  check('E1 begin: ACTIVE, Auswahl mit 0 Stimmen, endsAt, duration aus ends_at − started_at', p.pollId === 'e1' && p.status === 'ACTIVE' && p.choices.length === 2 && p.choices[0].votes === 0
    && p.endsAt === '2026-11-14T21:02:00Z' && p.duration === 120 && p.startedAt === '2026-11-14T21:00:00Z', JSON.stringify(p));
  check('E2 Kanalpunkte aus channel_points_voting', p.channelPointsVoting.isEnabled === true && p.channelPointsVoting.amountPerVote === 50);
  t.handleEvent('channel.poll.progress', progress);
  check('E3 progress: Stimmen', t.snapshot().choices[0].votes === 3 && t.snapshot().choices[1].channelPointsVotes === 1);
  t.handleEvent('channel.poll.begin', begin);
  check('E4 Verspätetes begin: Stimmen bleiben', t.snapshot().choices[0].votes === 3);
  check('E5 Ereignisse fragen Twitch nicht', fetches === 0);

  t.handleEvent('channel.poll.end', end);
  p = t.snapshot();
  check('E6 end completed: COMPLETED, endedAt, endsAt bleibt, Endstand', p.status === 'COMPLETED' && p.endedAt === '2026-11-14T21:02:00Z' && p.endsAt === '2026-11-14T21:02:00Z' && p.duration === 120 && p.choices[0].votes === 5, JSON.stringify(p));
  check('E7 Nach dem Ende keine Kontrolle', timers.list().length === 0);
  t.handleEvent('channel.poll.progress', progress);
  check('E8 Verspätetes progress nach end: bleibt COMPLETED', t.snapshot().status === 'COMPLETED' && t.snapshot().choices[0].votes === 5);
  t.handleEvent('channel.poll.end', { ...end, status: 'archived' });
  check('E9 archived nach completed wird übernommen', t.snapshot().status === 'ARCHIVED');
  t.handleEvent('channel.poll.end', { ...end, status: 'completed' });
  check('E10 completed nach archived ändert nichts', t.snapshot().status === 'ARCHIVED');

  t.handleEvent('channel.poll.begin', { ...begin, id: 'e2' });
  t.handleEvent('channel.poll.end', { ...end, id: 'e2', status: 'terminated' });
  check('E11 Neue Abstimmung ersetzt den Stand, terminated', t.snapshot().pollId === 'e2' && t.snapshot().status === 'TERMINATED');
  check('E12 Unbekannter Typ, unbekannter Endstatus, Ereignis ohne ID: ignoriert',
    t.handleEvent('channel.poll.foo', begin) === false && t.handleEvent('channel.poll.end', { ...end, id: 'e3', status: 'xyz' }) === false && t.handleEvent('channel.poll.begin', {}) === false && t.snapshot().pollId === 'e2');

  // Kontrolle: laufende Abstimmung ohne Ereignis, Ende verloren
  t.handleEvent('channel.poll.begin', { ...begin, id: 'e4' });
  helix = [{ ...helixActive, id: 'e4' }];
  fail = true; await timers.fire(); fail = false;
  check('K1 Kontrolle scheitert: Stand bleibt ACTIVE, Fehler gemeldet, neue Kontrolle', t.snapshot().status === 'ACTIVE' && errors.length === 1 && timers.list().length === 1);
  helix = [{ ...helixActive, id: 'e4', status: 'COMPLETED', ended_at: '2026-11-14T21:10:00Z' }];
  await timers.fire();
  check('K2 Verlorenes end: Kontrolle übernimmt COMPLETED, keine weitere Kontrolle', t.snapshot().status === 'COMPLETED' && timers.list().length === 0);
  helix = []; await t.refresh();
  check('K3 Twitch kennt keine Abstimmung: WAITING', JSON.stringify(t.snapshot()) === '{"status":"WAITING"}');
  t.stop();

  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
})();
