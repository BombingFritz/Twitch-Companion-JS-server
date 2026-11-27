// Architekturtest (ADR 0027, Nachtrag 27.11.2026, Abschnitt 8): prüft die Regeln für Abhängigkeiten und Schreibzugriffe
// in den Produktionsdateien (server.js, core/, lib/, modules/) sowie den Katalog der internen Ereignisse in docs/ARCHITEKTUR.md.
// Ohne Server, ohne weitere Pakete.
// Zuerst prüft er sich selbst an kleinen Beispielen (T…), dann den echten Stand (R…).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PRODUCTION = ['server.js', 'core', 'lib', 'modules'];

// axios und ws lädt nur die Zusammensetzung in server.js; alle anderen bekommen den Client über ctx (ADR 0024, 0027).
// Eine Ausnahme kommt nur mit Begründung im Kommentar dazu.
const EXTERNAL_ONLY_IN = { axios: ['server.js'], ws: ['server.js'] };

// Schreibzugriffe außerhalb von core/store.js, Stand 27.11.2026 (Altlast, AGENTS.md: writeJsonAtomic).
// Die Liste darf nur schrumpfen; wer eine Stelle umstellt, setzt die Zahl hier herunter.
const KNOWN_WRITES = {
  'server.js': 9,
  'core/auth.js': 1,            // bot.json
  'core/chat.js': 1,            // chat_senders.json
  'core/state.js': 1,           // modules.json (Schritt 3c aus server.js umgezogen)
  'lib/stream-reports.js': 2,   // Berichte als .txt
  'modules/topics/index.js': 1, // topics.json
};
const STORE_FILE = 'core/store.js';

// ── Prüfregeln (rein, ohne Dateisystem) ──
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(line => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
}

