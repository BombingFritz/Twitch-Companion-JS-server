// Intro-Topics im Server (ADR 0020/0021, docs/specs/intro-topics.md, docs/specs/stream-deck.md):
// Endpoints, Server-Sent Events, stille Effekte, Testmodus, Modulschalter, Webkonsole, Reset bei neuem Stream.
// Attrappen: ws, axios (Home Assistant), readline. Eigenes Arbeitsverzeichnis.
// Aufruf: node topics-test.js <server.js>
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { EventEmitter } = require('events');
const serverPath = path.resolve(process.argv[2]);
const PORT = 39700 + Math.floor(Math.random() * 200);
const HA_URL = 'http://ha-attrappe.invalid/api/webhook/test';
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topics-'));
fs.writeFileSync(path.join(workDir, '.env'), `CLIENT_ID=<CLIENT_ID>\nCLIENT_SECRET=<CLIENT_SECRET>\nREDIRECT_URI=http://localhost:${PORT}/callback\nPORT=${PORT}\nSCOPES=chat:read\nHA_WEBHOOK_URL=${HA_URL}\n`);
fs.writeFileSync(path.join(workDir, 'tokens.json'), JSON.stringify({ access_token: 'fake', refresh_token: 'fake', broadcaster_id: '1', broadcaster_name: 'test',
  obtained_at: Date.now(), expires_in: 99999, expires_at: Date.now() + 99999000 }));
fs.writeFileSync(path.join(workDir, 'topics.json'), JSON.stringify({ items: [{ title: 'Neuigkeiten' }, { title: 'Streamplan' }, { title: 'Community' }] }));
process.chdir(workDir);

const sockets = [];
class FakeWS extends EventEmitter { constructor() { super(); this.readyState = 1; sockets.push(this); } close() { this.emit('close'); } terminate() { this.emit('close'); } }
FakeWS.OPEN = 1;
const haPosts = [];
let haFails = false;
const fakeAxios = {
  post: async (url, body) => {
    if (url === HA_URL) { if (haFails) throw new Error('HA nicht erreichbar'); haPosts.push(body); }
    return { data: { data: [] } };
  },
  get: async () => ({ data: { data: [] } }),
};
const rl = new EventEmitter();
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'ws') return FakeWS; if (r === 'axios') return fakeAxios; if (r === 'readline') return { createInterface: () => rl }; return orig.call(this, r, ...a); };
const realLog = console.log, logs = [];
console.log = console.warn = console.error = (...a) => logs.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
require(serverPath);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const request = (p, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { let json = null; try { json = JSON.parse(d); } catch { /* kein JSON */ } res({ status: r.statusCode, json, text: d }); });
  });
  req.on('error', rej); req.end(body);
});
const JSON_TYPE = { 'Content-Type': 'application/json' };
const press = (action, headers = {}) => request(`/api/topics/${action}`, { method: 'POST', headers: { ...JSON_TYPE, ...headers }, body: '{}' });
const ADMIN = { Origin: `http://localhost:${PORT}`, ...JSON_TYPE };
const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });
const cmd = async line => { rl.emit('line', line); await sleep(60); };
const statuses = s => s.items.map(i => i.status[0]).join('');
let n = 0;
const send = (message_type, subType, payload) => sockets[0].emit('message', JSON.stringify({ metadata: { message_type, subscription_type: subType, message_id: `m${++n}` }, payload }));

// Widget-Attrappe: sammelt state-Ereignisse
function connect(headers = {}) {
  const events = [];
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/topics/stream', headers }, res => {
      let buf = '';
      res.on('data', c => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(frame), data = /^data: (.+)$/m.exec(frame);
          if (ev && data && ev[1] === 'state') events.push(JSON.parse(data[1]));
        }
      });
      setTimeout(() => resolve({ req, res, events, status: res.statusCode }), 100);
    });
  });
}

