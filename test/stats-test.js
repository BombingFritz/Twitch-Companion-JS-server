// lib/stats.js (ADR 0019, docs/specs/statistik.md): läuft ohne Server, mit künstlicher Uhr.
const path = require('path');
const { createStats } = require(path.join(__dirname, '..', 'lib', 'stats.js'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const METRICS = [{ key: 'a', label: 'A', areas: ['instance'] }, { key: 'b', label: 'B', areas: ['instance'] }, { key: 'nur_stream', label: 'C', areas: ['stream'] }];
const setup = (options = {}) => {
  const clock = { t: Date.UTC(2026, 10, 9, 12, 0, 0) };
  const warnings = [];
  const stats = createStats({ metrics: METRICS, now: () => clock.t, warn: m => warnings.push(m), ...options });
  return { stats, clock, warnings };
};
const values = stats => Object.fromEntries(stats.snapshot().instance.metrics.map(m => [m.key, m.value]));

let { stats, clock, warnings } = setup();
check('T1 Beginnt bei 0, in der Reihenfolge der Liste', JSON.stringify(stats.snapshot().instance.metrics.map(m => [m.key, m.label, m.value])) === '[["a","A",0],["b","B",0]]', JSON.stringify(stats.snapshot()));
stats.count('a');
stats.count('a');
stats.count('b', 5);
check('T2 Zählt um 1 oder um die angegebene Menge', values(stats).a === 2 && values(stats).b === 5, JSON.stringify(values(stats)));
clock.t += 90500;
const snap = stats.snapshot();
check('T3 Laufzeit und Startzeit', snap.enabled === true && snap.instance.uptime_seconds === 90 && snap.instance.started_at === '2026-11-09T12:00:00.000Z', JSON.stringify(snap));
for (const amount of [0, -3, NaN, Infinity, 'x', null]) stats.count('a', amount);
check('T4 Ungültige Mengen ändern nichts', values(stats).a === 2, JSON.stringify(values(stats)));
stats.count('gibtsnicht');
stats.count('gibtsnicht');
check('T5 Unbekannte Kennzahl: einmal gewarnt, nicht gezählt', warnings.length === 1 && warnings[0].includes('gibtsnicht') && !('gibtsnicht' in values(stats)), JSON.stringify(warnings));
for (const key of ['__proto__', 'constructor', undefined, 5]) stats.count(key);
check('T6 Sonderschlüssel richten nichts an', values(stats).a === 2 && ({}).polluted === undefined && Object.keys(values(stats)).length === 2);
stats.count('nur_stream');
check('T7 Kennzahl eines anderen Bereichs zählt nicht in der Instanz', !('nur_stream' in values(stats)) && warnings.length === 5, JSON.stringify(warnings));

({ stats, warnings } = setup({ enabled: false }));
stats.count('a');
stats.count('gibtsnicht');
check('T8 Abgeschaltet: zählt und warnt nicht', stats.snapshot().enabled === false && values(stats).a === 0 && warnings.length === 0);

({ stats } = setup({ warn: () => { throw new Error('kaputt'); } }));
let threw = false;
try { stats.count('gibtsnicht'); } catch { threw = true; }
check('T9 Ein Fehler beim Warnen erreicht den Aufrufer nicht', !threw);

const real = createStats({ warn: () => {} });
const keys = real.snapshot().instance.metrics.map(m => m.key).join(',');
check('T10 Kennzahlen der Server-Instanz', keys === 'errors,effects,follows,subs,gifts,chat_messages', keys);

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
