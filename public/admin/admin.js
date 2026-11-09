'use strict';
// Webkonsole (ADR 0018, docs/specs/webkonsole.md).
// Neuer Bereich: Eintrag in TABS mit ready: true und einer render-Funktion.
// Fremde Texte (Namen, Titel) nur über textContent einsetzen, nie als HTML.

const OVERVIEW_URL = '/api/admin/overview';
const DEFAULT_POLL_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;
const NOTICE_MS = 30000;
const EXIT_POLL_MS = 1000;
const CONFIRM_MS = 15000;
const CONFIRM_LOCK_MS = 500;
const COLLAPSE_KEY = 'twitchCompanionAdmin.optionalCollapsed';
const STATS_URL = '/api/admin/stats';
const WHITELIST_URL = '/api/admin/whitelist';
const MODULES_URL = '/api/admin/modules';
const EFFECT_MODE_URL = '/api/admin/effects/mode';
const MODULE_SETTINGS = [
  { key: 'bdu', name: 'BdU-Chat', text: 'Beantwortet !BdU im Chat. Aus: Der Befehl wird still ignoriert, offene Anfragen werden verworfen.' },
  { key: 'uboat', name: 'UBOAT-Soldbuch', text: 'Beantwortet !soldbuch im Chat. Aus: Der Befehl wird still ignoriert, der Spielstand wird weiter eingelesen.' },
];
const LOG_STREAM_URL = '/api/admin/log/stream';
const ERROR_LOG_URL = '/api/admin/log/errors';
const LOG_MAX_LINES = 2000;
const LOG_MAX_ERRORS = 1000;
const LOG_BOTTOM_TOLERANCE_PX = 24;
const LIGHT_LABELS = { ok: 'funktioniert', bad: 'Fehler', off: 'nicht aktiv' };
const SERVER_ACTIONS = {
  restart: { url: '/api/admin/server/restart', label: 'Server neu starten', question: 'Server wirklich neu starten?', yes: 'Ja, neu starten', warnMs: 30000 },
  shutdown: { url: '/api/admin/server/shutdown', label: 'Server beenden', question: 'Server wirklich beenden?', yes: 'Ja, beenden', warnMs: 5000 },
};
const EFFECT_LABELS = { follow: 'Follow', sub: 'Sub', gift: 'Gift' };

const TABS = [
  { id: 'uebersicht', title: 'Übersicht', ready: true, render: renderOverview },
  { id: 'log', title: 'Live-Log', ready: true, render: renderLog },
  { id: 'einstellungen', title: 'Einstellungen', ready: true, render: renderSettings },
  { id: 'whitelist', title: 'Whitelist', ready: true, render: renderWhitelist },
  { id: 'statistik', title: 'Statistik', ready: true, render: renderStatistics },
];

const state = {
  data: null, online: null, pid: null, pollMs: DEFAULT_POLL_MS, timer: null, noticeTimer: null,
  confirming: null, confirmTimer: null, exit: null, actions: null, actionsKey: null,
  optionalCollapsed: loadCollapsed(), optionalToggle: null,
  statistics: { view: null, rows: null, note: null, loading: false },
  settings: {
    view: null, rows: {}, message: null, busy: new Set(),
    effects: { input: null, state: null, hint: null, busy: false },
  },
  whitelist: {
    view: null, list: null, count: null, input: null, addButton: null, message: null,
    entries: [], filter: '', confirming: null, confirmTimer: null, loaded: false, loading: false, busy: false,
  },
  log: {
    view: null, list: null, errorList: null, status: null, toEnd: null, problems: null, modeButtons: null,
    source: null, pid: null, lastId: 0, filter: '', onlyProblems: false, follow: true, mode: 'live',
  },
};

// ── DOM-Helfer ──────────────────────────────────────────────────────
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
}

function indicator(level, text) {
  return el('span', { class: 'state' }, el('span', { class: `dot ${level}`, 'aria-hidden': 'true' }), text);
}

function row(label, value) {
  return el('div', { class: 'row' }, el('dt', { text: label }), el('dd', null, value));
}

function card(title, ...children) {
  return el('section', { class: 'card' }, el('h2', { text: title }), ...children);
}

function rows(...items) {
  return el('dl', { class: 'rows' }, ...items);
}

