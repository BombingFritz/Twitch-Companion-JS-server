// Stand der laufenden bzw. letzten Wette (Twitch Prediction), nur im Arbeitsspeicher.
// Spec: docs/specs/wetten-abstimmungen.md, Schritt 1. Grundsatz ADR 0023: Der Endpunkt gibt diesen Stand aus
// und fragt Twitch nicht selbst. Ablauf (Ausgangsstand, Kontrolle, Reihenfolge) in lib/live-state.js.
'use strict';
const { createLiveStateTracker, toIso } = require('./live-state');

const PREDICTION_EVENT_TYPES = ['channel.prediction.begin', 'channel.prediction.progress', 'channel.prediction.lock', 'channel.prediction.end'];
const EVENT_STATUS = {
  'channel.prediction.begin': 'ACTIVE',
  'channel.prediction.progress': 'ACTIVE',
  'channel.prediction.lock': 'LOCKED',
};
const END_STATUS = { resolved: 'RESOLVED', canceled: 'CANCELED' };
const STATUS_RANK = { ACTIVE: 0, LOCKED: 1, RESOLVED: 2, CANCELED: 2 };
const OPEN_STATUSES = ['ACTIVE', 'LOCKED'];

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

function fromEvent(subType, evt, same) {
  const status = subType === 'channel.prediction.end' ? END_STATUS[evt.status] : EVENT_STATUS[subType];
  if (!status) return null;
  // Verspätetes begin nach progress derselben Wette: Zahlen wären wieder 0
  if (subType === 'channel.prediction.begin' && same) return null;
  const startedMs = Date.parse(evt.started_at);
  const locksMs = Date.parse(evt.locks_at);
  const predictionWindow = Number.isFinite(startedMs) && Number.isFinite(locksMs)
    ? Math.round((locksMs - startedMs) / 1000)
    : (same ? same.predictionWindow : null);
  return shape({
    id: evt.id, title: evt.title, status, outcomes: mapOutcomes(evt.outcomes),
    createdAt: evt.started_at || (same && same.createdAt),
    locksAt: evt.locks_at || (same && same.locksAt) || null,   // lock und end liefern kein locks_at mehr
    lockedAt: evt.locked_at || (same && same.lockedAt),
    endedAt: evt.ended_at || null, predictionWindow,
    winningOutcomeId: evt.winning_outcome_id,
  });
}

function createPredictionTracker(options) {
  return createLiveStateTracker({
    ...options, idKey: 'predictionId', statusRank: STATUS_RANK, openStatuses: OPEN_STATUSES, fromHelix, fromEvent,
  });
}

module.exports = { createPredictionTracker, PREDICTION_EVENT_TYPES };
