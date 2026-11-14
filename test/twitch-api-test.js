// lib/twitch-api.js (ADR 0024, Issue #50): Drosselung, Token-Erneuerung, 401/429. Künstliche Uhr, HTTP-Attrappe, kein Netzwerk.
const path = require('path');
const { createTokenStore, createRateLimiter, createTwitchApi } = require(path.join(__dirname, '..', 'lib', 'twitch-api.js'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

function fakeClock(start = Date.UTC(2026, 10, 14, 12, 0, 0)) {
  const clock = { t: start };
  return { clock, now: () => clock.t, sleep: async ms => { clock.t += ms; } };
}

(async () => {
  // ── Drosselung ──
  {
    const c = fakeClock();
    const limiter = createRateLimiter({ perSecond: 3, perMinute: 200, now: c.now, sleep: c.sleep });
    const times = [];
    await Promise.all([1, 2, 3, 4, 5].map(() => limiter.acquire().then(() => times.push(c.clock.t - Date.UTC(2026, 10, 14, 12, 0, 0)))));
    check('T1 Im Schnitt 3 je Sekunde: nach den ersten 3 alle 333 ms eine weitere, der Reihe nach', JSON.stringify(times.slice(0, 3)) === '[0,0,0]' && times[3] >= 333 && times[3] <= 340 && times[4] >= 666 && times[4] <= 680, JSON.stringify(times));
    check('T2 Statistik zählt die letzte Minute und das Warten', limiter.stats().last_minute === 5 && limiter.stats().waited >= 1 && limiter.stats().queued === 0, JSON.stringify(limiter.stats()));
  }
  {
    const c = fakeClock();
    const limiter = createRateLimiter({ perSecond: 10, perMinute: 4, now: c.now, sleep: c.sleep });
    const start = c.clock.t;
    for (let i = 0; i < 4; i++) await limiter.acquire();
    await limiter.acquire();
    check('T3 Höchstens N je Minute: die nächste Anfrage wartet bis zum Ende des Fensters', c.clock.t - start >= 60000, String(c.clock.t - start));
  }
  {
    const c = fakeClock();
    const limiter = createRateLimiter({ perSecond: 3, perMinute: 200, burst: 20, now: c.now, sleep: c.sleep });
    const start = c.clock.t;
    await Promise.all(Array.from({ length: 20 }, () => limiter.acquire()));
    const afterBurst = c.clock.t - start;
    await Promise.all(Array.from({ length: 9 }, () => limiter.acquire()));
    check('T3b Spitze: 20 sofort (EventSub-Abos), danach wieder im Schnitt 3 je Sekunde', afterBurst === 0 && c.clock.t - start >= 2900 && c.clock.t - start <= 3100, `${afterBurst} ${c.clock.t - start}`);
  }

  // ── Token ──
  {
    const c = fakeClock();
    const saved = [];
    let posts = 0;
    const http = { post: async () => { posts += 1; await c.sleep(10); return { data: { access_token: 'neu', refresh_token: 'r2', expires_in: 14000 } }; } };
    const store = createTokenStore({
      load: () => ({ access_token: 'alt', refresh_token: 'r1', broadcaster_id: '1', expires_at: c.clock.t + 60000 }),
      save: t => saved.push(t), http, clientId: 'c', clientSecret: 's', now: c.now, bufferMs: 5 * 60000,
    });
    const [a, b] = await Promise.all([store.getValidAccessToken(), store.getValidAccessToken()]);
    check('T4 Gleichzeitige Aufrufe: nur eine Erneuerung, beide bekommen den neuen Token', posts === 1 && a === 'neu' && b === 'neu' && saved.length === 1 && saved[0].refresh_token === 'r2', `${posts} ${a} ${b}`);
    check('T5 Danach aus dem Arbeitsspeicher, ohne neue Erneuerung', (await store.getValidAccessToken()) === 'neu' && posts === 1 && store.get().broadcaster_id === '1');
    check('T6 Ablaufzeit ist bekannt (für /token)', store.expiresAt() === saved[0].expires_at);
  }
  {
    const c = fakeClock();
    let fail = true;
    const http = { post: async () => { if (fail) { const e = new Error('kaputt'); e.response = { data: { message: 'Invalid refresh token' } }; throw e; } return { data: { access_token: 'x', expires_in: 100 } }; } };
    const logs = [];
    const store = createTokenStore({ load: () => ({ access_token: 'a', refresh_token: 'r', expires_at: c.clock.t }), save: () => {}, http, clientId: 'c', clientSecret: 's', now: c.now, bufferMs: 0, log: m => logs.push(m) });
    let err = null;
    try { await store.getValidAccessToken(); } catch (e) { err = e; }
    check('T7 Gescheiterte Erneuerung: verständlicher Fehler, im Protokoll', err && /Bitte neu einloggen/.test(err.message) && logs.some(l => l.includes('Invalid refresh token')));
    fail = false;
    check('T8 Nächster Versuch klappt wieder (keine hängende Erneuerung)', (await store.getValidAccessToken()) === 'x');
  }
  {
    const store = createTokenStore({ load: () => null, save: () => {}, http: {}, clientId: 'c', clientSecret: 's', bufferMs: 0 });
    let err = null;
    try { await store.getValidAccessToken(); } catch (e) { err = e; }
    check('T9 Ohne Tokens: Fehler statt Absturz', err && /login/.test(err.message) && store.get() === null);
  }

  // ── Helix-Anfragen ──
  function setup({ responses, perSecond = 100 }) {
    const c = fakeClock();
    const calls = [];
    const http = {};
    for (const m of ['get', 'post']) {
      http[m] = async (url, ...rest) => {
        const config = m === 'get' ? rest[0] : rest[1];
        calls.push({ m, url, auth: config.headers.Authorization, params: config.params });
        const r = responses.shift();
        if (r instanceof Error) throw r;
        return r || { data: { data: [] } };
      };
    }
    let refreshes = 0, appTokens = 0;
    const tokens = { getValidAccessToken: async () => `user${refreshes}`, refresh: async () => { refreshes += 1; return `user${refreshes}`; } };
    const api = createTwitchApi({
      http, clientId: 'cid', tokens, getAppToken: async force => { appTokens += 1; return force ? 'app-neu' : 'app'; },
      limiter: createRateLimiter({ perSecond, perMinute: 200, now: c.now, sleep: c.sleep }), now: c.now, sleep: c.sleep,
    });
    return { api, calls, c, counts: () => ({ refreshes, appTokens }) };
  }
  const httpError = (status, headers = {}) => { const e = new Error(`HTTP ${status}`); e.response = { status, headers, data: { message: `status ${status}` } }; return e; };

  {
    const s = setup({ responses: [{ data: { data: [{ id: '1' }] }, headers: { 'ratelimit-limit': '800', 'ratelimit-remaining': '797', 'ratelimit-reset': '1794657600' } }] });
    const res = await s.api.get('/users?id=1');
    check('T10 Pfad wird zur Helix-Adresse, Token und Client-ID im Kopf', s.calls[0].url === 'https://api.twitch.tv/helix/users?id=1' && s.calls[0].auth === 'Bearer user0' && res.data.data[0].id === '1', JSON.stringify(s.calls[0]));
    check('T11 Ratelimit-Header von Twitch werden gemerkt', s.api.stats().twitch.limit === 800 && s.api.stats().twitch.remaining === 797, JSON.stringify(s.api.stats()));
  }
  {
    const s = setup({ responses: [httpError(401), { data: { data: ['ok'] } }] });
    const res = await s.api.get('/streams?user_id=1');
    check('T12 401: Token einmal erneuern und neu versuchen', res.data.data[0] === 'ok' && s.counts().refreshes === 1 && s.calls.length === 2 && s.calls[1].auth === 'Bearer user1', JSON.stringify(s.calls));
  }
  {
    const s = setup({ responses: [httpError(401), httpError(401)] });
    let err = null;
    try { await s.api.get('/streams'); } catch (e) { err = e; }
    check('T13 Zweites 401: Fehler an den Aufrufer, kein endloses Wiederholen', err && err.response.status === 401 && s.calls.length === 2);
  }
  {
    const s = setup({ responses: [httpError(429, { 'ratelimit-limit': '800', 'ratelimit-remaining': '0', 'ratelimit-reset': String(Math.floor(Date.UTC(2026, 10, 14, 12, 0, 20) / 1000)) }), { data: { data: ['ok'] } }] });
    const before = s.c.clock.t;
    const res = await s.api.get('/videos');
    check('T14 429: bis zum Reset warten und einmal neu versuchen', res.data.data[0] === 'ok' && s.c.clock.t - before >= 19000 && s.c.clock.t - before <= 21000, String(s.c.clock.t - before));
  }
  {
    const s = setup({ responses: [httpError(429)] });
    let err = null;
    try { await s.api.post('/chat/shoutouts', null, { params: { to_broadcaster_id: '2' }, retryOn429: false }); } catch (e) { err = e; }
    check('T15 Shoutout (retryOn429: false): 429 sofort an den Aufrufer', err && err.response.status === 429 && s.calls.length === 1 && s.calls[0].params.to_broadcaster_id === '2');
  }
  {
    const s = setup({ responses: [httpError(401), { data: { data: [{ is_sent: true }] } }] });
    await s.api.post('/chat/messages', { message: 'hi' }, { auth: 'app' });
    check('T16 App-Token: bei 401 einmal neu holen', s.calls[0].auth === 'Bearer app' && s.calls[1].auth === 'Bearer app-neu' && s.counts().refreshes === 0, JSON.stringify(s.calls));
  }
  {
    const s = setup({ responses: [httpError(401)] });
    let err = null;
    try { await s.api.get('/users', { auth: { token: 'vom-login' } }); } catch (e) { err = e; }
    check('T17 Fester Token (Login): kein Erneuern bei 401', err && s.calls.length === 1 && s.calls[0].auth === 'Bearer vom-login' && s.counts().refreshes === 0);
  }
  {
    const s = setup({ responses: [], perSecond: 3 });
    const before = s.c.clock.t;
    await Promise.all(Array.from({ length: 7 }, (_, i) => s.api.get(`/users?id=${i}`)));
    check('T18 Viele Anfragen auf einmal laufen gedrosselt, aber vollständig durch', s.calls.length === 7 && s.c.clock.t - before >= 1300, String(s.c.clock.t - before));
  }
  // ── Startfreibetrag (Nutzer, 14.11.2026): die ersten N Anfragen ohne Zeitgrenze, danach die normalen Grenzen ──
  {
    const c = fakeClock();
    const start = c.clock.t;
    const limiter = createRateLimiter({ perSecond: 3, perMinute: 200, burst: 20, startupFree: 300, now: c.now, sleep: c.sleep });
    await Promise.all(Array.from({ length: 300 }, () => limiter.acquire()));
    let s = limiter.stats();
    check('T19 Startfreibetrag: 300 Anfragen sofort, zählen nicht in Minute und Spitze', c.clock.t === start && s.startup_used === 300 && s.startup_free === 300 && s.last_minute === 0 && s.waited === 0, `${c.clock.t - start} ${JSON.stringify(s)}`);
    await Promise.all(Array.from({ length: 20 }, () => limiter.acquire()));
    const afterBurst = c.clock.t - start;
    await Promise.all(Array.from({ length: 9 }, () => limiter.acquire()));
    s = limiter.stats();
    check('T20 Danach normale Grenzen: Spitze 20 sofort, dann im Schnitt 3 je Sekunde', afterBurst === 0 && c.clock.t - start >= 2900 && c.clock.t - start <= 3100 && s.startup_used === 300 && s.last_minute === 29, `${afterBurst} ${c.clock.t - start} ${JSON.stringify(s)}`);
  }
  {
    const c = fakeClock();
    const limiter = createRateLimiter({ perSecond: 10, perMinute: 4, startupFree: 2, now: c.now, sleep: c.sleep });
    const start = c.clock.t;
    for (let i = 0; i < 6; i++) await limiter.acquire();
    check('T21 Freibetrag zählt nicht in die Minutengrenze: 2 frei + 4 im Fenster ohne Warten, die nächste wartet', c.clock.t === start, String(c.clock.t - start));
    await limiter.acquire();
    check('T22 Ohne Angabe kein Freibetrag (Standard 0)', c.clock.t - start >= 60000 && createRateLimiter({ perSecond: 3, perMinute: 200 }).stats().startup_free === 0, String(c.clock.t - start));
  }

  for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
  process.exit(results.every(x => x.ok) ? 0 : 1);
})().catch(err => { console.log(`FAIL Abbruch: ${err.stack}`); process.exit(1); });
