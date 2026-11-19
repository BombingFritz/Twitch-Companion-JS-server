// Chat-Brücke für lokale Verbraucher (Spec docs/specs/chat-bruecke.md, Teil A, Issue #74, ADR 0025):
// Anmeldung prüfen, passende Chat-Nachrichten erkennen und als Ereignis aufbereiten. Kennt weder Express noch Twitch.
'use strict';

const CLIENT_PATTERN = /^[a-z0-9_-]{1,32}$/;
const MAX_COMMANDS = 100;
const MAX_COMMAND_LENGTH = 32;
const MAX_PREFIXES = 5;
const MAX_PREFIX_LENGTH = 3;

const splitList = value => (typeof value === 'string' && value.length ? value.split(',') : []);

// Anmeldung aus den Abfrageparametern. Rückgabe: {client, commands, prefixes} oder {error}.
function parseSubscription(query = {}) {
  const client = typeof query.client === 'string' ? query.client : '';
  if (!CLIENT_PATTERN.test(client)) return { error: 'client fehlt oder ist ungültig (1–32 Zeichen a-z, 0-9, _ und -)' };
  const commands = splitList(query.commands).map(c => c.trim().toLowerCase());
  const prefixes = splitList(query.prefixes).map(p => p.trim());
  if (!commands.length && !prefixes.length) return { error: 'commands oder prefixes angeben' };
  if (commands.length > MAX_COMMANDS) return { error: `höchstens ${MAX_COMMANDS} Befehle` };
  if (commands.some(c => !c.length || c.length > MAX_COMMAND_LENGTH || /\s/.test(c))) return { error: `Befehle: je 1–${MAX_COMMAND_LENGTH} Zeichen ohne Leerzeichen` };
  if (prefixes.length > MAX_PREFIXES) return { error: `höchstens ${MAX_PREFIXES} Präfixe` };
  if (prefixes.some(p => !p.length || p.length > MAX_PREFIX_LENGTH || /\s/.test(p))) return { error: `Präfixe: je 1–${MAX_PREFIX_LENGTH} Zeichen ohne Leerzeichen` };
  return { client, commands: [...new Set(commands)], prefixes: [...new Set(prefixes)] };
}

const firstWord = text => String(text || '').trim().split(/\s+/)[0].toLowerCase();

// Passt die Nachricht zur Anmeldung? Erstes Wort gleich einem Befehl (ohne Groß-/Kleinschreibung) oder Text beginnt mit einem Präfix.
function matches(subscription, text) {
  const trimmed = String(text || '').trimStart();
  if (!trimmed) return false;
  const word = firstWord(trimmed);
  return subscription.commands.includes(word) || subscription.prefixes.some(p => trimmed.startsWith(p));
}

function badgesOf(evt) {
  const ids = new Set((evt.badges || []).map(b => b.set_id));
  return { broadcaster: ids.has('broadcaster'), moderator: ids.has('moderator'), vip: ids.has('vip'), subscriber: ids.has('subscriber') || ids.has('founder') };
}

// Geht die Nachricht überhaupt an Verbraucher? Nur eigener Kanal, keine Bots, keine eigenen Befehle des Servers.
function isForwardable(evt, { excludedLogins = [], serverCommands = [] } = {}) {
  if (!evt || !evt.message || typeof evt.message.text !== 'string') return false;
  if (evt.source_broadcaster_user_id && evt.source_broadcaster_user_id !== evt.broadcaster_user_id) return false;
  const login = String(evt.chatter_user_login || '').toLowerCase();
  if (excludedLogins.includes(login)) return false;
  return !serverCommands.includes(firstWord(evt.message.text));
}

function chatEvent(evt, { isPrivate = () => false, now = () => Date.now() } = {}) {
  return {
    messageId: evt.message_id || null,
    userId: String(evt.chatter_user_id),
    userLogin: evt.chatter_user_login,
    userName: evt.chatter_user_name || evt.chatter_user_login,
    text: evt.message.text,
    at: new Date(now()).toISOString(),
    badges: badgesOf(evt),
    private: Boolean(isPrivate(String(evt.chatter_user_id))),
  };
}

// Aktive Chatter (Spec chat-bruecke.md, Teil B, Issue #79): wer in den letzten windowMs geschrieben hat, nur im Arbeitsspeicher.
// Reihenfolge der Map = zuletzt aktiv am Ende; über max fällt der am längsten stille heraus.
function createActiveChatters({ windowMs, max, now = () => Date.now() }) {
  const entries = new Map();
  let lastNoteAt = null;
  const prune = () => {
    const limit = now() - windowMs;
    for (const [id, e] of entries) { if (e.lastChatMs > limit) break; entries.delete(id); }
  };
  return {
    note(evt) {
      const id = String(evt.chatter_user_id || '');
      if (!id) return;
      const b = badgesOf(evt);
      entries.delete(id);
      entries.set(id, { id, login: evt.chatter_user_login, name: evt.chatter_user_name || evt.chatter_user_login, lastChatMs: now(), moderator: b.moderator, vip: b.vip, subscriber: b.subscriber });
      while (entries.size > max) entries.delete(entries.keys().next().value);
      lastNoteAt = now();
    },
    remove(id) { entries.delete(String(id)); },
    snapshot() {
      prune();
      const chatters = [...entries.values()].reverse().map(({ lastChatMs, ...e }) => ({ ...e, lastChatAt: new Date(lastChatMs).toISOString() }));
      return { updatedAt: lastNoteAt === null ? null : new Date(lastNoteAt).toISOString(), windowMinutes: Math.round(windowMs / 60000), chatters };
    },
  };
}

module.exports = { parseSubscription, matches, isForwardable, chatEvent, badgesOf, firstWord, createActiveChatters };
