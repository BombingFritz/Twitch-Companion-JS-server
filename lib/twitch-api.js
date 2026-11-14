'use strict';
// Einzige Stelle für Anfragen an die Twitch-API (ADR 0023, ADR 0024, Issue #50).
// - Token des Broadcasters im Arbeitsspeicher, sicher gespeichert, nur eine Erneuerung zur Zeit.
// - Alle Helix-Anfragen über eine Drosselung (Vorgabe des Nutzers: höchstens 3 je Sekunde, 200 je Minute).
// - 401: Token einmal erneuern und neu versuchen. 429: bis zum Reset warten und einmal neu versuchen.
// - Ratelimit-Header von Twitch werden mitgelesen und für die Webkonsole bereitgehalten.
// Kennt weder Express noch Dateipfade; Laden, Speichern, Zeit und HTTP kommen von außen, damit es sich testen lässt.

const HELIX_BASE = 'https://api.twitch.tv/helix';
const OAUTH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

// ── Token des Broadcasters ──────────────────────────────────────────
function createTokenStore({ load, save, http, clientId, clientSecret, now = Date.now, bufferMs, log = () => {} }) {
  let cache;            // undefined = noch nicht geladen, null = keine Tokens
  let refreshing = null;

  const read = () => {
    if (cache === undefined) cache = load() || null;
    return cache;
  };

  const expiresAt = t => (t ? t.expires_at || (t.obtained_at + t.expires_in * 1000) : null);

  const store = {
    get() {
      const t = read();
      return t ? { ...t } : null;
    },
    set(tokens) {
      save(tokens);
      cache = { ...tokens };
    },
    expiresAt() {
      return expiresAt(read());
    },
    // Nur eine Erneuerung zur Zeit: Gleichzeitige Aufrufer warten auf dasselbe Ergebnis.
    refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const t = read();
        if (!t) throw new Error('Keine Tokens gespeichert. Bitte login durchführen');
        log('Token wird erneuert...');
        try {
          const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' });
          const res = await http.post(OAUTH_TOKEN_URL, params);
          const at = now();
          const next = {
            ...t,
            access_token: res.data.access_token,
            refresh_token: res.data.refresh_token || t.refresh_token,
            obtained_at: at,
            expires_in: res.data.expires_in,
            expires_at: at + res.data.expires_in * 1000,
          };
          store.set(next);
          log('Token erfolgreich aktualisiert!');
          return next.access_token;
        } catch (err) {
          log(`Token-Refresh fehlgeschlagen: ${JSON.stringify(err.response?.data || err.message)}`, 'error');
          throw new Error('Token-Refresh fehlgeschlagen. Bitte neu einloggen.');
        }
      })().finally(() => { refreshing = null; });
      return refreshing;
    },
    async getValidAccessToken() {
      const t = read();
      if (!t) throw new Error('Keine Tokens gespeichert. Bitte login durchführen');
      if (now() < expiresAt(t) - bufferMs) return t.access_token;
      return store.refresh();
    },
  };
  return store;
}

