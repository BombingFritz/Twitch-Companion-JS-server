// Kern: interner Ereignisbus (ADR 0027, Schritt 3c; Nachtrag 27.11.2026, Abschnitt 6).
// Ein Ereignis benachrichtigt beliebig viele Empfänger; eine Anfrage mit Antwort ist ein direkter Aufruf eines Kerndienstes.
// Welche Ereignisse es gibt, steht in docs/ARCHITEKTUR.md, „Interne Ereignisse“ (der Architekturtest prüft das).
//
// Bewusst kein EventEmitter von Node:
// - Er hält beim ersten Fehler eines Empfängers die übrigen an.
// - Abgelehnte Promises fängt er nicht.
// - Das Ereignis 'error' behandelt er besonders.
// Hier gilt dagegen:
// - Jeder Empfänger läuft für sich. Ein synchroner Fehler oder ein abgelehntes Promise wird mit dem Namen des Besitzers
//   geloggt und hält weder die übrigen Empfänger noch den Aufrufer auf.
// - emit wartet nicht auf asynchrone Empfänger.
'use strict';

function createEvents() {
  const listeners = [];   // { event, owner, fn } in der Reihenfolge der Anmeldung

  function report(owner, event, err) {
    let text;
    if (err && err.message !== undefined) text = err.message;
    else if (err && typeof err === 'object') { try { text = JSON.stringify(err); } catch { text = String(err); } }
    else text = String(err);
    console.error(`[Module] ${owner || '?'}: Fehler bei Ereignis ${event}: ${text}`);
  }

  return {
    // owner: Name des Moduls (oder Kernteils) für die Fehlermeldung
    on(event, owner, fn) {
      if (typeof fn !== 'function') throw new Error(`${owner || '?'}: Empfänger für Ereignis ${event} ist keine Funktion`);
      listeners.push({ event, owner, fn });
    },
    emit(event, payload) {
      // Kopie: Wer sich während emit anmeldet, hört erst ab dem nächsten Ereignis mit
      for (const l of listeners.slice()) {
        if (l.event !== event) continue;
        try {
          const result = l.fn(payload);
          if (result && typeof result.then === 'function') result.then(undefined, err => report(l.owner, event, err));
        } catch (err) {
          report(l.owner, event, err);
        }
      }
    },
    // angemeldete Ereignisse, z. B. für Tests und den Katalog
    eventNames() {
      return [...new Set(listeners.map(l => l.event))];
    },
  };
}

module.exports = { createEvents };
