// Abstimmungen im Auftrag lokaler Verbraucher (Spec docs/specs/chat-bruecke.md, Teil C, Issue #81):
// Anfrage prüfen, Twitch-Fehler einordnen, Ergebnis als Ereignis aufbereiten, offene Aufträge merken.
// Kennt weder Express noch Twitch; der Server ruft Helix über twitchApi auf.
'use strict';

const CLIENT_PATTERN = /^[a-z0-9_-]{1,32}$/;    // wie bei der Anmeldung am Ereignisstrom (lib/chat-bridge.js)
const LIMITS = {                                 // Grenzen von Twitch „Create Poll“
  titleMax: 60, choicesMin: 2, choicesMax: 5, choiceMax: 25,
  durationMin: 15, durationMax: 1800, pointsMin: 1, pointsMax: 1000000,
};
const FINAL_STATUSES = ['COMPLETED', 'TERMINATED', 'ARCHIVED', 'MODERATED', 'INVALID'];

const chars = s => [...s].length;   // Zeichen statt UTF-16-Einheiten, damit Emoji nicht doppelt zählen

// Rückgabe: {client, title, choices, durationS, channelPointsPerVote} oder {error}. Gekürzt wird nicht, nur getrimmt.
function validateStart(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.client !== 'string' || !CLIENT_PATTERN.test(b.client)) return { error: 'client fehlt oder ist ungültig (1–32 Zeichen a-z, 0-9, _ und -)' };
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || chars(title) > LIMITS.titleMax) return { error: `title: 1–${LIMITS.titleMax} Zeichen` };
  if (!Array.isArray(b.choices) || b.choices.length < LIMITS.choicesMin || b.choices.length > LIMITS.choicesMax) {
    return { error: `choices: ${LIMITS.choicesMin} bis ${LIMITS.choicesMax} Optionen` };
  }
  const choices = b.choices.map(c => (typeof c === 'string' ? c.trim() : ''));
  if (choices.some(c => !c || chars(c) > LIMITS.choiceMax)) return { error: `choices: je 1–${LIMITS.choiceMax} Zeichen` };
  const durationS = b.durationS;
  if (!Number.isInteger(durationS) || durationS < LIMITS.durationMin || durationS > LIMITS.durationMax) {
    return { error: `durationS: ganze Sekunden von ${LIMITS.durationMin} bis ${LIMITS.durationMax}` };
  }
  let channelPointsPerVote = null;
  if (b.channelPointsPerVote !== undefined && b.channelPointsPerVote !== null) {
    const p = b.channelPointsPerVote;
    if (!Number.isInteger(p) || p < LIMITS.pointsMin || p > LIMITS.pointsMax) {
      return { error: `channelPointsPerVote: ganze Zahl von ${LIMITS.pointsMin} bis ${LIMITS.pointsMax} oder weglassen` };
    }
    channelPointsPerVote = p;
  }
  return { client: b.client, title, choices, durationS, channelPointsPerVote };
}

// Body für Helix POST /polls
function helixBody(broadcasterId, start) {
  const body = { broadcaster_id: broadcasterId, title: start.title, choices: start.choices.map(title => ({ title })), duration: start.durationS };
  if (start.channelPointsPerVote) Object.assign(body, { channel_points_voting_enabled: true, channel_points_per_vote: start.channelPointsPerVote });
  return body;
}

// Twitch-Fehler beim Anlegen → {status, reason, error} für den Verbraucher
function classifyCreateError(err) {
  const status = err && err.response && err.response.status;
  const message = String((err && err.response && err.response.data && err.response.data.message) || (err && err.message) || 'unbekannter Fehler');
  if (status === 400 && /already has a poll|poll that's running|active poll/i.test(message)) {
    return { status: 409, reason: 'poll_active', error: 'Es läuft schon eine Abstimmung' };
  }
  if (status === 401 && /scope/i.test(message)) {
    return { status: 403, reason: 'missing_scope', error: 'Dem Broadcaster-Token fehlt channel:manage:polls (SCOPES ergänzen, /login neu)' };
  }
  if (status === 403) return { status: 403, reason: 'not_eligible', error: `Twitch erlaubt keine Abstimmung: ${message}` };
  if (status === 400) return { status: 502, reason: 'twitch_rejected', error: `Twitch lehnt ab: ${message}` };
  return { status: 502, reason: 'twitch_error', error: `Twitch-Fehler${status ? ` ${status}` : ''}: ${message}` };
}

// Ereignis poll_result aus dem Stand von lib/poll-state.js; Gewinner sind alle mit der Höchstzahl, bei 0 Stimmen alle
function resultEvent(p, { now = () => Date.now() } = {}) {
  const choices = (p.choices || []).map(c => ({ id: c.id, title: c.title, votes: c.votes || 0, channelPointsVotes: c.channelPointsVotes || 0 }));
  const totalVotes = choices.reduce((sum, c) => sum + c.votes, 0);
  const max = Math.max(0, ...choices.map(c => c.votes));
  return {
    pollId: p.pollId, title: p.title, status: p.status, choices, totalVotes,
    winners: choices.filter(c => c.votes === max).map(({ id, title, votes }) => ({ id, title, votes })),
    startedAt: p.startedAt || null, endedAt: p.endedAt || null, at: new Date(now()).toISOString(),
  };
}

// Offene Aufträge: pollId → Verbraucher. Nur im Arbeitsspeicher; je Abstimmung höchstens eine Ergebnismeldung.
function createPollRequests({ maxAgeMs, max = 20, now = () => Date.now() }) {
  const entries = new Map();
  const prune = () => {
    for (const [id, e] of entries) if (now() - e.at > maxAgeMs) entries.delete(id);
    while (entries.size > max) entries.delete(entries.keys().next().value);
  };
  return {
    add(pollId, client) { entries.set(pollId, { client, at: now() }); prune(); },
    // Endstand gesehen: Verbraucher zurückgeben und vergessen; sonst null
    takeFinal(snapshot) {
      if (!snapshot || !FINAL_STATUSES.includes(snapshot.status) || !entries.has(snapshot.pollId)) return null;
      const { client } = entries.get(snapshot.pollId);
      entries.delete(snapshot.pollId);
      return client;
    },
    size: () => entries.size,
  };
}

module.exports = { validateStart, helixBody, classifyCreateError, resultEvent, createPollRequests, LIMITS, FINAL_STATUSES };
