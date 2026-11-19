// lib/chat-bridge.js: Anmeldung, Erkennen passender Nachrichten, Filter (Spec chat-bruecke.md, Teil A). Reiner Modultest.
const path = require('path');
const { parseSubscription, matches, isForwardable, chatEvent, firstWord } = require(path.join(__dirname, '..', 'lib', 'chat-bridge'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

let s = parseSubscription({ client: 'rimworld', prefixes: '!,$' });
check('C1 Präfixe angemeldet', !s.error && s.client === 'rimworld' && JSON.stringify(s.prefixes) === '["!","$"]' && s.commands.length === 0, JSON.stringify(s));
check('C2 $beer und $beer 5 passen, hallo nicht', matches(s, '$beer') && matches(s, '  $beer 5') && !matches(s, 'hallo') && !matches(s, ''));
s = parseSubscription({ client: 'coinflip', commands: 'flip,!FLIP,flip' });
check('C3 Befehle klein und ohne Doppel', JSON.stringify(s.commands) === '["flip","!flip"]', JSON.stringify(s));
check('C4 Erstes Wort, ohne Groß-/Kleinschreibung', matches(s, 'FLIP') && matches(s, '!flip jetzt') && !matches(s, 'flipper') && !matches(s, 'ich flip'));
check('C5 Ohne client, ungültiger client, ohne Befehle und Präfixe: Fehler',
  parseSubscription({ prefixes: '!' }).error && parseSubscription({ client: 'Rim World', prefixes: '!' }).error && parseSubscription({ client: 'x' }).error);
check('C6 Zu viele oder zu lange Einträge: Fehler',
  parseSubscription({ client: 'x', prefixes: '!,$,#,%,&,?' }).error && parseSubscription({ client: 'x', prefixes: '!!!!' }).error
  && parseSubscription({ client: 'x', commands: Array.from({ length: 101 }, (_, i) => `c${i}`).join(',') }).error && parseSubscription({ client: 'x', commands: 'a'.repeat(33) }).error);

const evt = (over = {}) => ({ broadcaster_user_id: '1', chatter_user_id: '7', chatter_user_login: 'kalle', chatter_user_name: 'Kalle', message_id: 'm1', message: { text: '$beer' }, badges: [], ...over });
const opts = { excludedLogins: ['nightbot', 'derbdu'], serverCommands: ['!bdu', '!soldbuch', '!privat', '!raidstats'] };
check('F1 Normale Nachricht geht weiter', isForwardable(evt(), opts));
check('F2 Bot und Nightbot nicht', !isForwardable(evt({ chatter_user_login: 'DerBdu' }), opts) && !isForwardable(evt({ chatter_user_login: 'nightbot' }), opts));
check('F3 Fremder geteilter Chat nicht, eigener schon', !isForwardable(evt({ source_broadcaster_user_id: '99' }), opts) && isForwardable(evt({ source_broadcaster_user_id: '1' }), opts));
check('F4 Eigene Befehle des Servers nicht', ['!BdU Lage?', '!soldbuch', '!privat', '!raidstats'].every(t => !isForwardable(evt({ message: { text: t } }), opts)) && isForwardable(evt({ message: { text: '!bal' } }), opts));
check('F5 Broadcaster geht weiter', isForwardable(evt({ chatter_user_id: '1', chatter_user_login: 'fritz', badges: [{ set_id: 'broadcaster' }] }), opts));
check('F6 Ohne Text: nicht', !isForwardable({ broadcaster_user_id: '1' }, opts));

const e = chatEvent(evt({ badges: [{ set_id: 'moderator' }, { set_id: 'founder' }] }), { isPrivate: id => id === '7', now: () => Date.parse('2026-11-20T20:00:00Z') });
check('E1 Felder des Ereignisses', e.messageId === 'm1' && e.userId === '7' && e.userLogin === 'kalle' && e.userName === 'Kalle' && e.text === '$beer' && e.at === '2026-11-20T20:00:00.000Z', JSON.stringify(e));
check('E2 Abzeichen (founder zählt als Subscriber), private', JSON.stringify(e.badges) === '{"broadcaster":false,"moderator":true,"vip":false,"subscriber":true}' && e.private === true, JSON.stringify(e));
check('E3 erstes Wort', firstWord('  !Bal  5') === '!bal' && firstWord('') === '');

// Teil B: aktive Chatter
const { createActiveChatters } = require(path.join(__dirname, '..', 'lib', 'chat-bridge'));
let clock = Date.parse('2026-11-20T20:00:00Z');
const active = createActiveChatters({ windowMs: 60 * 60000, max: 3, now: () => clock });
check('A1 Ohne Nachricht: leer, updatedAt null', JSON.stringify(active.snapshot()) === '{"updatedAt":null,"windowMinutes":60,"chatters":[]}');
active.note(evt({ chatter_user_id: '1', chatter_user_login: 'anna', chatter_user_name: 'Anna', badges: [{ set_id: 'vip' }] }));
clock += 60000;
active.note(evt({ chatter_user_id: '2', chatter_user_login: 'bert', chatter_user_name: 'Bert', badges: [{ set_id: 'moderator' }, { set_id: 'subscriber' }] }));
let snap = active.snapshot();
check('A2 Zwei Chatter, zuletzt aktiv zuerst, mit Abzeichen und Zeitpunkt', snap.chatters.map(c => c.login).join() === 'bert,anna' && snap.chatters[0].moderator && snap.chatters[0].subscriber && snap.chatters[1].vip
  && snap.chatters[1].lastChatAt === '2026-11-20T20:00:00.000Z' && snap.updatedAt === '2026-11-20T20:01:00.000Z', JSON.stringify(snap));
clock += 60000;
active.note(evt({ chatter_user_id: '1', chatter_user_login: 'anna', chatter_user_name: 'Anna', badges: [] }));
snap = active.snapshot();
check('A3 Erneute Nachricht: nach vorn, Abzeichen der letzten Nachricht', snap.chatters.map(c => c.login).join() === 'anna,bert' && snap.chatters[0].vip === false);
clock += 60 * 60000 - 30000;
check('A4 Nach 61 min Stille fällt bert heraus, anna bleibt', active.snapshot().chatters.map(c => c.login).join() === 'anna', JSON.stringify(active.snapshot().chatters));
['3', '4', '5'].forEach(id => active.note(evt({ chatter_user_id: id, chatter_user_login: `z${id}` })));
check('A5 Obergrenze: der am längsten stille fällt heraus', active.snapshot().chatters.map(c => c.login).join() === 'z5,z4,z3');
active.remove('4');
check('A6 Entfernen (!privat)', active.snapshot().chatters.map(c => c.login).join() === 'z5,z3');

for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