(async () => {
  try {
    await sleep(500);
    send('session_welcome', null, { session: { id: 's1', keepalive_timeout_seconds: 600 } });
    await sleep(300);
    // Verbindung und Lesen
    const w1 = await connect({ Origin: 'null' });
    const w2 = await connect();
    check('S1 Widget (Herkunft null) und Plugin (ohne Herkunft) verbunden, Zustand sofort', w1.status === 200 && w2.status === 200 && w1.events.length === 1 && w2.events.length === 1, JSON.stringify(w1.events));
    const s0 = w1.events[0];
    check('S2 Startzustand aus topics.json', s0.total === 3 && s0.step === 0 && !s0.visible && s0.enabled && s0.display.title === 'Tagesthemen', JSON.stringify(s0));
    let r = await request('/api/topics');
    check('S3 GET /api/topics', r.status === 200 && r.json.total === 3);

    // Zugriffsschutz
    r = await press('next', { Origin: 'https://fremd.example' });
    check('S4 Fremde Herkunft: 403', r.status === 403, String(r.status));
    r = await request('/api/topics/next', { method: 'POST', headers: { ...JSON_TYPE, Host: 'example.com' }, body: '{}' });
    check('S5 Fremder Host (DNS-Rebinding): 403', r.status === 403, String(r.status));
    r = await request('/api/topics/next', { method: 'POST' });
    check('S6 Ohne JSON: 415', r.status === 415, String(r.status));
    r = await request('/api/topics/next', { method: 'GET' });
    check('S7 GET ändert nichts', (await request('/api/topics')).json.revision === s0.revision);
    r = await press('loeschen');
    check('S8 Unbekannte Aktion: 404', r.status === 404, String(r.status));
    check('S8b Abgelehnte Anfragen bleiben im Log sichtbar', logs.some(l => /\[HTTP\] POST \/api\/topics\/next -> 415/.test(l)) && logs.some(l => /\[Zugriffsschutz\].*fremd\.example/.test(l)));
    const logStart = logs.length;

    // Klickfolge
    r = await press('next');
    check('S9 Erster Druck blendet nur ein', r.status === 200 && r.json.ok && r.json.state.visible && r.json.state.step === 0, r.text);
    const seq = [];
    for (let i = 0; i < 6; i++) seq.push(statuses((await press('next')).json.state));
    check('S10 Klickfolge 6 × weiter', seq.join(',') === 'aoo,eoo,eao,eeo,eea,eee', seq.join(','));
    await sleep(100);
    check('S11 Beide Widgets bekommen jede Änderung', w1.events.length === 8 && w2.events.length === 8 && w1.events[7].complete, `${w1.events.length}/${w2.events.length}`);
    await sleep(5300);
    const last = w1.events[w1.events.length - 1];
    check('S12 Nach 5 s ausgeblendet (auto)', !last.visible && last.hide_reason === 'auto', JSON.stringify(last));

    // Effekte: kommen bei HA an, aber in keinem Log, nicht im Event-Log, nicht in der Statistik
    await sleep(9000);
    const types = haPosts.map(p => p.type);
    check('S13 Topic-Effekte erreichen Home Assistant (gebündelt)', types.includes('topic_active') && types.includes('topic_done') && types.includes('topics_complete'), JSON.stringify(haPosts));
    const p0 = haPosts.find(p => p.type === 'topics_complete');
    check('S14 HA-Payload unverändert {type, count, meta, timestamp}', p0 && Object.keys(p0).join(',') === 'type,count,meta,timestamp' && p0.meta.total === 3, JSON.stringify(p0));
    const newLogs = logs.slice(logStart);
    check('S15 Kein Log: keine Effekt-, HTTP- oder Topics-Zeilen', !newLogs.some(l => /Effekt|\[HTTP\].*topics|\[Topics\]/.test(l)), JSON.stringify(newLogs));
    const events = fs.existsSync('events.json') ? JSON.parse(fs.readFileSync('events.json', 'utf8')) : [];
    check('S16 Nicht im Event-Log', !events.some(e => /topic/.test(e.type)), JSON.stringify(events));
    r = await request('/api/admin/stats', { headers: { Origin: `http://localhost:${PORT}` } });
    const effectsMetric = r.json && r.json.instance.metrics.find(m => m.key === 'effects');
    check('S17 Nicht in der Statistik', effectsMetric && effectsMetric.value === 0, JSON.stringify(effectsMetric));

    // Ein/Aus und Zurück
    r = await press('toggle');
    check('S18 Ein/Aus zeigt die fertige Liste', r.json.state.visible && r.json.state.complete);
    await sleep(5500);
    check('S19 Kein Ausblenden nach manuellem Einblenden', (await request('/api/topics')).json.visible);
    r = await press('back');
    check('S20 Zurück', statuses(r.json.state) === 'eea');

    // Testmodus
    await cmd('topics debug on');
    const dbgStart = logs.length;
    await press('next');
    await sleep(7000);
    const dbg = logs.slice(dbgStart);
    check('S21 Testmodus: Tastendruck, HTTP und Effekt im Log', dbg.some(l => /\[Topics\] Taste next/.test(l)) && dbg.some(l => /\[HTTP\] POST \/api\/topics\/next/.test(l)) && dbg.some(l => /Effekt ausgelöst: topic_done/.test(l)), JSON.stringify(dbg));
    await cmd('topics debug off');
    const offStart = logs.length;
    await press('back');
    await sleep(200);
    check('S22 Testmodus aus: wieder still', !logs.slice(offStart).some(l => /Topics\] Taste|\[HTTP\].*topics/.test(l)), JSON.stringify(logs.slice(offStart)));

    // HA-Fehler: einmal sichtbar, nicht je Tastendruck
    haFails = true;
    const errStart = logs.length;
    await press('next'); await sleep(3000); await press('back'); await press('next'); await sleep(7000);
    const errLines = logs.slice(errStart).filter(l => /Home Assistant Webhook \(Intro-Topics\)/.test(l));
    check('S23 Kaputter Webhook: Fehler genau einmal gemeldet', errLines.length === 1, JSON.stringify(logs.slice(errStart)));
    haFails = false;

    // Konsole
    await cmd('topics show');
    check('S24 topics show', logs.some(l => /\[Topics\] Modul: aktiviert/.test(l)) && logs.some(l => /1\. \[x\] Neuigkeiten/.test(l)));
    await cmd('topics reset');
    check('S25 topics reset per Konsole', (await request('/api/topics')).json.step === 0);

    // Modulschalter
    await cmd('topics deactivate');
    await sleep(100);
    r = await press('next');
    const off = w1.events[w1.events.length - 1];
    check('S26 Modul aus: 503, Widgets erfahren enabled false, gespeichert', r.status === 503 && off.enabled === false && JSON.parse(fs.readFileSync('modules.json', 'utf8')).topics === false, `${r.status} ${JSON.stringify(off)}`);
    check('S27 Meldung beim Ausschalten', logs.some(l => /Intro-Topics deaktiviert – Stream-Deck-Tasten werden ignoriert/.test(l)));
    r = await request('/api/deck');
    check('S28 /api/deck zeigt Modulstatus', r.status === 200 && r.json.actions.topics.enabled === false && r.json.server === 'twitch-companion-js-server', r.text);
    await cmd('topics activate');

    // Webkonsole
    r = await request('/api/admin/topics', { headers: { Origin: `http://localhost:${PORT}` } });
    check('S29 Webkonsole liest Liste und Zustand', r.status === 200 && r.json.items.length === 3 && r.json.state && r.json.display.theme === 'panel', r.text);
    r = await request('/api/admin/topics', { method: 'POST', headers: { ...JSON_TYPE, Origin: 'null' }, body: JSON.stringify({ items: ['X'] }) });
    check('S30 Webkonsole: Widget-Herkunft darf nicht schreiben', r.status === 403, String(r.status));
    r = await request('/api/admin/topics', { method: 'POST', headers: ADMIN, body: JSON.stringify({ items: ['Begrüßung', 'Neues', 'Plan', 'Fragen'], display: { title: 'Agenda', background: { vertikal: 'transparent' } } }) });
    const saved = JSON.parse(fs.readFileSync('topics.json', 'utf8'));
    check('S31 Liste und Anzeige gespeichert', r.status === 200 && saved.items.length === 4 && saved.display.title === 'Agenda' && saved.display.background.vertikal === 'transparent' && saved.display.background.horizontal === 'transparent', r.text);
    await sleep(100);
    check('S32 Widgets bekommen neue Liste und Anzeige', w1.events[w1.events.length - 1].total === 4 && w1.events[w1.events.length - 1].display.title === 'Agenda');
    r = await request('/api/admin/topics', { method: 'POST', headers: ADMIN, body: JSON.stringify({ items: [] }) });
    check('S33 Ungültige Liste: 400, Datei unverändert', r.status === 400 && JSON.parse(fs.readFileSync('topics.json', 'utf8')).items.length === 4, r.text);
    r = await request('/api/admin/topics/action', { method: 'POST', headers: ADMIN, body: JSON.stringify({ action: 'toggle' }) });
    check('S34 Bedienen aus der Webkonsole', r.status === 200 && r.json.state.visible === true, r.text);
    r = await request('/api/admin/overview', { headers: { Origin: `http://localhost:${PORT}` } });
    check('S35 Übersicht enthält Topics und Modul', r.json.topics && r.json.topics.total === 4 && r.json.topics.clients === 2 && r.json.modules.topics === true, JSON.stringify(r.json && r.json.topics));

    // Neuer Stream setzt zurück, Wiederaufnahme nicht
    await press('next'); await press('next');
    send('notification', 'stream.online', { event: { id: 'stream-1', type: 'live', started_at: new Date().toISOString() } });
    await sleep(300);
    let st = (await request('/api/topics')).json;
    check('S36 Neuer Stream: zurückgesetzt und ausgeblendet', st.step === 0 && !st.visible && logs.some(l => /Neuer Stream – Intro-Topics zurückgesetzt/.test(l)), JSON.stringify(st));
    await press('next'); await press('next');
    send('notification', 'stream.offline', { event: {} });
    await sleep(100);
    send('notification', 'stream.online', { event: { id: 'stream-1b', type: 'live', started_at: new Date().toISOString() } });
    await sleep(300);
    st = (await request('/api/topics')).json;
    check('S37 Wiederaufnahme nach Unterbrechung: Stand bleibt', st.step === 1, JSON.stringify(st));

    // Verbindungen schließen
    w1.req.destroy(); w2.req.destroy();
    await sleep(200);
    r = await request('/api/admin/overview', { headers: { Origin: `http://localhost:${PORT}` } });
    check('S38 Getrennte Widgets werden abgemeldet', r.json.topics.clients === 0, JSON.stringify(r.json.topics));
  } catch (err) {
    check('Abbruch', false, err.stack);
  }
  for (const x of results) realLog(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
  process.exit(results.every(x => x.ok) ? 0 : 1);
})();
