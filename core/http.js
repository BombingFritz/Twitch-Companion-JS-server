// Kern: HTTP-Zugriffsschutz und HTTP-Protokoll (ADR 0027, ADR 0013). Prüft Browser-Herkunft (CORS), verhindert
// Caching und erlaubt bestimmte Endpunkte nur vom eigenen Rechner. Welche Abrufe still bleiben, gibt server.js vor.
'use strict';
const cors = require('cors');

function createAccess({ port, corsOrigins, defaultOrigins, loopbackAddresses, loopbackHostnames, logIfChanged }) {
  // CORS_ORIGINS leer: Standard-Herkünfte. '*': jede Herkunft (altes Verhalten,
  // nur als Notschalter gedacht). localhost/127.0.0.1 auf dem eigenen Port sind immer erlaubt.
  const corsAllowAll = (corsOrigins || '').trim() === '*';
  const allowedOrigins = new Set([
    ...(corsOrigins && corsOrigins.trim() && !corsAllowAll
      ? corsOrigins.split(',').map(o => o.trim()).filter(Boolean)
      : defaultOrigins),
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

  // Anfragen ohne Origin-Header (Stream Deck, Home Assistant, Adresszeile des Browsers) sind nicht betroffen.
  function isAllowedOrigin(origin) {
    return corsAllowAll || !origin || allowedOrigins.has(origin);
  }

  function isLoopbackRequest(req) {
    return loopbackAddresses.includes(req.socket.remoteAddress);
  }

  // Prüft den Host-Header. Schützt vor DNS-Rebinding: Eine fremde Domain, die auf
  // 127.0.0.1 zeigt, käme sonst als "gleiche Herkunft" an CORS vorbei.
  function hasLoopbackHost(req) {
    const host = (req.headers.host || '').toLowerCase();
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    return loopbackHostnames.includes(hostname);
  }

  // Anmeldung nur vom eigenen Rechner (ADR 0013, Nachtrag 07.11.2026): REDIRECT_URI zeigt auf localhost, die Rückkehr
  // von Twitch kommt also immer lokal an. Ohne diese Prüfung könnte ein Gerät im Heimnetz einen Code für ein fremdes
  // Konto an /callback schicken und tokens.json überschreiben. Antwortet selbst mit 403.
  function requireLocalRequest(req, res, label) {
    if (isLoopbackRequest(req) && hasLoopbackHost(req)) return true;
    logIfChanged(
      `local-only-denied:${label}:${req.socket.remoteAddress}|${req.headers.host}`,
      `[Zugriffsschutz] ${label} abgelehnt: Aufruf von ${req.socket.remoteAddress} an Host "${req.headers.host}". Nur lokale Aufrufe über localhost oder 127.0.0.1.`,
      'warn'
    );
    res.status(403).send('Nur für lokale Aufrufe über localhost oder 127.0.0.1');
    return false;
  }

  // Wie requireLocalRequest, aber ohne eigene Antwort: Der Endpunkt antwortet selbst (meist JSON).
  function isLocalWidgetRequest(req, label) {
    if (isLoopbackRequest(req) && hasLoopbackHost(req)) return true;
    logIfChanged(
      `bdu-denied:${label}:${req.socket.remoteAddress}|${req.headers.host}`,
      `[Zugriffsschutz] ${label} abgelehnt: Aufruf von ${req.socket.remoteAddress} an Host "${req.headers.host}". Nur lokale Aufrufe über localhost oder 127.0.0.1.`,
      'warn'
    );
    return false;
  }

  // HTTP-Protokoll: loggt jede Anfrage, unterdrückt aber direkt aufeinanderfolgende identische Zeilen.
  // isQuiet(req, res) entscheidet, welche erfolgreichen Abrufe gar nicht erscheinen (Vorgabe aus server.js).
  function requestLogger(isQuiet = () => false) {
    let lastLine = null;
    return (req, res, next) => {
      const startedAt = Date.now();
      res.on('finish', () => {
        if (isQuiet(req, res)) return;
        const durationMs = Date.now() - startedAt;
        // OAuth-Code und state aus /callback nicht ins Protokoll schreiben
        const url = req.originalUrl.replace(/([?&](?:code|state)=)[^&]*/g, '$1…');
        const line = `[HTTP] ${req.method} ${url} -> ${res.statusCode} (${durationMs}ms)`;
        if (line !== lastLine) {
          console.log(line);
          lastLine = line;
        }
      });
      next();
    };
  }

  // Herkunftsprüfung, CORS und no-store in dieser Reihenfolge, nach dem HTTP-Protokoll.
  function install(app) {
    // Browser-Anfragen von fremden Webseiten werden abgelehnt, bevor ein Endpoint etwas ausführt oder Daten herausgibt.
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (isAllowedOrigin(origin)) return next();
      logIfChanged(
        `origin-blocked:${origin}`,
        `[Zugriffsschutz] Anfrage von fremder Herkunft "${origin}" abgelehnt (${req.method} ${req.path}). Eigenes Widget? Herkunft in CORS_ORIGINS (.env) eintragen.`,
        'warn'
      );
      res.status(403).json({ error: 'Herkunft nicht erlaubt', origin });
    });

    app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }));

    // Alle Antworten sind Live-Daten. Ohne diesen Header kann z. B. eine
    // OBS-Browser-Source eine alte /token-Antwort aus dem Cache verwenden.
    app.use((req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    });
  }

  return { corsAllowAll, allowedOrigins, isAllowedOrigin, isLoopbackRequest, hasLoopbackHost, requireLocalRequest, isLocalWidgetRequest, requestLogger, install };
}

module.exports = { createAccess };
