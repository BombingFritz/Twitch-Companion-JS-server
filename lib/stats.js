'use strict';
// Statistik (ADR 0019, docs/specs/statistik.md). Kennt weder Twitch noch Express.
// Neue Kennzahl: ein Eintrag in METRICS und ein Aufruf stats.count('schluessel') an der Ereignisstelle.
// Kennzahl entfernen: beides löschen.

const METRICS = [
  { key: 'errors', label: 'Fehler', areas: ['instance'] },
  { key: 'effects', label: 'Ausgelöste Effekte', areas: ['instance'] },
  { key: 'follows', label: 'Follows', areas: ['instance', 'stream'] },
  { key: 'subs', label: 'Subs', areas: ['instance', 'stream'] },
  { key: 'gifts', label: 'Verschenkte Subs', areas: ['instance', 'stream'] },
  { key: 'raids', label: 'Raids', areas: ['stream'] },
  { key: 'chat_messages', label: 'Chatnachrichten', areas: ['instance', 'stream'] },
  { key: 'bot_messages', label: 'Botnachrichten', areas: ['stream'] },
  { key: 'shoutouts', label: 'Shoutouts', areas: ['stream'] },
  { key: 'enigma_answers', label: 'Enigma-Antworten', areas: ['stream'] },
  { key: 'polls', label: 'Abstimmungen', areas: ['stream'] },
  { key: 'poll_votes', label: 'Abgegebene Stimmen', areas: ['stream'] },
  { key: 'predictions', label: 'Wetten', areas: ['stream'] },
  { key: 'prediction_users', label: 'Teilnahmen an Wetten', areas: ['stream'] },
  { key: 'channel_points', label: 'Kanalpunkte in Abstimmungen und Wetten', areas: ['stream'] },
];

const streamMetricKeys = (metrics = METRICS) => metrics.filter(m => m.areas.includes('stream')).map(m => m.key);

function createStats({ metrics = METRICS, enabled = true, now = Date.now, warn = (...args) => console.warn(...args), stream = null } = {}) {
  const known = new Set(metrics.map(m => m.key));
  const streamMetrics = metrics.filter(m => m.areas.includes('stream'));
  const instanceMetrics = metrics.filter(m => m.areas.includes('instance'));
  const instance = Object.fromEntries(instanceMetrics.map(m => [m.key, 0]));
  const startedAt = now();
  const warned = new Set();

  // Darf nie werfen: Die Statistik soll keine andere Funktion stören.
  function count(key, amount = 1) {
    if (!enabled) return;
    try {
      if (!known.has(key)) {
        if (!warned.has(key)) {
          warned.add(key);
          warn(`[Statistik] Unbekannte Kennzahl „${key}“ wird nicht gezählt.`);
        }
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (Object.hasOwn(instance, key)) instance[key] += amount;
      if (stream) stream.count(key, amount);
    } catch { /* siehe oben */ }
  }

  function streamSnapshot() {
    if (!stream) return null;
    const { counters, ...rest } = stream.snapshot();
    return { ...rest, metrics: streamMetrics.map(m => ({ key: m.key, label: m.label, value: counters[m.key] || 0 })) };
  }

  function snapshot() {
    return {
      enabled,
      instance: {
        started_at: new Date(startedAt).toISOString(),
        uptime_seconds: Math.max(0, Math.floor((now() - startedAt) / 1000)),
        metrics: instanceMetrics.map(m => ({ key: m.key, label: m.label, value: instance[m.key] })),
      },
      stream: streamSnapshot(),
    };
  }

  return { count, snapshot };
}

module.exports = { createStats, streamMetricKeys };