function requiresOf(src) {
  const code = stripComments(src);
  const literal = [...code.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)].map(m => m[2]);
  const dynamic = [...code.matchAll(/\brequire\(\s*(?!['"])([^)]*)\)/g)].map(m => m[1].trim());
  return { literal, dynamic };
}

function resolveLocal(fromRel, spec, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  return [base, `${base}.js`, `${base}/index.js`].find(c => Object.prototype.hasOwnProperty.call(files, c)) || null;
}

function areaOf(rel) {
  if (rel === 'server.js') return { layer: 'server' };
  const [top, name] = rel.split('/');
  if (top === 'modules') return { layer: 'modules', module: name };
  return { layer: top };
}

function writesIn(src) {
  return (stripComments(src).match(/\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(/g) || []).length;
}

// files: { 'core/x.js': Quelltext }; Ergebnis: [{ rule, text }]
function checkArchitecture(files, options = {}) {
  const externalOnlyIn = options.externalOnlyIn || EXTERNAL_ONLY_IN;
  const knownWrites = options.knownWrites || KNOWN_WRITES;
  const out = [];
  const edges = {};
  for (const [rel, src] of Object.entries(files)) {
    const from = areaOf(rel);
    const { literal, dynamic } = requiresOf(src);
    edges[rel] = [];
    for (const d of dynamic) out.push({ rule: 'dynamisch', text: `${rel}: require(${d}) ist nicht prüfbar` });
    for (const spec of literal) {
      if (!spec.startsWith('.')) {
        const allowed = externalOnlyIn[spec];
        if (allowed && !allowed.includes(rel)) out.push({ rule: 'extern', text: `${rel}: lädt ${spec} (erlaubt nur in ${allowed.join(', ')})` });
        continue;
      }
      const target = resolveLocal(rel, spec, files);
      if (!target) continue;   // außerhalb der Produktionsdateien, z. B. ../package.json
      edges[rel].push(target);
      const to = areaOf(target);
      if (to.layer === 'server') out.push({ rule: 'import', text: `${rel}: importiert server.js` });
      else if (from.layer === 'modules' && to.layer === 'modules' && to.module !== from.module) out.push({ rule: 'import', text: `${rel}: importiert ein anderes Modul (${target})` });
      else if (from.layer === 'core' && to.layer === 'modules') out.push({ rule: 'import', text: `${rel}: Kern importiert ein Modul (${target})` });
      else if (from.layer === 'lib' && (to.layer === 'core' || to.layer === 'modules')) out.push({ rule: 'import', text: `${rel}: lib importiert ${to.layer} (${target})` });
    }
  }
  // Zyklen: Tiefensuche über die lokalen Importe
  const state = {};
  const stack = [];
  const visit = (node) => {
    state[node] = 'offen'; stack.push(node);
    for (const next of edges[node] || []) {
      if (state[next] === 'offen') out.push({ rule: 'zyklus', text: `Zyklus: ${[...stack.slice(stack.indexOf(next)), next].join(' -> ')}` });
      else if (!state[next]) visit(next);
    }
    stack.pop(); state[node] = 'fertig';
  };
  for (const node of Object.keys(edges).sort()) if (!state[node]) visit(node);
  // Schreibzugriffe
  for (const [rel, src] of Object.entries(files)) {
    if (rel === STORE_FILE) continue;
    const count = writesIn(src);
    const known = knownWrites[rel] || 0;
    if (count > known) out.push({ rule: 'schreiben', text: `${rel}: ${count} direkte Schreibzugriffe, bekannt ${known} – writeJsonAtomic aus core/store.js nutzen` });
    if (count < known) out.push({ rule: 'liste', text: `${rel}: nur noch ${count} direkte Schreibzugriffe, bekannt ${known} – KNOWN_WRITES in test/architektur-test.js herabsetzen` });
  }
  return out;
}

// ── Echte Dateien ──
function productionFiles() {
  const files = {};
  const add = (abs) => { files[path.relative(root, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8'); };
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) add(full);
    }
  };
  for (const p of PRODUCTION) {
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walk(abs); else add(abs);
  }
  return files;
}

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const rulesOf = v => v.map(x => x.rule).sort().join(',');

// Selbsttest
const clean = {
  'server.js': "const axios = require('axios'); const { a } = require('./core/a'); const m = require('./modules/m');",
  'core/a.js': "const l = require('../lib/l'); const p = require('../package.json');",
  'lib/l.js': "const fs = require('fs'); // require('../core/a') nur im Kommentar\nconst u = 'http://x.example'; /* require('../modules/m') */",
  'core/store.js': "fs.writeFileSync(t, j); fs.renameSync(t, f);",
  'modules/m/index.js': "const l = require('../../lib/l'); const h = require('./hilfe');",
  'modules/m/hilfe.js': "module.exports = {};",
};
check('T1 Sauberer Aufbau: kein Verstoß (Kommentare, URLs, package.json, eigene Moduldatei)', checkArchitecture(clean, { knownWrites: {} }).length === 0, JSON.stringify(checkArchitecture(clean, { knownWrites: {} })));
const bad = (extra, opts = {}) => checkArchitecture({ ...clean, ...extra }, { knownWrites: {}, ...opts });
check('T2 Modul importiert anderes Modul', rulesOf(bad({ 'modules/n/index.js': "require('../m')" })) === 'import');
check('T3 Kern importiert Modul', rulesOf(bad({ 'core/b.js': "require('../modules/m')" })) === 'import');
check('T4 lib importiert Kern', rulesOf(bad({ 'lib/k.js': "require('../core/a')" })) === 'import');
check('T5 Import von server.js', rulesOf(bad({ 'lib/k.js': "require('../server')" })) === 'import');
check('T6 Zyklus', rulesOf(bad({ 'lib/x.js': "require('./y')", 'lib/y.js': "require('./x')" })) === 'zyklus');
check('T7 Dynamisches require', rulesOf(bad({ 'lib/k.js': 'require(name)' })) === 'dynamisch');
check('T8 axios außerhalb von server.js', rulesOf(bad({ 'lib/k.js': "require('axios')" })) === 'extern');
check('T9 Neuer Schreibzugriff außerhalb von store.js', rulesOf(bad({ 'lib/k.js': 'fs.writeFileSync(f, d)' })) === 'schreiben');
check('T10 Bekannte Stelle umgestellt: Liste muss nachgezogen werden', rulesOf(bad({}, { knownWrites: { 'lib/l.js': 1 } })) === 'liste');

// Echter Stand
const files = productionFiles();
const found = checkArchitecture(files);
const by = rule => found.filter(v => v.rule === rule).map(v => v.text);
check('R1 Produktionsdateien gefunden', files['server.js'] && files['core/modules.js'] && Object.keys(files).length > 20, Object.keys(files).length);
check('R2 Module nur am Kern, Kern ohne Module, lib ohne Kern und Module, niemand importiert server.js', by('import').length === 0, by('import').join(' | '));
check('R3 Keine Zyklen', by('zyklus').length === 0, by('zyklus').join(' | '));
check('R4 Nur prüfbare require-Aufrufe', by('dynamisch').length === 0, by('dynamisch').join(' | '));
check('R5 axios und ws nur in server.js', by('extern').length === 0, by('extern').join(' | '));
check('R6 Keine neuen direkten Schreibzugriffe außerhalb von core/store.js', by('schreiben').length === 0, by('schreiben').join(' | '));
check('R7 Liste der bekannten Schreibzugriffe ist aktuell', by('liste').length === 0, by('liste').join(' | '));

// Ereigniskatalog (ADR 0027, Nachtrag, Abschnitt 6): gesendete und von Modulen gehörte Ereignisse stehen in ARCHITEKTUR.md
function eventUsage(sources) {
  const emitted = new Set(); const heard = new Set();
  for (const [rel, src] of Object.entries(sources)) {
    const code = stripComments(src);
    for (const m of code.matchAll(/\bevents\.emit\(\s*(['"])([^'"]+)\1/g)) emitted.add(m[2]);
    for (const m of code.matchAll(/\bevents\.on\(\s*(['"])([^'"]+)\1/g)) heard.add(m[2]);
    if (rel.startsWith('modules/')) {
      // Empfänger im on-Block: Schlüssel mit Punkt, dem eine Funktion folgt, z. B. 'stream.new': () => … oder 'x.y': async ({ key }) => …
      for (const m of code.matchAll(/^\s*(['"])([a-z]+(?:\.[a-z]+)+)\1\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>)/gm)) heard.add(m[2]);
    }
  }
  return { emitted, heard };
}
function catalogEvents(md) {
  const start = md.indexOf('### Interne Ereignisse');
  if (start < 0) return null;
  const rest = md.slice(start + 1);
  const end = rest.search(/\n#{1,3} /);
  const section = end < 0 ? rest : rest.slice(0, end);
  return new Set([...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map(m => m[1]));
}
const sample = eventUsage({ 'server.js': "events.emit('a.b'); // events.emit('kommentar.x')", 'modules/m/index.js': "on: {\n  'c.d': () => {\n    x();\n  },\n  'e.f': async ({ key }) => {},\n  'g.h': p => p,\n},\nconst f = { 'datei.json': 1 };\n" });
check('T11 Ereignisse erkannt: gesendet, im on-Block gehört (mehrere Empfänger), Kommentare und andere Schlüssel nicht', JSON.stringify([...sample.emitted]) === '["a.b"]' && JSON.stringify([...sample.heard].sort()) === '["c.d","e.f","g.h"]', JSON.stringify({ e: [...sample.emitted], h: [...sample.heard] }));
const catalog = catalogEvents(fs.readFileSync(path.join(root, 'docs', 'ARCHITEKTUR.md'), 'utf8'));
const usage = eventUsage(files);
const missing = [...new Set([...usage.emitted, ...usage.heard])].filter(e => !catalog || !catalog.has(e));
const stale = catalog ? [...catalog].filter(e => !usage.emitted.has(e)) : [];
check('R8 Jedes gesendete und gehörte Ereignis steht im Katalog (ARCHITEKTUR.md, „Interne Ereignisse“)', catalog && usage.emitted.size > 0 && missing.length === 0, `fehlt: ${missing.join(', ')}`);
check('R9 Jedes Ereignis im Katalog wird auch gesendet', catalog && stale.length === 0, `nie gesendet: ${stale.join(', ')}`);

for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
