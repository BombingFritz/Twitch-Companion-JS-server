// Kern: unbehandelte asynchrone Fehler (ADR 0027, Nachtrag 27.11.2026, Abschnitt 10; Entscheidung des Nutzers:
// lieber Stabilität, wenn der Zustand klar erkennbar ist und protokolliert wird).
// Ein abgelehntes Promise, das niemand abfängt, beendet den Server nicht mehr: Es kommt mit Stack ins Log und
// Fehlerprotokoll, wird gezählt und erscheint in /status und der Webkonsole. Synchrone Fehler außerhalb jedes Fängers
// (uncaughtException) beenden den Server weiter; danach ist sein Zustand nicht mehr verlässlich.
'use strict';

function textOf(reason) {
  if (reason && reason.message !== undefined) return String(reason.message);
  if (reason && typeof reason === 'object') {
    try { return JSON.stringify(reason); } catch { return String(reason); }
  }
  return String(reason);
}

// ctx: sanitize (core/log.js, für den Text in /status und der Webkonsole; Log und Fehlerprotokoll bereinigt core/log.js selbst)
function createRejectionGuard(ctx) {
  let count = 0;
  let lastAt = null;
  let lastText = null;

  function handle(reason) {
    const text = textOf(reason);
    // Gleicher Text wie der vorige: nur zählen, nicht noch einmal loggen. Der Stack zählt dabei nicht mit,
    // denn derselbe Fehler kommt oft von verschiedenen Zeilen.
    const repeated = count > 0 && lastText === ctx.sanitize(text);
    count += 1;
    lastAt = new Date().toISOString();
    lastText = ctx.sanitize(text);
    if (repeated) return;
    const detail = reason && typeof reason.stack === 'string' ? reason.stack : text;
    console.error(`[Fehler] Unbehandelter asynchroner Fehler, der Server läuft weiter: ${detail}`);
  }

  return {
    handle,
    install(proc = process) { proc.on('unhandledRejection', handle); },
    stats: () => ({ count, last_at: lastAt, last_text: lastText }),
  };
}

module.exports = { createRejectionGuard };
