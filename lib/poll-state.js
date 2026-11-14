// Stand der laufenden bzw. letzten Abstimmung (Twitch Poll), nur im Arbeitsspeicher.
// Spec: docs/specs/wetten-abstimmungen.md, Schritt 2. Grundsatz ADR 0023: Der Endpunkt gibt diesen Stand aus
// und fragt Twitch nicht selbst. Ablauf (Ausgangsstand, Kontrolle, Reihenfolge) in lib/live-state.js.
'use strict';
const { createLiveStateTracker, toIso } = require('./live-state');

const POLL_EVENT_TYPES = ['channel.poll.begin', 'channel.poll.progress', 'channel.poll.end'];
const END_STATUS = { completed: 'COMPLETED', terminated: 'TERMINATED', archived: 'ARCHIVED' };
// archived folgt bei Twitch auf completed bzw. terminated derselben Abstimmung
const STATUS_RANK = { ACTIVE: 0, COMPLETED: 1, TERMINATED: 1, MODERATED: 1, INVALID: 1, ARCHIVED: 2 };
const OPEN_STATUSES = ['ACTIVE'];

const voting = (isEnabled, amountPerVote) => ({ isEnabled: !!isEnabled, amountPerVote: amountPerVote || 0 });

function mapChoices(choices) {
  return (choices || []).map(c => ({
    id: c.id,
    title: c.title,
    votes: c.votes || 0,
    channelPointsVotes: c.channel_points_votes || 0,
    bitsVotes: c.bits_votes || 0,
  }));
}

function shape({ id, title, status, choices, channelPointsVoting, bitsVoting, startedAt, endsAt, endedAt, duration }) {
  return {
    pollId: id, title, status, choices, channelPointsVoting, bitsVoting,
    startedAt: startedAt || null, endsAt: endsAt || null, endedAt: endedAt || null,
    duration: Number.isFinite(duration) ? duration : null,
  };
}

// Helix „Get Polls“: duration statt ends_at, Status schon in Großbuchstaben
function fromHelix(p) {
  const duration = Number.isFinite(p.duration) ? p.duration : null;
  const startedMs = Date.parse(p.started_at);
  return shape({
    id: p.id, title: p.title, status: p.status, choices: mapChoices(p.choices),
    channelPointsVoting: voting(p.channel_points_voting_enabled, p.channel_points_per_vote),
    bitsVoting: voting(p.bits_voting_enabled, p.bits_per_vote),
    startedAt: p.started_at, endsAt: duration !== null ? toIso(startedMs + duration * 1000) : null,
    endedAt: p.ended_at, duration,
  });
}

function fromEvent(subType, evt, same) {
  const status = subType === 'channel.poll.end' ? END_STATUS[evt.status] : (POLL_EVENT_TYPES.includes(subType) ? 'ACTIVE' : null);
  if (!status) return null;
  // Verspätetes begin nach progress derselben Abstimmung: Stimmen wären wieder 0
  if (subType === 'channel.poll.begin' && same) return null;
  const startedMs = Date.parse(evt.started_at);
  const endsMs = Date.parse(evt.ends_at);
  const duration = Number.isFinite(startedMs) && Number.isFinite(endsMs)
    ? Math.round((endsMs - startedMs) / 1000)
    : (same ? same.duration : null);
  const cp = evt.channel_points_voting || {};
  const bits = evt.bits_voting || {};
  return shape({
    id: evt.id, title: evt.title, status, choices: mapChoices(evt.choices),
    channelPointsVoting: voting(cp.is_enabled, cp.amount_per_vote),
    bitsVoting: voting(bits.is_enabled, bits.amount_per_vote),
    startedAt: evt.started_at || (same && same.startedAt),
    endsAt: evt.ends_at || (same && same.endsAt) || null,   // end liefert ended_at statt ends_at
    endedAt: evt.ended_at || null, duration,
  });
}

function createPollTracker(options) {
  return createLiveStateTracker({
    ...options, idKey: 'pollId', statusRank: STATUS_RANK, openStatuses: OPEN_STATUSES, fromHelix, fromEvent,
  });
}

module.exports = { createPollTracker, POLL_EVENT_TYPES };
