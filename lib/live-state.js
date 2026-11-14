// Gemeinsamer Kern für „letzter Stand aus EventSub“ (ADR 0023, Spec wetten-abstimmungen.md): Wette und Abstimmung.
// Der Stand liegt nur im Arbeitsspeicher. Quellen: EventSub-Ereignisse, dazu eine Helix-Abfrage als Ausgangsstand
// je Verbindung und als Kontrolle, solange der Stand offen ist und recheckMs lang kein Ereignis kam.
// Bei derselben ID gewinnt nie ein früherer Zustand (verspätete Ereignisse, Helix hinkt hinterher).
'use strict';

const toIso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

function createLiveStateTracker({
  idKey,                       // Feldname der ID im Stand, z. B. 'predictionId'
  statusRank,                  // { STATUS: Rang }; ein niedrigerer Rang ersetzt keinen höheren derselben ID
  openStatuses,                // Zustände, in denen die Kontrolle läuft
  fromHelix,                   // (helixObjekt) => Stand ohne updatedAt
  fromEvent,                   // (subType, evt, bisherigerStandDerselbenId|null) => Stand ohne updatedAt, oder null = ignorieren
  fetchLatest,                 // async () => Helix-Objekt oder null; wirft bei Fehler
  recheckMs,
  onChange = () => {},         // (stand) nach jeder Übernahme
  onError = () => {},          // (err) wenn fetchLatest scheitert; der letzte Stand bleibt
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let state = null;
  let timer = null;

  const isOpen = () => !!state && openStatuses.includes(state.status);
  const snapshot = () => (state ? { ...state } : { status: 'WAITING' });

  function scheduleRecheck() {
    if (timer) { clearTimer(timer); timer = null; }
    if (!isOpen()) return;
    timer = setTimer(() => { timer = null; refresh(); }, recheckMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function accept(next) {
    if (state && next && state[idKey] === next[idKey] && statusRank[next.status] < statusRank[state.status]) return false;
    state = next ? { ...next, updatedAt: toIso(now()) } : null;
    onChange(snapshot());
    return true;
  }

  function handleEvent(subType, evt) {
    if (!evt || !evt.id) return false;
    const same = state && state[idKey] === evt.id ? state : null;
    const next = fromEvent(subType, evt, same);
    const changed = next ? accept(next) : false;
    scheduleRecheck();   // jedes Ereignis zeigt, dass die Verbindung lebt
    return changed;
  }

  async function refresh() {
    try {
      const raw = await fetchLatest();
      accept(raw ? fromHelix(raw) : null);
    } catch (err) {
      onError(err);
    }
    scheduleRecheck();
  }

  function stop() { if (timer) { clearTimer(timer); timer = null; } }

  return { handleEvent, refresh, snapshot, isOpen, stop };
}

module.exports = { createLiveStateTracker, toIso };
