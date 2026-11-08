// Webkonsole (docs/specs/webkonsole.md): Zeitangabe in der Effektliste (heute nur Uhrzeit, ältere mit Datum) und Lichter der optionalen Module.
// Läuft ohne Server und ohne Browser: Nur der Abschnitt „Formatierung“ aus admin.js wird ausgeführt, er braucht keine Seite.
const fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
const section = source.match(/\/\/ ── Formatierung[\s\S]*?(?=\/\/ ── Reiter)/);
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

check('F0 Abschnitt „Formatierung“ gefunden', section);
if (section) {
  const context = vm.createContext({});
  vm.runInContext(section[0], context);
  const at = (...args) => new Date(...args).toISOString();
  const show = (iso, now) => { context.iso = iso; context.now = now; return vm.runInContext('effectTime(iso, new Date(now))', context); };

  const evening = at(2026, 10, 8, 23, 59);
  const justAfterMidnight = at(2026, 10, 8, 0, 1);
  let r = show(at(2026, 10, 8, 9, 5), evening);
  check('F1 Eintrag von heute: nur die Uhrzeit', r === '09:05', r);
  r = show(at(2026, 10, 8, 0, 0), evening);
  check('F2 Eintrag von heute um Mitternacht: nur die Uhrzeit', r === '00:00', r);
  r = show(at(2026, 10, 7, 21, 14), evening);
  check('F3 Eintrag von gestern: Datum und Uhrzeit', r.includes('07.11') && r.includes('21:14'), r);
  r = show(at(2026, 10, 7, 23, 59), justAfterMidnight);
  check('F4 Zwei Minuten vor Mitternacht ist schon gestern', r.includes('07.11') && r.includes('23:59'), r);
  r = show(at(2025, 10, 8, 20, 0), evening);
  check('F5 Gleicher Tag im Vorjahr zählt nicht als heute', r.includes('08.11') && r.includes('20:00'), r);

  context.iso = at(2026, 10, 8, 9, 5, 7);
  r = vm.runInContext('logTime(iso)', context);
  check('F7 Live-Log zeigt die Uhrzeit mit Sekunden', r === '09:05:07', r);

  const healthy = { ha_webhook_configured: true, effect_mode: 'auto', uboat_enabled: true, modules: { bdu: true, uboat: true }, uboat_save: 'a.save', bdu_widget_connected: true, bdu_silence_until: null };
  const lights = changes => { context.d = { ...healthy, ...changes }; return JSON.parse(vm.runInContext('JSON.stringify(moduleLights(d))', context)); };
  const level = (name, changes) => lights(changes).find(m => m.name === name).level;
  const names = lights({}).map(m => m.name).join(',');
  check('L1 Die vier Module in der gewünschten Reihenfolge', names === 'HA-Effekte,UBOAT-Soldbuch,BdU-Chat,Sub-Goal', names);
  check('L2 Alles eingerichtet: grün', ['HA-Effekte', 'UBOAT-Soldbuch', 'BdU-Chat'].every(n => level(n, {}) === 'ok'));
  check('L3 Sub-Goal hat kein Licht', level('Sub-Goal', {}) === null);
  check('L4 HA-Effekte: kein Webhook ist ein Fehler', level('HA-Effekte', { ha_webhook_configured: false }) === 'bad');
  check('L5 HA-Effekte: Modus off ist nur nicht aktiv', level('HA-Effekte', { effect_mode: 'off' }) === 'off');
  check('L6 HA-Effekte: Modus manual ist grün', level('HA-Effekte', { effect_mode: 'manual' }) === 'ok');
  check('L7 Soldbuch: nicht eingerichtet ist nur nicht aktiv', level('UBOAT-Soldbuch', { uboat_enabled: false, uboat_save: null }) === 'off');
  check('L8 Soldbuch: ausgeschaltet ist nur nicht aktiv', level('UBOAT-Soldbuch', { modules: { bdu: true, uboat: false } }) === 'off');
  check('L9 Soldbuch: eingerichtet, aber kein Spielstand ist ein Fehler', level('UBOAT-Soldbuch', { uboat_save: null }) === 'bad');
  check('L10 BdU-Chat: ausgeschaltet ist nur nicht aktiv', level('BdU-Chat', { modules: { bdu: false, uboat: true } }) === 'off');
  check('L11 BdU-Chat: Widget noch nicht verbunden ist nur nicht aktiv', level('BdU-Chat', { bdu_widget_connected: false }) === 'off');
  check('L12 BdU-Chat: Funkstille ist nur nicht aktiv', level('BdU-Chat', { bdu_silence_until: 'bis Streamstart' }) === 'off');
}
check('F6 Die Effektliste nutzt diese Anzeige', /el\('time', \{ text: effectTime\(e\.timestamp\) \}\)/.test(source));

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
