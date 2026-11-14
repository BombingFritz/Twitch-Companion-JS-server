// Stand der laufenden bzw. letzten Wette (Twitch Prediction), nur im Arbeitsspeicher.
// Spec: docs/specs/wetten-abstimmungen.md, Schritt 1. Grundsatz ADR 0023: Der Endpunkt gibt diesen Stand aus
// und fragt Twitch nicht selbst.
// Quellen: EventSub channel.prediction.begin/progress/lock/end, dazu Helix GET /predictions?first=1
// als Ausgangsstand je Verbindung und als Kontrolle, solange eine Wette offen ist und kein Ereignis kam.
'use strict';

const EVENT_STATUS = {
  'channel.prediction.begin': 'ACTIVE',
  'channel.prediction.progress': 'ACTIVE',
  'channel.prediction.lock': 'LOCKED',
};
const END_STATUS = { resolved: 'RESOLVED', canceled: 'CANCELED' };
// Reihenfolge der Zustände einer Wette: ein späterer Zustand wird von einem früheren nicht überschrieben
const STATUS_RANK = { ACTIVE: 0, LOCKED: 1, RESOLVED: 2, CANCELED: 2 };
const OPEN_STATUSES = ['ACTIVE', 'LOCKED'];

const toIso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

// Felder wie bisher am Endpunkt; neu ist userId je Top-Tipper. Farben in Großbuchstaben wie bei Helix
// (EventSub schreibt sie klein). channel_points_won ist bei progress/lock null und wird dann 0.
function mapOutcomes(outcomes) {
  return (outcomes || []).map(o => ({
    id: o.id,
    title: o.title,
    channelPoints: o.channel_points || 0,
    users: o.users || 0,
    color: o.color ? String(o.color).toUpperCase() : null,
    topPredictors: (o.top_predictors || []).map(p => ({
      userId: p.user_id || null,
      userName: p.user_name,
      userLogin: p.user_login,
      channelPointsUsed: p.channel_points_used || 0,
      channelPointsWon: p.channel_points_won || 0,
    })),
  }));
}

// Antwortform des Endpunkts; endsAt ist der bisherige Name für endedAt
function shape({ id, title, status, outcomes, createdAt, locksAt, lockedAt, endedAt, predictionWindow, winningOutcomeId }) {
  return {
    predictionId: id, title, status, outcomes,
    createdAt: createdAt || null, locksAt: locksAt || null, endsAt: endedAt || null,
    lockedAt: lockedAt || null, endedAt: endedAt || null,
    predictionWindow: Number.isFinite(predictionWindow) ? predictionWindow : null,
    winningOutcomeId: winningOutcomeId || null,
  };
}

// Helix „Get Predictions“: prediction_window statt locks_at, Status schon in Großbuchstaben
function fromHelix(p) {
  const predictionWindow = Number.isFinite(p.prediction_window) ? p.prediction_window : null;
  const createdMs = Date.parse(p.created_at);
  return shape({
    id: p.id, title: p.title, status: p.status, outcomes: mapOutcomes(p.outcomes),
    createdAt: p.created_at, locksAt: predictionWindow !== null ? toIso(createdMs + predictionWindow * 1000) : null,
    lockedAt: p.locked_at, endedAt: p.ended_at, predictionWindow, winningOutcomeId: p.winning_outcome_id,
  });
}

function createPredictionTracker({
  fetchLatest,                 // async () => Helix-Wette oder null; wirft bei Fehler
  recheckMs,                   // Kontrolle, solange die Wette offen ist und kein Ereignis kam
  onChange = () => {},         // (stand) nach jeder Übernahme
  onError = () => {},          // (err) wenn fetchLatest scheitert
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let state = null;
  let timer = null;

  const isOpen = () => !!state && OPEN_STATUSES.includes(state.status);

  function scheduleRecheck() {
    if (timer) { clearTimer(timer); timer = null; }
    if (!isOpen()) return;
    timer = setTimer(() => { timer = null; refresh(); }, recheckMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  // Übernimmt einen neuen Stand. Bei derselben Wette gewinnt nie ein früherer Zustand (verspätete Ereignisse).
  function accept(next) {
    if (state && next && state.predictionId === next.predictionId && STATUS_RANK[next.status] < STATUS_RANK[state.status]) return false;
    state = next ? { ...next, updatedAt: toIso(now()) } : null;
    onChange(snapshot());
    return true;
  }

  function handleEvent(subType, evt) {
    if (!evt || !evt.id) return false;
    const status = subType === 'channel.prediction.end' ? END_STATUS[evt.status] : EVENT_STATUS[subType];
    if (!status) return false;
    const same = state && state.predictionId === evt.id ? state : null;
    // Verspätetes begin nach progress derselben Wette: Zahlen wären wieder 0
    if (subType === 'channel.prediction.begin' && same) { scheduleRecheck(); return false; }
    const startedMs = Date.parse(evt.started_at);
    const locksMs = Date.parse(evt.locks_at);
    const locksAt = evt.locks_at || (same && same.locksAt) || null;
    const predictionWindow = Number.isFinite(startedMs) && Number.isFinite(locksMs)
      ? Math.round((locksMs - startedMs) / 1000)
      : (same ? same.predictionWindow : null);
    const changed = accept(shape({
      id: evt.id, title: evt.title, status, outcomes: mapOutcomes(evt.outcomes),
      createdAt: evt.started_at || (same && same.createdAt), locksAt,
      lockedAt: evt.locked_at || (same && same.lockedAt),
      endedAt: evt.ended_at || null, predictionWindow,
      winningOutcomeId: evt.winning_outcome_id,
    }));
    scheduleRecheck();
    return changed;
  }

  async function refresh() {
    try {
      const p = await fetchLatest();
      accept(p ? fromHelix(p) : null);
    } catch (err) {
      onError(err);   // letzter Stand bleibt
    }
    scheduleRecheck();
  }

  function snapshot() { return state ? { ...state } : { status: 'WAITING' }; }
  function stop() { if (timer) { clearTimer(timer); timer = null; } }

  return { handleEvent, refresh, snapshot, isOpen, stop };
}

module.exports = { createPredictionTracker, PREDICTION_EVENT_TYPES: ['channel.prediction.begin', 'channel.prediction.progress', 'channel.prediction.lock', 'channel.prediction.end'] };
