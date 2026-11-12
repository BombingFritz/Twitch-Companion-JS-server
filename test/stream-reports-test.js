// lib/stream-reports.js (ADR 0019, docs/specs/statistik.md): Archiv je Stream, lesbarer Bericht, Gesamtsumme. Eigener Temp-Ordner.
const fs = require('fs'), os = require('os'), path = require('path');
const { createStreamReports, reportIdFor, reportWarnings, isReportId } = require(path.join(__dirname, '..', 'lib', 'stream-reports.js'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
const dir = path.join(work, 'stream_reports');
const warnings = [];
const metrics = [{ key: 'follows', label: 'Follows' }, { key: 'chat_messages', label: 'Chatnachrichten' }];
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data));
const reports = createStreamReports({ dir, metrics, shortSeconds: 3600, writeJson, log: m => warnings.push(m) });

function closed(startedAt, hours, extra = {}) {
  const ended = new Date(Date.parse(startedAt) + hours * 3600000).toISOString();
  const state = { v: 1, status: 'closed', started_at: startedAt, ended_at: ended, close_reason: 'raid', aborted: false, late_start: false,
    counters: { follows: 2, chat_messages: 10 }, chatters: { 1: { name: 'Anna', count: 7 }, 2: { name: 'Bert', count: 3 } }, ...extra };
  const summary = { started_at: startedAt, ended_at: ended, close_reason: state.close_reason, aborted: state.aborted, late_start: state.late_start,
    duration_seconds: hours * 3600, interruptions: 0, interruption_seconds: 0, categories: [{ name: 'UBOAT', seconds: hours * 3600 }], ...extra };
  return { state, summary };
}

const start1 = new Date(2026, 10, 10, 21, 13).toISOString();
check('R1 ID aus der Ortszeit des Starts', reportIdFor(start1) === '2026-11-10_2113', reportIdFor(start1));
check('R2 Gültige und ungültige IDs', isReportId('2026-11-10_2113') && isReportId('2026-11-10_2113-2')
  && !['../.env', '2026-11-10_2113.json', '..\\x', '', null, '2026-11-10_2113/../x'].some(isReportId));

check('R3 Ohne Ordner: leere Liste', reports.list().length === 0 && reports.totals().streams === 0);
let id = reports.archive(closed(start1, 4.5));
check('R4 Archiv legt .json und .txt an', id === '2026-11-10_2113' && fs.existsSync(path.join(dir, `${id}.json`)) && fs.existsSync(path.join(dir, `${id}.txt`)), id);
const saved = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
check('R5 Bericht enthält Daten, ID und keine Hinweise bei normalem Stream', saved.v === 1 && saved.state.report_id === id && saved.warnings.length === 0 && saved.state.counters.follows === 2);
const text = reports.text(id);
check('R6 Lesbarer Text mit Dauer, Grund, Zahlen und Chattern', /4 Std\. 30 Min\./.test(text) && text.includes('nach dem Raid') && text.includes('Follows: 2')
  && text.includes('Verschiedene Chatter: 2') && text.includes('1. Anna (7)') && text.includes('UBOAT'), text);

check('R7 Derselbe Stream überschreibt seinen Bericht', reports.archive(closed(start1, 5)) === id && reports.list().length === 1);
const start1b = new Date(2026, 10, 10, 21, 13, 30).toISOString();
check('R8 Anderer Stream in derselben Minute bekommt eine Endung', reports.archive(closed(start1b, 2)) === '2026-11-10_2113-2');
reports.remove('2026-11-10_2113-2');

const start2 = new Date(2026, 10, 12, 20, 0).toISOString();
const id2 = reports.archive(closed(start2, 0.5, { aborted: true, late_start: true }));
const list = reports.list();
check('R9 Liste, neuester zuerst', list.length === 2 && list[0].id === id2 && list[1].id === id, JSON.stringify(list.map(r => r.id)));
check('R10 Hinweise bei kurz, abgebrochen und spät begonnen', list[0].warnings.length === 3 && list[0].warnings.some(w => w.includes('kürzer')) && list[0].warnings.some(w => w.includes('abgebrochen')), JSON.stringify(list[0].warnings));
const totals = reports.totals();
check('R11 Gesamt summiert alle Berichte', totals.streams === 2 && totals.duration_seconds === 5.5 * 3600 && totals.metrics.find(m => m.key === 'follows').value === 4 && totals.metrics.find(m => m.key === 'chat_messages').value === 20, JSON.stringify(totals));

fs.rmSync(path.join(dir, `${id2}.txt`));
check('R12 Fehlt die .txt, wird der Text neu erzeugt', (reports.text(id2) || '').includes('Hinweise:'));
check('R13 Unbekannte oder ungültige ID: kein Text', reports.text('2026-01-01_0000') === null && reports.text('../.env') === null);

// !privat (ADR 0022): Anna (ID 1) wird in allen Berichten anonymisiert
const withTop = closed(start1, 3);
withTop.summary.top_chatters = [{ name: 'Anna', count: 7 }, { name: 'Bert', count: 3 }];
const idTop = reports.archive(withTop);
const changed = reports.anonymize('1', 'anonymer Schlaumeier');
const anonReport = JSON.parse(fs.readFileSync(path.join(dir, `${idTop}.json`), 'utf8'));
const anonText = fs.readFileSync(path.join(dir, `${idTop}.txt`), 'utf8');
check('R19 Anonymisieren ändert alle Berichte mit der ID, ohne Name in .json und .txt', changed === 2 && !JSON.stringify(anonReport).includes('Anna') && !anonText.includes('Anna')
  && anonReport.state.chatters['anon-1'].count === 7 && anonReport.summary.top_chatters[0].name === 'anonymer Schlaumeier' && anonText.includes('1. anonymer Schlaumeier (7)'), JSON.stringify(anonReport.state.chatters));
check('R20 Summen und verschiedene Chatter bleiben', anonText.includes('Verschiedene Chatter: 2') && reports.totals().streams === 2, anonText);
check('R21 Zweiter Aufruf ändert nichts mehr', reports.anonymize('1', 'anonymer Schlaumeier') === 0);

fs.writeFileSync(path.join(dir, '2026-11-13_1000.json'), '{ kaputt');
fs.writeFileSync(path.join(dir, 'fremd.json'), '{}');
const before = warnings.length;
check('R14 Unlesbare und fremde Dateien werden übergangen', reports.list().length === 2 && warnings.length === before + 1, JSON.stringify(warnings));

check('R15 Ungültige ID wird nicht gelöscht', reports.remove('../stream_reports/2026-11-10_2113') === false && fs.existsSync(path.join(dir, `${id}.json`)));
check('R16 Löschen entfernt beide Dateien', reports.remove(id) === true && !fs.existsSync(path.join(dir, `${id}.json`)) && !fs.existsSync(path.join(dir, `${id}.txt`)) && reports.list().length === 1);
check('R17 Zweites Löschen: nichts mehr da', reports.remove(id) === false);
check('R17a Vorhanden-Prüfung', reports.exists(id2) && !reports.exists(id) && !reports.exists('../.env'));
fs.rmSync(path.join(dir, `${id2}.json`));
check('R17b Von Hand gelöschter Bericht fällt aus der Liste', reports.list().length === 0 && reports.totals().streams === 0);

check('R18 Hinweise je Fall', reportWarnings({ duration_seconds: 7200 }, 3600).length === 0 && reportWarnings({ duration_seconds: 100, aborted: true }, 3600).length === 2);

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(results.every(x => x.ok) ? 0 : 1);
