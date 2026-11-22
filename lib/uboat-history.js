// UBOAT-Verlauf (Stream-Kartei Stufe 1c, Spec docs/specs/stream-kartei.md „Feindfahrten je Person und gesicherter Lebenslauf“):
// Was das Spiel nicht selbst behält, hält der Server je Kampagne nach:
//  - Lebenslauf: das Spiel löscht ihn, sobald eine Figur Aufträge abgeschlossen hat; gesichert wird er beim ersten Sehen.
//  - Feindfahrten je Person: Nummer der Feindfahrt (assignmentIndex), wenn die Figur in einem Spielstand auf See an Bord ist.
//  - Umbenennungen: Figuren werden oft nach Zuschauern umbenannt, Namen auch weitergegeben. Eine Person bleibt dieselbe über
//    Geburtszeitpunkt, Typ und Eigenschaften (Fähigkeiten kommen dazu, daher Ähnlichkeit statt Gleichheit).
// Reine Logik ohne Dateisystem; Laden und Speichern übergibt server.js (loadUboatHistory/saveUboatHistory).
'use strict';

const HISTORY_VERSION = 1;
const STATUS_ON_BOARD = 1;
// Mindestähnlichkeit der Eigenschaften (Jaccard) für eine Umbenennung. Beobachtet: gleiche Person ≥ 0,7, andere ≤ 0,4.
const RENAME_MIN_SIMILARITY = 0.5;

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
    const persons = (Array.isArray(c.persons) ? c.persons : []).map((p, i) => (p && typeof p === 'object' ? cleanPerson(p, i) : null)).filter(Boolean);
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

// Crew eines Spielstands Personen im Verlauf zuordnen: erst gleicher Name und Geburtszeitpunkt, dann Umbenennungen
// (gleicher Geburtszeitpunkt und Typ, ähnliche Eigenschaften, beste Paare zuerst), sonst neue Person.
function matchCrew(camp, crew) {
  const assigned = new Map(), used = new Set();
  for (const c of crew) {
    const p = camp.persons.find(x => !used.has(x) && x.name === c.name && x.birth === c.birthTicks);
    if (p) { assigned.set(c, p); used.add(p); }
  }
  const pairs = [];
  for (const c of crew) {
    if (assigned.has(c)) continue;
    for (const p of camp.persons) {
      if (used.has(p) || p.birth !== c.birthTicks || p.type !== c.type) continue;
      const s = similarity(p.statuses, c.statuses || []);
      if (s >= RENAME_MIN_SIMILARITY) pairs.push({ c, p, s });
    }
  }
  pairs.sort((x, y) => y.s - x.s);
  for (const { c, p } of pairs) if (!assigned.has(c) && !used.has(p)) { assigned.set(c, p); used.add(p); }
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
      p = { id: camp.persons.reduce((m, x) => Math.max(m, x.id), 0) + 1, name: c.name, names: [c.name], birth: c.birthTicks || null, type: c.type, statuses: [], background: null, patrols: [] };
      camp.persons.push(p); changed = true;
    }
    if (p.name !== c.name) { p.name = c.name; if (!p.names.includes(c.name)) p.names.push(c.name); changed = true; }
    // Typ nachführen: Matrosen können Offiziere werden (beobachtet: Binggeli); Umbenennung danach prüft den neuen Typ
    if (p.type !== c.type) { p.type = c.type; changed = true; }
    const st = [...new Set(c.statuses || [])].sort();
    if (st.join('|') !== p.statuses.join('|')) { p.statuses = st; changed = true; }
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
    // Alte Personen den neu aufgebauten zuordnen: gleicher Name und Geburtszeitpunkt, sonst wie bei Umbenennungen
    const merged = new Map(), taken = new Set();
    for (const o of old.persons) {
      const p = camp.persons.find(x => !taken.has(x) && x.name === o.name && x.birth === o.birth);
      if (p) { merged.set(o, p); taken.add(p); }
    }
    const pairs = [];
    for (const o of old.persons) {
      if (merged.has(o)) continue;
      for (const p of camp.persons) {
        if (taken.has(p) || p.birth !== o.birth || p.type !== o.type) continue;
        const s = similarity(o.statuses, p.statuses);
        if (s >= RENAME_MIN_SIMILARITY) pairs.push({ o, p, s });
      }
    }
    pairs.sort((x, y) => y.s - x.s);
    for (const { o, p } of pairs) if (!merged.has(o) && !taken.has(p)) { merged.set(o, p); taken.add(p); }
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

module.exports = { campaignKey, emptyHistory, normalize, observe, preview, figureOf, similarity, HISTORY_VERSION, RENAME_MIN_SIMILARITY };
