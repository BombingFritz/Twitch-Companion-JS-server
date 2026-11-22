// Erzeugt UBOAT-Testdaten im Format echter Spielstände (siehe lib/uboat-save.js), ohne echte Spielstände
// ins Repository zu legen. Nachgebildet: rohes Deflate, Typdefinitionen inline beim ersten Objekt,
// Felder in umgekehrter Schema-Reihenfolge mit Längenangabe, Präfix vor den Feldern, 4-Byte-Trailer
// hinter Listenelementen, JSON-Kopf und Spielversion am Anfang.
const zlib = require('zlib');

const ASM = ', com.uboat.game, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null';
const PCD = 'UBOAT.Game.Scene.Characters.PlayableCharacterData';
const ROLE = 'UBOAT.Game.Scene.Characters.CharacterRole';

const u8 = (...b) => Buffer.from(b);
const i32 = v => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const i64 = v => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
function v7(n) { const out = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; out.push(x); } while (n); return Buffer.from(out); }
const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([v7(b.length), b]); };
const field = payload => Buffer.concat([i32(payload.length), payload]);
const ticks = iso => iso ? BigInt(Date.parse(iso + 'T00:00:00Z')) * 10000n + 621355968000000000n : 0n;
const td = (code, args = []) => Buffer.concat([i32(code), i32(args.length), ...args]);

// Schema in Deklarationsreihenfolge; Daten stehen umgekehrt (erstes Datenfeld = name)
const PCD_DATA_ORDER = [
  ['name', td(7)], ['level', td(13)], ['birthDateTicks', td(15)], ['enrollmentTicks', td(15)], ['commandStartTicks', td(15)],
  ['deathTicks', td(15)], ['experiencePoints', td(13)], ['experiencePointsFromLastPatrol', td(13)], ['characterType', td(13)],
  ['characterClass', td(7)], ['availableSkills', td(3, [td(0)])], ['statuses', td(4, [td(0)])], ['status', td(13)],
  ['backgroundStory', td(0)], ['decorations', td(4, [td(0)])], ['fate', td(13)], ['role', td(0)], ['accomplishments', td(4, [td(0)])],
];
const STATUS_DATA_ORDER = [['name', td(7)], ['hidden', td(19)], ['character', td(0)]];
const ROLE_DATA_ORDER = [['name', td(7)], ['isUnsaved', td(19)]];
// Stream-Kartei Stufe 1b: Typen wie im Spielstand (Patch 21), Felder in Datenreihenfolge
const LOCSTR = 'UBOAT.Game.Core.LocalizedString';
const LOCSTR_DATA_ORDER = [['keyword', td(7)], ['arguments', td(3, [td(0)])], ['flags', td(8)]];
const DECO = 'UBOAT.Game.Scene.Characters.Decoration';
const DECO_DATA_ORDER = [['name', td(7)], ['category', td(7)], ['pointsType', td(7)], ['pointsAmount', td(17)]];
const ACC = 'UBOAT.Game.Scene.Characters.PlayableCharacterData+Accomplishment';
const ACC_DATA_ORDER = [['Name', td(0)], ['Details', td(0)], ['AwardType', td(7)], ['Points', td(17)]];
const CAREER = 'UBOAT.Game.Sandbox.PlayerCareer';
const CAREER_DATA_ORDER = [
  ['budget', td(13)], ['totalTimeOnSeaOnPreviousDepartures', td(15)], ['totalTimeUnderWater', td(15)], ['maximumDepth', td(17)],
  ['startScenarioId', td(7)], ['startDate', td(1)], ['totalTorpedoesFired', td(13)], ['totalTorpedoHits', td(13)],
  ['farthestTorpedoHitDistance', td(17)], ['totalDistanceTravelled', td(18)], ['totalFuelConsumedInLitres', td(18)],
  ['totalDeckGunShotsFired', td(13)], ['totalDeckGunHits', td(13)], ['totalFlakShotsFired', td(13)], ['totalFlakHits', td(13)],
  ['casualties', td(4, [td(0)])], ['playerShipInfos', td(4, [td(0)])], ['commemorativePlaqueInfos', td(4, [td(0)])],
  ['tonnageSunk', td(13)], ['assignmentIndex', td(13)], ['pacifiedEntities', td(4, [td(0)])], ['notableEvents', td(4, [td(0)])],
];
const SHIP = 'UBOAT.Game.Sandbox.PlayerShipInfo';
const SHIP_DATA_ORDER = [['Name', td(7)], ['Type', td(7)], ['TonnageSunk', td(13)], ['MerchantShipsSunk', td(13)], ['WarshipsSunk', td(13)], ['AircraftShotDown', td(13)], ['CommisionedDate', td(1)]];
const PLAQUE = 'UBOAT.Game.Sandbox.PlayerCommemorativePlaqueInfo';
const PLAQUE_DATA_ORDER = [['PortName', td(7)], ['EmblemName', td(7)], ['BoatName', td(7)]];
const PACIFIED = 'UBOAT.Game.Sandbox.PlayerCareer+PacifiedEntityData';
const PACIFIED_DATA_ORDER = [['Name', td(7)], ['GroupId', td(7)], ['GroupName', td(0)], ['Blueprint', td(0)], ['GRT', td(13)], ['EntityPurpose', td(7)],
  ['DestinationName', td(0)], ['Latlong', td(20)], ['AssignmentIndex', td(13)], ['Country', td(0)], ['WasOnlyDamaged', td(19)]];
