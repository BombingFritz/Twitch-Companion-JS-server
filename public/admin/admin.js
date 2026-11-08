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
const SERVER_ACTIONS = {
  restart: { url: '/api/admin/server/restart', label: 'Server neu starten', question: 'Server wirklich neu starten?', yes: 'Ja, neu starten', warnMs: 30000 },
  shutdown: { url: '/api/admin/server/shutdown', label: 'Server beenden', question: 'Server wirklich beenden?', yes: 'Ja, beenden', warnMs: 5000 },
};
const EFFECT_LABELS = { follow: 'Follow', sub: 'Sub', gift: 'Gift' };

const TABS = [
  { id: 'uebersicht', title: 'Übersicht', ready: true, render: renderOverview },
  { id: 'log', title: 'Live-Log', ready: false },
  { id: 'einstellungen', title: 'Einstellungen', ready: false },
  { id: 'whitelist', title: 'Whitelist', ready: false },
  { id: 'statistik', title: 'Statistik', ready: false },
];

const state = {
  data: null, online: null, pid: null, pollMs: DEFAULT_POLL_MS, timer: null, noticeTimer: null,
  confirming: null, confirmTimer: null, exit: null, actions: null, actionsKey: null,
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
  const modes = { auto: ['ok', 'automatisch'], manual: ['warn', 'manuell (Bestätigung nötig)'], off: ['warn', 'aus'] };
  const [level, label] = modes[d.effect_mode] || ['off', String(d.effect_mode)];
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
  return card('Effekte', rows(
    row('Modus', indicator(level, label)),
    row('Warteschlange', el('span', { text: String(d.effect_queue_length) })),
    row('Wartet auf Bestätigung', d.pending_confirmation
      ? indicator('warn', `${EFFECT_LABELS[d.pending_confirmation.type] || d.pending_confirmation.type} ×${d.pending_confirmation.count}`)
      : el('span', { text: 'nein' })),
  ), el('ul', { class: 'events' }, ...list));
}

function modulesCard(d) {
  const line = (label, on) => row(label, on ? indicator('ok', 'an') : indicator('off', 'aus'));
  return card('Module', rows(
    line('BdU-Chat', d.modules.bdu),
    line('UBOAT-Soldbuch', d.modules.uboat),
  ));
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
    row('Enigma-Widget', d.bdu_widget_connected ? indicator('ok', 'verbunden') : indicator('off', 'nicht verbunden')),
    row('Funkstille', silence),
  ));
}

function uboatCard(d) {
  if (!d.uboat_enabled) {
    return card('UBOAT', rows(row('Spielstände', indicator('off', 'nicht eingerichtet'))));
  }
  return card('UBOAT', rows(
    row('Kategorie aktiv', d.uboat_active ? indicator('ok', 'ja') : indicator('off', 'nein')),
    row('Spielstand', el('span', { text: d.uboat_save ? fileName(d.uboat_save) : 'noch keiner' })),
    row('Stand', el('span', { text: d.uboat_saved_at ? dateTime(d.uboat_saved_at) : '–' })),
  ));
}

function whitelistCard(d) {
  return card('Whitelist',
    el('div', { class: 'big', text: String(d.whitelist_count) }),
    el('div', { class: 'sub', text: d.whitelist_count === 1 ? 'Eintrag' : 'Einträge' }));
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

function renderOverview(content, d) {
  content.replaceChildren(el('div', { class: 'grid' },
    serverCard(d), twitchCard(d), effectsCard(d), modulesCard(d),
    botCard(d), bduCard(d), uboatCard(d), whitelistCard(d), subgoalCard(d)));
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
