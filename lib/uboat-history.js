// UBOAT-Verlauf (Stream-Kartei Stufe 1c, Spec docs/specs/stream-kartei.md „Feindfahrten je Person und gesicherter Lebenslauf“):
// Was das Spiel nicht selbst behält, hält der Server je Kampagne nach:
//  - Lebenslauf: Offiziere verlieren ihn im Spiel; wer schon als Offizier hinzukam, hatte nie einen (Nutzer, 22.11.2026).
//    Gesichert wird er beim ersten Sehen.
//  - Feindfahrten je Person: Nummer der Feindfahrt (assignmentIndex), wenn die Figur in einem Spielstand auf See an Bord ist.
//  - Umbenennungen: Figuren werden oft nach Zuschauern umbenannt, Namen auch weitergegeben. Feste Merkmale entscheiden
//    (Nutzer, 22.11.2026): Geburtszeitpunkt ist Pflicht, der Charakterzug zählt am stärksten, dann der Typ; die Fähigkeiten
//    (wachsen mit der Zeit) entscheiden nur zwischen sonst gleichen Kandidaten.
// Reine Logik ohne Dateisystem; Laden und Speichern übergibt server.js (loadUboatHistory/saveUboatHistory).
'use strict';

const HISTORY_VERSION = 1;
const STATUS_ON_BOARD = 1;
// Charakterzüge (Locales/UI/CrewListUI, Patch 21). uboat-crew.js gibt sie aus den Spieltexten mit (traitKeys); dies ist der Ersatz.
const DEFAULT_TRAIT_KEYS = ['AnxiousPersonality', 'Weak', 'SeaWolf'];
// Ohne gleichen Charakterzug (beobachtet einmal: Zug kam später dazu) nur bei gleichem Typ und sehr ähnlichen Fähigkeiten
const RENAME_MIN_SKILL_SIMILARITY_WITHOUT_TRAIT = 0.7;
// Gewichte der Zuordnung: Charakterzug vor Typ vor Fähigkeiten (Ähnlichkeit 0–1)
const WEIGHT_SAME_TRAITS = 100;
const WEIGHT_SAME_TYPE = 10;

// Kampagne = Startszenario und Startdatum, z. B. "U-68|1941-08-01". Ohne beides: null (dann kein Verlauf).
function campaignKey(career) {
  return career && career.startScenarioId && career.startDate ? `${career.startScenarioId}|${career.startDate}` : null;
}

function emptyHistory() { return { version: HISTORY_VERSION, campaigns: {} }; }

