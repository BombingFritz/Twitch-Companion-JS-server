// Stream-Kartei Stufe 1b (Issue #87, Spec docs/specs/stream-kartei.md „Akte, Boot und Karriere“):
// Lebenslauf, Orden, Leistungen, Boot, Karriere, Versenkungen aus einem erzeugten Spielstand (test/uboat-fixture.js).
// Kein Server, keine Netzwerkanfragen; eigenes Arbeitsverzeichnis.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const fx = require('./uboat-fixture');
const { parseSave } = require('../lib/uboat-save');
const { createUboatCrew } = require('../lib/uboat-crew');
const { buildUboatCrew } = require('../lib/stream-kartei');

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ` – ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}

function setup(dirName, saveOpts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${dirName}-`));
  const savesDir = path.join(root, 'UBOAT', 'Saves');
  fs.mkdirSync(savesDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'UBOAT', 'Data Sheets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'UBOAT', 'Data Sheets', 'UBOAT - Locales.dat'), fx.buildLocales(fx.DEFAULT_LOCALES));
  fs.writeFileSync(path.join(savesDir, 'Akte.save'), fx.buildSave(saveOpts));
  const logs = [];
  const crew = createUboatCrew({ savesDir, log: (level, msg) => logs.push(`${level} ${msg}`) });
  crew.reload();
  return { root, savesDir, crew, logs };
}

// --- Format: parseSave direkt ---
{
  const raw = fx.buildSave({ crew: fx.AKTE_CREW, career: fx.DEFAULT_CAREER });
  const res = parseSave(raw);
  const fritz = res.crew.find(c => c.name === 'Fritz Unsinkbar');
  const alpaka = res.crew.find(c => c.name === 'Alpaka');
  check('A1 Orden: eingebettet und als Verweis gelesen', JSON.stringify(fritz.decorationNames) === '["Iron Cross 2nd Class","U-boat War Badge"]'
    && JSON.stringify(alpaka.decorationNames) === '["U-boat War Badge"]', { fritz: fritz.decorationNames, alpaka: alpaka.decorationNames });
  check('A2 Leistungen: 3 Stück mit Schlüssel, Argument und Ordensart', fritz.accomplishments.length === 3
    && fritz.accomplishments[0].key === 'UI/Accomplishments/Sunk Ship Freighter' && fritz.accomplishments[0].args[0] === 'Samythian'
    && fritz.accomplishments[0].awardType === 'Iron Cross' && fritz.accomplishments[0].points === 7, fritz.accomplishments);
  check('A3 Verschachteltes Argument: Verweis auf LocalizedString aufgelöst', fritz.accomplishments[1].args[1] && fritz.accomplishments[1].args[1].key === 'Entities/Freighter', fritz.accomplishments[1]);
  check('A4 Lebenslauf: Schlüssel und Name bei der Anwerbung', alpaka.background && alpaka.background.key === 'UI/RecruitmentUI/Backgrounds/Story 7'
    && alpaka.background.args[0] === 'Hermann Herrmann', alpaka.background);
  check('A5 Ohne Lebenslauf: null', fritz.background === null, fritz.background);
  const k = res.career;
  check('A6 Karriere trotz 33 Byte Präfix gelesen', k && k.startDate === '1941-08-01' && k.torpedoesFired === 12 && k.assignmentIndex === 2, k && { startDate: k.startDate, torpedoesFired: k.torpedoesFired });
  check('A7 DateTime-Struktur: Indienststellung', k && k.ships[0] && k.ships[0].commissioned === '1939-08-01', k && k.ships);
  check('A8 Versenkungen: 2, eine ohne Namen', k && k.sinkings.length === 2 && k.sinkings[0].name === 'Samythian' && k.sinkings[1].name === null, k && k.sinkings);
  check('A9 Ereignis mit Datum', k && k.events.length === 1 && k.events[0].date === '1941-08-08', k && k.events);
  const plain = parseSave(fx.buildSave({ crew: fx.DEFAULT_CREW }));
  check('A10 Spielstand ohne Karriere und ohne Akte: Crew wie bisher', plain.crew.length === 9 && plain.career === null
    && plain.crew.every(c => c.decorationNames.length === 0 && c.accomplishments.length === 0 && c.background === null), { career: plain.career, n: plain.crew.length });
}