const EVENT = 'UBOAT.Game.Sandbox.NotableEventData';
const EVENT_DATA_ORDER = [['Id', td(7)], ['Title', td(0)], ['Subtitle', td(0)], ['Description', td(0)], ['Latitude', td(17)], ['Longitude', td(17)],
  ['Date', td(1)], ['AssignmentIndex', td(13)], ['Rewards', td(3, [td(0)])], ['PossibleRepresentations', td(3, [td(0)])], ['Displayed', td(19)]];
const f32 = v => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };
const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; };
const NULL_REF = u8(0, 0, 0, 0, 0);
// DateTime als Struktur, 21 Byte wie im Spielstand: int32, 00, int32 8, int64 Ticks, int32
const dateStruct = iso => Buffer.concat([i32(0x1d), u8(0), i32(8), i64(ticks(iso)), i32(0)]);

function schema(dataOrder) {
  const decl = dataOrder.slice().reverse();
  return Buffer.concat([i32(decl.length), ...decl.map(([n, t]) => Buffer.concat([str(n), t]))]);
}

// career (optional): { startDate, scenario, torpedoesFired, torpedoHits, farthestHit, distance, fuel, maxDepth, hoursUnderWater, hoursAtSea,
//   deckGunShots, deckGunHits, flakShots, flakHits, assignmentIndex, ship: {name, type, tonnage, merchant, warships, aircraft, commissioned},
//   plaques: [{boat, port, emblem}], sinkings: [{name, group, grt, purpose, destination, patrol, damaged}], events: [{id, date, patrol}] }
// Crew-Eintrag zusätzlich: background: {key, args}, decorationList: [Name], accomplishments: [{key, args, award, points}]
//   (args: Zeichenkette oder {ref: "Schlüssel"} für einen Verweis auf einen LocalizedString außerhalb)
function buildSave({ version = '2026.1 Patch 21', crew = [], career = null } = {}) {
  let nextObj = 100000, nextType = 900000;
  const typeIds = new Map();
  const parts = [];
  // Typkopf: bei erster Nutzung inline definieren, danach referenzieren
  function typeHead(name, dataOrder) {
    if (typeIds.has(name)) return u8(0, ...i32(typeIds.get(name)));
    const id = nextType++; typeIds.set(name, id);
    return Buffer.concat([u8(0), i32(-id), str(name + ASM), schema(dataOrder)]);
  }
  const objHead = (name, order, prefix) => Buffer.concat([u8(0), i32(-(nextObj++)), typeHead(name, order), prefix]);
  const ownerRef = u8(0, ...i32(4242));   // Präfix vor den Feldern (Bedeutung im Spiel offen)

  // Kopf mit JSON und Spielversion
  const commander = crew.find(c => c.type === 2);
  parts.push(u8(0, 0x10, 0, 0), field(str(version)), Buffer.from(JSON.stringify({ level: commander ? commander.level : 0, role: 'Watch Officer' }, null, 4).replace(/^\{/, '{\n').replace(/\n\s*\n/, '\n')), u8(0xAA, 0xAA, 0xAA));

  // eine Rolle (wird von Offizieren referenziert)
  const roleId = nextObj;
  parts.push(objHead(ROLE, ROLE_DATA_ORDER, u8(0)), field(str('Chief Boatswain')), field(u8(0)));

  // LocalizedString-Objekte außerhalb, auf die Argumente verweisen (wie Entities/Freighter im Spielstand)
  const sharedLoc = new Map();
  const locObject = (key, args = []) => {
    const argParts = [i32(args.length)];
    for (const a of args) {
      if (typeof a === 'string') argParts.push(u8(7), str(a));
      else argParts.push(u8(0), i32(sharedLoc.get(a.ref)));
    }
    return Buffer.concat([objHead(LOCSTR, LOCSTR_DATA_ORDER, Buffer.alloc(0)), field(str(key)), field(Buffer.concat(argParts)), field(u8(0)), i32(0)]);
  };
  const refKeys = new Set();
  for (const c of crew) for (const a of c.accomplishments || []) for (const x of a.args || []) if (x && x.ref) refKeys.add(x.ref);
  for (const k of refKeys) { sharedLoc.set(k, nextObj); parts.push(locObject(k)); }

  // Orden: erste Nutzung eingebettet, danach Verweis (wie im Spielstand)
  const decoIds = new Map();
  function decoElement(name) {
    if (decoIds.has(name)) return Buffer.concat([u8(0), i32(decoIds.get(name))]);
    decoIds.set(name, nextObj);
    return Buffer.concat([objHead(DECO, DECO_DATA_ORDER, Buffer.alloc(0)), field(str(name)), field(str('Medal')), field(str('Iron Cross')), field(f32(10)), i32(0)]);
  }
  const objList = elements => Buffer.concat([i32(elements.length), ...elements]);

  // Fremdcharakter vor der Crew, damit die erste PlayableCharacterData-Instanz kein Crewmitglied ist
  const all = [{ name: 'Arthur Smith', type: 5, cls: 'Citizen' }, ...crew];
  for (const c of all) {
    const statusList = [i32(c.statuses ? c.statuses.length : 0)];
    for (const s of c.statuses || []) {
      const typeName = 'UBOAT.Game.Scene.Characters.Skills.' + s.replace(/\s+/g, '');
      statusList.push(objHead(typeName, STATUS_DATA_ORDER, ownerRef), field(str(s)), field(u8(1)), field(u8(0, ...i32(4242))), i32(0));
    }
    const decorations = c.decorationList ? objList(c.decorationList.map(decoElement)) : i32(c.decorations || 0);
    const accomplishments = c.accomplishments ? objList(c.accomplishments.map(a => Buffer.concat([
      objHead(ACC, ACC_DATA_ORDER, Buffer.concat([u8(0), i32(4243), i32(0)])),   // Präfix 9 Byte wie im Spielstand
      field(locObject(a.key, a.args)), field(NULL_REF), field(str(a.award || 'Iron Cross')), field(f32(a.points ?? 5)), i32(0),
    ]))) : i32(0);
    const values = {
      name: str(c.name), level: i32(c.level || 0), birthDateTicks: i64(ticks(c.born || '1910-05-01')),
      enrollmentTicks: i64(c.enrolled === false ? 0n : ticks(c.enrolled || '1939-08-01')), commandStartTicks: i64(0n),
      deathTicks: i64(ticks(c.died)), experiencePoints: i32(c.xp || 0), experiencePointsFromLastPatrol: i32(c.xpLP || 0),
      characterType: i32(c.type || 0), characterClass: c.cls ? str(c.cls) : Buffer.alloc(0), availableSkills: i32(0),
      statuses: Buffer.concat(statusList), status: i32(c.status ?? 1),
      backgroundStory: c.background ? locObject(c.background.key, c.background.args) : NULL_REF,
      decorations, fate: i32(0), role: u8(0, ...i32(c.type === 1 ? roleId : 0)), accomplishments,
    };
    parts.push(objHead(PCD, PCD_DATA_ORDER, Buffer.concat([u8(0), i32(0), i32(0), i32(0)])));
    for (const [n] of PCD_DATA_ORDER) parts.push(field(values[n]));
  }

  if (career) {
    const k = career;
    const ship = k.ship ? [Buffer.concat([objHead(SHIP, SHIP_DATA_ORDER, Buffer.alloc(0)), field(str(k.ship.name)), field(str(k.ship.type)), field(i32(k.ship.tonnage)),
      field(i32(k.ship.merchant)), field(i32(k.ship.warships)), field(i32(k.ship.aircraft || 0)), field(dateStruct(k.ship.commissioned)), i32(0)])] : [];
    const plaques = (k.plaques || []).map(p => Buffer.concat([objHead(PLAQUE, PLAQUE_DATA_ORDER, Buffer.alloc(0)), field(str(p.port)), field(str(p.emblem || 'Badge')), field(str(p.boat)), i32(0)]));
    const sinkings = (k.sinkings || []).map(s => Buffer.concat([objHead(PACIFIED, PACIFIED_DATA_ORDER, Buffer.alloc(0)),
      field(s.name ? str(s.name) : i32(-1)), field(str(s.group)), field(NULL_REF), field(NULL_REF), field(i32(s.grt || 0)),
      field(s.purpose ? str(s.purpose) : i32(-1)), field(s.destination ? locObject(`Entities/${s.destination}`) : NULL_REF), field(f64(0)),
      field(i32(s.patrol || 1)), field(NULL_REF), field(u8(s.damaged ? 1 : 0)), i32(0)]));
    const events = (k.events || []).map(e => Buffer.concat([objHead(EVENT, EVENT_DATA_ORDER, Buffer.alloc(0)), field(str(e.id)),
      field(locObject('UI/TrophyScreenUI/Sunk Ship Title')), field(NULL_REF), field(NULL_REF), field(f32(0)), field(f32(0)),
      field(dateStruct(e.date)), field(i32(e.patrol || 1)), field(i32(0)), field(i32(0)), field(u8(1)), i32(0)]));
    const hoursToTicks = h => i64(BigInt(Math.round((h || 0) * 3.6e10)));
    const values = {
      budget: i32(1000), totalTimeOnSeaOnPreviousDepartures: hoursToTicks(k.hoursAtSea), totalTimeUnderWater: hoursToTicks(k.hoursUnderWater),
      maximumDepth: f32(k.maxDepth || 0), startScenarioId: str(k.scenario || 'U-68'), startDate: dateStruct(k.startDate),
      totalTorpedoesFired: i32(k.torpedoesFired || 0), totalTorpedoHits: i32(k.torpedoHits || 0), farthestTorpedoHitDistance: f32(k.farthestHit || 0),
      totalDistanceTravelled: f64(k.distance || 0), totalFuelConsumedInLitres: f64(k.fuel || 0),
      totalDeckGunShotsFired: i32(k.deckGunShots || 0), totalDeckGunHits: i32(k.deckGunHits || 0), totalFlakShotsFired: i32(k.flakShots || 0), totalFlakHits: i32(k.flakHits || 0),
      casualties: objList([]), playerShipInfos: objList(ship), commemorativePlaqueInfos: objList(plaques),
      tonnageSunk: i32(1234), assignmentIndex: i32(k.assignmentIndex || 1), pacifiedEntities: objList(sinkings), notableEvents: objList(events),
    };
    // Präfix 33 Byte wie im Spielstand (Ereignis-Abonnenten)
    parts.push(objHead(CAREER, CAREER_DATA_ORDER, Buffer.concat([u8(1), ...Array.from({ length: 8 }, (_, i) => i32(5000 + i))])));
    for (const [n] of CAREER_DATA_ORDER) parts.push(field(values[n]));
  }
  parts.push(Buffer.alloc(64, 0));
  return zlib.deflateRawSync(Buffer.concat(parts));
}

// Locales.dat: <Länge><Pfad> <Kopf> 01<Text> je Sprache (Schlüssel, Englisch, Deutsch, Polnisch)
// texts: { "Items/Iron Cross 1st Class": "Eisernes Kreuz 1. Klasse", … } (Schlüssel ohne "Locales/")
function buildLocales({ skills = {}, traits = {}, texts = {} } = {}) {
  const parts = [u8(0x0e), Buffer.from('2026.1-patch21')];
  const entry = (pathStr, texts) => parts.push(str(pathStr), Buffer.alloc(20, 0), ...texts.map(t => Buffer.concat([u8(1), str(t)])), u8(0));
  for (const [k, de] of Object.entries(skills)) entry('Locales/Skills/' + k, [k, k, de, 'pl']);
  for (const [k, de] of Object.entries(traits)) entry('Locales/UI/CrewListUI/' + k, [k, `<b>${k}</b>_x000D_\nEnglish text`, `<b>${de}</b>_x000D_\nDeutscher Text`, 'pl']);
  for (const [k, de] of Object.entries(texts)) entry('Locales/' + k, [k.slice(k.lastIndexOf('/') + 1), 'English', de, 'pl']);
  return Buffer.concat(parts);
}

const DEFAULT_LOCALES = {
  skills: { Tough: 'Hart im Nehmen', Leader: 'Befehlshaber', Radioman: 'Funker', 'Spanish Speaker': 'Spanischsprachig', 'Sensitive Hearing': 'Gutes Gehör', Authority: 'Autorität', Skipper: 'Kommandant', Runner: 'Läufer' },
  traits: { SeaWolf: 'Seewolf', AnxiousPersonality: 'Ängstlich', Weak: 'Gesundheitsprobleme' },
  texts: {
    'UI/RecruitmentUI/Backgrounds/Story 7': '{0} stammt aus Kiel und liest gern._x000D__x000D__x000D_',   // wie im Spiel: CR als _x000D_
    'UI/Accomplishments/Sunk Ship Freighter': 'Versenkung von Frachter "{0}".',
    'UI/Accomplishments/Torpedo Course': 'Torpedo Ziellösung "{0}" {1}.',
    'UI/Accomplishments/Assignment Completed': 'Auftrag abgeschlossen.',
    'Items/Iron Cross 2nd Class': 'Eisernes Kreuz 2. Klasse',
    'Items/U-boat War Badge': 'U-Boot-Kriegsabzeichen',
    'Items/Cargo/Oil': 'Öl',
    'Entities/Freighter': 'Frachter',
    'Entities/Liverpool': 'Liverpool',
    'Entities/Port of Brest': 'Hafen von Brest',
  },
};

// Karriere für Tests der Stufe 1b (Werte frei erfunden)
const DEFAULT_CAREER = {
  startDate: '1941-08-01', scenario: 'U-68', torpedoesFired: 12, torpedoHits: 8, farthestHit: 1555.4, distance: 4321.6, fuel: 9876.4,
  maxDepth: 204.4, hoursUnderWater: 61.25, hoursAtSea: 100.04, deckGunShots: 6, deckGunHits: 4, flakShots: 20, flakHits: 9, assignmentIndex: 2,
  ship: { name: 'U-68', type: 'Type IXC (Player)', tonnage: 15000, merchant: 2, warships: 0, aircraft: 0, commissioned: '1939-08-01' },
  plaques: [{ boat: 'U-68', port: 'Port of Brest' }],
  sinkings: [
    { name: 'Samythian', group: 'Convoy #148 Separated #2 Separated', grt: 7783, purpose: 'Oil', destination: 'Liverpool', patrol: 1 },
    { name: null, group: 'Transport #4024', grt: 0, purpose: null, destination: null, patrol: 2 },
  ],
  events: [{ id: 'Convoy #148 Separated #2 Separated', date: '1941-08-08', patrol: 1 }],
};

const DEFAULT_CREW = [
  { name: 'Fritz Unsinkbar', type: 2, cls: 'Leader', level: 4, xp: 281, xpLP: 200, decorations: 4, statuses: ['Skipper', 'Weak', 'Move', 'Leader', 'Spanish Speaker'] },
  { name: 'Alpaka', type: 1, cls: 'Radioman', level: 3, xp: 484, xpLP: 140, decorations: 1, statuses: ['AnxiousPersonality', 'Officer', 'Move', 'Radioman', 'Authority', 'Sensitive Hearing'] },
  { name: 'Gefallener Gustav', type: 1, cls: 'Leader', level: 2, xp: 50, died: '1941-03-12', statuses: ['SeaWolf'] },
  { name: 'Kobold', type: 0, level: 0, xp: 0, born: '1911-02-14', statuses: ['AnxiousPersonality', 'Sailor', 'Tough'] },
  { name: 'Major Mac', type: 0, level: 0, xp: 25, xpLP: 25, statuses: ['SeaWolf', 'Sailor', 'Runner'] },
  { name: 'Jürgen Müller', type: 0, statuses: ['Weak', 'Sailor'] },
  { name: 'Zwergwildsau', type: 0, status: 0, statuses: ['SeaWolf', 'Sailor'] },
  { name: 'Hans Peter', type: 0, statuses: ['Sailor'] },
  { name: 'Hanspeter', type: 0, statuses: ['Sailor'] },
  { name: 'Nicht Angeheuert', type: 0, enrolled: false, statuses: ['Sailor'] },
];

// DEFAULT_CREW mit Akte (Stufe 1b): Kommandant mit Orden und Leistungen, Offizier mit Lebenslauf und Verweis auf einen Orden
const AKTE_CREW = DEFAULT_CREW.map(c => {
  if (c.name === 'Fritz Unsinkbar') return { ...c, decorations: 2, decorationList: ['Iron Cross 2nd Class', 'U-boat War Badge'], accomplishments: [
    { key: 'UI/Accomplishments/Sunk Ship Freighter', args: ['Samythian'], points: 7 },
    { key: 'UI/Accomplishments/Torpedo Course', args: ['Samythian', { ref: 'Entities/Freighter' }], points: 7 },
    { key: 'UI/Accomplishments/Assignment Completed', args: [] },
  ] };
  if (c.name === 'Alpaka') return { ...c, decorations: 1, decorationList: ['U-boat War Badge'], background: { key: 'UI/RecruitmentUI/Backgrounds/Story 7', args: ['Hermann Herrmann'] } };
  return c;
});

module.exports = { buildSave, buildLocales, DEFAULT_LOCALES, DEFAULT_CREW, AKTE_CREW, DEFAULT_CAREER };
