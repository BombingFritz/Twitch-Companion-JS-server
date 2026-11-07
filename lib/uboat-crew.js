// UBOAT-Crew: neuesten Spielstand einlesen, Ordner beobachten, Zuschauer zuordnen, Soldbuch formulieren.
// ADR 0016, Spec docs/specs/uboat-personalakte.md. Liest nur; schreibt nie in den Saves-Ordner.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseSave, parseLocales } = require('./uboat-save');

const LOCALES_RELATIVE = path.join('..', 'Data Sheets', 'UBOAT - Locales.dat');
// Feld "status" der Personaldaten, Enum PlayableCharacterStatus im Spielcode: Reserve = 0, Onboard = 1, Deceased = 2
const STATUS_LABELS = { 0: 'in Reserve', 1: 'an Bord', 2: 'gefallen' };
// Zustände mit der Schnittstelle IWoundedStatus im Spielcode (Patch 21). Als Eintrag in "statuses" noch in keinem
// echten Spielstand gesehen [UNGEKLÄRT: Name im Spielstand beim ersten Verwundeten prüfen].
const WOUNDED_STATUS_LABELS = { Bleeding: 'verwundet', Treatment: 'verwundet', Hospitalization: 'im Krankenhaus' };

function normalizeName(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

// "1941-03-12" -> "12.03.1941" ohne Zeitzonen-Umrechnung (Spielzeit-Datum, nicht formatDateDe aus server.js)
function formatIsoDateDe(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }
function formatStand(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time} Uhr`;
}

// options: { savesDir, knownGameVersions, hiddenSkills, settleMs, pollMs, freshMs, log(level, msg) }
function createUboatCrew(options) {
  const { savesDir, knownGameVersions = [], hiddenSkills = [], settleMs = 3000, pollMs = 60000, freshMs = 60 * 60 * 1000 } = options;
  const log = options.log || ((level, msg) => (level === 'warn' ? console.warn : console.log)(msg));
  const state = { source: null, savedAt: null, loadedAt: null, gameVersion: null, crew: [], error: null };
  let loadedKey = null, failedKey = null, observed = null, checkTimer = null, pollTimer = null, watcher = null;
  let locales = null;
  const warnedVersions = new Set();

  function loadLocales() {
    const file = path.join(savesDir, LOCALES_RELATIVE);
    try { locales = parseLocales(fs.readFileSync(file)); }
    catch { locales = { skills: new Map(), traits: new Map() }; log('warn', `[UBOAT] Spieltexte nicht gefunden (${file}) – Eigenschaften werden englisch angezeigt`); }
  }

  function toMember(c) {
    const classLabel = c.characterClass ? (locales.skills.get(c.characterClass) || c.characterClass) : null;
    const traits = [], skills = [];
    let woundLabel = null;
    for (const s of c.statuses) {
      if (WOUNDED_STATUS_LABELS[s]) { if (!woundLabel || s === 'Hospitalization') woundLabel = WOUNDED_STATUS_LABELS[s]; continue; }
      if (hiddenSkills.includes(s) || s === c.characterClass) continue;
      if (locales.traits.has(s)) { if (!traits.includes(locales.traits.get(s))) traits.push(locales.traits.get(s)); }
      else if (locales.skills.has(s)) { if (!skills.includes(locales.skills.get(s))) skills.push(locales.skills.get(s)); }
    }
    return {
      name: c.name, type: c.type, typeLabel: c.typeLabel, characterClass: c.characterClass, classLabel,
      level: c.level, experiencePoints: c.experiencePoints, experiencePointsFromLastPatrol: c.experiencePointsFromLastPatrol,
      born: c.born, decorations: c.decorations, died: c.died, traits, skills, status: c.status, statusLabel: STATUS_LABELS[c.status] || null,
      wounded: Boolean(woundLabel), woundLabel,
    };
  }

  function newestSave() {
    let best = null;
    let names;
    try { names = fs.readdirSync(savesDir); } catch (e) { return { error: e.message }; }
    for (const n of names) {
      if (!n.toLowerCase().endsWith('.save')) continue;
      try {
        const st = fs.statSync(path.join(savesDir, n));
        if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { file: path.join(savesDir, n), name: n, size: st.size, mtimeMs: st.mtimeMs };
      } catch { /* Datei gerade weg */ }
    }
    return best;
  }

  function load(cand) {
    const key = `${cand.file}|${cand.size}|${cand.mtimeMs}`;
    try {
      const raw = fs.readFileSync(cand.file);   // in einem Zug lesen, Datei ist danach geschlossen
      if (!locales) loadLocales();
      const res = parseSave(raw);
      state.source = cand.name; state.savedAt = cand.mtimeMs; state.loadedAt = Date.now();
      state.gameVersion = res.gameVersion; state.crew = res.crew.map(toMember); state.error = null;
      loadedKey = key; failedKey = null;
      log('log', `[UBOAT] Spielstand „${cand.name}“ eingelesen (Stand ${formatStand(cand.mtimeMs)}, ${state.crew.length} Crewmitglieder, Spielversion ${res.gameVersion || 'unbekannt'})`);
      if (knownGameVersions.length && !knownGameVersions.includes(res.gameVersion) && !warnedVersions.has(res.gameVersion)) {
        warnedVersions.add(res.gameVersion);
        log('warn', `[UBOAT] Ungetestete Spielversion „${res.gameVersion || 'unbekannt'}“ – Daten bitte prüfen (uboat show)`);
      }
      return true;
    } catch (e) {
      if (failedKey !== key) log('warn', `[UBOAT] Spielstand „${cand.name}“ nicht lesbar (${e.message}) – letzter gültiger Stand bleibt`);
      failedKey = key; state.error = e.message;
      return false;
    }
  }

  // Liest erst, wenn Größe und Änderungszeit seit settleMs unverändert sind.
  function check() {
    checkTimer = null;
    const cand = newestSave();
    if (!cand || cand.error) { if (cand && cand.error) state.error = cand.error; return; }
    const key = `${cand.file}|${cand.size}|${cand.mtimeMs}`;
    if (key === loadedKey || key === failedKey) return;
    const now = Date.now();
    if (observed && observed.key === key && now - observed.since >= settleMs) { observed = null; load(cand); return; }
    if (!observed || observed.key !== key) observed = { key, since: now };
    schedule(settleMs);
  }
  function schedule(ms) { if (!checkTimer) checkTimer = setTimeout(check, ms); }

  return {
    start() {
      loadLocales();
      const cand = newestSave();
      if (cand && cand.error) log('warn', `[UBOAT] Saves-Ordner nicht lesbar: ${cand.error}`);
      else if (!cand) log('log', `[UBOAT] Noch kein Spielstand im Ordner`);
      else load(cand);   // beim Start sofort: das Spiel schreibt dann in der Regel nicht
      try { watcher = fs.watch(savesDir, () => schedule(settleMs)); watcher.on('error', () => {}); }
      catch (e) { log('warn', `[UBOAT] Ordner kann nicht beobachtet werden (${e.message}) – nur Abfrage alle ${Math.round(pollMs / 1000)} s`); }
      pollTimer = setInterval(check, pollMs);
    },
    stop() { if (watcher) watcher.close(); clearInterval(pollTimer); clearTimeout(checkTimer); },
    reload() { loadLocales(); const cand = newestSave(); if (!cand || cand.error) return false; loadedKey = null; failedKey = null; return load(cand); },
    getState() { return state; },
    hasData() { return state.crew.length > 0; },

    // map: { login: "Name im Spiel" }. Ergebnis: { member } | { ambiguous: [...] } | null
    findMember(login, displayName, map = {}) {
      const byNorm = key => state.crew.filter(m => normalizeName(m.name) === key);
      const mapped = map[String(login || '').toLowerCase()];
      const tries = [mapped, login, displayName].filter(Boolean).map(normalizeName).filter(Boolean);
      for (const key of tries) {
        const hits = byNorm(key);
        if (hits.length === 1) return { member: hits[0] };
        if (hits.length > 1) return { ambiguous: hits.map(h => h.name) };
      }
      return null;
    },

    // Soldbuch-Text. Stufe und EP nur für Offiziere und Kommandant (bei Matrosen im Spiel nicht aussagekräftig).
    // "Der Eintrag ist aktuell." nur, wenn der Spielstand höchstens freshMs alt ist; sonst kein Hinweis.
    formatAkte(m, now = Date.now()) {
      // Gefallene nicht als "an Bord"/"in Reserve"/"verwundet" führen; das Todesdatum folgt unten
      const where = m.died ? '' : [m.statusLabel, m.woundLabel].filter(Boolean).map(s => `, ${s}`).join('');
      const year = m.born ? `, Jahrgang ${m.born.slice(0, 4)}` : '';
      const details = [];
      if (m.type !== 0) {
        let xp = `Stufe ${m.level}, ${m.experiencePoints} EP`;
        if (m.experiencePointsFromLastPatrol > 0) xp += ` (+${m.experiencePointsFromLastPatrol} letzte Feindfahrt)`;
        details.push(xp);
      }
      if (m.decorations > 0) details.push(`${m.decorations} ${m.decorations === 1 ? 'Auszeichnung' : 'Auszeichnungen'}`);
      const head = `Soldbuch ${m.name}${year} – ${m.typeLabel}${m.classLabel ? ` (${m.classLabel})` : ''}${where}`;
      const parts = [head + (details.length ? `: ${details.join(', ')}` : '') + '.'];
      if (m.traits.length) parts.push(`Charakter: ${m.traits.join(', ')}.`);
      if (m.skills.length) parts.push(`Fähigkeiten: ${m.skills.join(', ')}.`);
      if (m.died) parts.push(`Gefallen am ${formatIsoDateDe(m.died)}.`);
      if (state.savedAt && now - state.savedAt <= freshMs) parts.push('Der Eintrag ist aktuell.');
      return parts.join(' ');
    },
    formatStand,
  };
}

module.exports = { createUboatCrew, normalizeName, STATUS_LABELS, WOUNDED_STATUS_LABELS };
