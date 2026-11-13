'use strict';
// Archiv der Stream-Berichte (ADR 0019, docs/specs/statistik.md): je abgeschlossenem Stream eine .json und eine .txt.
// Die Gesamtstatistik wird beim Lesen aus den Berichten gebildet, es gibt keinen zweiten Zähler.

const fs = require('fs');
const path = require('path');
const { anonymizeChatter } = require('./privacy');

const REPORT_VERSION = 1;
const REPORT_ID_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{4}(-\d{1,3})?$/;
const CLOSE_REASONS = { raid: 'nach dem Raid', knopf: 'per Knopf', frist: '2 Stunden nach dem letzten Offline', neustart: 'beim Serverstart' };

const pad = n => String(n).padStart(2, '0');

// Ortszeit des Servers, z. B. 2026-11-10_2113
function reportIdFor(startedAt) {
  const d = new Date(startedAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function isReportId(id) {
  return typeof id === 'string' && REPORT_ID_PATTERN.test(id);
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} Std. ${minutes % 60} Min.` : `${minutes} Min.`;
}

const dateTime = iso => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const clock = iso => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// Auffälligkeiten, die einen genaueren Blick lohnen
function reportWarnings(summary, shortSeconds) {
  const warnings = [];
  if (summary.aborted) warnings.push('abgebrochen, das Ende ist geschätzt');
  if (summary.late_start) warnings.push('Server kam erst während des Streams dazu, frühere Ereignisse fehlen');
  if (summary.duration_seconds < shortSeconds) warnings.push(`kürzer als ${formatDuration(shortSeconds)}`);
  return warnings;
}

const VIEWER_COURSE_MINUTES = 15;

// Kurzfassung des Minutenverlaufs für den Textbericht, z. B. „21:15 42 · 21:30 55“
function viewerCourse(viewers, startedAt) {
  if (!Array.isArray(viewers) || !viewers.length) return '';
  const buckets = new Map();
  for (const [minute, count] of viewers) {
    const bucket = Math.floor(minute / VIEWER_COURSE_MINUTES);
    buckets.set(bucket, Math.max(buckets.get(bucket) ?? 0, count));
  }
  return [...buckets].map(([bucket, peak]) => `${clock(Date.parse(startedAt) + bucket * VIEWER_COURSE_MINUTES * 60000)} ${peak}`).join(' · ');
}

function createStreamReports({ dir, metrics, shortSeconds, writeJson, log = () => {} }) {
  let cache = null;

  const file = (id, ext) => path.join(dir, `${id}.${ext}`);
  const metricValue = (report, key) => report.state.counters[key] || 0;

  function formatText(report) {
    const s = report.summary;
    const lines = [
      `Stream-Bericht vom ${dateTime(s.started_at)}`,
      '',
      `Start: ${clock(s.started_at)}   Ende: ${clock(s.ended_at)} (${CLOSE_REASONS[s.close_reason] || s.close_reason})   Dauer: ${formatDuration(s.duration_seconds)}`,
      `Unterbrechungen: ${s.interruptions ? `${s.interruptions}, zusammen ${formatDuration(s.interruption_seconds)}` : 'keine'}`,
      `Kategorien: ${s.categories.length ? s.categories.map(c => `${c.name} (${formatDuration(c.seconds)})`).join(', ') : 'unbekannt'}`,
    ];
    if (s.viewers && s.viewers.minutes) {
      lines.push(`Zuschauer: höchstens ${s.viewers.peak}, im Schnitt ${s.viewers.average} (${s.viewers.minutes} ${s.viewers.minutes === 1 ? 'Minute' : 'Minuten'} erfasst)`);
      const course = viewerCourse(report.state.viewers, s.started_at);
      if (course) lines.push(`Verlauf je Viertelstunde (Höchstwert): ${course}`);
    }
    if (report.warnings.length) lines.push(`Hinweise: ${report.warnings.join('; ')}`);
    lines.push('', 'Zahlen:');
    for (const m of metrics) lines.push(`  ${m.label}: ${metricValue(report, m.key)}`);
    lines.push(`  Verschiedene Chatter: ${Object.keys(report.state.chatters || {}).length}`);
    const top = Object.values(report.state.chatters || {}).sort((a, b) => b.count - a.count).slice(0, 10);
    if (top.length) lines.push('', 'Aktivste Chatter:', ...top.map((c, i) => `  ${i + 1}. ${c.name} (${c.count})`));
    lines.push('', `Erstellt ${dateTime(report.created_at)}`);
    return `${lines.join('\r\n')}\r\n`;
  }

  // Derselbe Stream überschreibt seinen Bericht, ein anderer mit derselben Startminute bekommt eine Endung.
  function freeId(state) {
    const base = reportIdFor(state.started_at);
    for (let n = 1; n < 1000; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!fs.existsSync(file(id, 'json'))) return id;
      try {
        if (JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8')).state.started_at === state.started_at) return id;
      } catch { /* defekte Datei: nächste Endung */ }
    }
    throw new Error('Kein freier Name für den Bericht');
  }

  function archive({ state, summary }) {
    fs.mkdirSync(dir, { recursive: true });
    const id = freeId(state);
    const report = { v: REPORT_VERSION, id, created_at: new Date().toISOString(), warnings: reportWarnings(summary, shortSeconds), summary, state: { ...state, report_id: id } };
    writeJson(file(id, 'json'), report);
    fs.writeFileSync(file(id, 'txt'), formatText(report), 'utf8');
    cache = null;
    return id;
  }

  // Zwischenspeicher, solange sich die Dateinamen im Ordner nicht ändern (auch von Hand gelöschte Berichte fallen so heraus)
  function loadAll() {
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    const key = names.join('|');
    if (cache && cache.key === key) return cache.reports;
    const reports = [];
    for (const name of names) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !isReportId(id)) continue;
      try {
        const report = JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8'));
        if (report.v === REPORT_VERSION && report.summary && report.state) reports.push(report);
      } catch (err) {
        log(`[Statistik] Bericht ${name} ist unlesbar und wird übergangen: ${err.message}`, 'warn');
      }
    }
    reports.sort((a, b) => Date.parse(b.summary.started_at) - Date.parse(a.summary.started_at));
    cache = { key, reports };
    return reports;
  }

  function list() {
    return loadAll().map(r => ({
      id: r.id,
      started_at: r.summary.started_at,
      ended_at: r.summary.ended_at,
      duration_seconds: r.summary.duration_seconds,
      close_reason: r.summary.close_reason,
      aborted: r.summary.aborted,
      warnings: r.warnings,
    }));
  }

  function totals() {
    const reports = loadAll();
    return {
      streams: reports.length,
      duration_seconds: reports.reduce((sum, r) => sum + (r.summary.duration_seconds || 0), 0),
      metrics: metrics.map(m => ({ key: m.key, label: m.label, value: reports.reduce((sum, r) => sum + metricValue(r, m.key), 0) })),
    };
  }

  // Der Text wird bei Bedarf aus der .json neu erzeugt, falls die .txt fehlt.
  function text(id) {
    if (!isReportId(id) || !fs.existsSync(file(id, 'json'))) return null;
    if (fs.existsSync(file(id, 'txt'))) return fs.readFileSync(file(id, 'txt'), 'utf8');
    return formatText(JSON.parse(fs.readFileSync(file(id, 'json'), 'utf8')));
  }

  function remove(id) {
    if (!isReportId(id) || !fs.existsSync(file(id, 'json'))) return false;
    fs.rmSync(file(id, 'json'), { force: true });
    fs.rmSync(file(id, 'txt'), { force: true });
    cache = null;
    log(`[Statistik] Bericht ${id} gelöscht`);
    return true;
  }

  const exists = id => isReportId(id) && fs.existsSync(file(id, 'json'));

  // !privat: Eintrag der ID in allen Berichten anonymisieren, Top-Liste und Text neu schreiben. Rückgabe: Anzahl geänderter Berichte.
  function anonymize(userId, anonName) {
    let changed = 0;
    for (const report of loadAll()) {
      if (!anonymizeChatter(report.state.chatters, userId, anonName)) continue;
      const topLength = Array.isArray(report.summary.top_chatters) ? report.summary.top_chatters.length : 0;
      report.summary.top_chatters = Object.values(report.state.chatters).sort((a, b) => b.count - a.count).slice(0, topLength);
      writeJson(file(report.id, 'json'), report);
      fs.writeFileSync(file(report.id, 'txt'), formatText(report), 'utf8');
      changed += 1;
    }
    if (changed) cache = null;
    return changed;
  }

  return { archive, list, totals, text, remove, exists, anonymize };
}

module.exports = { createStreamReports, reportIdFor, reportWarnings, isReportId, CLOSE_REASONS };
