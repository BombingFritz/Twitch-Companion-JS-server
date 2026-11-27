// Architekturtest (ADR 0027, Nachtrag 27.11.2026, Abschnitt 8): prüft die Regeln für Abhängigkeiten und Schreibzugriffe
// in den Produktionsdateien (server.js, core/, lib/, modules/). Ohne Server, ohne weitere Pakete.
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
  'server.js': 10,
  'core/auth.js': 1,            // bot.json
  'core/chat.js': 1,            // chat_senders.json
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

for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : `  -> ${r.info}`}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
