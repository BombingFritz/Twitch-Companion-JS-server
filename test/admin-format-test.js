// Webkonsole (docs/specs/webkonsole.md): Zeitangabe in der Effektliste. Einträge von heute nur mit Uhrzeit, ältere mit Datum.
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
}
check('F6 Die Effektliste nutzt diese Anzeige', /el\('time', \{ text: effectTime\(e\.timestamp\) \}\)/.test(source));

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