// ── Formatierung ────────────────────────────────────────────────────
function clock(iso) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function dateTime(iso) {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Einträge von heute nur mit Uhrzeit, ältere zusätzlich mit Datum.
function logTime(iso) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function errorTime(iso) {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function effectTime(iso, now = new Date()) {
  return new Date(iso).toDateString() === now.toDateString() ? clock(iso) : dateTime(iso);
}

function uptime(iso) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'gerade gestartet';
  const hours = Math.floor(minutes / 60);
  return hours ? `seit ${hours} Std. ${minutes % 60} Min.` : `seit ${minutes} Min.`;
}

function fileName(value) {
  return String(value).split(/[\\/]/).pop();
}

// Lichter der optionalen Module. level: ok = funktioniert, bad = Fehler, off = nur nicht aktiv, null = kein Licht.
function effectsLight(d) {
  if (!d.ha_webhook_configured) return { level: 'bad', hint: 'Webhook nicht eingetragen' };
  if (d.effect_mode === 'off') return { level: 'off', hint: 'Effekte ausgeschaltet' };
  return { level: 'ok', hint: 'bereit' };
}

function soldbuchLight(d) {
  if (!d.uboat_enabled) return { level: 'off', hint: 'nicht eingerichtet' };
  if (!d.modules.uboat) return { level: 'off', hint: 'ausgeschaltet' };
  if (!d.uboat_save) return { level: 'bad', hint: 'kein Spielstand gelesen' };
  return { level: 'ok', hint: 'bereit' };
}

function bduLight(d) {
  if (!d.modules.bdu) return { level: 'off', hint: 'ausgeschaltet' };
  if (!d.bdu_widget_connected) return { level: 'off', hint: 'Enigma-Widget nicht verbunden' };
  if (d.bdu_silence_until) return { level: 'off', hint: 'Funkstille' };
  return { level: 'ok', hint: 'bereit' };
}

function moduleLights(d) {
  return [
    { name: 'HA-Effekte', ...effectsLight(d) },
    { name: 'UBOAT-Soldbuch', ...soldbuchLight(d) },
    { name: 'BdU-Chat', ...bduLight(d) },
    { name: 'Sub-Goal', level: null, hint: '' },
  ];
}

// ── Reiter ──────────────────────────────────────────────────────────
function activeTab() {
  const id = location.hash.slice(1);
  return TABS.find(t => t.id === id && t.ready) || TABS[0];
}

function renderTabs() {
  const current = activeTab();
  const nodes = TABS.map(tab => {
    const button = el('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      'aria-selected': String(tab === current),
    }, tab.title);
    if (tab.ready) {
      button.addEventListener('click', () => { location.hash = tab.id; });
    } else {
      button.disabled = true;
      button.append(el('small', { text: 'folgt' }));
    }
    return button;
  });
  document.getElementById('tabs').replaceChildren(...nodes);
}

function renderContent() {
  const content = document.getElementById('content');
  if (!state.data) {
    content.replaceChildren(el('p', { text: 'Warte auf den Server …' }));
    return;
  }
  activeTab().render(content, state.data);
}

// ── Whitelist ───────────────────────────────────────────────────────
function showWhitelistMessage(text, isError) {
  const { message } = state.whitelist;
  message.textContent = text;
  message.className = `wl-message ${isError ? 'error' : 'ok'}`;
}

function cancelWhitelistConfirm() {
  clearTimeout(state.whitelist.confirmTimer);
  state.whitelist.confirming = null;
  renderWhitelistRows();
}

