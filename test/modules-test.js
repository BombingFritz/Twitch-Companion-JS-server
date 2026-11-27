// Kern: Anmeldung der Module (core/modules.js, ADR 0027, Schritt 2) und Ereignisbus (core/events.js, Schritt 3c). Reiner Modultest ohne Server.
const path = require('path');
const { createModuleHost } = require(path.join(__dirname, '..', 'core', 'modules'));
const { createEvents } = require(path.join(__dirname, '..', 'core', 'events'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const calls = [];
const host = createModuleHost();
host.add({
  name: 'a',
  routes: { widget: app => calls.push(`a-widget:${app}`), admin: app => calls.push(`a-admin:${app}`) },
  consoleCommands: [{ name: 'eins', help: [' eins x', ' eins y'], handle: parts => calls.push(`eins:${parts.join(' ')}`) }],
  isQuiet: req => req.path === '/still',
  showsSilentEffects: () => false,
  overview: () => ({ n: 1 }),
  on: { 'stream.new': () => calls.push('a-new'), 'module.switched': p => calls.push(`a-switch:${p.key}`) },
});
host.add({
  name: 'b',
  routes: { widget: app => calls.push(`b-widget:${app}`) },
  consoleCommands: [{ name: 'zwei', help: [' zwei'], handle: () => calls.push('zwei') }],
  showsSilentEffects: () => true,
});
host.add({ name: 'leer' });

host.mountRoutes('APP', 'widget');
host.mountRoutes('APP', 'admin');
check('M1 Endpunkte je Phase, in der Reihenfolge der Anmeldung', JSON.stringify(calls.splice(0)) === '["a-widget:APP","b-widget:APP","a-admin:APP"]');
check('M2 Konsole: passender Befehl übernommen, fremder nicht', host.handleConsole('eins', ['eins', 'show']) === true && host.handleConsole('drei', ['drei']) === false
  && JSON.stringify(calls.splice(0)) === '["eins:eins show"]');
check('M3 Hilfezeilen in Reihenfolge der Anmeldung', JSON.stringify(host.helpLines()) === '[" eins x"," eins y"," zwei"]');
check('M4 still, wenn ein Modul es sagt', host.isQuiet({ path: '/still' }, {}) && !host.isQuiet({ path: '/laut' }, {}));
check('M5 stille Effekte sichtbar, wenn ein Modul im Testmodus ist', host.silentEffectsVisible() === true);
check('M6 Übersicht unter dem Namen des Moduls, ohne Module ohne Beitrag', JSON.stringify(host.overview()) === '{"a":{"n":1}}');
host.events.emit('stream.new');
host.events.emit('module.switched', { key: 'topics' });
host.events.emit('unbekannt');
check('M7 Ereignisse an die Module, die darauf hören', JSON.stringify(calls.splice(0)) === '["a-new","a-switch:topics"]');

// Gemeinsamer Bus: server.js gibt ihn mit, Erzeuger rufen events.emit
const events = createEvents();
const errHost = createModuleHost({ events });
errHost.add({ name: 'kaputt', on: { 'stream.new': () => { throw new Error('bumm'); } } });
errHost.add({ name: 'heil', on: { 'stream.new': () => calls.push('heil') } });
const realError = console.error; const errors = []; console.error = m => errors.push(m);
let threw = false;
try { events.emit('stream.new'); } catch { threw = true; }
console.error = realError;
check('M8 Fehler in einem Modul: übrige Module laufen, Aufrufer bekommt keine Ausnahme, Fehler im Log', !threw && calls.includes('heil')
  && errors.some(e => e.includes('[Module] kaputt: Fehler bei Ereignis stream.new: bumm')), JSON.stringify(errors));
let dup = false;
try { errHost.add({ name: 'heil' }); } catch { dup = true; }
check('M9 Doppelter Modulname wird abgelehnt', dup);
check('M10 Gemeinsamer Bus: Host nutzt den mitgegebenen', errHost.events === events && JSON.stringify(events.eventNames()) === '["stream.new"]');
let badHandler = false;
try { errHost.add({ name: 'falsch', on: { 'stream.new': 'keine Funktion' } }); } catch { badHandler = true; }
check('M11 Empfänger, der keine Funktion ist, wird beim Anmelden abgelehnt, nichts halb angemeldet', badHandler && JSON.stringify(events.eventNames()) === '["stream.new"]'
  && (() => { let again = false; try { errHost.add({ name: 'falsch' }); } catch { again = true; } return !again; })());

// Asynchrone Empfänger (ADR 0027, Nachtrag, Abschnitt 6): Ohne Fänger hätte ein abgelehntes Promise den Server beendet
(async () => {
  const bus = createEvents();
  const order = [];
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  bus.on('stream.new', 'langsam', async () => { order.push('langsam-start'); await new Promise(r => setTimeout(r, 20)); order.push('langsam-ende'); });
  bus.on('stream.new', 'abgelehnt', async () => { order.push('abgelehnt'); throw new Error('später'); });
  bus.on('stream.new', 'promise', () => Promise.reject('ohne Error-Objekt'));
  bus.on('stream.new', 'objekt', () => Promise.reject({ status: 500 }));
  bus.on('stream.new', 'spaet', () => { bus.on('stream.new', 'nachzuegler', () => order.push('nachzuegler')); });
  bus.on('stream.new', 'sync', () => { order.push('sync'); });
  const asyncErrors = []; console.error = m => asyncErrors.push(m);
  let threwAsync = false;
  try { bus.emit('stream.new'); } catch { threwAsync = true; }
  const afterEmit = order.slice();
  // auf das Ergebnis warten statt fester Pause (AGENTS.md), danach eine Runde mehr, in der Node unbehandelte Ablehnungen meldet
  const until = Date.now() + 2000;
  while (Date.now() < until && !(order.includes('langsam-ende') && asyncErrors.length >= 3)) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setImmediate(r));
  console.error = realError;
  process.off('unhandledRejection', onUnhandled);
  check('E1 emit kehrt sofort zurück, alle Empfänger gestartet, in Reihenfolge der Anmeldung', !threwAsync
    && JSON.stringify(afterEmit) === '["langsam-start","abgelehnt","sync"]' && order.includes('langsam-ende'), JSON.stringify({ afterEmit, order }));
  check('E2 Abgelehntes Promise: mit Besitzer im Log, kein unbehandelter Fehler', unhandled === 0
    && asyncErrors.some(e => e.includes('[Module] abgelehnt: Fehler bei Ereignis stream.new: später'))
    && asyncErrors.some(e => e.includes('[Module] promise: Fehler bei Ereignis stream.new: ohne Error-Objekt'))
    && asyncErrors.some(e => e.includes('[Module] objekt: Fehler bei Ereignis stream.new: {"status":500}')), JSON.stringify({ unhandled, asyncErrors }));
  check('E3 Wer sich während emit anmeldet, hört erst ab dem nächsten Ereignis', !afterEmit.includes('nachzuegler')
    && (() => { bus.emit('stream.new'); return order.includes('nachzuegler'); })());

  for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}`);
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
