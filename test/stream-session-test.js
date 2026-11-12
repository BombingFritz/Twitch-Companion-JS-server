// lib/stream-session.js (ADR 0019, docs/specs/statistik.md): Stream-Ablauf mit künstlicher Uhr, ohne Server und ohne Dateien.
const path = require('path');
const { createStreamSession } = require(path.join(__dirname, '..', 'lib', 'stream-session.js'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const MIN = 60 * 1000, HOUR = 60 * MIN;
const START = Date.UTC(2026, 10, 9, 18, 0, 0);

function setup(options = {}, file = { data: null }) {
  const clock = options.clock || { t: START };
  const saves = [];
  const session = createStreamSession({
    keys: ['follows', 'chat'], now: () => clock.t,
    load: () => file.data && JSON.parse(JSON.stringify(file.data)),
    save: s => { file.data = JSON.parse(JSON.stringify(s)); saves.push(clock.t); },
    log: () => {}, graceMs: 2 * HOUR, saveIntervalMs: 30000, heartbeatMs: 5 * MIN, reconcileMinAgeMs: 5 * MIN, ...options,
  });
  return { session, clock, file, saves };
}
const snap = s => s.snapshot();

// Normaler Ablauf
let { session, clock, file, saves } = setup();
check('A1 Beginnt ohne Stream', snap(session).status === 'none');
session.count('follows');
check('A2 Ohne Stream wird nicht gezählt', !snap(session).counters.follows);
session.setCategory('UBOAT');
session.onOnline({ id: 's1', startedAt: new Date(START).toISOString() });
check('A3 stream.online startet und speichert sofort', snap(session).status === 'live' && snap(session).started_at === new Date(START).toISOString() && saves.length === 1 && !snap(session).late_start, JSON.stringify(snap(session)));
session.count('follows');
session.count('follows', 2);
session.count('unbekannt');
check('A4 Zählt nur bekannte Schlüssel', snap(session).counters.follows === 3 && !('unbekannt' in snap(session).counters), JSON.stringify(snap(session).counters));
check('A5 Zählen schreibt nicht sofort', saves.length === 1);
clock.t += 10000; session.tick();
check('A6 Vor Ablauf von 30 s kein Schreiben', saves.length === 1);
clock.t += 21000; session.tick();
check('A7 Nach 30 s wird geschrieben', saves.length === 2);
session.tick();
check('A8 Ohne Änderung kein weiteres Schreiben', saves.length === 2);
clock.t += 5 * MIN; session.tick();
check('A9 Lebenszeichen nach 5 Minuten, solange live', saves.length === 3 && file.data.last_saved_at === new Date(clock.t).toISOString());
session.onOnline({ id: 's1' });
check('A10 Wiederholtes stream.online ändert nichts', snap(session).counters.follows === 3 && snap(session).status === 'live');

// Kategorien
({ session, clock } = setup());
session.setCategory('UBOAT');
session.onOnline({ id: 's1' });
clock.t += 10 * MIN;
session.setCategory('Just Chatting');
clock.t += 5 * MIN;
let cats = snap(session).categories;
check('K1 Zeit je Kategorie', cats.length === 2 && cats[0].name === 'UBOAT' && cats[0].seconds === 600 && cats[1].seconds === 300, JSON.stringify(cats));
session.onOffline();
clock.t += 30 * MIN;
cats = snap(session).categories;
check('K2 Offline läuft keine Kategoriezeit', cats[1].seconds === 300, JSON.stringify(cats));

// Offline, Frist, Unterbrechung
({ session, clock, saves } = setup());
session.onOnline({ id: 's1', startedAt: new Date(START).toISOString() });
clock.t += HOUR;
session.onOffline();
let s = snap(session);
check('O1 Offline: Frist läuft, sofort gespeichert', s.status === 'offline' && s.closes_at === new Date(START + 3 * HOUR).toISOString() && saves.length === 2, JSON.stringify(s));
session.count('chat');
check('O2 In der Frist wird weitergezählt', snap(session).counters.chat === 1);
clock.t += 15 * MIN;
session.onOnline({ id: 's2' });
s = snap(session);
check('O3 Wiederkehr: derselbe Stream, Unterbrechung vermerkt', s.status === 'live' && s.interruptions === 1 && s.interruption_seconds === 900 && s.counters.chat === 1, JSON.stringify(s));
clock.t += HOUR;
s = snap(session);
check('O4 Dauer von der ersten Startzeit an, Abbruch zählt mit', s.duration_seconds === 2.25 * 3600, String(s.duration_seconds));
session.onOffline();
const offlineAt = clock.t;
clock.t += 2 * HOUR - 1000; session.tick();
check('O5 Knapp vor Ablauf noch offen', snap(session).status === 'offline');
clock.t += 1000; session.tick();
s = snap(session);
check('O6 Nach 2 Stunden abgeschlossen, Ende ist das letzte Offline', s.status === 'closed' && s.close_reason === 'frist' && s.ended_at === new Date(offlineAt).toISOString() && !s.aborted, JSON.stringify(s));
session.count('chat');
check('O7 Abgeschlossen: nichts wird mehr gezählt, Werte bleiben', snap(session).counters.chat === 1);
session.onOnline({ id: 's3' });
s = snap(session);
check('O8 Nächster Stream beginnt bei 0', s.status === 'live' && !s.counters.chat && s.interruptions === 0, JSON.stringify(s));

// Raid
({ session, clock } = setup());
session.onOnline({ id: 's1' });
clock.t += HOUR;
session.onRaidOut();
s = snap(session);
check('R1 Raid schließt sofort ab', s.status === 'closed' && s.close_reason === 'raid' && s.ended_at === new Date(clock.t).toISOString(), JSON.stringify(s));
session.onOffline();
check('R2 Offline danach ändert nichts', snap(session).status === 'closed');
session.onOnline({ id: 's1' });
session.reconcile({ id: 's1', startedAt: new Date(START).toISOString() });
check('R3 Derselbe Stream läuft nach dem Raid weiter: bleibt abgeschlossen', snap(session).status === 'closed');
session.onOnline({ id: 's2' });
check('R4 Neue Stream-ID ist ein neuer Stream', snap(session).status === 'live' && !snap(session).interruptions);
({ session, clock } = setup());
session.onOnline({ id: 's1' });
clock.t += HOUR;
session.onOffline();
const raidOffline = new Date(clock.t).toISOString();
clock.t += 10 * MIN;
session.onRaidOut();
check('R5 Raid nach Offline: Ende ist das Offline', snap(session).ended_at === raidOffline && snap(session).close_reason === 'raid');

// Abgleich und Neustart
const running = () => {
  const ctx = setup();
  ctx.session.setCategory('UBOAT');
  ctx.session.onOnline({ id: 's1', startedAt: new Date(START).toISOString() });
  ctx.session.count('follows');
  ctx.clock.t += HOUR;
  ctx.session.flush();
  return ctx;
};
let ctx = running();
let again = setup({ clock: ctx.clock }, ctx.file);
ctx.clock.t += 2 * MIN;
again.session.reconcile({ id: 's1', startedAt: new Date(START).toISOString() });
s = snap(again.session);
check('N1 Neustart im Stream: weiterzählen', s.status === 'live' && s.counters.follows === 1 && !s.aborted && !s.late_start, JSON.stringify(s));
ctx = running();
again = setup({ clock: ctx.clock }, ctx.file);
ctx.clock.t += 20 * MIN;
again.session.reconcile({ id: 's2', startedAt: new Date(ctx.clock.t).toISOString() });
s = snap(again.session);
check('N2 Absturz, binnen 2 Stunden andere Stream-ID: derselbe Stream', s.status === 'live' && s.counters.follows === 1, JSON.stringify(s));
ctx = running();
again = setup({ clock: ctx.clock }, ctx.file);
ctx.clock.t += 3 * HOUR;
again.session.reconcile({ id: 's2', startedAt: new Date(ctx.clock.t - MIN).toISOString() });
s = snap(again.session);
check('N3 Rückkehr nach mehr als 2 Stunden: neuer Stream, spät begonnen', s.status === 'live' && s.late_start && !s.counters.follows && again.file.data.stream_ids[0] === 's2', JSON.stringify(s));
ctx = running();
const lastSaved = ctx.file.data.last_saved_at;
again = setup({ clock: ctx.clock }, ctx.file);
ctx.clock.t += 30 * MIN;
again.session.reconcile(null);
s = snap(again.session);
check('N4 Server war beim Streamende aus: Frist ab dem letzten Speichern', s.status === 'offline' && s.offline_at === lastSaved && s.aborted, JSON.stringify(s));
ctx = running();
const saved = ctx.file.data.last_saved_at;
again = setup({ clock: ctx.clock }, ctx.file);
ctx.clock.t += 3 * HOUR;
again.session.reconcile(null);
s = snap(again.session);
check('N5 Frist schon vorbei: abgeschlossen, als abgebrochen markiert, Werte erhalten', s.status === 'closed' && s.aborted && s.ended_at === saved && s.counters.follows === 1, JSON.stringify(s));
ctx = running();
ctx.session.onOffline();
again = setup({ clock: ctx.clock }, ctx.file);
ctx.clock.t += 3 * HOUR;
again.session.onOnline({ id: 's2' });
s = snap(again.session);
check('N6 Frist während Serverpause abgelaufen: neues Live ist neuer Stream', s.status === 'live' && !s.counters.follows, JSON.stringify(s));
({ session, clock } = setup());
session.reconcile({ id: 's9', startedAt: new Date(START - 20 * MIN).toISOString() });
s = snap(session);
check('N7 Server kommt während des Streams dazu', s.status === 'live' && s.late_start && s.started_at === new Date(START - 20 * MIN).toISOString(), JSON.stringify(s));
ctx = running();
ctx.session.onOffline();
ctx.clock.t += MIN;
ctx.session.reconcile({ id: 's1', startedAt: new Date(START).toISOString() });
check('N8 Veraltete Antwort nach Offline: bekannte ID kehrt nicht zurück', snap(ctx.session).status === 'offline');
({ session, clock } = setup());
session.onOnline({ id: 's1' });
clock.t += MIN;
session.reconcile(null);
check('N9 Frisch gestartet: „nicht live“ wird ignoriert', snap(session).status === 'live');
({ session } = setup());
session.reconcile(null);
check('N10 Kein Stream und nicht live: bleibt so', snap(session).status === 'none');

// Chatter
({ session, clock } = setup({ maxChatters: 3, topChatters: 2 }));
session.noteChatter('a', 'Anna');
check('C1 Ohne Stream keine Chatter', snap(session).unique_chatters === 0);
session.onOnline({ id: 's1' });
session.noteChatter('a', 'Anna');
session.noteChatter('a', 'Anna');
session.noteChatter('b', 'Bert');
session.noteChatter('c', 'Cleo');
session.noteChatter('c', 'Cleo');
session.noteChatter('c', 'Cleo');
s = snap(session);
check('C2 Verschiedene Chatter und die Aktivsten', s.unique_chatters === 3 && s.top_chatters.length === 2 && s.top_chatters[0].name === 'Cleo' && s.top_chatters[0].count === 3 && s.top_chatters[1].name === 'Anna', JSON.stringify(s.top_chatters));
session.noteChatter('d', 'Dora');
session.noteChatter('a', 'Anna');
s = snap(session);
check('C3 Begrenzt: keine neuen mehr, bekannte zählen weiter', s.unique_chatters === 3 && s.top_chatters.find(c => c.name === 'Anna').count === 3, JSON.stringify(s.top_chatters));
session.noteChatter('__proto__', 'x');
check('C4 Sonderschlüssel richten nichts an', ({}).name === undefined && snap(session).unique_chatters === 3);
session.onRaidOut();
session.noteChatter('a', 'Anna');
check('C5 Abgeschlossen: Werte bleiben, nichts kommt dazu', snap(session).top_chatters.find(c => c.name === 'Anna').count === 3);
session.onOnline({ id: 's2' });
check('C6 Nächster Stream beginnt leer', snap(session).unique_chatters === 0);

// Knopf und Archiv
const archived = [];
({ session, clock } = setup({ onClose: c => { archived.push(c); return `bericht-${archived.length}`; } }));
check('B1 Knopf ohne Stream: nichts zu beenden', session.closeManually() === false && archived.length === 0);
session.onOnline({ id: 's1' });
session.count('follows');
clock.t += HOUR;
check('B2 Knopf im Stream schließt ab', session.closeManually() === true && snap(session).status === 'closed' && snap(session).close_reason === 'knopf' && snap(session).ended_at === new Date(clock.t).toISOString());
check('B3 Archiv bekommt Stand und Zusammenfassung, ID wird gemerkt', archived.length === 1 && archived[0].state.counters.follows === 1 && archived[0].summary.duration_seconds === 3600 && snap(session).report_id === 'bericht-1', JSON.stringify(archived[0] && archived[0].summary));
check('B4 Zweiter Knopfdruck: nichts mehr zu beenden', session.closeManually() === false && archived.length === 1);
session.onOnline({ id: 's2' });
clock.t += HOUR;
session.onOffline();
const knopfOffline = new Date(clock.t).toISOString();
clock.t += 10 * MIN;
session.closeManually();
check('B5 Knopf nach Offline: Ende ist das Offline', snap(session).ended_at === knopfOffline && archived.length === 2 && snap(session).report_id === 'bericht-2');
session.onOnline({ id: 's3' });
check('B6 Neuer Stream beginnt ohne Bericht', snap(session).report_id === null);
session.onRaidOut();
check('B7 Raid archiviert ebenfalls', archived.length === 3 && snap(session).report_id === 'bericht-3');
let failNext = true;
({ session } = setup({ onClose: () => { if (failNext) throw new Error('Platte voll'); return 'nachgeholt'; } }));
session.onOnline({ id: 's1' });
let thrown = false;
try { session.onRaidOut(); } catch { thrown = true; }
check('B8 Fehler beim Archivieren stört nicht, Stand bleibt abgeschlossen', !thrown && snap(session).status === 'closed' && snap(session).report_id === null);
failNext = false;
session.ensureArchived();
check('B9 ensureArchived holt den Bericht nach', snap(session).report_id === 'nachgeholt');
const oldFile = { data: { v: 1, status: 'closed', started_at: new Date(START).toISOString(), ended_at: new Date(START + HOUR).toISOString(), close_reason: 'raid', counters: { follows: 2 }, segments: [], stream_ids: ['alt'], categories: [], chatters: {} } };
const fromOld = [];
const old = setup({ onClose: c => { fromOld.push(c); return 'alter-stream'; } }, oldFile);
old.session.ensureArchived();
old.session.ensureArchived();
check('B10 Älterer abgeschlossener Stand ohne Bericht wird einmal archiviert', fromOld.length === 1 && old.file.data.report_id === 'alter-stream' && fromOld[0].state.counters.follows === 2);

// !privat (ADR 0022)
{
  const privat = new Set();
  const p = setup({ isPrivate: id => privat.has(id), anonName: 'anonymer Schlaumeier' });
  p.session.onOnline({ id: 's1' });
  p.session.noteChatter('u1', 'Anna');
  p.session.noteChatter('u1', 'Anna');
  p.session.noteChatter('u2', 'Bert');
  privat.add('u1');
  const savesBefore = p.saves.length;
  const moved = p.session.anonymize('u1');
  let chatters = p.file.data.chatters;
  check('P1 Anonymisieren verschiebt den Eintrag ohne ID und Namen und speichert sofort', moved === true && !('u1' in chatters) && chatters['anon-1'].name === 'anonymer Schlaumeier'
    && chatters['anon-1'].count === 2 && p.saves.length === savesBefore + 1 && !JSON.stringify(p.file.data).includes('Anna'), JSON.stringify(chatters));
  p.session.noteChatter('u1', 'Anna');
  p.session.flush();
  chatters = p.file.data.chatters;
  check('P2 Weitere Nachrichten zählen beim selben anonymen Eintrag', chatters['anon-1'].count === 3 && !('u1' in chatters) && snap(p.session).unique_chatters === 2, JSON.stringify(chatters));
  privat.add('u3');
  p.session.noteChatter('u3', 'Cora');
  p.session.flush();
  chatters = p.file.data.chatters;
  check('P3 Neue private Chatter bekommen einen eigenen anonymen Eintrag', chatters['anon-2'].count === 1 && !JSON.stringify(chatters).includes('Cora') && snap(p.session).unique_chatters === 3, JSON.stringify(chatters));
  check('P4 Top-Liste zeigt den anonymen Namen', snap(p.session).top_chatters[0].name === 'anonymer Schlaumeier', JSON.stringify(snap(p.session).top_chatters));
  check('P5 Ohne Eintrag nichts zu tun', p.session.anonymize('u9') === false && p.session.anonymize('anon-1') === false);
  privat.delete('u1');
  p.session.noteChatter('u1', 'Anna');
  check('P6 Ausgeschaltet: wieder mit Namen, alte Einträge bleiben anonym', snap(p.session).unique_chatters === 4 && p.session.snapshot().top_chatters.some(c => c.name === 'Anna' && c.count === 1));
}

// Robustheit
({ session } = setup({ save: () => { throw new Error('Datei gesperrt'); } }));
let threw = false;
try { session.onOnline({ id: 's1' }); session.count('follows'); session.flush(); } catch { threw = true; }
check('X1 Fehler beim Speichern erreicht den Aufrufer nicht', !threw && snap(session).counters.follows === 1);
({ session } = setup({ enabled: false }));
session.onOnline({ id: 's1' });
session.count('follows');
check('X2 Abgeschaltet: kein Ablauf', snap(session).status === 'none');
({ session } = setup({ load: () => ({ v: 99, status: 'live' }) }));
check('X3 Unbekanntes Dateiformat: beginnt leer', snap(session).status === 'none');
({ session } = setup({ load: () => 'kaputt' }));
check('X4 Kaputte Datei: beginnt leer', snap(session).status === 'none');

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