// --- Deutsch und Ausgabe: uboat-crew + stream-kartei ---
{
  const { crew, logs, root } = setup('uboat-akte', { crew: fx.AKTE_CREW, career: fx.DEFAULT_CAREER });
  const st = crew.getState();
  const fritz = st.crew.find(m => m.name === 'Fritz Unsinkbar');
  const alpaka = st.crew.find(m => m.name === 'Alpaka');
  check('D1 Lebenslauf deutsch, heutiger Name statt Name bei der Anwerbung', alpaka.background === 'Alpaka stammt aus Kiel und liest gern.', alpaka.background);
  check('D2 Orden deutsch', JSON.stringify(fritz.decorationNames) === '["Eisernes Kreuz 2. Klasse","U-Boot-Kriegsabzeichen"]', fritz.decorationNames);
  check('D3 Leistungen deutsch mit Art', JSON.stringify(fritz.accomplishments) === JSON.stringify([
    { kind: 'Sunk Ship Freighter', text: 'Versenkung von Frachter "Samythian".' },
    { kind: 'Torpedo Course', text: 'Torpedo Ziellösung "Samythian" Frachter.' },
    { kind: 'Assignment Completed', text: 'Auftrag abgeschlossen.' },
  ]), fritz.accomplishments);
  const data = buildUboatCrew(st);
  check('D4 Boot: Typ deutsch ohne „(Player)“', JSON.stringify(data.boat) === JSON.stringify({ name: 'U-68', typeLabel: 'Typ IXC', commissioned: '1939-08-01', tonnageSunk: 15000, merchantShipsSunk: 2, warshipsSunk: 0, aircraftShotDown: 0 }), data.boat);
  const c = data.career;
  check('D5 Karriere: Meter gerundet, Stunden mit einer Stelle', c && c.farthestTorpedoHitM === 1555 && c.maximumDepthM === 204 && c.hoursUnderWater === 61.3
    && c.hoursAtSea === 100 && c.distanceTravelled === 4322 && c.fuelConsumedLitres === 9876 && c.currentPatrol === 2 && c.casualties === 0, c);
  check('D6 Gedenktafel: Hafen deutsch', JSON.stringify(data.plaques) === '[{"boat":"U-68","port":"Hafen von Brest"}]', data.plaques);
  check('D7 Versenkung: Art aus Leistungen, Ladung, Geleitzug, Ziel, Datum aus Ereignis', JSON.stringify(data.sinkings[0]) === JSON.stringify({
    name: 'Samythian', grt: 7783, kindLabel: 'Frachter', cargoLabel: 'Öl', convoy: 'Geleitzug 148', destination: 'Liverpool', patrol: 1, date: '1941-08-08', damagedOnly: false }), data.sinkings[0]);
  check('D8 Versenkung ohne Namen und ohne Ereignis: null-Felder, kein Geleitzug', JSON.stringify(data.sinkings[1]) === JSON.stringify({
    name: null, grt: null, kindLabel: null, cargoLabel: null, convoy: null, destination: null, patrol: 2, date: null, damagedOnly: false }), data.sinkings[1]);
  const crewOut = data.crew.find(m => m.name === 'Alpaka');
  check('D9 crew.json: Akte je Figur', crewOut.background === 'Alpaka stammt aus Kiel und liest gern.' && JSON.stringify(crewOut.decorationNames) === '["U-Boot-Kriegsabzeichen"]'
    && Array.isArray(crewOut.accomplishments) && crewOut.accomplishments.length === 0, crewOut);
  const fallen = data.fallen.find(m => m.name === 'Gefallener Gustav');
  check('D10 Ehrentafel: Akte-Felder vorhanden', fallen && fallen.background === null && Array.isArray(fallen.decorationNames) && Array.isArray(fallen.accomplishments), fallen);
  const json = JSON.stringify(data);
  check('D11 Name bei der Anwerbung erscheint nirgends', !json.includes('Hermann Herrmann'));
  check('D12 Keine englischen Schlüssel außer kind', !/UI\/Accomplishments|Items\/|Entities\//.test(json), json.match(/(UI\/Accomplishments|Items\/|Entities\/)[^"]*/g));
  const hidden = buildUboatCrew(st, { isHidden: m => m.name === 'Fritz Unsinkbar' });
  check('D13 !privat: Akte fehlt mit der Figur, Boot und Versenkungen bleiben', !JSON.stringify(hidden).includes('Eisernes Kreuz 2. Klasse')
    && !hidden.crew.some(m => m.name === 'Fritz Unsinkbar') && hidden.sinkings.length === 2 && hidden.boat && hidden.boat.name === 'U-68');
  check('D14 Keine Warnung beim Einlesen', !logs.some(l => l.startsWith('warn')), logs);
  fs.rmSync(root, { recursive: true, force: true });
}

// --- Ohne Karriere: leere Listen, null ---
{
  const { crew, root } = setup('uboat-akte-ohne', { crew: fx.DEFAULT_CREW });
  const data = buildUboatCrew(crew.getState());
  check('O1 Ohne Karriere: boat/career null, plaques/sinkings leer', data.boat === null && data.career === null && data.plaques.length === 0 && data.sinkings.length === 0,
    { boat: data.boat, career: data.career });
  check('O2 Ohne Akte: Felder leer, Anzahl der Orden bleibt', data.crew.every(m => m.background === null && m.decorationNames.length === 0 && m.accomplishments.length === 0)
    && data.crew.find(m => m.name === 'Fritz Unsinkbar').decorations === 4);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} FEHLER` : '\nAlle Prüfungen bestanden');
process.exit(failed ? 1 : 0);