function askWhitelistRemove(id) {
  const wl = state.whitelist;
  clearTimeout(wl.confirmTimer);
  wl.confirming = id;
  wl.confirmTimer = setTimeout(cancelWhitelistConfirm, CONFIRM_MS);
  renderWhitelistRows();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function postWhitelist(path, body) {
  return postJson(`${WHITELIST_URL}/${path}`, body);
}

async function loadWhitelistEntries() {
  const wl = state.whitelist;
  if (wl.loading) return;
  wl.loading = true;
  try {
    const response = await fetch(WHITELIST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    wl.entries = (await response.json()).entries;
    wl.loaded = true;
    renderWhitelistRows();
  } catch {
    showWhitelistMessage('Die Whitelist konnte nicht geladen werden.', true);
  } finally {
    wl.loading = false;
  }
}

async function addWhitelistEntry() {
  const wl = state.whitelist;
  const user = wl.input.value.trim();
  if (!user || wl.busy) return;
  wl.busy = true;
  wl.addButton.disabled = true;
  try {
    const { entry } = await postWhitelist('add', { user });
    wl.input.value = '';
    showWhitelistMessage(`@${entry.name} hinzugefügt.`, false);
    await loadWhitelistEntries();
  } catch (err) {
    showWhitelistMessage(err.message, true);
  } finally {
    wl.busy = false;
    wl.addButton.disabled = false;
    wl.input.focus();
  }
}

async function removeWhitelistEntry(entry) {
  cancelWhitelistConfirm();
  try {
    await postWhitelist('remove', { id: entry.id });
    showWhitelistMessage(`@${entry.name} entfernt.`, false);
    await loadWhitelistEntries();
  } catch (err) {
    showWhitelistMessage(err.message, true);
  }
}

function whitelistRow(entry) {
  const wl = state.whitelist;
  let actions = [actionButton('Entfernen', '', () => askWhitelistRemove(entry.id), false)];
  if (wl.confirming === entry.id) {
    const yes = actionButton('Ja, entfernen', 'danger', () => removeWhitelistEntry(entry), true);
    setTimeout(() => { yes.disabled = false; }, CONFIRM_LOCK_MS);
    actions = [yes, actionButton('Abbrechen', '', cancelWhitelistConfirm, false)];
  }
  return el('li', { class: 'wl-row' },
    el('div', { class: 'wl-name' }, el('span', { text: `@${entry.name}` }), el('span', { class: 'wl-id mono', text: entry.id })),
    el('div', { class: 'wl-actions' }, ...actions));
}

function renderWhitelistRows() {
  const wl = state.whitelist;
  const shown = wl.entries.filter(e => !wl.filter || e.name.toLowerCase().includes(wl.filter) || e.id.includes(wl.filter));
  wl.count.textContent = wl.entries.length === 1 ? '1 Eintrag' : `${wl.entries.length} Einträge`;
  if (shown.length) {
    wl.list.replaceChildren(...shown.map(whitelistRow));
  } else {
    wl.list.replaceChildren(el('li', { class: 'wl-empty', text: wl.entries.length ? 'Kein Treffer.' : 'Die Whitelist ist leer.' }));
  }
}

function whitelistView() {
  const wl = state.whitelist;
  if (wl.view) return wl.view;
  wl.input = el('input', { type: 'text', class: 'wl-input', placeholder: 'Twitch-Name, @Name oder ID', 'aria-label': 'Streamer hinzufügen', maxlength: '40', autocomplete: 'off' });
  wl.input.addEventListener('keydown', event => { if (event.key === 'Enter') addWhitelistEntry(); });
  wl.addButton = actionButton('Hinzufügen', '', addWhitelistEntry, false);
  wl.message = el('p', { class: 'wl-message', role: 'status' });
  const search = el('input', { type: 'search', class: 'wl-input', placeholder: 'Filtern …', 'aria-label': 'Whitelist filtern' });
  search.addEventListener('input', () => { wl.filter = search.value.trim().toLowerCase(); renderWhitelistRows(); });
  wl.count = el('span', { class: 'log-status' });
  wl.list = el('ul', { class: 'wl-list' });
  wl.view = el('section', { class: 'wl' },
    el('div', { class: 'log-toolbar' }, wl.input, wl.addButton),
    wl.message,
    el('div', { class: 'log-toolbar' }, search, wl.count),
    wl.list);
  renderWhitelistRows();
  return wl.view;
}

function renderWhitelist(content, d) {
  const wl = state.whitelist;
  const view = whitelistView();
  if (content.firstChild !== view) {
    content.replaceChildren(view);
    loadWhitelistEntries();
  } else if (wl.loaded && d.whitelist_count !== wl.entries.length) {
    loadWhitelistEntries();   // an der Konsole geändert
  }
}

// ── Statistik ───────────────────────────────────────────────────────
async function loadStatistics() {
  const statistics = state.statistics;
  if (statistics.loading) return;
  statistics.loading = true;
  try {
    const response = await fetch(STATS_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const { started_at: started, metrics } = data.instance;
    statistics.rows.replaceChildren(
      row('Läuft', el('span', { text: `${uptime(started)}, Start ${dateTime(started)}` })),
      ...metrics.map(m => row(m.label, el('span', { class: 'mono', text: String(m.value) }))));
    statistics.note.textContent = data.enabled
      ? 'Der Broadcaster und genutzte Chat-Bots zählen nicht bei den Chatnachrichten. Laufender Stream und Gesamtstatistik folgen.'
      : 'Die Statistik ist abgeschaltet.';
  } catch {
    statistics.note.textContent = 'Die Statistik konnte nicht geladen werden.';
  } finally {
    statistics.loading = false;
  }
}

function statisticsView() {
  const statistics = state.statistics;
  if (statistics.view) return statistics.view;
  statistics.rows = rows();
  statistics.note = el('p', { class: 'sub' });
  statistics.view = el('section', { class: 'settings' }, card('Diese Server-Instanz', statistics.rows), statistics.note);
  return statistics.view;
}

function renderStatistics(content) {
  const view = statisticsView();
  if (content.firstChild !== view) content.replaceChildren(view);
  loadStatistics();
}

// ── Einstellungen ───────────────────────────────────────────────────
function showSettingsMessage(text, isError) {
  const { message } = state.settings;
  message.textContent = text;
  message.className = `wl-message ${isError ? 'error' : 'ok'}`;
}

function updateSettings(d) {
  const settings = state.settings;
  for (const { key } of MODULE_SETTINGS) {
    const row = settings.rows[key];
    if (!settings.busy.has(key)) row.input.checked = Boolean(d.modules[key]);
    row.state.textContent = row.input.checked ? 'an' : 'aus';
  }
  const uboatHint = settings.rows.uboat.hint;
  uboatHint.hidden = d.uboat_enabled;
  uboatHint.textContent = 'UBOAT_SAVES_DIR ist nicht gesetzt. Das Soldbuch antwortet erst, wenn der Ordner in der .env steht und der Server neu gestartet wurde.';
  updateEffectSettings(d);
}

function updateEffectSettings(d) {
  const fx = state.settings.effects;
  if (!fx.busy) fx.input.checked = d.effect_mode !== 'off';
  fx.state.textContent = fx.input.checked ? 'an' : 'aus';
  fx.hint.hidden = d.ha_webhook_configured;
  fx.hint.textContent = 'HA_WEBHOOK_URL ist nicht gesetzt. Effekte werden nur lokal protokolliert.';
}

async function toggleEffects() {
  const fx = state.settings.effects;
  const enabled = fx.input.checked;
  fx.busy = true;
  fx.input.disabled = true;
  try {
    const { mode } = await postJson(EFFECT_MODE_URL, { mode: enabled ? 'auto' : 'off' });
    state.data.effect_mode = mode;
    showSettingsMessage(`HA-Effekte ${enabled ? 'eingeschaltet' : 'ausgeschaltet'}.`, false);
  } catch (err) {
    fx.input.checked = !enabled;
    showSettingsMessage(`HA-Effekte: ${err.message}`, true);
  } finally {
    fx.busy = false;
    fx.input.disabled = false;
    updateEffectSettings(state.data);
  }
}

function effectCard() {
  const fx = state.settings.effects;
  fx.input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'HA-Effekte' });
  fx.input.addEventListener('change', toggleEffects);
  fx.state = el('span', { class: 'setting-state' });
  fx.hint = el('div', { class: 'sub setting-hint' });
  fx.hint.hidden = true;
  return card('HA-Effekte', el('div', { class: 'setting' },
    el('div', { class: 'setting-text' },
      el('div', { class: 'setting-name', text: 'Effekte' }),
      el('div', { class: 'sub', text: 'Follows, Subs und Gifts lösen Effekte in Home Assistant aus. Aus: Neue Effekte werden verworfen.' }),
      fx.hint),
    el('div', { class: 'setting-control' }, fx.state, el('label', { class: 'switch' }, fx.input, el('span', { class: 'track' })))));
}

async function toggleModule(setting) {
  const settings = state.settings;
  const { input } = settings.rows[setting.key];
  const enabled = input.checked;
  settings.busy.add(setting.key);
  input.disabled = true;
  try {
    const { modules } = await postJson(MODULES_URL, { module: setting.key, enabled });
    state.data.modules = modules;
    showSettingsMessage(`${setting.name} ${enabled ? 'eingeschaltet' : 'ausgeschaltet'}.`, false);
  } catch (err) {
    input.checked = !enabled;
    showSettingsMessage(`${setting.name}: ${err.message}`, true);
  } finally {
    settings.busy.delete(setting.key);
    input.disabled = false;
    updateSettings(state.data);
  }
}

function settingRow(setting) {
  const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': setting.name });
  input.addEventListener('change', () => toggleModule(setting));
  const stateText = el('span', { class: 'setting-state' });
  const hint = el('div', { class: 'sub setting-hint' });
  hint.hidden = true;
  state.settings.rows[setting.key] = { input, state: stateText, hint };
  return el('div', { class: 'setting' },
    el('div', { class: 'setting-text' }, el('div', { class: 'setting-name', text: setting.name }), el('div', { class: 'sub', text: setting.text }), hint),
    el('div', { class: 'setting-control' }, stateText, el('label', { class: 'switch' }, input, el('span', { class: 'track' }))));
}

function settingsView() {
  const settings = state.settings;
  if (settings.view) return settings.view;
  settings.message = el('p', { class: 'wl-message', role: 'status' });
  settings.view = el('section', { class: 'settings' },
    effectCard(),
    card('Modul-Schalter', ...MODULE_SETTINGS.map(settingRow)),
    settings.message);
  return settings.view;
}

function renderSettings(content, d) {
  const view = settingsView();
  if (content.firstChild !== view) content.replaceChildren(view);
  updateSettings(d);
}

// ── Live-Log ────────────────────────────────────────────────────────
function logLineMatches(line) {
  if (state.log.onlyProblems && line.dataset.level === 'info') return false;
  return !state.log.filter || line.dataset.search.includes(state.log.filter);
}

function applyLogFilter() {
  for (const list of [state.log.list, state.log.errorList]) {
    for (const line of list.children) line.hidden = !logLineMatches(line);
  }
  scrollLogIfFollowing();
}

function logLineNode(entry, timeText) {
  const line = el('div', { class: `log-line ${entry.level}` }, el('time', { text: timeText }), el('span', { text: entry.text }));
  line.dataset.level = entry.level;
  line.dataset.search = entry.text.toLowerCase();
  line.hidden = !logLineMatches(line);
  return line;
}

function errorLineNode(entry) {
  return logLineNode({ level: 'error', text: entry.text }, errorTime(entry.at));
}

function logNote(text) {
  const note = el('div', { class: 'log-note', text });
  note.dataset.level = 'error';
  note.dataset.search = '';
  return note;
}

function prependErrorEntry(entry) {
  const list = state.log.errorList;
  const note = list.querySelector('.log-note');
  if (note) note.remove();
  list.prepend(errorLineNode(entry));
  while (list.children.length > LOG_MAX_ERRORS) list.lastChild.remove();
}

async function showErrorLog() {
  const list = state.log.errorList;
  try {
    const response = await fetch(ERROR_LOG_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { entries } = await response.json();
    list.replaceChildren(...(entries.length ? entries.map(errorLineNode) : [logNote('Keine Fehler gespeichert.')]));
    list.scrollTop = 0;
  } catch {
    list.replaceChildren(logNote('Das Fehlerprotokoll konnte nicht geladen werden.'));
  }
}

function setLogMode(mode) {
  const log = state.log;
  log.mode = mode;
  const errors = mode === 'errors';
  log.list.hidden = errors;
  log.errorList.hidden = !errors;
  log.problems.hidden = errors;
  log.toEnd.hidden = errors || log.follow;
  log.modeButtons.live.setAttribute('aria-pressed', String(!errors));
  log.modeButtons.errors.setAttribute('aria-pressed', String(errors));
  if (errors) showErrorLog();
  else scrollLogIfFollowing();
}

function setLogFollow(follow) {
  state.log.follow = follow;
  state.log.toEnd.hidden = follow;
}

function scrollLogIfFollowing() {
  if (state.log.follow) state.log.list.scrollTop = state.log.list.scrollHeight;
}

function appendLogNode(line) {
  state.log.list.append(line);
  while (state.log.list.children.length > LOG_MAX_LINES) state.log.list.firstChild.remove();
  scrollLogIfFollowing();
}

function appendLogSeparator(text) {
  const line = el('div', { class: 'log-separator', text });
  line.dataset.level = 'info';
  line.dataset.search = text.toLowerCase();
  line.hidden = !logLineMatches(line);
  appendLogNode(line);
}

function appendLogEntry(entry) {
  if (entry.id <= state.log.lastId) return;
  state.log.lastId = entry.id;
  appendLogNode(logLineNode(entry, logTime(entry.at)));
  if (entry.level === 'error' && state.log.mode === 'errors') prependErrorEntry(entry);
}

function connectLog() {
  if (state.log.source) return;
  state.log.status.textContent = 'verbinde …';
  const source = new EventSource(LOG_STREAM_URL);
  state.log.source = source;
  source.addEventListener('hello', event => {
    const { pid } = JSON.parse(event.data);
    if (state.log.pid !== null && state.log.pid !== pid) {
      appendLogSeparator(`Neuer Serverprozess: PID ${pid} (vorher ${state.log.pid})`);
      state.log.lastId = 0;
    }
    state.log.pid = pid;
    state.log.status.textContent = 'live';
  });
  source.addEventListener('line', event => appendLogEntry(JSON.parse(event.data)));
  source.onerror = () => { state.log.status.textContent = 'getrennt, verbinde neu …'; };
}

function logView() {
  const log = state.log;
  if (log.view) return log.view;
  log.list = el('div', { class: 'log-list', role: 'log', 'aria-live': 'off', tabindex: '0' });
  log.list.addEventListener('scroll', () => {
    const distance = log.list.scrollHeight - log.list.scrollTop - log.list.clientHeight;
    setLogFollow(distance <= LOG_BOTTOM_TOLERANCE_PX);
  });
  // Eine andere Breite bricht die Zeilen neu um; das darf das Mitlaufen nicht beenden.
  new ResizeObserver(scrollLogIfFollowing).observe(log.list);
  log.status = el('span', { class: 'log-status' });
  log.toEnd = actionButton('Zum neuesten Eintrag', '', () => { setLogFollow(true); scrollLogIfFollowing(); }, false);
  log.toEnd.hidden = true;
  const search = el('input', { type: 'search', placeholder: 'Filtern …', 'aria-label': 'Log filtern', class: 'log-search' });
  search.addEventListener('input', () => { log.filter = search.value.trim().toLowerCase(); applyLogFilter(); });
  const problems = el('input', { type: 'checkbox' });
  problems.addEventListener('change', () => { log.onlyProblems = problems.checked; applyLogFilter(); });
  log.problems = el('label', { class: 'log-check' }, problems, 'Nur Warnungen und Fehler');
  log.errorList = el('div', { class: 'log-list', tabindex: '0' });
  log.errorList.hidden = true;
  log.modeButtons = {
    live: actionButton('Live', 'mode', () => setLogMode('live'), false),
    errors: actionButton('Fehlerprotokoll', 'mode', () => setLogMode('errors'), false),
  };
  log.modeButtons.live.setAttribute('aria-pressed', 'true');
  log.modeButtons.errors.setAttribute('aria-pressed', 'false');
  log.view = el('section', { class: 'log' },
    el('div', { class: 'log-toolbar' },
      el('div', { class: 'log-modes', role: 'group', 'aria-label': 'Ansicht' }, log.modeButtons.live, log.modeButtons.errors),
      search, log.problems, log.toEnd, log.status),
    log.list, log.errorList);
  return log.view;
}

function renderLog(content) {
  const view = logView();
  if (content.firstChild !== view) {
    content.replaceChildren(view);
    scrollLogIfFollowing();
  }
  connectLog();
}

// ── Server beenden und neu starten ──────────────────────────────────
function askServerAction(kind) {
  clearTimeout(state.confirmTimer);
  state.confirming = kind;
  state.confirmTimer = setTimeout(cancelServerAction, CONFIRM_MS);
  updateServerActions();
}

function cancelServerAction() {
  clearTimeout(state.confirmTimer);
  state.confirming = null;
  updateServerActions();
}

async function runServerAction(kind) {
  const action = SERVER_ACTIONS[kind];
  cancelServerAction();
  try {
    const response = await fetch(action.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(`${action.label} abgelehnt: ${result.error || `HTTP ${response.status}`}`);
      return;
    }
    state.exit = { kind, pid: result.pid, at: result.at, requestedAt: Date.now(), warned: false };
    renderConnection();
    updateServerActions();
    clearTimeout(state.timer);
    state.timer = setTimeout(poll, EXIT_POLL_MS);
  } catch {
    showNotice('Der Server hat nicht geantwortet. Bitte das Konsolenfenster prüfen.');
  }
}

function actionButton(text, variant, onClick, disabled) {
  const button = el('button', { class: `btn ${variant}`, type: 'button' }, text);
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function fillServerActions(box, canRestart) {
  if (state.confirming) {
    const kind = state.confirming;
    const action = SERVER_ACTIONS[kind];
    // Kurze Sperre, damit ein Doppelklick auf den ersten Knopf nicht gleich bestätigt.
    const yes = actionButton(action.yes, 'danger', () => runServerAction(kind), true);
    setTimeout(() => { yes.disabled = false; }, CONFIRM_LOCK_MS);
    box.replaceChildren(
      el('p', { class: 'question', text: action.question }),
      el('p', { text: 'Wartende Effekte und Raid-Begrüßungen gehen dabei verloren.' }),
      yes,
      actionButton('Abbrechen', '', cancelServerAction, false));
    return;
  }
  const blocked = !state.online || Boolean(state.exit);
  box.replaceChildren(...[
    actionButton(SERVER_ACTIONS.restart.label, '', () => askServerAction('restart'), blocked || !canRestart),
    actionButton(SERVER_ACTIONS.shutdown.label, 'danger', () => askServerAction('shutdown'), blocked),
    canRestart ? null : el('p', { text: 'Neu starten geht nur, wenn der Server über AuthServer.cmd läuft.' }),
  ].filter(Boolean));
}

// Die Knöpfe bleiben dieselben Elemente und werden nur bei einer Änderung neu gefüllt,
// sonst ginge ein Klick verloren, wenn gerade die Abfrage die Seite neu aufbaut.
function updateServerActions() {
  if (!state.data) return;
  if (!state.actions) state.actions = el('div', { class: 'actions' });
  const canRestart = Boolean(state.data.can_restart);
  const key = [state.confirming, Boolean(state.exit), state.online, canRestart].join('|');
  if (key === state.actionsKey) return;
  state.actionsKey = key;
  fillServerActions(state.actions, canRestart);
}

function serverActions() {
  updateServerActions();
  return state.actions;
}

// ── Übersicht ───────────────────────────────────────────────────────
function serverCard(d) {
  return card('Server', rows(
    row('Läuft', el('span', { text: `${uptime(d.started_at)}, Start ${dateTime(d.started_at)}` })),
    row('Prozess-ID', el('span', { class: 'mono', text: String(d.pid) })),
    row('Port', el('span', { class: 'mono', text: String(d.port) })),
  ), serverActions());
}

function twitchCard(d) {
  if (!d.authenticated) {
    return card('Twitch', rows(
      row('Anmeldung', indicator('bad', 'nicht angemeldet')),
      row('', el('a', { href: '/login', text: 'Jetzt bei Twitch anmelden' })),
    ));
  }
  const token = d.token_valid
    ? indicator('ok', `gültig, noch ${d.expires_in_minutes} Min.`)
    : indicator('warn', 'abgelaufen, wird automatisch erneuert');
  return card('Twitch', rows(
    row('Konto', el('span', { text: d.broadcaster_name || 'unbekannt' })),
    row('Token', token),
    row('EventSub', d.eventsub_connected ? indicator('ok', 'verbunden') : indicator('bad', 'getrennt')),
    row('Kategorie', el('span', { text: d.category || 'unbekannt' })),
  ));
}

function effectsCard(d) {
  const list = d.recent_effects.length
    ? d.recent_effects.map(e => {
      const name = EFFECT_LABELS[e.type] || e.type;
      const count = e.count > 1 ? ` ×${e.count}` : '';
      const who = e.userName ? ` · ${e.userName}` : '';
      const skipped = e.skipped ? ' (nicht bestätigt)' : '';
      return el('li', null,
        el('span', { text: `${name}${count}${who}${skipped}` }),
        el('time', { text: effectTime(e.timestamp) }));
    })
    : [el('li', { class: 'empty', text: 'Noch keine Effekte.' })];
  return card('HA-Effekte', rows(
    row('Webhook', d.ha_webhook_configured ? indicator('ok', 'eingetragen') : indicator('bad', 'nicht eingetragen')),
    row('Effekte', d.effect_mode === 'off' ? indicator('off', 'aus') : indicator('ok', 'an')),
    row('Warteschlange', el('span', { text: String(d.effect_queue_length) })),
  ), el('ul', { class: 'events' }, ...list));
}

function switchRow(on) {
  return row('Modul', on ? indicator('ok', 'an') : indicator('off', 'aus'));
}

function botCard(d) {
  const featureNames = { bdu: 'BdU-Chat', uboat: 'Soldbuch' };
  if (!d.bot_configured) {
    return card('Bot', rows(
      row('DerBdu', indicator('off', 'nicht eingerichtet')),
      row('Es sendet', el('span', { text: 'Broadcaster' })),
      row('', el('a', { href: '/login-bot', text: 'Bot einrichten' })),
    ));
  }
  return card('Bot', rows(
    row('Konto', indicator('ok', d.bot_login)),
    row('Sendet', el('span', { text: d.bot_features.map(f => featureNames[f] || f).join(', ') })),
  ));
}

function bduCard(d) {
  let silence = el('span', { text: 'keine' });
  if (d.bdu_silence_until === 'bis Streamstart') silence = indicator('warn', 'bis Streamstart');
  else if (d.bdu_silence_until) silence = indicator('warn', `bis ${clock(d.bdu_silence_until)} Uhr`);
  return card('BdU-Chat', rows(
    switchRow(d.modules.bdu),
    row('Enigma-Widget', d.bdu_widget_connected ? indicator('ok', 'verbunden') : indicator('off', 'nicht verbunden')),
    row('Funkstille', silence),
  ));
}

function uboatCard(d) {
  if (!d.uboat_enabled) {
    return card('UBOAT-Soldbuch', rows(row('Spielstände', indicator('off', 'nicht eingerichtet'))));
  }
  return card('UBOAT-Soldbuch', rows(
    switchRow(d.modules.uboat),
    row('Kategorie aktiv', d.uboat_active ? indicator('ok', 'ja') : indicator('off', 'nein')),
    row('Spielstand', el('span', { text: d.uboat_save ? fileName(d.uboat_save) : 'noch keiner' })),
    row('Stand', el('span', { text: d.uboat_saved_at ? dateTime(d.uboat_saved_at) : '–' })),
  ));
}

function subgoalCard(d) {
  const goal = d.subgoal;
  if (goal.current === null || goal.current === undefined) {
    return card('Sub-Goal', el('div', { class: 'sub', text: 'Noch kein Stand bekannt.' }));
  }
  const percent = goal.target ? Math.min(100, Math.round((goal.current / goal.target) * 100)) : 0;
  const bar = el('span');
  bar.style.width = `${percent}%`;
  return card('Sub-Goal',
    el('div', { class: 'big', text: goal.target ? `${goal.current} / ${goal.target}` : String(goal.current) }),
    goal.title ? el('div', { class: 'sub', text: goal.title }) : null,
    goal.target ? el('div', { class: 'bar' }, bar) : null);
}

function loadCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

function saveCollapsed(collapsed) {
  try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* nur eine Bequemlichkeit */ }
}

// Dasselbe Element über alle Abfragen, sonst ginge ein Klick verloren, wenn gerade neu aufgebaut wird.
function optionalToggle() {
  if (!state.optionalToggle) {
    state.optionalToggle = el('button', { class: 'group-head', type: 'button' }, el('span', { class: 'chevron', 'aria-hidden': 'true' }), 'Optionale Module');
    state.optionalToggle.addEventListener('click', () => {
      state.optionalCollapsed = !state.optionalCollapsed;
      saveCollapsed(state.optionalCollapsed);
      renderContent();
    });
  }
  state.optionalToggle.setAttribute('aria-expanded', String(!state.optionalCollapsed));
  state.optionalToggle.firstChild.textContent = state.optionalCollapsed ? '▸' : '▾';
  return state.optionalToggle;
}

function moduleLightList(d) {
  return el('ul', { class: 'module-lights' }, ...moduleLights(d).map(m => el('li', { title: m.hint },
    m.level ? el('span', { class: `dot ${m.level}`, role: 'img', 'aria-label': LIGHT_LABELS[m.level] }) : null,
    m.name)));
}

function optionalModules(d) {
  return el('section', { class: 'group' }, optionalToggle(), state.optionalCollapsed
    ? moduleLightList(d)
    : el('div', { class: 'grid' }, effectsCard(d), uboatCard(d), bduCard(d), subgoalCard(d)));
}

function renderOverview(content, d) {
  content.replaceChildren(
    el('div', { class: 'grid' }, serverCard(d), twitchCard(d), botCard(d)),
    optionalModules(d));
}

// ── Verbindung und Abfrage ──────────────────────────────────────────
function connectionView() {
  const exit = state.exit;
  if (exit && exit.kind === 'restart') return ['pending', exit.warned ? 'Neustart ausgeblieben' : 'Neustart läuft …'];
  if (exit && state.online) return ['pending', 'Server wird beendet …'];
  if (exit) return ['stopped', `Server beendet um ${clock(exit.at)} (PID ${exit.pid})`];
  return state.online ? ['online', 'verbunden'] : ['offline', 'Server nicht erreichbar'];
}

function renderConnection() {
  const [variant, text] = connectionView();
  document.getElementById('connection').className = `connection ${variant}`;
  document.getElementById('connection-text').textContent = text;
}

function setConnection(online) {
  state.online = online;
  if (!online && state.confirming) {
    clearTimeout(state.confirmTimer);
    state.confirming = null;
  }
  renderConnection();
  document.body.classList.toggle('stale', !online);
  updateServerActions();
}

// Antwortet der Server: Ist es ein neuer Prozess, oder läuft der alte trotz Auftrag weiter?
function checkExitAfterAnswer(data) {
  const exit = state.exit;
  if (state.pid !== null && state.pid !== data.pid) {
    showNotice(exit && exit.kind === 'restart'
      ? `Neustart abgeschlossen: PID ${data.pid} (vorher ${state.pid}).`
      : `Neuer Serverprozess: PID ${data.pid} (vorher ${state.pid}).`);
    state.exit = null;
  } else if (exit && Date.now() - exit.requestedAt > SERVER_ACTIONS[exit.kind].warnMs) {
    showNotice(`Server läuft noch: PID ${data.pid} antwortet weiterhin. Bitte das Konsolenfenster prüfen.`);
    state.exit = null;
  }
}

function checkExitWithoutAnswer() {
  const exit = state.exit;
  if (!exit || exit.kind !== 'restart' || exit.warned) return;
  if (Date.now() - exit.requestedAt <= SERVER_ACTIONS.restart.warnMs) return;
  exit.warned = true;
  showNotice('Der Neustart dauert ungewöhnlich lange. Bitte das Konsolenfenster prüfen.');
  renderConnection();
}

function pollDelay() {
  const exit = state.exit;
  return exit && !exit.warned && (exit.kind === 'restart' || state.online) ? EXIT_POLL_MS : state.pollMs;
}

function showNotice(text) {
  const notice = document.getElementById('notice');
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => { notice.hidden = true; }, NOTICE_MS);
}

async function poll() {
  clearTimeout(state.timer);
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OVERVIEW_URL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    checkExitAfterAnswer(data);
    state.pid = data.pid;
    state.data = data;
    state.pollMs = data.poll_ms || DEFAULT_POLL_MS;
    document.getElementById('version').textContent = `v${data.version}`;
    setConnection(true);
    renderContent();
  } catch {
    setConnection(false);
    checkExitWithoutAnswer();
  } finally {
    clearTimeout(abort);
    clearTimeout(state.timer);
    if (!document.hidden) state.timer = setTimeout(poll, pollDelay());
  }
}

window.addEventListener('hashchange', () => { renderTabs(); renderContent(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(state.timer);
  else poll();
});

renderTabs();
renderContent();
poll();