function cleanPerson(p, i) {
  const names = Array.isArray(p.names) ? p.names.filter(n => typeof n === 'string') : [];
  const name = typeof p.name === 'string' ? p.name : names[names.length - 1];
  if (!name) return null;
  return {
    id: Number.isInteger(p.id) ? p.id : i + 1,
    name, names: names.length ? names : [name],
    birth: typeof p.birth === 'string' ? p.birth : null,
    type: Number.isInteger(p.type) ? p.type : null,
    traits: Array.isArray(p.traits) ? p.traits.filter(s => typeof s === 'string').sort() : null,
    statuses: Array.isArray(p.statuses) ? p.statuses.filter(s => typeof s === 'string') : [],
    background: p.background && typeof p.background.key === 'string' ? { key: p.background.key, args: Array.isArray(p.background.args) ? p.background.args.filter(a => typeof a === 'string') : [] } : null,
    patrols: Array.isArray(p.patrols) ? [...new Set(p.patrols.filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b) : [],
  };
}

function normalize(raw) {
  const h = emptyHistory();
  if (!raw || typeof raw !== 'object' || !raw.campaigns || typeof raw.campaigns !== 'object' || Array.isArray(raw.campaigns)) return h;
  for (const [key, c] of Object.entries(raw.campaigns)) {
    if (!c || typeof c !== 'object') continue;
    let list = Array.isArray(c.persons) ? c.persons : [];
    // Übergang: erste Fassung (PR #90) führte "figures" nach Namen; ohne Geburtszeitpunkt, der kommt beim nächsten Spielstand
    if (!list.length && c.figures && typeof c.figures === 'object') {
      list = Object.entries(c.figures).map(([name, f], i) => ({ id: i + 1, name, names: [name], background: f && f.background, patrols: f && f.patrols }));
    }
    const persons = list.map((p, i) => (p && typeof p === 'object' ? cleanPerson(p, i) : null)).filter(Boolean);
    const patrols = {};
    for (const [n, start] of Object.entries(c.patrols || {})) if (/^\d+$/.test(n)) patrols[n] = typeof start === 'string' ? start : null;
    h.campaigns[key] = { patrols, persons };
  }
  return h;
}

function similarity(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Merkmale einer Figur aus dem Spielstand: Geburtszeitpunkt, Typ, Charakterzüge, übrige Zustände (Fähigkeiten usw.)
function profileOf(c) {
  const statuses = [...new Set(c.statuses || [])].sort();
  const traitSet = new Set(Array.isArray(c.traitKeys) ? c.traitKeys : DEFAULT_TRAIT_KEYS);
  return { birth: c.birthTicks || null, type: c.type, traits: statuses.filter(s => traitSet.has(s)), statuses };
}

// Wie gut passt ein neuer Name (b) zu einer bekannten Person (a)? null = nicht dieselbe Person.
// Pflicht: gleicher Geburtszeitpunkt. Gleicher Charakterzug zählt am stärksten, dann gleicher Typ (Beförderung möglich),
// die Fähigkeiten nur als Feinentscheid. Ohne gleichen Charakterzug nur bei gleichem Typ und sehr ähnlichen Fähigkeiten.
function renameScore(a, b) {
  if (!a.birth || a.birth !== b.birth) return null;
  const traitsKnown = Array.isArray(a.traits);
  const sameTraits = traitsKnown && sameList(a.traits, b.traits);
  const sameType = a.type === b.type;
  const skillsA = a.statuses.filter(s => !(a.traits || []).includes(s)), skillsB = b.statuses.filter(s => !b.traits.includes(s));
  const skills = similarity(skillsA, skillsB);
  if (!sameTraits && !(sameType && skills >= RENAME_MIN_SKILL_SIMILARITY_WITHOUT_TRAIT)) return null;
  return (sameTraits ? WEIGHT_SAME_TRAITS : 0) + (sameType ? WEIGHT_SAME_TYPE : 0) + skills;
}

// Paare (bekannt, neu) nach Wert, beste zuerst, je Seite höchstens einmal
function bestPairs(known, fresh, score) {
  const pairs = [];
  for (const a of known) for (const b of fresh) { const s = score(a, b); if (s !== null) pairs.push({ a, b, s }); }
  pairs.sort((x, y) => y.s - x.s);
  const out = new Map(), usedA = new Set();
  for (const { a, b } of pairs) if (!out.has(b) && !usedA.has(a)) { out.set(b, a); usedA.add(a); }
  return out;
}

// Crew eines Spielstands Personen im Verlauf zuordnen: erst gleicher Name und Geburtszeitpunkt (Einträge aus der ersten
// Fassung ohne Geburtszeitpunkt: nur Name), dann Umbenennungen nach renameScore, sonst neue Person.
function matchCrew(camp, crew) {
  const assigned = new Map(), used = new Set();
  for (const c of crew) {
    const p = camp.persons.find(x => !used.has(x) && x.name === c.name && (x.birth === c.birthTicks || x.birth === null));
    if (p) { assigned.set(c, p); used.add(p); }
  }
  const open = crew.filter(c => !assigned.has(c));
  const renamed = bestPairs(camp.persons.filter(p => !used.has(p)), open, (p, c) => renameScore(p, profileOf(c)));
  for (const [c, p] of renamed) assigned.set(c, p);
  return assigned;
}

// Einen eingelesenen Spielstand (Ergebnis von parseSave) in den Verlauf übernehmen. Ändert h; Ergebnis: geändert ja/nein.
function observe(h, res) {
  const key = campaignKey(res && res.career);
  if (!key) return false;
  let changed = false;
  let camp = h.campaigns[key];
  if (!camp) { camp = h.campaigns[key] = { patrols: {}, persons: [] }; changed = true; }
  const k = res.career;
  const patrol = Number.isInteger(k.assignmentIndex) && k.assignmentIndex > 0 ? k.assignmentIndex : null;
  if (patrol && k.patrolStart && camp.patrols[patrol] !== k.patrolStart) { camp.patrols[patrol] = k.patrolStart; changed = true; }
  const crew = (res.crew || []).filter(c => c.name);
  const assigned = matchCrew(camp, crew);
  for (const c of crew) {
    let p = assigned.get(c);
    if (!p) {
      p = { id: camp.persons.reduce((m, x) => Math.max(m, x.id), 0) + 1, name: c.name, names: [c.name], birth: c.birthTicks || null, type: c.type, traits: null, statuses: [], background: null, patrols: [] };
      camp.persons.push(p); changed = true;
    }
    if (p.name !== c.name) { p.name = c.name; if (!p.names.includes(c.name)) p.names.push(c.name); changed = true; }
    if (!p.birth && c.birthTicks) { p.birth = c.birthTicks; changed = true; }   // Eintrag aus der ersten Fassung
    // Typ nachführen: Matrosen können Offiziere werden (beobachtet: Binggeli)
    if (p.type !== c.type) { p.type = c.type; changed = true; }
    const prof = profileOf(c);
    if (prof.statuses.join('|') !== p.statuses.join('|')) { p.statuses = prof.statuses; changed = true; }
    if (!p.traits || !sameList(p.traits, prof.traits)) { p.traits = prof.traits; changed = true; }
    // Lebenslauf sichern, sobald er im Spielstand steht (erster gesehener bleibt); nur Zeichenketten-Argumente
    if (c.background && c.background.key && !p.background) {
      p.background = { key: c.background.key, args: c.background.args.filter(a => typeof a === 'string') };
      changed = true;
    }
    if (patrol && k.atSea === true && c.status === STATUS_ON_BOARD && !c.died && !p.patrols.includes(patrol)) {
      p.patrols.push(patrol); p.patrols.sort((a, b) => a - b); changed = true;
    }
  }
  return changed;
}

// Nachlesen alter Spielstände (älteste zuerst): Die Kampagne wird aus den Spielständen neu aufgebaut, damit Umbenennungen
// in zeitlicher Reihenfolge erkannt werden. Was der bisherige Verlauf darüber hinaus weiß (Spielstände, die es nicht mehr
// gibt), bleibt: gleiche Person über heutigen Namen und Geburtszeitpunkt, sonst als eigene Person.
// Liefert die Kopie und je Person, was neu dazukäme (Feindfahrten, Lebenslauf, frühere Namen).
function preview(h, results) {
  const copy = normalize(JSON.parse(JSON.stringify(h)));
  const keys = [...new Set(results.map(r => campaignKey(r && r.career)).filter(Boolean))];
  for (const key of keys) {
    const old = copy.campaigns[key] || { patrols: {}, persons: [] };
    const rebuilt = { version: HISTORY_VERSION, campaigns: {} };
    for (const res of results) if (campaignKey(res.career) === key) observe(rebuilt, res);
    const camp = rebuilt.campaigns[key];
    for (const [n, d] of Object.entries(old.patrols)) if (!camp.patrols[n]) camp.patrols[n] = d;
    // Alte Personen den neu aufgebauten zuordnen: gleicher Name und Geburtszeitpunkt (erste Fassung: nur Name),
    // sonst nach denselben Regeln wie bei Umbenennungen
    const merged = new Map(), taken = new Set();
    for (const o of old.persons) {
      const p = camp.persons.find(x => !taken.has(x) && x.name === o.name && (x.birth === o.birth || o.birth === null));
      if (p) { merged.set(o, p); taken.add(p); }
    }
    const renamed = bestPairs(camp.persons.filter(p => !taken.has(p)), old.persons.filter(o => !merged.has(o)),
      (p, o) => renameScore(p, { birth: o.birth, type: o.type, traits: o.traits || [], statuses: o.statuses }));
    for (const [o, p] of renamed) { merged.set(o, p); taken.add(p); }
    for (const o of old.persons) {
      const p = merged.get(o);
      if (!p) { camp.persons.push({ ...o, id: camp.persons.reduce((m, x) => Math.max(m, x.id), 0) + 1 }); continue; }
      p.patrols = [...new Set([...p.patrols, ...o.patrols])].sort((a, b) => a - b);
      if (!p.background && o.background) p.background = o.background;
      p.names = [...o.names.filter(n => !p.names.includes(n)), ...p.names];
    }
    copy.campaigns[key] = camp;
  }
  for (const res of results) if (!campaignKey(res.career)) observe(copy, res);
  const diff = [];
  for (const [key, camp] of Object.entries(copy.campaigns)) {
    const before = (h.campaigns[key] && h.campaigns[key].persons) || [];
    for (const p of camp.persons) {
      // Vergleich über heutigen Namen und Geburtszeitpunkt (Ids sind nach dem Neuaufbau andere)
      const old = before.find(x => x.name === p.name && x.birth === p.birth) || { patrols: [], background: null, names: [] };
      const newPatrols = p.patrols.filter(n => !old.patrols.includes(n));
      const newBackground = Boolean(p.background && !old.background);
      const newNames = p.names.filter(n => !old.names.includes(n));
      if (newPatrols.length || newBackground || newNames.length) diff.push({ campaign: key, name: p.name, names: p.names, patrols: p.patrols, newPatrols, newBackground });
    }
  }
  return { history: copy, diff };
}

// Für die Ausgabe: Feindfahrten (Anzahl, null ohne Verlauf der Kampagne) und gesicherter Lebenslauf einer Figur.
// Gesucht über den heutigen Namen und, falls bekannt, den Geburtszeitpunkt.
function figureOf(h, key, name, birthTicks = null) {
  const camp = key && h.campaigns[key];
  if (!camp) return { patrols: null, background: null, names: [] };
  const p = camp.persons.find(x => x.name === name && (!birthTicks || !x.birth || x.birth === birthTicks));
  return { patrols: p ? p.patrols.length : 0, background: p ? p.background : null, names: p ? p.names : [] };
}

// Konsole "uboat verlauf <Name>": Personen einer Kampagne, deren heutiger oder früherer Name passt.
// Erst genaue Treffer (nach norm), sonst Teilwörter. Mehrere Treffer sind gewollt, z. B. bei weitergegebenen Namen.
function findPersons(h, key, query, norm = s => String(s || '').trim().toLowerCase()) {
  const camp = key && h.campaigns[key];
  const q = norm(query);
  if (!camp || !q) return [];
  const exact = camp.persons.filter(p => p.names.concat(p.name).some(n => norm(n) === q));
  return exact.length ? exact : camp.persons.filter(p => p.names.concat(p.name).some(n => norm(n).includes(q)));
}

// Geburtszeitpunkt (Ticks seit 0001-01-01 als Zeichenkette) als Datum "JJJJ-MM-TT"; null, wenn unbekannt oder unplausibel
const TICKS_AT_UNIX_EPOCH = 621355968000000000n;
const TICKS_PER_MS = 10000n;
const TICKS_MASK = (1n << 62n) - 1n;   // die obersten zwei Bits sind bei .NET die Zeitzonenart
function birthDate(birth) {
  if (typeof birth !== 'string' || !/^\d+$/.test(birth)) return null;
  const ms = Number(((BigInt(birth) & TICKS_MASK) - TICKS_AT_UNIX_EPOCH) / TICKS_PER_MS);
  const d = new Date(ms);
  return Number.isFinite(ms) && d.getUTCFullYear() > 1800 && d.getUTCFullYear() < 2000 ? d.toISOString().slice(0, 10) : null;
}

module.exports = { campaignKey, emptyHistory, normalize, observe, preview, figureOf, findPersons, birthDate, similarity, renameScore, profileOf, HISTORY_VERSION, DEFAULT_TRAIT_KEYS };
