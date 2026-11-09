'use strict';
// Stream-Ablauf (ADR 0019, docs/specs/statistik.md): kein Stream -> live -> offline (Frist) -> abgeschlossen.
// Kennt weder Twitch noch Express. Zeit, Laden und Speichern kommen von außen, damit es sich testen lässt.
// Gezählt wird von stream.online bis zum Abschluss (Raid, später Knopf, oder Frist abgelaufen).

const SCHEMA_VERSION = 1;

function emptyState() {
  return {
    v: SCHEMA_VERSION,
    status: 'none',
    started_at: null,
    ended_at: null,
    offline_at: null,
    close_reason: null,
    aborted: false,
    late_start: false,
    stream_ids: [],
    segments: [],
    categories: [],
    tags: [],
    counters: {},
    last_saved_at: null,
  };
}

function createStreamSession({
  keys = [], enabled = true, now = Date.now, load = () => null, save = () => {}, log = () => {},
  graceMs, saveIntervalMs, heartbeatMs, reconcileMinAgeMs,
}) {
  const loaded = load();
  let state = loaded && loaded.v === SCHEMA_VERSION && typeof loaded.status === 'string' ? { ...emptyState(), ...loaded } : emptyState();
  let category = null;
  let categorySince = null;
  let dirty = false;
  let lastWrite = 0;

  const iso = ms => new Date(ms).toISOString();
  const counting = () => state.status === 'live' || state.status === 'offline';
  const knownId = id => Boolean(id) && state.stream_ids.includes(id);

  function accrueCategory() {
    const t = now();
    if (state.status === 'live' && category && categorySince !== null) {
      let entry = state.categories.find(c => c.name === category);
      if (!entry) {
        entry = { name: category, seconds: 0 };
        state.categories.push(entry);
      }
      entry.seconds += (t - categorySince) / 1000;
    }
    categorySince = t;
  }

  // Darf nie werfen: Die Statistik soll keine andere Funktion stören.
  function flush() {
    if (!enabled) return;
    try {
      accrueCategory();
      state.last_saved_at = iso(now());
      save(state);
      dirty = false;
      lastWrite = now();
    } catch (err) {
      log(`[Statistik] Stream-Stand konnte nicht gespeichert werden: ${err.message}`, 'warn');
    }
  }

  function addStreamId(id) {
    if (id && !state.stream_ids.includes(id)) {
      state.stream_ids.push(id);
      dirty = true;
    }
  }

  function start(id, startedAt, late) {
    state = {
      ...emptyState(),
      status: 'live',
      started_at: startedAt || iso(now()),
      late_start: late,
      stream_ids: id ? [id] : [],
    };
    state.segments = [{ start: state.started_at, end: null }];
    categorySince = now();
    flush();
    log(`[Statistik] Stream wird erfasst${late ? ' (Server kam erst während des Streams dazu)' : ''}, Start ${state.started_at}`);
  }

  function resume(id) {
    state.status = 'live';
    state.offline_at = null;
    state.aborted = false;
    addStreamId(id);
    state.segments.push({ start: iso(now()), end: null });
    categorySince = now();
    flush();
    log('[Statistik] Stream läuft nach einer Unterbrechung weiter');
  }

  function endSegment(at) {
    const last = state.segments[state.segments.length - 1];
    if (last && last.end === null) last.end = at;
  }

  function goOffline(at) {
    accrueCategory();
    endSegment(at);
    state.status = 'offline';
    state.offline_at = at;
    flush();
    log(`[Statistik] Stream offline, Erfassung endet spätestens ${iso(Date.parse(at) + graceMs)}`);
  }

  function close(reason, endedAt, aborted) {
    accrueCategory();
    endSegment(endedAt);
    state.status = 'closed';
    state.ended_at = endedAt;
    state.close_reason = reason;
    state.aborted = aborted;
    state.offline_at = null;
    flush();
    log(`[Statistik] Stream-Erfassung abgeschlossen (${reason}${aborted ? ', abgebrochen' : ''})`);
  }

  function expire() {
    if (state.status !== 'offline') return;
    if (now() - Date.parse(state.offline_at) >= graceMs) close('frist', state.offline_at, state.aborted);
  }

  function guarded(fn) {
    return (...args) => {
      if (!enabled) return undefined;
      try {
        return fn(...args);
      } catch (err) {
        log(`[Statistik] Fehler im Stream-Ablauf: ${err.message}`, 'warn');
        return undefined;
      }
    };
  }

  const onOnline = guarded(({ id, startedAt } = {}) => {
    expire();
    if (state.status === 'live') return addStreamId(id);
    if (state.status === 'offline') return resume(id);
    if (state.status === 'closed' && knownId(id)) return undefined;   // nach dem Raid läuft derselbe Stream noch
    return start(id, startedAt, false);
  });

  const onOffline = guarded(() => {
    if (state.status === 'live') goOffline(iso(now()));
  });

  const onRaidOut = guarded(() => {
    if (state.status === 'live') close('raid', iso(now()), false);
    else if (state.status === 'offline') close('raid', state.offline_at, false);
  });

  // Abgleich beim Verbinden. info: { id, startedAt } wenn Twitch den Stream als live meldet, sonst null.
  // Twitchs Antwort kann einige Minuten alt sein, deshalb zählt ein bekanntes Ereignis mehr als die Abfrage.
  const reconcile = guarded(info => {
    expire();
    if (info) {
      if (state.status === 'live') {
        if (knownId(info.id)) return;
        if (now() - Date.parse(state.last_saved_at) <= graceMs) {
          addStreamId(info.id);
        } else {
          close('neustart', state.last_saved_at, true);
          start(info.id, info.startedAt, true);
        }
      } else if (state.status === 'offline') {
        if (!knownId(info.id)) resume(info.id);
      } else if (!(state.status === 'closed' && knownId(info.id))) {
        start(info.id, info.startedAt, true);
      }
      return;
    }
    if (state.status !== 'live') return;
    if (now() - Date.parse(state.started_at) < reconcileMinAgeMs) return;   // frisch gestartet: Antwort vermutlich noch alt
    goOffline(state.last_saved_at);
    state.aborted = true;
    dirty = true;
    expire();
  });

  const setCategory = guarded(name => {
    accrueCategory();
    category = name || null;
    if (state.status === 'live') dirty = true;
  });

  const count = guarded((key, amount = 1) => {
    if (!counting() || !keys.includes(key)) return;
    state.counters[key] = (state.counters[key] || 0) + amount;
    dirty = true;
  });

  const tick = guarded(() => {
    expire();
    const sinceWrite = now() - lastWrite;
    if (dirty && sinceWrite >= saveIntervalMs) flush();
    else if (state.status === 'live' && sinceWrite >= heartbeatMs) flush();
  });

  function snapshot() {
    if (enabled) accrueCategory();
    const end = state.ended_at || state.offline_at || (state.status === 'live' ? iso(now()) : null);
    const interruptions = state.segments.slice(1).map((segment, i) => ({ from: state.segments[i].end, to: segment.start }));
    const secondsBetween = (from, to) => Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 1000));
    return {
      status: state.status,
      started_at: state.started_at,
      ended_at: state.ended_at,
      offline_at: state.offline_at,
      closes_at: state.status === 'offline' ? iso(Date.parse(state.offline_at) + graceMs) : null,
      close_reason: state.close_reason,
      aborted: state.aborted,
      late_start: state.late_start,
      duration_seconds: state.started_at && end ? secondsBetween(state.started_at, end) : 0,
      interruptions: interruptions.length,
      interruption_seconds: interruptions.reduce((sum, gap) => sum + secondsBetween(gap.from, gap.to), 0),
      categories: state.categories.map(c => ({ name: c.name, seconds: Math.round(c.seconds) })),
      tags: state.tags,
      counters: { ...state.counters },
    };
  }

  return { onOnline, onOffline, onRaidOut, reconcile, setCategory, count, tick, flush, snapshot };
}

module.exports = { createStreamSession };
