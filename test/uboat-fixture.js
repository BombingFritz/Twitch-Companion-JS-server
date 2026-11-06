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
  ['decorations', td(4, [td(0)])], ['fate', td(13)], ['role', td(0)], ['accomplishments', td(4, [td(0)])],
];
const STATUS_DATA_ORDER = [['name', td(7)], ['hidden', td(19)], ['character', td(0)]];
const ROLE_DATA_ORDER = [['name', td(7)], ['isUnsaved', td(19)]];

function schema(dataOrder) {
  const decl = dataOrder.slice().reverse();
  return Buffer.concat([i32(decl.length), ...decl.map(([n, t]) => Buffer.concat([str(n), t]))]);
}

function buildSave({ version = '2026.1 Patch 21', crew = [] } = {}) {
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

  // Fremdcharakter vor der Crew, damit die erste PlayableCharacterData-Instanz kein Crewmitglied ist
  const all = [{ name: 'Arthur Smith', type: 5, cls: 'Citizen' }, ...crew];
  for (const c of all) {
    const statusList = [i32(c.statuses ? c.statuses.length : 0)];
    for (const s of c.statuses || []) {
      const typeName = 'UBOAT.Game.Scene.Characters.Skills.' + s.replace(/\s+/g, '');
      statusList.push(objHead(typeName, STATUS_DATA_ORDER, ownerRef), field(str(s)), field(u8(1)), field(u8(0, ...i32(4242))), i32(0));
    }
    const values = {
      name: str(c.name), level: i32(c.level || 0), birthDateTicks: i64(ticks('1910-05-01')),
      enrollmentTicks: i64(c.enrolled === false ? 0n : ticks(c.enrolled || '1939-08-01')), commandStartTicks: i64(0n),
      deathTicks: i64(ticks(c.died)), experiencePoints: i32(c.xp || 0), experiencePointsFromLastPatrol: i32(c.xpLP || 0),
      characterType: i32(c.type || 0), characterClass: c.cls ? str(c.cls) : Buffer.alloc(0), availableSkills: i32(0),
      statuses: Buffer.concat(statusList), status: i32(c.status ?? 1), decorations: i32(c.decorations || 0), fate: i32(0),
      role: u8(0, ...i32(c.type === 1 ? roleId : 0)), accomplishments: i32(0),
    };
    parts.push(objHead(PCD, PCD_DATA_ORDER, Buffer.concat([u8(0), i32(0), i32(0), i32(0)])));
    for (const [n] of PCD_DATA_ORDER) parts.push(field(values[n]));
  }
  parts.push(Buffer.alloc(64, 0));
  return zlib.deflateRawSync(Buffer.concat(parts));
}

// Locales.dat: <Länge><Pfad> <Kopf> 01<Text> je Sprache (Schlüssel, Englisch, Deutsch, Polnisch)
function buildLocales({ skills = {}, traits = {} } = {}) {
  const parts = [u8(0x0e), Buffer.from('2026.1-patch21')];
  const entry = (pathStr, texts) => parts.push(str(pathStr), Buffer.alloc(20, 0), ...texts.map(t => Buffer.concat([u8(1), str(t)])), u8(0));
  for (const [k, de] of Object.entries(skills)) entry('Locales/Skills/' + k, [k, k, de, 'pl']);
  for (const [k, de] of Object.entries(traits)) entry('Locales/UI/CrewListUI/' + k, [k, `<b>${k}</b>_x000D_\nEnglish text`, `<b>${de}</b>_x000D_\nDeutscher Text`, 'pl']);
  return Buffer.concat(parts);
}

const DEFAULT_LOCALES = {
  skills: { Tough: 'Hart im Nehmen', Leader: 'Befehlshaber', Radioman: 'Funker', 'Spanish Speaker': 'Spanischsprachig', 'Sensitive Hearing': 'Gutes Gehör', Authority: 'Autorität', Skipper: 'Kommandant', Runner: 'Läufer' },
  traits: { SeaWolf: 'Seewolf', AnxiousPersonality: 'Ängstlich', Weak: 'Gesundheitsprobleme' },
};

const DEFAULT_CREW = [
  { name: 'Fritz Unsinkbar', type: 2, cls: 'Leader', level: 4, xp: 281, xpLP: 200, decorations: 4, statuses: ['Skipper', 'Weak', 'Move', 'Leader', 'Spanish Speaker'] },
  { name: 'Alpaka', type: 1, cls: 'Radioman', level: 3, xp: 484, xpLP: 140, decorations: 1, statuses: ['AnxiousPersonality', 'Officer', 'Move', 'Radioman', 'Authority', 'Sensitive Hearing'] },
  { name: 'Gefallener Gustav', type: 1, cls: 'Leader', level: 2, xp: 50, died: '1941-03-12', statuses: ['SeaWolf'] },
  { name: 'Kobold', type: 0, level: 0, xp: 0, statuses: ['AnxiousPersonality', 'Sailor', 'Tough'] },
  { name: 'Major Mac', type: 0, level: 0, xp: 25, xpLP: 25, statuses: ['SeaWolf', 'Sailor', 'Runner'] },
  { name: 'Jürgen Müller', type: 0, statuses: ['Weak', 'Sailor'] },
  { name: 'Zwergwildsau', type: 0, status: 0, statuses: ['SeaWolf', 'Sailor'] },
  { name: 'Hans Peter', type: 0, statuses: ['Sailor'] },
  { name: 'Hanspeter', type: 0, statuses: ['Sailor'] },
  { name: 'Nicht Angeheuert', type: 0, enrolled: false, statuses: ['Sailor'] },
];

module.exports = { buildSave, buildLocales, DEFAULT_LOCALES, DEFAULT_CREW };
