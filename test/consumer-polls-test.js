// lib/consumer-polls.js: Abstimmung im Auftrag eines Verbrauchers prüfen, Fehler einordnen, Ergebnis (Spec chat-bruecke.md, Teil C, #81). Reiner Modultest.
const path = require('path');
const { validateStart, helixBody, classifyCreateError, resultEvent, createPollRequests } = require(path.join(__dirname, '..', 'lib', 'consumer-polls'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const ok = (over = {}) => ({ client: 'rimworld', title: '  Was kommt als Nächstes?  ', choices: [' Raid ', 'Händler', 'Sonnenfinsternis'], durationS: 120, ...over });

let s = validateStart(ok());
check('V1 Gültige Anfrage: getrimmt, ohne Kanalpunkte', !s.error && s.title === 'Was kommt als Nächstes?' && JSON.stringify(s.choices) === '["Raid","Händler","Sonnenfinsternis"]' && s.durationS === 120 && s.channelPointsPerVote === null, JSON.stringify(s));
check('V2 Mit channelPointsPerVote 3000', validateStart(ok({ channelPointsPerVote: 3000 })).channelPointsPerVote === 3000);
const bad = {
  'ohne client': ok({ client: undefined }), 'client mit Leerzeichen': ok({ client: 'Rim World' }),
  'Titel leer': ok({ title: '   ' }), 'Titel 61 Zeichen': ok({ title: 'x'.repeat(61) }),
  'eine Option': ok({ choices: ['a'] }), 'sechs Optionen': ok({ choices: ['a', 'b', 'c', 'd', 'e', 'f'] }),
  'Option 26 Zeichen': ok({ choices: ['a', 'y'.repeat(26)] }), 'Option leer': ok({ choices: ['a', ' '] }), 'Option keine Zeichenkette': ok({ choices: ['a', 5] }),
  'Dauer 14': ok({ durationS: 14 }), 'Dauer 1801': ok({ durationS: 1801 }), 'Dauer Text': ok({ durationS: '60' }), 'Dauer Bruch': ok({ durationS: 60.5 }),
  'Kanalpunkte 0': ok({ channelPointsPerVote: 0 }), 'Kanalpunkte zu hoch': ok({ channelPointsPerVote: 1000001 }),
};
const notRejected = Object.entries(bad).filter(([, b]) => !validateStart(b).error).map(([k]) => k);
check('V3 Ungültige Werte werden abgelehnt, nicht gekürzt', notRejected.length === 0, notRejected.join(', '));
check('V4 Grenzwerte gehen: 60/25 Zeichen, 2 und 5 Optionen, 15 und 1800 s, Emoji zählt als ein Zeichen',
  !validateStart(ok({ title: 'x'.repeat(60), choices: ['y'.repeat(25), 'b'], durationS: 15 })).error
  && !validateStart(ok({ choices: ['a', 'b', 'c', 'd', 'e'], durationS: 1800 })).error
  && !validateStart(ok({ choices: ['🐻'.repeat(25), 'b'] })).error);

let b = helixBody('4711', validateStart(ok()));
check('H1 Helix-Body ohne Kanalpunkte', JSON.stringify(b) === '{"broadcaster_id":"4711","title":"Was kommt als Nächstes?","choices":[{"title":"Raid"},{"title":"Händler"},{"title":"Sonnenfinsternis"}],"duration":120}', JSON.stringify(b));
b = helixBody('4711', validateStart(ok({ channelPointsPerVote: 3000 })));
check('H2 Helix-Body mit Kanalpunkten', b.channel_points_voting_enabled === true && b.channel_points_per_vote === 3000);

const twitchErr = (status, message) => Object.assign(new Error('x'), { response: { status, data: { message } } });
const c = [
  classifyCreateError(twitchErr(400, "The broadcaster already has a poll that's running; you may not create another poll until the current poll completes.")),
  classifyCreateError(twitchErr(401, 'Missing scope: channel:manage:polls')),
  classifyCreateError(twitchErr(403, 'The broadcaster is not a partner or affiliate.')),
  classifyCreateError(twitchErr(400, "The choice's title failed AutoMod checks.")),
  classifyCreateError(twitchErr(401, 'Invalid OAuth token')),
  classifyCreateError(new Error('socket hang up')),
];
check('K1 Twitch-Fehler eingeordnet', c.map(x => `${x.status}:${x.reason}`).join(' ') === '409:poll_active 403:missing_scope 403:not_eligible 502:twitch_rejected 502:twitch_error 502:twitch_error', c.map(x => `${x.status}:${x.reason}`).join(' '));
check('K2 Grund von Twitch bleibt im Fehlertext', c[3].error.includes('AutoMod') && c[5].error.includes('socket hang up'));

const snap = (status, votes) => ({ pollId: 'p1', title: 'Frage', status, startedAt: '2026-11-20T20:00:00Z', endedAt: '2026-11-20T20:02:00Z',
  choices: votes.map((v, i) => ({ id: `c${i}`, title: `Option ${i}`, votes: v, channelPointsVotes: i === 0 ? 1 : 0, bitsVotes: 0 })) });
let r = resultEvent(snap('COMPLETED', [5, 3, 1]), { now: () => Date.parse('2026-11-20T20:02:01Z') });
check('E1 Ergebnis: Stimmen je Option, Summe, ein Gewinner', r.pollId === 'p1' && r.status === 'COMPLETED' && r.totalVotes === 9 && JSON.stringify(r.winners) === '[{"id":"c0","title":"Option 0","votes":5}]'
  && r.choices[0].channelPointsVotes === 1 && !('bitsVotes' in r.choices[0]) && r.at === '2026-11-20T20:02:01.000Z' && r.endedAt === '2026-11-20T20:02:00Z', JSON.stringify(r));
r = resultEvent(snap('COMPLETED', [4, 4, 1]));
check('E2 Gleichstand: alle Gleichplatzierten', r.winners.map(w => w.id).join() === 'c0,c1');
r = resultEvent(snap('TERMINATED', [0, 0]));
check('E3 Abgebrochen ohne Stimmen: Status bleibt, alle Optionen gleichauf', r.status === 'TERMINATED' && r.totalVotes === 0 && r.winners.length === 2);

let clock = 0;
const reqs = createPollRequests({ maxAgeMs: 1000, max: 2, now: () => clock });
reqs.add('p1', 'rimworld');
check('A1 Offen: kein Ergebnis', reqs.takeFinal({ pollId: 'p1', status: 'ACTIVE' }) === null);
check('A2 Fremde Abstimmung: kein Verbraucher', reqs.takeFinal({ pollId: 'fremd', status: 'COMPLETED' }) === null);
check('A3 Endstand: Verbraucher genau einmal', reqs.takeFinal({ pollId: 'p1', status: 'COMPLETED' }) === 'rimworld' && reqs.takeFinal({ pollId: 'p1', status: 'ARCHIVED' }) === null);
reqs.add('p2', 'a'); clock = 2000; reqs.add('p3', 'b');
check('A4 Alte Aufträge fallen heraus', reqs.takeFinal({ pollId: 'p2', status: 'COMPLETED' }) === null && reqs.takeFinal({ pollId: 'p3', status: 'TERMINATED' }) === 'b');
reqs.add('x1', 'a'); reqs.add('x2', 'a'); reqs.add('x3', 'a');
check('A5 Obergrenze: der älteste fällt heraus', reqs.size() === 2 && reqs.takeFinal({ pollId: 'x1', status: 'COMPLETED' }) === null);

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
