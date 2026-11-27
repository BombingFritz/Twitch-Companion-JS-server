// Kern: gemeinsamer Laufzeitstand (ADR 0027, Schritt 3c, zweiter Teil; Nachtrag 27.11.2026, Abschnitt 4).
// Nur was mindestens zwei Bereiche lesen: Modul-Schalter, Twitch-Kategorie, !privat-Liste, Stream live.
// Welche Module schaltbar sind, gibt server.js mit (modules, offTexts); der Kern kennt keine Funktion selbst.
'use strict';
const fs = require('fs');

// ctx: config (MODULES_FILE, PRIVACY_FILE),
//      modules { key: Name } in der Reihenfolge der Schalter (Konsole, Webkonsole, modules.json),
//      offTexts { key: Hinweis beim Ausschalten }, sonst „Befehle im Chat werden ignoriert“,
//      events (core/events.js) für 'module.switched', writeJson (writeJsonAtomic) für die !privat-Liste,
//      isLive() – Stream läuft (Quelle: Stream-Session, lib/stream-session.js)
function createState(ctx) {
  const { config: c, modules: names, offTexts = {}, events } = ctx;

  // ── Modul-Schalter (modules.json) ──
  // Fehlende Datei oder fehlender Eintrag: Modul an (Verhalten wie vor Einführung der Schalter)
  function loadModuleSwitches() {
    const switches = Object.fromEntries(Object.keys(names).map(k => [k, true]));
    if (!fs.existsSync(c.MODULES_FILE)) return switches;
    try {
      const data = JSON.parse(fs.readFileSync(c.MODULES_FILE, 'utf8'));
      for (const k of Object.keys(switches)) if (typeof data[k] === 'boolean') switches[k] = data[k];
    } catch { /* defekte Datei: alle Module an */ }
    return switches;
  }

  function saveModuleSwitches(switches) {
    fs.writeFileSync(c.MODULES_FILE, JSON.stringify(switches, null, 2), 'utf8');
  }

  let moduleSwitches = loadModuleSwitches();

  function isEnabled(key) {
    return moduleSwitches[key];
  }

  function stateLabel(key) {
    return moduleSwitches[key] ? 'aktiviert' : `deaktiviert ("${key} activate" schaltet ein)`;
  }

  // Rückgabe: true, wenn sich etwas geändert hat
  function setModuleSwitch(key, on) {
    const name = names[key];
    if (moduleSwitches[key] === on) {
      console.log(`${name} ist bereits ${on ? 'aktiviert' : 'deaktiviert'}`);
      return false;
    }
    moduleSwitches = { ...moduleSwitches, [key]: on };
    saveModuleSwitches(moduleSwitches);
    console.log(`${name} ${on ? 'aktiviert' : `deaktiviert – ${offTexts[key] || 'Befehle im Chat werden ignoriert'}`} (gespeichert, gilt auch nach Neustart)`);
    return true;
  }

  // Für Konsole und Webkonsole. Die Folgen für das jeweilige Modul hängen an 'module.switched' (Katalog in ARCHITEKTUR.md).
  function switchModule(key, on) {
    const changed = setModuleSwitch(key, on);
    events.emit('module.switched', { key, on, changed });
    return changed;
  }

  // ── Twitch-Kategorie des eigenen Kanals ──
  let category = null;              // null = unbekannt
  let categoryChangedAt = null;     // wann sie sich zuletzt geändert hat (ISO), für /api/twitch/channel
  let categoryConfirmedAt = null;   // wann der Server sie zuletzt bestätigt hat (Abruf oder channel.update)

  // Rückgabe: true, wenn sich die Kategorie geändert hat; bestätigt wird sie in jedem Fall
  function setCategory(name) {
    categoryConfirmedAt = new Date().toISOString();
    if (name === category) return false;
    category = name;
    categoryChangedAt = categoryConfirmedAt;
    return true;
  }

  // ── !privat-Liste: { "<userId>": "<ISO-Zeitpunkt>" } ──
  // Fehlt die Datei oder ist sie ungültig: leer
  function loadPrivacyOptouts() {
    if (!fs.existsSync(c.PRIVACY_FILE)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(c.PRIVACY_FILE, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      console.warn(`[Privat] ${c.PRIVACY_FILE} ist unlesbar – niemand gilt als privat, bis die Datei repariert ist`);
      return {};
    }
  }

  const privacyOptouts = loadPrivacyOptouts();

  function isPrivateUser(userId) {
    return Object.hasOwn(privacyOptouts, String(userId));
  }

  // Nur im Arbeitsspeicher; gespeichert wird mit savePrivacyOptouts (wirft bei Fehler, der Aufrufer meldet ihn)
  function setPrivate(userId, on, at = Date.now()) {
    if (on) privacyOptouts[String(userId)] = new Date(at).toISOString();
    else delete privacyOptouts[String(userId)];
  }

  function savePrivacyOptouts() {
    ctx.writeJson(c.PRIVACY_FILE, privacyOptouts);
  }

  return {
    // Modul-Schalter
    isEnabled, stateLabel, switchModule,
    moduleSwitches: () => ({ ...moduleSwitches }),
    // Kategorie
    category: () => category,
    categoryChangedAt: () => categoryChangedAt,
    categoryConfirmedAt: () => categoryConfirmedAt,
    setCategory,
    // !privat
    isPrivateUser, setPrivate, savePrivacyOptouts,
    privateUserIds: () => Object.keys(privacyOptouts),
    // Stream
    isLive: () => Boolean(ctx.isLive()),
  };
}

module.exports = { createState };
