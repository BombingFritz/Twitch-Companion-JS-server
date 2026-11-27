// Kern: Login, Tokens, Bot-Freigabe und der zentrale Twitch-Zugriff (ADR 0027, Schritt 3a; ADR 0013, 0017, 0024).
// Kennt keine Funktion des Servers; was nach einer Anmeldung passieren soll, gibt server.js als Rückruf mit.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { createTokenStore, createRateLimiter, createTwitchApi } = require('../lib/twitch-api');

// ctx: config, http (axios), writeJson, logIfChanged, access (isLoopbackRequest, hasLoopbackHost, requireLocalRequest),
//      onBroadcasterLogin() nach gespeichertem Broadcaster-Login, onBotAuthorized() nach gespeicherter Bot-Freigabe,
//      botFeatureLabels() für die Antwort der Bot-Freigabe
function createAuth(ctx) {
  const { config: c, http } = ctx;

  // tokens.json wird nur beim Start gelesen; danach liegt der Stand im Arbeitsspeicher (ADR 0024).
  function readTokensFile() {
    if (!fs.existsSync(c.TOKEN_FILE)) return null;
    try { return JSON.parse(fs.readFileSync(c.TOKEN_FILE, 'utf8')); } catch { return null; }
  }

  const tokenStore = createTokenStore({
    load: readTokensFile,
    save: tokens => ctx.writeJson(c.TOKEN_FILE, tokens),
    http,
    clientId: c.CLIENT_ID,
    clientSecret: c.CLIENT_SECRET,
    bufferMs: c.TOKEN_REFRESH_BUFFER_MS,
    log: (message, level = 'log') => console[level](message),
  });

  function loadTokens() {
    return tokenStore.get();
  }

  function saveTokens(tokens) {
    tokenStore.set(tokens);
  }

  async function getValidAccessToken() {
    if (!tokenStore.get()) throw new Error(`Keine Tokens gespeichert. Bitte login durchführen: http://localhost:${c.PORT}/login`);
    return tokenStore.getValidAccessToken();
  }

  // Rechtzeitig vor dem Ablauf erneuern, damit Widgets mit /token nicht in einen abgelaufenen Token laufen.
  // Scheitert es, erst nach TOKEN_PROACTIVE_RETRY_MS wieder versuchen, damit das Fehlerprotokoll nicht volläuft.
  let tokenProactiveRetryAt = 0;
  setInterval(() => {
    const expiresAt = tokenStore.expiresAt();
    if (!expiresAt || expiresAt - Date.now() > c.TOKEN_PROACTIVE_REFRESH_MS || Date.now() < tokenProactiveRetryAt) return;
    tokenStore.refresh().catch(() => { tokenProactiveRetryAt = Date.now() + c.TOKEN_PROACTIVE_RETRY_MS; });
  }, c.TOKEN_CHECK_INTERVAL_MS).unref();

  // ── Bot-Account „DerBdu“ (ADR 0017): nur ID und Name, gesendet wird mit dem App-Token ──
  function loadBotConfig() {
    if (!fs.existsSync(c.BOT_FILE)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(c.BOT_FILE, 'utf8'));
      return data && data.bot_id ? data : null;
    } catch { return null; }
  }

  function saveBotConfig(bot) {
    fs.writeFileSync(c.BOT_FILE, JSON.stringify(bot, null, 2), 'utf8');
  }

  function removeBotConfig() {
    fs.unlinkSync(c.BOT_FILE);
  }

  let appAccessToken = null;          // { token, expiresAt } – nur im RAM (Client-Credentials)

  async function getAppAccessToken(forceNew = false) {
    if (!forceNew && appAccessToken && Date.now() < appAccessToken.expiresAt - c.APP_TOKEN_REFRESH_MARGIN_MS) {
      return appAccessToken.token;
    }
    const params = new URLSearchParams({ client_id: c.CLIENT_ID, client_secret: c.CLIENT_SECRET, grant_type: 'client_credentials' });
    const response = await http.post('https://id.twitch.tv/oauth2/token', params);
    appAccessToken = { token: response.data.access_token, expiresAt: Date.now() + response.data.expires_in * 1000 };
    return appAccessToken.token;
  }

  // Alle Helix-Anfragen laufen hierüber: Drosselung, Token, 401/429 (ADR 0024, Issue #50)
  const twitchApi = createTwitchApi({
    http,
    clientId: c.CLIENT_ID,
    tokens: { getValidAccessToken, refresh: () => tokenStore.refresh() },
    getAppToken: getAppAccessToken,
    limiter: createRateLimiter({
      perSecond: c.TWITCH_API_PER_SECOND, perMinute: c.TWITCH_API_PER_MINUTE, burst: c.TWITCH_API_BURST,
      startupFree: c.TWITCH_API_STARTUP_FREE,
    }),
    maxRetryWaitMs: c.TWITCH_API_MAX_RETRY_WAIT_MS,
    log: (message, level = 'log') => ctx.logIfChanged(`twitch-api:${message}`, message, level),
  });

  // ── Login (ADR 0013, Nachtrag 07.11.2026): nur lokal, mit einmal gültigem state ──
  // Offene Logins: state -> { kind: 'broadcaster' | 'bot', createdAt }. Jeder state gilt einmal und LOGIN_STATE_TTL_MS lang.
  const pendingLogins = new Map();

  function createLoginState(kind) {
    const now = Date.now();
    for (const [value, entry] of pendingLogins) if (now - entry.createdAt > c.LOGIN_STATE_TTL_MS) pendingLogins.delete(value);
    const value = crypto.randomBytes(16).toString('hex');
    pendingLogins.set(value, { kind, createdAt: now });
    return value;
  }

  // Liefert 'broadcaster', 'bot' oder null (unbekannt, abgelaufen, schon benutzt) und verbraucht den state.
  function takeLoginState(value) {
    if (typeof value !== 'string') return null;
    const entry = pendingLogins.get(value);
    if (!entry) return null;
    pendingLogins.delete(value);
    return Date.now() - entry.createdAt > c.LOGIN_STATE_TTL_MS ? null : entry.kind;
  }

  // Rückkehr von /login-bot (state schon geprüft): nur ID und Name des Bots speichern, das Bot-Token wird nicht gebraucht (App-Token reicht).
  async function handleBotCallback(req, res) {
    const { code } = req.query;
    if (!code) return res.status(400).send('Kein Code erhalten (Freigabe abgebrochen?)');
    try {
      const params = new URLSearchParams({ client_id: c.CLIENT_ID, client_secret: c.CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: c.REDIRECT_URI });
      const response = await http.post('https://id.twitch.tv/oauth2/token', params);
      const granted = Array.isArray(response.data.scope) ? response.data.scope : String(response.data.scope || '').split(' ');
      const userResponse = await twitchApi.get('/users', { auth: { token: response.data.access_token } });
      const user = userResponse.data.data[0];
      const tokens = loadTokens();
      if (tokens && user.id === tokens.broadcaster_id) {
        console.warn(`[Bot] Freigabe abgelehnt: angemeldet war der Broadcaster ${user.login}, nicht der Bot`);
        return res.status(400).send(`Du warst bei Twitch als ${user.login} (Broadcaster) angemeldet. Bitte in einem privaten Browserfenster als DerBdu anmelden und /login-bot erneut aufrufen.`);
      }
      const missing = c.BOT_SCOPES.split(' ').filter(s => !granted.includes(s));
      if (missing.length) {
        console.warn(`[Bot] Freigabe abgelehnt: es fehlen die Rechte ${missing.join(', ')}`);
        return res.status(400).send(`Es fehlen die Rechte ${missing.join(', ')}. Bitte /login-bot erneut aufrufen und alles bestätigen.`);
      }
      saveBotConfig({ bot_id: user.id, bot_login: user.login, bot_name: user.display_name || user.login, authorized_at: new Date().toISOString() });
      ctx.onBotAuthorized();
      console.log(`[Bot] Bot-Account eingerichtet: ${user.display_name || user.login} (ID ${user.id}). Sendet ab jetzt: ${ctx.botFeatureLabels()}`);
      res.send(`\n\nBot-Account eingerichtet: ${user.display_name || user.login}\n\nSendet ab jetzt: ${ctx.botFeatureLabels()}\n\nWichtig: DerBdu muss Moderator in deinem Kanal sein (/mod ${user.login}).\n\nDu kannst diesen Tab jetzt schließen.`);
    } catch (err) {
      console.error('[Bot] Fehler bei der Freigabe:', err.response?.data || err.message);
      res.status(500).send(`Fehler: ${err.message}`);
    }
  }

  function routes(app) {
    const { requireLocalRequest, isLoopbackRequest, hasLoopbackHost } = ctx.access;

    app.get('/login', (req, res) => {
      if (!requireLocalRequest(req, res, '/login')) return;
      const scope = c.SCOPES.replace(/\+/g, ' ');
      const authUrl = `https://id.twitch.tv/oauth2/authorize`
        + `?response_type=code`
        + `&client_id=${c.CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(c.REDIRECT_URI)}`
        + `&scope=${encodeURIComponent(scope)}`
        + `&state=${createLoginState('broadcaster')}`;
      console.log('Leite zu Twitch Login weiter...');
      res.redirect(authUrl);
    });

    // Einmalige Freigabe des Bot-Kontos (ADR 0017). Nur lokal, wie /token.
    app.get('/login-bot', (req, res) => {
      if (!requireLocalRequest(req, res, '/login-bot')) return;
      const authUrl = `https://id.twitch.tv/oauth2/authorize`
        + `?response_type=code`
        + `&client_id=${c.CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(c.REDIRECT_URI)}`
        + `&scope=${encodeURIComponent(c.BOT_SCOPES)}`
        + `&force_verify=true`
        + `&state=${createLoginState('bot')}`;
      console.log('[Bot] Leite zur Twitch-Freigabe für den Bot-Account weiter (im Browser als DerBdu angemeldet sein)...');
      res.redirect(authUrl);
    });

    app.get('/callback', async (req, res) => {
      if (!requireLocalRequest(req, res, '/callback')) return;
      // Der state entscheidet, welcher Login zurückkehrt; ohne gültigen state wird nichts gespeichert.
      const kind = takeLoginState(req.query.state);
      if (kind === 'bot') return handleBotCallback(req, res);
      if (kind !== 'broadcaster') {
        console.warn('[Zugriffsschutz] /callback abgelehnt: unbekannter, abgelaufener oder schon benutzter Login (state) – nichts gespeichert');
        return res.status(400).send(`Anmeldung ungültig oder abgelaufen. Bitte http://localhost:${c.PORT}/login bzw. /login-bot erneut aufrufen.`);
      }
      const { code } = req.query;
      if (!code) return res.status(400).send('Kein Code erhalten (Anmeldung abgebrochen?)');

      try {
        console.log('Tausche Authorization Code gegen Tokens...');
        const params = new URLSearchParams({
          client_id: c.CLIENT_ID,
          client_secret: c.CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: c.REDIRECT_URI,
        });

        const response = await http.post('https://id.twitch.tv/oauth2/token', params);

        const userResponse = await twitchApi.get('/users', { auth: { token: response.data.access_token } });

        const userData = userResponse.data.data[0];
        const broadcasterUserId = userData.id;
        const broadcasterName = userData.login || userData.display_name;

        console.log('Broadcaster ID extrahiert:', broadcasterUserId);
        console.log('Broadcaster Name:', broadcasterName);

        const tokens = {
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
          broadcaster_id: broadcasterUserId,
          broadcaster_name: broadcasterName,
          obtained_at: Date.now(),
          expires_in: response.data.expires_in,
          expires_at: Date.now() + response.data.expires_in * 1000
        };

        saveTokens(tokens);
        console.log('Tokens gespeichert');
        console.log(`Token läuft ab in: ${Math.floor(response.data.expires_in / 3600)} Stunden`);

        res.send(`\n\nBroadcaster: ${broadcasterName}\n\nID: ${broadcasterUserId}\n\nToken-Gültigkeit: ${Math.floor(response.data.expires_in / 3600)} Stunden\n\nAuto-Refresh: Aktiviert\n\nDu kannst diesen Tab jetzt schließen.\n\nDer Server ist bereit und die Widgets können geladen werden.`);

        // z. B. EventSub verbinden; ein Fehler dort darf nicht in den catch unten laufen, die Antwort ist schon gesendet
        try {
          ctx.onBroadcasterLogin();
        } catch (err) {
          console.error('Nach dem Login:', err.message);
        }

      } catch (err) {
        console.error('Callback Fehler:', err.response?.data || err.message);
        res.status(500).send(`Fehler: ${err.message}`);
      }
    });

    app.get('/token', async (req, res) => {
      // Den Access-Token nur an Aufrufer auf diesem Rechner über localhost/127.0.0.1 herausgeben.
      if (!isLoopbackRequest(req) || !hasLoopbackHost(req)) {
        ctx.logIfChanged(
          `token-denied:${req.socket.remoteAddress}|${req.headers.host}`,
          `[Zugriffsschutz] /token abgelehnt: Aufruf von ${req.socket.remoteAddress} an Host "${req.headers.host}". Erlaubt sind nur lokale Aufrufe über localhost oder 127.0.0.1.`,
          'warn'
        );
        return res.status(403).json({ error: 'Token nur für lokale Aufrufe über localhost oder 127.0.0.1' });
      }

      try {
        const accessToken = await getValidAccessToken();
        const tokens = loadTokens();
        // Einmal je Herkunft loggen, damit sichtbar wird, welche Origin die Widgets tatsächlich senden.
        ctx.logIfChanged(`token-origin:${req.headers.origin || '-'}`, `[Token] Ausgabe an Widget-Herkunft: ${req.headers.origin || '(keine Origin)'}`);
        // expires_at: Widgets holen sich rechtzeitig einen neuen Token (der Server erneuert TOKEN_PROACTIVE_REFRESH_MS vor Ablauf)
        res.json({
          access_token: accessToken,
          broadcaster_id: tokens.broadcaster_id,
          client_id: c.CLIENT_ID,
          expires_at: new Date(tokenStore.expiresAt()).toISOString(),
        });
      } catch (err) {
        console.error('Token-Endpoint Fehler:', err.message);
        res.status(401).json({
          error: err.message,
          hint: 'Bitte login durchführen: http://localhost:3000/login'
        });
      }
    });
  }

  return {
    tokenStore, twitchApi, loadTokens, saveTokens, getValidAccessToken,
    loadBotConfig, saveBotConfig, removeBotConfig, getAppAccessToken, routes,
  };
}

module.exports = { createAuth };
