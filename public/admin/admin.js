'use strict';
// Webkonsole (ADR 0018, docs/specs/webkonsole.md).
// Neuer Bereich: Eintrag in TABS mit ready: true und einer render-Funktion.
// Fremde Texte (Namen, Titel) nur über textContent einsetzen, nie als HTML.

const OVERVIEW_URL = '/api/admin/overview';
const DEFAULT_POLL_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;
const NOTICE_MS = 30000;
const EFFECT_LABELS = { follow: 'Follow', sub: 'Sub', gift: 'Gift' };

const TABS = [
  { id: 'uebersicht', title: 'Übersicht', ready: true, render: renderOverview },
  { id: 'log', title: 'Live-Log', ready: false },
  { id: 'einstellungen', title: 'Einstellungen', ready: false },
  { id: 'whitelist', title: 'Whitelist', ready: false },
  { id: 'statistik', title: 'Statistik', ready: false },
];

const state = { data: null, online: null, pid: null, pollMs: DEFAULT_POLL_MS, timer: null, noticeTimer: null };

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

// ── Übersicht ───────────────────────────────────────────────────────
function serverCard(d) {
  return card('Server', rows(
    row('Läuft', el('span', { text: `${uptime(d.started_at)}, Start ${dateTime(d.started_at)}` })),
    row('Prozess-ID', el('span', { class: 'mono', text: String(d.pid) })),
    row('Port', el('span', { class: 'mono', text: String(d.port) })),
  ));
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
        el('time', { text: clock(e.timestamp) }));
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
function setConnection(online) {
  state.online = online;
  document.getElementById('connection').className = `connection ${online ? 'online' : 'offline'}`;
  document.getElementById('connection-text').textContent = online ? 'verbunden' : 'Server nicht erreichbar';
  document.body.classList.toggle('stale', !online);
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
    if (state.pid !== null && state.pid !== data.pid) {
      showNotice(`Neuer Serverprozess: PID ${data.pid} (vorher ${state.pid}).`);
    }
    state.pid = data.pid;
    state.data = data;
    state.pollMs = data.poll_ms || DEFAULT_POLL_MS;
    document.getElementById('version').textContent = `v${data.version}`;
    setConnection(true);
    renderContent();
  } catch {
    setConnection(false);
  } finally {
    clearTimeout(abort);
    if (!document.hidden) state.timer = setTimeout(poll, state.pollMs);
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
