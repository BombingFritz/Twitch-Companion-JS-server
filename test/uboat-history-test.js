// Stream-Kartei Stufe 1c (Spec docs/specs/stream-kartei.md „Feindfahrten je Person und gesicherter Lebenslauf“):
// Verlauf je Kampagne aus erzeugten Spielständen (test/uboat-fixture.js). Kein Server, eigenes Arbeitsverzeichnis.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const fx = require('./uboat-fixture');
const { parseSave } = require('../lib/uboat-save');
const H = require('../lib/uboat-history');
const { createUboatCrew } = require('../lib/uboat-crew');
const { buildUboatCrew } = require('../lib/stream-kartei');

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ` – ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}

const BG = { key: 'UI/RecruitmentUI/Backgrounds/Story 7', args: ['Hermann Herrmann'] };
// Crew in drei Lagen: Alpaka erst in Reserve mit Lebenslauf, später an Bord ohne (das Spiel löscht ihn)
const crewAt = ({ alpakaOnBoard, alpakaBackground }) => fx.DEFAULT_CREW.map(c => (c.name === 'Alpaka'
  ? { ...c, status: alpakaOnBoard ? 1 : 0, background: alpakaBackground ? BG : undefined }
  : c));
const career = (patrol, patrolStart, lastDock) => ({ ...fx.DEFAULT_CAREER, assignmentIndex: patrol, patrolStart, lastDock });

const saves = {
  p1See: fx.buildSave({ crew: crewAt({ alpakaOnBoard: false, alpakaBackground: true }), career: career(1, '1941-08-05') }),
  p1Hafen: fx.buildSave({ crew: crewAt({ alpakaOnBoard: true, alpakaBackground: true }), career: career(1, '1941-08-05', '1941-08-19') }),
  p2See: fx.buildSave({ crew: crewAt({ alpakaOnBoard: true, alpakaBackground: false }), career: career(2, '1941-08-21') }),
  fremd: fx.buildSave({ crew: crewAt({ alpakaOnBoard: true, alpakaBackground: false }), career: { ...career(5, '1942-01-10'), scenario: 'U-96', startDate: '1941-01-09' } }),
};

// --- Leser: Fahrtstart und "auf See" ---
{
  const k1 = parseSave(saves.p1See).career, kH = parseSave(saves.p1Hafen).career;
  check('L1 Fahrtstart gelesen, auf See (angelegt am Starttag)', k1.patrolStart === '1941-08-05' && k1.atSea === true, { patrolStart: k1.patrolStart, atSea: k1.atSea });
  check('L2 Im Hafen nach der Rückkehr: nicht auf See', kH.atSea === false, kH.atSea);
  check('L3 Kampagne: Szenario und Startdatum', H.campaignKey(k1) === 'U-68|1941-08-01', H.campaignKey(k1));
}

// --- Verlauf: observe ---
{
  const h = H.emptyHistory();
  const key = 'U-68|1941-08-01';
  check('V1 Erster Spielstand ändert den Verlauf', H.observe(h, parseSave(saves.p1See)) === true);
  check('V2 Gleicher Spielstand noch einmal: keine Änderung (kein Schreiben)', H.observe(h, parseSave(saves.p1See)) === false);
  const fritz1 = H.figureOf(h, key, 'Fritz Unsinkbar'), alp1 = H.figureOf(h, key, 'Alpaka');
  check('V3 An Bord auf See: Feindfahrt 1 gezählt; in Reserve: nicht', fritz1.patrols === 1 && alp1.patrols === 0, { fritz1, alp1 });
  check('V4 Lebenslauf gesichert', alp1.background && alp1.background.key === BG.key && alp1.background.args[0] === 'Hermann Herrmann', alp1);
  H.observe(h, parseSave(saves.p1Hafen));
  check('V5 Im Hafen an Bord: zählt nicht', H.figureOf(h, key, 'Alpaka').patrols === 0, H.figureOf(h, key, 'Alpaka'));
  H.observe(h, parseSave(saves.p2See));
  const alp2 = H.figureOf(h, key, 'Alpaka');
  check('V6 Feindfahrt 2 an Bord gezählt; gesicherter Lebenslauf bleibt, obwohl das Spiel ihn gelöscht hat', alp2.patrols === 1 && alp2.background && alp2.background.key === BG.key, alp2);
  check('V7 Feindfahrten der Kampagne mit Startdatum', JSON.stringify(h.campaigns[key].patrols) === '{"1":"1941-08-05","2":"1941-08-21"}', h.campaigns[key].patrols);
  check('V8 Gefallene zählen nicht', H.figureOf(h, key, 'Gefallener Gustav').patrols === 0);
  H.observe(h, parseSave(saves.fremd));
  check('V9 Andere Kampagne getrennt', H.figureOf(h, key, 'Fritz Unsinkbar').patrols === 2 && H.figureOf(h, 'U-96|1941-01-09', 'Fritz Unsinkbar').patrols === 1,
    { u68: H.figureOf(h, key, 'Fritz Unsinkbar'), u96: H.figureOf(h, 'U-96|1941-01-09', 'Fritz Unsinkbar') });
  check('V10 Ohne Verlauf der Kampagne: null', H.figureOf(h, 'U-1|1939-09-01', 'Fritz Unsinkbar').patrols === null);
  const round = H.normalize(JSON.parse(JSON.stringify(h)));
  check('V11 Speichern und Laden ergeben denselben Verlauf', JSON.stringify(round) === JSON.stringify(h));
  check('V12 Defekte Datei: leerer Verlauf', JSON.stringify(H.normalize({ campaigns: 'kaputt' })) === JSON.stringify(H.emptyHistory()) && JSON.stringify(H.normalize(null)) === JSON.stringify(H.emptyHistory()));
}

// --- Vorschau beim Nachlesen ---
{
  const h = H.emptyHistory();
  H.observe(h, parseSave(saves.p2See));
  const before = JSON.stringify(h);
  const pv = H.preview(h, [parseSave(saves.p1See), parseSave(saves.p1Hafen)]);
  check('P1 Vorschau ändert den Verlauf nicht', JSON.stringify(h) === before);
  const fritz = pv.diff.find(d => d.name === 'Fritz Unsinkbar'), alp = pv.diff.find(d => d.name === 'Alpaka');
  check('P2 Vorschau: Feindfahrt 1 neu für Fritz, Lebenslauf neu für Alpaka', fritz && JSON.stringify(fritz.newPatrols) === '[1]' && JSON.stringify(fritz.patrols) === '[1,2]'
    && alp && alp.newBackground === true && alp.newPatrols.length === 0, { fritz, alp });
  check('P3 Nichts Neues: leere Liste', H.preview(pv.history, [parseSave(saves.p1See)]).diff.length === 0);
}

// --- Crew mit Verlauf: Ausgabe, Nachlesen über den Ordner ---
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uboat-verlauf-'));
  const savesDir = path.join(root, 'UBOAT', 'Saves');
  fs.mkdirSync(savesDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'UBOAT', 'Data Sheets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'UBOAT', 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
  const put = (name, buf, minutesAgo) => { const f = path.join(savesDir, name); fs.writeFileSync(f, buf); const t = new Date(Date.now() - minutesAgo * 60000); fs.utimesSync(f, t, t); };
  put('Alt.save', saves.p1See, 30);
  put('Fremd.save', saves.fremd, 20);
  put('Neu.save', saves.p2See, 1);
  let hist = H.emptyHistory(), writes = 0;
  const crew = createUboatCrew({ savesDir, log: () => {}, history: { observe: res => { if (H.observe(hist, res)) writes++; }, figure: (k, n) => H.figureOf(hist, k, n) } });
  crew.reload();
  let alp = crew.getState().crew.find(m => m.name === 'Alpaka');
  check('C1 Neuester Stand ohne Lebenslauf, Verlauf leer: kein Lebenslauf, 1 Feindfahrt', alp.background === null && alp.patrols === 1 && writes === 1, { alp: { bg: alp.background, patrols: alp.patrols }, writes });
  const scan = await crew.scanCampaignSaves();
  check('C2 Nachlesen: nur Spielstände derselben Kampagne, älteste zuerst', JSON.stringify(scan.saves.map(s => s.name)) === '["Alt.save","Neu.save"]' && scan.campaign === 'U-68|1941-08-01', scan.saves.map(s => s.name));
  const pv = H.preview(hist, scan.saves.map(s => s.res));
  hist = pv.history;
  crew.rebuild();
  alp = crew.getState().crew.find(m => m.name === 'Alpaka');
  check('C3 Nach dem Übernehmen: Lebenslauf aus altem Stand, mit heutigem Namen', alp.background === 'Alpaka stammt aus Kiel und liest gern.', alp.background);
  const fritz = crew.getState().crew.find(m => m.name === 'Fritz Unsinkbar');
  check('C4 Feindfahrten je Person nach dem Nachlesen', fritz.patrols === 2 && alp.patrols === 1, { fritz: fritz.patrols, alp: alp.patrols });
  const data = buildUboatCrew(crew.getState());
  const out = data.crew.find(m => m.name === 'Fritz Unsinkbar');
  check('C5 crew.json: patrols je Person, auch in der Ehrentafel', out.patrols === 2 && data.fallen.every(m => 'patrols' in m), out);
  check('C6 Saves-Ordner unverändert (nur gelesen)', fs.readdirSync(savesDir).sort().join(',') === 'Alt.save,Fremd.save,Neu.save');
  const plain = createUboatCrew({ savesDir, log: () => {} });
  plain.reload();
  check('C7 Ohne Verlauf: patrols null', plain.getState().crew.every(m => m.patrols === null));
  fs.rmSync(root, { recursive: true, force: true });
  console.log(failed ? `\n${failed} FEHLER` : '\nAlle Prüfungen bestanden');
  process.exit(failed ? 1 : 0);
})();
