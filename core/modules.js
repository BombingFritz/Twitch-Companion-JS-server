// Kern: Anmeldung der Module (ADR 0027, Schritt 2). Der Kern kennt keine Module, er ruft sie nur über diese Liste auf.
//
// Ein Modul ist ein Objekt mit diesen optionalen Teilen:
//   name                      Kurzname, z. B. 'topics'
//   routes: { widget(app), admin(app) }
//                             Endpunkte. 'widget' wird an der alten Stelle der Widget-Endpunkte eingehängt,
//                             'admin' erst nach dem Schutz der Webkonsole (app.use('/api/admin', …)).
//   consoleCommands: [{ name, help: [Zeilen], handle(parts) }]
//                             Konsolenbefehle; die Hilfezeilen erscheinen in printConsoleHelp an fester Stelle.
//   isQuiet(req, res)         true: erfolgreicher Abruf erscheint nicht im HTTP-Protokoll
//   showsSilentEffects()      true: stille Effekte (z. B. Topics) erscheinen im Log (Testmodus)
//   overview()                Beitrag zu /api/admin/overview, unter dem Namen des Moduls
//   on: { '<ereignis>': fn }  Reaktion auf interne Ereignisse (core/events.js), z. B. 'stream.new', 'module.switched';
//                             beim Anmelden in den Ereignisbus eingetragen, Katalog in docs/ARCHITEKTUR.md
'use strict';
const { createEvents } = require('./events');

// options.events: gemeinsamer Ereignisbus aus core/events.js (server.js gibt ihn mit); ohne: ein eigener
function createModuleHost(options = {}) {
  const modules = [];
  const events = options.events || createEvents();
  return {
    events,
    // Namen müssen eindeutig sein; overview() legt jedes Modul unter seinem Namen in /api/admin/overview ab,
    // der Name darf deshalb auch kein vorhandenes Feld der Übersicht sein (z. B. subgoal, stream).
    add(mod) {
      if (modules.some(m => m.name === mod.name)) throw new Error(`Modul ${mod.name} ist schon angemeldet`);
      for (const [event, fn] of Object.entries(mod.on || {})) {
        if (typeof fn !== 'function') throw new Error(`Modul ${mod.name}: Empfänger für Ereignis ${event} ist keine Funktion`);
      }
      modules.push(mod);
      for (const [event, fn] of Object.entries(mod.on || {})) events.on(event, mod.name, fn);
      return mod;
    },
    mountRoutes(app, phase) {
      for (const m of modules) if (m.routes && typeof m.routes[phase] === 'function') m.routes[phase](app);
    },
    // true, wenn ein Modul den Befehl übernommen hat
    handleConsole(cmd, parts) {
      for (const m of modules) {
        const command = (m.consoleCommands || []).find(c => c.name === cmd);
        if (command) {
          command.handle(parts);
          return true;
        }
      }
      return false;
    },
    helpLines() {
      return modules.flatMap(m => (m.consoleCommands || []).flatMap(c => c.help || []));
    },
    isQuiet(req, res) {
      return modules.some(m => typeof m.isQuiet === 'function' && m.isQuiet(req, res));
    },
    silentEffectsVisible() {
      return modules.some(m => typeof m.showsSilentEffects === 'function' && m.showsSilentEffects());
    },
    overview() {
      const out = {};
      for (const m of modules) if (typeof m.overview === 'function') out[m.name] = m.overview();
      return out;
    },
  };
}

module.exports = { createModuleHost };
