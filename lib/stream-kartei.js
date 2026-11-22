// Stream-Kartei (ADR 0026, Spec docs/specs/stream-kartei.md): Datenformat für die öffentliche Website,
// Vergleich über einen Hash und Takt der Veröffentlichung. Kennt weder Express, Twitch noch GitHub.
'use strict';
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const UBOAT_PATH = 'uboat/crew.json';
const INDEX_PATH = 'index.json';
const TYPE_ORDER = { 2: 0, 1: 1, 0: 2 };   // Kommandant, Offiziere, Matrosen

const byRankAndName = (a, b) => (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3) || String(a.name).localeCompare(String(b.name), 'de');
const toIso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

// state: getState() von lib/uboat-crew.js. isHidden(member): Figur eines !privat-Zuschauers.
// Ohne publishedAt; das setzt erst die Veröffentlichung. Keine Twitch-Namen, keine Zuordnungen, kein Dateiname.
function buildUboatCrew(state, { isHidden = () => false } = {}) {
  const visible = (state.crew || []).filter(m => !isHidden(m)).slice().sort(byRankAndName);
  // Akte (Stufe 1b): Lebenslauf, Orden mit Namen, Leistungen
  const akte = m => ({
    // Stufe 1c: Feindfahrten, in denen die Figur auf See an Bord war (Verlauf des Servers); null ohne Verlauf
    patrols: Number.isInteger(m.patrols) ? m.patrols : null,
    background: m.background || null,
    decorationNames: [...(m.decorationNames || [])],
    accomplishments: (m.accomplishments || []).map(a => ({ kind: a.kind || null, text: a.text })),
  });
  const crew = visible.filter(m => !m.died && m.status !== 2).map(m => ({
    name: m.name, typeLabel: m.typeLabel, classLabel: m.classLabel || null, level: m.level ?? null,
    experiencePoints: m.experiencePoints ?? null, experiencePointsFromLastPatrol: m.experiencePointsFromLastPatrol ?? null,
    born: m.born || null, decorations: m.decorations ?? 0, statusLabel: m.statusLabel || null, woundLabel: m.woundLabel || null,
    traits: [...(m.traits || [])], skills: [...(m.skills || [])], ...akte(m),
  }));
  const fallen = visible.filter(m => m.died || m.status === 2).map(m => ({
    name: m.name, typeLabel: m.typeLabel, classLabel: m.classLabel || null, level: m.level ?? null,
    born: m.born || null, died: m.died || null, decorations: m.decorations ?? 0,
    traits: [...(m.traits || [])], skills: [...(m.skills || [])], ...akte(m),
  }));
  const k = state.career || null;
  return {
    schemaVersion: SCHEMA_VERSION, game: 'uboat', savedAt: toIso(state.savedAt), gameVersion: state.gameVersion || null, crew, fallen,
    boat: k && k.boat ? { ...k.boat } : null,
    career: k && k.stats ? { ...k.stats } : null,
    plaques: k ? k.plaques.map(p => ({ ...p })) : [],
    sinkings: k ? k.sinkings.map(s => ({ ...s })) : [],
  };
}

// Hash über den Inhalt ohne publishedAt: Gleicher Spielstand ergibt gleichen Hash.
function contentHash(data) {
  const { publishedAt, ...rest } = data || {};
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

function buildIndex(games, publishedAt) {
  return { schemaVersion: SCHEMA_VERSION, publishedAt, games };
}

// Dateien für den Zweig data: index.json und uboat/crew.json, je mit publishedAt
function uboatFiles(crewData, publishedAt) {
  const crew = { ...crewData, publishedAt };
  const index = buildIndex([{ game: 'uboat', title: 'UBOAT', path: UBOAT_PATH, savedAt: crewData.savedAt, publishedAt }], publishedAt);
  return { [INDEX_PATH]: `${JSON.stringify(index, null, 2)}\n`, [UBOAT_PATH]: `${JSON.stringify(crew, null, 2)}\n` };
}

// Takt (Spec „Wann“): höchstens alle minGapMs, nur bei geändertem Inhalt; urgent (Ausblenden nach !privat) sofort.
// build(): async -> {data} | {skip: Grund}. publish(data): async. readRemoteHash(): async -> Hash oder null.
// 401/403 sperren bis zum Neustart; andere Fehler: neuer Versuch nach minGapMs.
function createKarteiScheduler({ minGapMs, build, publish, readRemoteHash, isEnabled = () => true, onState = () => {},
  log = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const st = { lastHash: undefined, lastPublishedAt: null, lastAttemptAt: null, lastError: null, authFailed: false, pending: false, running: false, lastSkip: null };
  let timer = null, again = false, againUrgent = false;

  const snapshot = () => ({ ...st, nextAllowedAt: st.lastAttemptAt !== null ? toIso(st.lastAttemptAt + minGapMs) : null });
  const changed = () => onState(snapshot());

  function schedule(delay) {
    if (timer) return;
    timer = setTimer(() => { timer = null; run(false); }, Math.max(0, delay));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function run(urgent) {
    if (st.running) { again = true; againUrgent = againUrgent || urgent; return; }
    if (!isEnabled() || st.authFailed) { st.pending = false; changed(); return; }
    const wait = st.lastAttemptAt !== null ? st.lastAttemptAt + minGapMs - now() : 0;
    if (!urgent && wait > 0) { schedule(wait); return; }
    if (timer) { clearTimer(timer); timer = null; }
    st.running = true;
    try {
      const built = await build();
      if (built.skip) {
        st.lastSkip = built.skip;
        log('warn', `[Kartei] Nicht veröffentlicht: ${built.skip} – neuer Versuch in ${Math.round(minGapMs / 60000)} min`);
        st.lastAttemptAt = now();
        schedule(minGapMs);
        return;
      }
      st.lastSkip = null;
      const hash = contentHash(built.data);
      if (st.lastHash === undefined && readRemoteHash) {
        try { st.lastHash = await readRemoteHash(); } catch { st.lastHash = null; }
      }
      if (hash === st.lastHash) { st.pending = false; return; }
      st.lastAttemptAt = now();
      await publish(built.data);
      st.lastHash = hash;
      st.lastPublishedAt = toIso(now());
      st.lastError = null;
      st.pending = false;
    } catch (err) {
      const status = err && err.response && err.response.status;
      st.lastError = `${status ? `HTTP ${status}: ` : ''}${(err && err.response && err.response.data && err.response.data.message) || (err && err.message) || 'unbekannt'}`;
      st.lastAttemptAt = now();
      if (status === 401 || status === 403) {
        st.authFailed = true;
        log('warn', `[Kartei] GitHub lehnt das Token ab (${st.lastError}). STREAM_KARTEI_TOKEN prüfen; bis zum Neustart kein neuer Versuch`);
      } else {
        log('warn', `[Kartei] Veröffentlichung gescheitert (${st.lastError}) – neuer Versuch in ${Math.round(minGapMs / 60000)} min`);
        schedule(minGapMs);
      }
    } finally {
      st.running = false;
      changed();
      if (again) { const u = againUrgent; again = false; againUrgent = false; run(u); }
    }
  }

  return {
    // Etwas hat sich geändert: Spielstand, !privat. urgent: sofort, ohne Abstand.
    request({ urgent = false } = {}) { st.pending = true; changed(); return run(urgent); },
    snapshot,
    stop() { if (timer) { clearTimer(timer); timer = null; } },
  };
}

module.exports = { buildUboatCrew, contentHash, buildIndex, uboatFiles, createKarteiScheduler, UBOAT_PATH, INDEX_PATH, SCHEMA_VERSION };
