// Führt alle Tests mit Attrappen nacheinander aus (npm test).
// Kein Netzwerk, kein Twitch, kein Home Assistant: ws, axios und readline werden in jedem Test ersetzt,
// jeder Test läuft in einem eigenen temporären Arbeitsverzeichnis mit Fake-.env und Fake-tokens.json.
// Die echten Laufzeitdateien im Projektordner werden nicht angefasst. Dauer: etwa 3–4 Minuten.
// Auswertung: Jeder Test gibt Zeilen "OK  …" oder "FAIL …" aus.
const { spawnSync } = require('child_process');
const path = require('path');

const server = path.resolve(__dirname, '..', 'server.js');
const runs = [
  ['k3-test.js', []],
  ['shoutout-test.js', ['raid-ok']],
  ['shoutout-test.js', ['raid-fail']],
  ['shoutout-test.js', ['offline']],
  ['shoutout-test.js', ['start-ohne-ha']],
  ['port-test.js', []],
  ['status-test.js', []],
  ['status-test.js', ['ohne-tokens']],
  ['keepalive-test.js', []],
  ['k9-test.js', []],
  ['jahr-test.js', ['2026-11-05T20:00:00', '2026-Q4', 'Quartal']],
  ['jahr-test.js', ['2026-12-31T23:59:00', '2026-Q4', 'Quartal']],
  ['jahr-test.js', ['2027-01-01T00:01:00', '2027', 'Jahr']],
  ['aktiv-test.js', ['aktiv']],
  ['aktiv-test.js', ['grammatik', '0.1']],
  ['aktiv-test.js', ['grammatik', '0.4']],
  ['aktiv-test.js', ['grammatik', '0.8']],
  ['uboat-test.js', ['an']],
  ['uboat-test.js', ['aus']],
  ['modul-test.js', ['schalten']],
  ['modul-test.js', ['gespeichert']],
  ['modul-test.js', ['defekt']],
  ['bot-test.js', ['ablauf']],
  ['bot-test.js', ['eingerichtet']],
  ['bot-test.js', ['ohne-bot']],
  ['login-test.js', []],
  ['admin-test.js', ['ablauf']],
  ['admin-test.js', ['alle-herkuenfte']],
  ['admin-test.js', ['ohne-tokens']],
  ['admin-test.js', ['server-beenden']],
  ['admin-test.js', ['server-neustart']],
  ['admin-test.js', ['live-log']],
  ['admin-test.js', ['fehler-protokoll']],
  ['admin-test.js', ['fehler-defekt']],
  ['admin-test.js', ['whitelist']],
  ['admin-test.js', ['module']],
  ['admin-test.js', ['effekte']],
  ['admin-test.js', ['effekte-alt']],
  ['admin-test.js', ['statistik']],
  ['stats-test.js', []],
  ['stream-session-test.js', []],
  ['admin-format-test.js', []],
  ['authserver-test.js', []],
  ['prediction-test.js', []],
];

let ok = 0, fail = 0;
const failures = [];
for (const [file, args] of runs) {
  const label = [file, ...args].join(' ');
  process.stdout.write(`▶ ${label} … `);
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(__dirname, file), server, ...args], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
  const lines = (res.stdout || '').split('\n');
  const okLines = lines.filter(l => l.startsWith('OK'));
  const failLines = lines.filter(l => l.startsWith('FAIL'));
  const crashed = res.status !== 0 || res.error || okLines.length + failLines.length === 0;
  ok += okLines.length;
  fail += failLines.length + (crashed ? 1 : 0);
  console.log(`${okLines.length} OK, ${failLines.length} FAIL${crashed ? ', ABBRUCH' : ''} (${Math.round((Date.now() - started) / 1000)} s)`);
  failLines.forEach(l => failures.push(`${label}: ${l}`));
  if (crashed) failures.push(`${label}: Abbruch (Exit ${res.status}${res.error ? ', ' + res.error.message : ''})\n${(res.stderr || '').trim().split('\n').slice(-5).join('\n')}`);
}

console.log(`\nErgebnis: ${ok} OK, ${fail} FAIL`);
if (failures.length) { console.log('\nFehlgeschlagen:'); failures.forEach(f => console.log(' - ' + f)); }
process.exit(fail === 0 ? 0 : 1);
