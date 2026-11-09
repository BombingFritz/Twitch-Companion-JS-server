'use strict';
// Statistik (ADR 0019, docs/specs/statistik.md). Kennt weder Twitch noch Express.
// Neue Kennzahl: ein Eintrag in METRICS und ein Aufruf stats.count('schluessel') an der Ereignisstelle.
// Kennzahl entfernen: beides löschen.

const METRICS = [
  { key: 'errors', label: 'Fehler', areas: ['instance'] },
  { key: 'effects', label: 'Ausgelöste Effekte', areas: ['instance'] },
  { key: 'follows', label: 'Follows', areas: ['instance'] },
  { key: 'subs', label: 'Subs', areas: ['instance'] },
  { key: 'gifts', label: 'Verschenkte Subs', areas: ['instance'] },
  { key: 'chat_messages', label: 'Chatnachrichten', areas: ['instance'] },
];

function createStats({ metrics = METRICS, enabled = true, now = Date.now, warn = (...args) => console.warn(...args) } = {}) {
  const known = new Set(metrics.map(m => m.key));
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
    } catch { /* siehe oben */ }
  }

  function snapshot() {
    return {
      enabled,
      instance: {
        started_at: new Date(startedAt).toISOString(),
        uptime_seconds: Math.max(0, Math.floor((now() - startedAt) / 1000)),
        metrics: instanceMetrics.map(m => ({ key: m.key, label: m.label, value: instance[m.key] })),
      },
    };
  }

  return { count, snapshot };
}

module.exports = { createStats };
