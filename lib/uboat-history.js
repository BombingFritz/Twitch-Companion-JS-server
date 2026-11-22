// UBOAT-Verlauf (Stream-Kartei Stufe 1c, Spec docs/specs/stream-kartei.md „Feindfahrten je Person und gesicherter Lebenslauf“):
// Was das Spiel nicht selbst behält, hält der Server je Kampagne nach:
//  - Lebenslauf: das Spiel löscht ihn, sobald eine Figur Aufträge abgeschlossen hat; gesichert wird er beim ersten Sehen.
//  - Feindfahrten je Person: Nummer der Feindfahrt (assignmentIndex), wenn die Figur in einem Spielstand auf See an Bord ist.
// Reine Logik ohne Dateisystem; Laden und Speichern übergibt server.js (loadUboatHistory/saveUboatHistory).
'use strict';

const HISTORY_VERSION = 1;
const STATUS_ON_BOARD = 1;

// Kampagne = Startszenario und Startdatum, z. B. "U-68|1941-08-01". Ohne beides: null (dann kein Verlauf).
function campaignKey(career) {
  return career && career.startScenarioId && career.startDate ? `${career.startScenarioId}|${career.startDate}` : null;
}

function emptyHistory() { return { version: HISTORY_VERSION, campaigns: {} }; }

function normalize(raw) {
  const h = emptyHistory();
  if (!raw || typeof raw !== 'object' || !raw.campaigns || typeof raw.campaigns !== 'object') return h;
  for (const [key, c] of Object.entries(raw.campaigns)) {
    if (!c || typeof c !== 'object') continue;
    const figures = {};
    for (const [name, f] of Object.entries(c.figures || {})) {
      if (!f || typeof f !== 'object') continue;
      const bg = f.background && typeof f.background.key === 'string' ? { key: f.background.key, args: Array.isArray(f.background.args) ? f.background.args : [] } : null;
      const patrols = Array.isArray(f.patrols) ? [...new Set(f.patrols.filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b) : [];
      figures[name] = { background: bg, patrols };
    }
    const patrols = {};
    for (const [n, start] of Object.entries(c.patrols || {})) if (/^\d+$/.test(n)) patrols[n] = typeof start === 'string' ? start : null;
    h.campaigns[key] = { patrols, figures };
  }
  return h;
}

// Einen eingelesenen Spielstand (Ergebnis von parseSave) in den Verlauf übernehmen. Ändert h; Ergebnis: geändert ja/nein.
function observe(h, res) {
  const key = campaignKey(res && res.career);
  if (!key) return false;
  let changed = false;
  let camp = h.campaigns[key];
  if (!camp) { camp = h.campaigns[key] = { patrols: {}, figures: {} }; changed = true; }
  const k = res.career;
  const patrol = Number.isInteger(k.assignmentIndex) && k.assignmentIndex > 0 ? k.assignmentIndex : null;
  if (patrol && k.patrolStart && camp.patrols[patrol] !== k.patrolStart) { camp.patrols[patrol] = k.patrolStart; changed = true; }
  for (const c of res.crew || []) {
    if (!c.name) continue;
    let f = camp.figures[c.name];
    // Lebenslauf sichern, sobald er im Spielstand steht (erster gesehener bleibt)
    if (c.background && c.background.key && !(f && f.background)) {
      f = f || (camp.figures[c.name] = { background: null, patrols: [] });
      // Verschachtelte Argumente (Objekte) nicht übernehmen; Lebensläufe haben beobachtet nur den Namen als Argument
      f.background = { key: c.background.key, args: c.background.args.filter(a => typeof a === 'string') };
      changed = true;
    }
    if (patrol && k.atSea === true && c.status === STATUS_ON_BOARD && !c.died) {
      f = f || (camp.figures[c.name] = { background: null, patrols: [] });
      if (!f.patrols.includes(patrol)) { f.patrols.push(patrol); f.patrols.sort((a, b) => a - b); changed = true; }
    }
  }
  return changed;
}

// Nachlesen alter Spielstände: Ergebnisse (parseSave) einer Kampagne in eine Kopie übernehmen, zum Vergleich mit dem Verlauf.
// Liefert die Kopie und je Figur, was neu dazukäme.
function preview(h, results) {
  const copy = normalize(JSON.parse(JSON.stringify(h)));
  for (const res of results) observe(copy, res);
  const diff = [];
  for (const [key, camp] of Object.entries(copy.campaigns)) {
    const before = (h.campaigns[key] && h.campaigns[key].figures) || {};
    for (const [name, f] of Object.entries(camp.figures)) {
      const old = before[name] || { background: null, patrols: [] };
      const newPatrols = f.patrols.filter(n => !old.patrols.includes(n));
      const newBackground = Boolean(f.background && !old.background);
      if (newPatrols.length || newBackground) diff.push({ campaign: key, name, patrols: f.patrols, newPatrols, newBackground });
    }
  }
  return { history: copy, diff };
}

// Für die Ausgabe: Feindfahrten (Anzahl, null ohne Verlauf der Kampagne) und gesicherter Lebenslauf einer Figur
function figureOf(h, key, name) {
  const camp = key && h.campaigns[key];
  if (!camp) return { patrols: null, background: null };
  const f = camp.figures[name];
  return { patrols: f ? f.patrols.length : 0, background: f ? f.background : null };
}

module.exports = { campaignKey, emptyHistory, normalize, observe, preview, figureOf, HISTORY_VERSION };
