// Kern: Anmeldung der Module (core/modules.js, ADR 0027, Schritt 2). Reiner Modultest ohne Server.
const path = require('path');
const { createModuleHost } = require(path.join(__dirname, '..', 'core', 'modules'));

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
host.emit('stream.new');
host.emit('module.switched', { key: 'topics' });
host.emit('unbekannt');
check('M7 Ereignisse an die Module, die darauf hören', JSON.stringify(calls.splice(0)) === '["a-new","a-switch:topics"]');

const errHost = createModuleHost();
errHost.add({ name: 'kaputt', on: { 'stream.new': () => { throw new Error('bumm'); } } });
errHost.add({ name: 'heil', on: { 'stream.new': () => calls.push('heil') } });
const realError = console.error; const errors = []; console.error = m => errors.push(m);
let threw = false;
try { errHost.emit('stream.new'); } catch { threw = true; }
console.error = realError;
check('M8 Fehler in einem Modul: übrige Module laufen, Aufrufer bekommt keine Ausnahme, Fehler im Log', !threw && calls.includes('heil')
  && errors.some(e => e.includes('[Module] kaputt: Fehler bei Ereignis stream.new: bumm')), JSON.stringify(errors));
let dup = false;
try { errHost.add({ name: 'heil' }); } catch { dup = true; }
check('M9 Doppelter Modulname wird abgelehnt', dup);

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : `  -> ${x.info}`}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
