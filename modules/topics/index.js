// Modul Intro-Topics (ADR 0021, ADR 0020, docs/specs/intro-topics.md, docs/specs/stream-deck.md); umgezogen nach ADR 0027.
// Zustand und Regeln in lib/topics.js; hier Datei, Ereignisse an Widgets und Plugin, Effekte, Endpunkte und Konsole.
'use strict';
const fs = require('fs');
const express = require('express');
const { createTopics } = require('../../lib/topics');

const TOPICS_FILE = './topics.json';              // Themenliste und Anzeige-Einstellungen; Fortschritt nur im Arbeitsspeicher
const TOPICS_AUTO_HIDE_MS = 5000;                 // so lange bleibt die fertige Liste stehen
const TOPICS_SSE_PING_MS = 30 * 1000;             // Lebenszeichen auf der Events-Verbindung der Widgets und des Plugins
const TOPICS_JSON_LIMIT = '4kb';                  // Liste mit bis zu 10 Themen à 60 Zeichen
const TOPICS_ACTIONS = ['next', 'back', 'toggle', 'reset'];
const ADMIN_TOPICS_PATH = '/api/admin/topics';
const LOCAL_ONLY = 'Nur für lokale Aufrufe über localhost oder 127.0.0.1';

// ctx: state (core/state.js, Modul-Schalter 'topics'), writeJson (writeJsonAtomic, topics.json), scheduleEffect(type, meta), logIfChanged, isLocalWidgetRequest,
//      requireAdminWrite, adminJsonLimit, deckPath (still im HTTP-Protokoll wie die Topics-Endpunkte)
function createTopicsModule(ctx) {
  const KEY = 'topics';                    // Schlüssel des Modul-Schalters
  const isEnabled = () => ctx.state.isEnabled(KEY);
  let debug = false;                       // Testschalter "topics debug on": Topic-Effekte und Tastendrücke erscheinen im Log
  const clients = [];                      // offene Events-Verbindungen (Widgets, Stream-Deck-Plugin)

  function isTopicsPath(p) {
    const lower = p.toLowerCase();
    return lower === '/api/topics' || lower.startsWith('/api/topics/') || lower === ADMIN_TOPICS_PATH || lower.startsWith(`${ADMIN_TOPICS_PATH}/`) || lower === ctx.deckPath;
  }

  function debugLog(message) {
    if (debug) console.log(`[Topics] ${message}`);
  }

  function loadFile() {
    if (!fs.existsSync(TOPICS_FILE)) return null;
    try {
      return JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
    } catch {
      console.warn('[Topics] topics.json ist defekt – Standardliste wird verwendet');
      return null;
    }
  }

  function saveFile(data) {
    ctx.writeJson(TOPICS_FILE, data);
  }

  function broadcast(state) {
    const frame = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) client.res.write(frame);
  }

  const topics = createTopics({
    load: loadFile,
    save: saveFile,
    isEnabled,
    autoHideMs: TOPICS_AUTO_HIDE_MS,
    warn: message => console.warn(message),
    onChange: state => {
      broadcast(state);
      debugLog(`Stand ${state.step}/${2 * state.total}, ${state.visible ? 'sichtbar' : `ausgeblendet${state.hide_reason ? ` (${state.hide_reason})` : ''}`}, Revision ${state.revision}`);
    },
    onEffect: (type, meta) => {
      try {
        ctx.scheduleEffect(type, meta);
      } catch (err) {
        ctx.logIfChanged('topics-effect-error', `[Topics] Effekt konnte nicht eingereiht werden: ${err.message}`, 'error');
      }
    },
  });

  function summary(state) {
    const current = state.current === null ? 'noch keins' : `${state.current + 1}/${state.total} „${state.items[state.current].title}“ (${state.items[state.current].status})`;
    return `Thema ${current}, ${state.visible ? 'sichtbar' : 'ausgeblendet'}${state.complete ? ', alle erledigt' : ''}`;
  }

  function printStatus() {
    const state = topics.getState();
    console.log(`[Topics] Modul: ${ctx.state.stateLabel(KEY)}, Testmodus: ${debug ? 'an' : 'aus'}, verbundene Widgets/Plugins: ${clients.length}`);
    console.log(`[Topics] ${summary(state)}`);
    state.items.forEach((item, i) => console.log(`  ${i + 1}. [${item.status === 'erledigt' ? 'x' : item.status === 'aktiv' ? '>' : ' '}] ${item.title}`));
    console.log(`[Topics] Überschrift: „${state.display.title}“, Design: ${state.display.theme}, Hintergrund horizontal: ${state.display.background.horizontal}, vertikal: ${state.display.background.vertikal}`);
  }

  // Widgets (Herkunft null) und Plugin (ohne Herkunft); fremde Herkünfte lehnt die CORS-Prüfung vorher ab.
  function widgetRoutes(app) {
    app.get('/api/topics', (req, res) => {
      if (!ctx.isLocalWidgetRequest(req, '/api/topics')) return res.status(403).json({ ok: false, error: LOCAL_ONLY });
      res.json(topics.getState());
    });

    app.get('/api/topics/stream', (req, res) => {
      if (!ctx.isLocalWidgetRequest(req, '/api/topics/stream')) return res.status(403).json({ ok: false, error: LOCAL_ONLY });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive'
      });
      res.write('retry: 5000\n\n');
      res.write(`event: state\ndata: ${JSON.stringify(topics.getState())}\n\n`);
      const client = { res, origin: req.headers.origin || '-' };
      client.ping = setInterval(() => res.write(': ping\n\n'), TOPICS_SSE_PING_MS);
      clients.push(client);
      debugLog(`Widget/Plugin verbunden (Herkunft: ${client.origin}, verbunden: ${clients.length})`);
      req.on('close', () => {
        clearInterval(client.ping);
        const i = clients.indexOf(client);
        if (i >= 0) clients.splice(i, 1);
        debugLog(`Widget/Plugin getrennt (verbunden: ${clients.length})`);
      });
    });

    // Stream-Deck-Tasten: POST mit JSON (Body darf {} sein), nur lokal, Modul muss an sein.
    app.post('/api/topics/:action', express.json({ limit: ctx.adminJsonLimit }), (req, res) => {
      const action = String(req.params.action).toLowerCase();
      if (!ctx.isLocalWidgetRequest(req, '/api/topics/…')) return res.status(403).json({ ok: false, error: LOCAL_ONLY });
      if (!TOPICS_ACTIONS.includes(action)) return res.status(404).json({ ok: false, error: `Unbekannte Aktion. Erlaubt: ${TOPICS_ACTIONS.join(', ')}` });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Content-Type: application/json erwartet (Body darf {} sein)' });
      if (!isEnabled()) return res.status(503).json({ ok: false, error: 'Intro-Topics ist ausgeschaltet' });
      const state = topics[action]();
      debugLog(`Taste ${action}: ${summary(state)}`);
      res.json({ ok: true, state });
    });
  }

  // Webkonsole, Reiter „Topics“; der Schutz app.use('/api/admin', …) liegt davor
  function adminRoutes(app) {
    app.get(ADMIN_TOPICS_PATH, (req, res) => {
      res.json({ ...topics.getConfig(), state: topics.getState(), debug, clients: clients.length });
    });

    // Liste und/oder Anzeige-Einstellungen speichern
    app.post(ADMIN_TOPICS_PATH, ctx.requireAdminWrite, express.json({ limit: TOPICS_JSON_LIMIT }), (req, res) => {
      const { items, display } = req.body || {};
      if (items === undefined && display === undefined) return res.status(400).json({ error: 'items oder display angeben' });
      if (items !== undefined) {
        const result = topics.setItems(items);
        if (result.error) return res.status(400).json({ error: result.error });
        console.log(`[Webkonsole] Intro-Topics: neue Liste mit ${result.state.total} Themen gespeichert`);
      }
      if (display !== undefined) {
        const result = topics.setDisplay(display);
        if (result.error) return res.status(400).json({ error: result.error });
        console.log('[Webkonsole] Intro-Topics: Anzeige-Einstellungen gespeichert');
      }
      res.json({ ok: true, ...topics.getConfig(), state: topics.getState() });
    });

    // Bedienen aus der Webkonsole (wie die Stream-Deck-Tasten)
    app.post(`${ADMIN_TOPICS_PATH}/action`, ctx.requireAdminWrite, express.json({ limit: ctx.adminJsonLimit }), (req, res) => {
      const action = req.body && req.body.action;
      if (!TOPICS_ACTIONS.includes(action)) return res.status(400).json({ error: `Unbekannte Aktion. Erlaubt: ${TOPICS_ACTIONS.join(', ')}` });
      if (!isEnabled()) return res.status(409).json({ error: 'Intro-Topics ist ausgeschaltet' });
      res.json({ ok: true, state: topics[action]() });
    });
  }

  function handleConsole(parts) {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'show') {
      printStatus();
      return;
    }
    if (TOPICS_ACTIONS.includes(sub)) {
      if (!isEnabled()) {
        console.log('Intro-Topics ist deaktiviert ("topics activate" schaltet ein)');
        return;
      }
      const state = topics[sub]();
      console.log(`[Topics] ${sub}: ${summary(state)}`);
      return;
    }
    if (sub === 'debug' && ['on', 'off'].includes((parts[2] || '').toLowerCase())) {
      debug = parts[2].toLowerCase() === 'on';
      console.log(`[Topics] Testmodus ${debug ? 'an – Topic-Effekte und Tastendrücke erscheinen im Log (bis "topics debug off" oder Neustart)' : 'aus'}`);
      return;
    }
    if (sub === 'activate' || sub === 'deactivate') {
      ctx.state.switchModule(KEY, sub === 'activate');
      return;
    }
    console.log('Nutzung: topics show | topics next|back|toggle|reset | topics debug on|off | topics activate|deactivate');
  }

  return {
    name: 'topics',
    routes: { widget: widgetRoutes, admin: adminRoutes },
    consoleCommands: [{
      name: 'topics',
      help: [
        ' topics show                - Intro-Topics: Liste, Stand, Sichtbarkeit, verbundene Widgets',
        ' topics next|back|toggle|reset - Intro-Topics bedienen (wie die Stream-Deck-Tasten)',
        ' topics debug on|off        - Intro-Topics: Testmodus, zeigt Effekte und Tastendrücke im Log (bis Neustart)',
        ' topics activate|deactivate - Intro-Topics ein- bzw. ausschalten (bleibt nach Neustart)',
      ],
      handle: handleConsole,
    }],
    // Tastendrücke und Widget-Verbindungen nur im Testmodus im HTTP-Protokoll (topics debug on)
    isQuiet: (req, res) => isTopicsPath(req.path) && res.statusCode < 400 && !debug,
    showsSilentEffects: () => debug,
    overview: () => {
      const { visible, step, total, complete, current } = topics.getState();
      return { visible, step, total, complete, current, clients: clients.length };
    },
    on: {
      // Neue Stream-Session (nicht Wiederaufnahme nach Unterbrechung): Intro-Topics von vorn
      'stream.new': () => {
        topics.reset();
        console.log('[Topics] Neuer Stream – Intro-Topics zurückgesetzt');
      },
      'module.switched': ({ key, changed }) => {
        if (key === KEY && changed) topics.notifyEnabledChanged();
      },
    },
  };
}

module.exports = { createTopicsModule, TOPICS_ACTIONS, ADMIN_TOPICS_PATH };
