// Syntaxprüfung aller projekteigenen JS-Dateien (npm run check; ADR 0027, Nachtrag 27.11.2026, Abschnitt 8).
// Vorher prüfte npm run check nur server.js; Fehler in core/, modules/, lib/, der Webkonsole oder den Tests fielen erst beim Laden auf.
// Läuft unter Windows und Linux gleich, ohne git und ohne weitere Pakete. Ausgelassen: node_modules und Ordner mit Punkt (.git, .github, .claude).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = jsFiles(root).sort();
const failed = [];
for (const file of files) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) failed.push({ file: path.relative(root, file), detail: (res.stderr || res.error?.message || '').trim() });
}

for (const f of failed) console.error(`Syntaxfehler in ${f.file}:\n${f.detail}\n`);
console.log(`Syntax geprüft: ${files.length} Dateien, ${failed.length} mit Fehler`);
process.exit(failed.length ? 1 : 0);