// ── Drosselung ──────────────────────────────────────────────────────
// Im Schnitt höchstens perSecond je Sekunde (Token-Bucket), kurze Spitzen bis burst Anfragen auf einmal,
// und hart höchstens perMinute in jedem gleitenden 60-s-Fenster. Wartende Anfragen kommen der Reihe nach dran.
// Die Spitze ist nötig, weil Twitch die EventSub-Abos binnen 10 s nach dem Welcome erwartet.
// Startfreibetrag (Nutzer, 14.11.2026): Die ersten startupFree Anfragen nach dem Start laufen ohne Zeitgrenze
// und zählen nicht in Spitze und Minutenfenster. Beim Start entstehen viele Anfragen (Token, Abos, Ausgangsstände);
// danach braucht der Server meist wenig. Übergang bis zur geplanten automatischen Drosselung.
function createRateLimiter({ perSecond, perMinute, burst = perSecond, startupFree = 0, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let startupUsed = 0;
  const sent = [];
  let chain = Promise.resolve();
  let waited = 0;          // Anfragen, die warten mussten (für die Anzeige)
  let queued = 0;
  let tokens = burst;
  let lastRefill = now();

  const prune = t => { while (sent.length && sent[0] <= t - 60000) sent.shift(); };
  const refill = t => {
    tokens = Math.min(burst, tokens + ((t - lastRefill) / 1000) * perSecond);
    lastRefill = t;
  };

  function acquire() {
    if (startupUsed < startupFree) {
      startupUsed += 1;
      return Promise.resolve();
    }
    queued += 1;
    const turn = chain.then(async () => {
      let hadToWait = false;
      for (;;) {
        const t = now();
        prune(t);
        refill(t);
        if (tokens >= 1 && sent.length < perMinute) {
          tokens -= 1;
          sent.push(t);
          if (hadToWait) waited += 1;
          queued -= 1;
          return;
        }
        hadToWait = true;
        const untilToken = tokens < 1 ? Math.ceil(((1 - tokens) / perSecond) * 1000) : 0;
        const untilMinute = sent.length >= perMinute ? sent[0] + 60000 - t : 0;
        await sleep(Math.max(untilToken, untilMinute, 1));
      }
    });
    chain = turn.catch(() => {});
    return turn;
  }

  return {
    acquire,
    stats() {
      prune(now());
      return { last_minute: sent.length, per_minute: perMinute, per_second: perSecond, burst, queued, waited, startup_free: startupFree, startup_used: startupUsed };
    },
  };
}

// ── Helix-Anfragen ──────────────────────────────────────────────────
function createTwitchApi({
  http, clientId, tokens, getAppToken, limiter, now = Date.now,
  sleep = ms => new Promise(r => setTimeout(r, ms)), maxRetryWaitMs = 60000, log = () => {},
}) {
  let twitchLimits = null;   // { limit, remaining, reset_at } aus den letzten Ratelimit-Headern

  function noteHeaders(headers) {
    if (!headers) return;
    const get = name => headers[name] ?? headers[name.toLowerCase()];
    const limit = Number(get('Ratelimit-Limit'));
    const remaining = Number(get('Ratelimit-Remaining'));
    const reset = Number(get('Ratelimit-Reset'));
    if (Number.isFinite(limit) && Number.isFinite(remaining)) {
      twitchLimits = { limit, remaining, reset_at: Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : null, seen_at: new Date(now()).toISOString() };
    }
  }

  async function tokenFor(auth, force) {
    if (auth && typeof auth === 'object' && auth.token) return auth.token;
    if (auth === 'app') return getAppToken(force);
    return force ? tokens.refresh() : tokens.getValidAccessToken();
  }

  // method: 'get' | 'post' | 'patch' | 'delete'; url: Helix-Pfad (z. B. '/users?id=1') oder volle Adresse;
  // options: { data, params, headers, auth: 'user' (Standard) | 'app' | { token }, retryOn429 }
  async function request(method, url, options = {}) {
    const fullUrl = url.startsWith('http') ? url : `${HELIX_BASE}${url}`;
    let retried = false;
    for (;;) {
      await limiter.acquire();
      const token = await tokenFor(options.auth, retried === '401');
      const config = { headers: { 'Authorization': `Bearer ${token}`, 'Client-ID': clientId, ...(options.headers || {}) } };
      if (options.params) config.params = options.params;
      try {
        const res = method === 'get' || method === 'delete'
          ? await http[method](fullUrl, config)
          : await http[method](fullUrl, options.data ?? null, config);
        noteHeaders(res && res.headers);
        return res;
      } catch (err) {
        noteHeaders(err.response && err.response.headers);
        const status = err.response && err.response.status;
        const ownToken = !(options.auth && typeof options.auth === 'object');
        if (status === 401 && !retried && ownToken) {
          retried = '401';
          log(`[Twitch-API] 401 bei ${method.toUpperCase()} ${fullUrl.replace(HELIX_BASE, '')} – Token wird erneuert, ein neuer Versuch`);
          continue;
        }
        // retryOn429: false für Aktionen mit eigener Wartezeit bei Twitch (z. B. Shoutouts), dort bedeutet 429 „noch nicht wieder“
        if (status === 429 && !retried && options.retryOn429 !== false) {
          retried = '429';
          const resetAt = twitchLimits && twitchLimits.reset_at ? Date.parse(twitchLimits.reset_at) : now() + 1000;
          const wait = Math.min(Math.max(resetAt - now(), 1000), maxRetryWaitMs);
          log(`[Twitch-API] 429 (Anfragegrenze von Twitch erreicht) – warte ${Math.ceil(wait / 1000)} s und versuche es einmal neu`, 'warn');
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
  }

  return {
    get: (url, options) => request('get', url, options),
    post: (url, data, options = {}) => request('post', url, { ...options, data }),
    patch: (url, data, options = {}) => request('patch', url, { ...options, data }),
    delete: (url, options) => request('delete', url, options),
    stats() {
      return { ...limiter.stats(), twitch: twitchLimits };
    },
  };
}

module.exports = { createTokenStore, createRateLimiter, createTwitchApi, HELIX_BASE, OAUTH_TOKEN_URL };
