# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/). Bis zur ersten bestätigten Version steht alles unter [Unreleased]. Die Reihenfolge folgt dem Doku-Stand (09.09.2026, 18.09.2026) und dem aktuellen Code. Exakte Zeitpunkte einzelner Änderungen sind nicht belegt.

## [Unreleased]

### Added
- BdU-Chat `!BdU <Text>` (ADR 0014, `docs/specs/bdu-chat.md`): Server prüft Limits (1 Anfrage je 3 min, 3 je Nutzer in 30 min, Warnung „Funkverkehr einschränken, Feind peilt ein!“ höchstens 1× je 10 min, Tagesobergrenze 60), reicht angenommene Anfragen per Server-Sent Events (`GET /api/bdu/stream`) an das Enigma-Widget weiter und postet dessen Antwort (`POST /api/bdu/answer`) als „FT vom BdU: …“ (Reply). Funkstille bei erschöpftem KI-Kontingent (30 min bzw. bis Streamstart) mit einmaliger Ansage. Beide Endpoints nur lokal. Konsole `bdu show`, `bdu silence off`; `/status` mit `bdu_widget_connected`, `bdu_silence_until`. Getestet mit Attrappen (35/35) und Ende-zu-Ende mit dem Widget (18/18); Live-Test ausstehend.
- OAuth2-Login (`/login`, `/callback`), Token-Speicher und Auto-Refresh mit 5-Minuten-Puffer, `/token`, `/status`.
- Predictions-API `/api/twitch/prediction/current`.
- EventSub-WebSocket mit `channel.raid`, `channel.chat.message`, `stream.online`, Auto-Reconnect nach 5 s.
- Raid-Begrüßung mit Warteschlange (90 s Abstand), Quartals-Statistik in `raids.json`, Textbausteine mit Zufallsvarianten.
- Mod-Befehl `!raidstats` mit 30 s Cooldown.
- Shoutouts über die Helix-API, automatisch bei Raids ab 3 Zuschauern.
- Whitelist mit Konsolenbefehlen und Auto-Shoutout bei der ersten Chat-Nachricht je Session.
- Sub-Goal-Counter (`/api/twitch/subcounter`, `subgoal_cache.json`, Konsolenbefehle `subgoal refresh|show`).
- Subscriptions `channel.subscribe`, `channel.subscription.gift`, `channel.subscription.message`, `channel.follow` (v2).
- Effekt-Queue mit Bündelung, Mindestabstand, Modi `auto`/`manual`/`off`, Home-Assistant-Webhook, Konsole `effects mode|show`.
- Event-Log (`events.json`, `/api/homeassistant/events`, `events show`).
- Logging-Entrauschung (`logIfChanged`, HTTP-Logger).
- Subscription `channel.chat.notification` mit `handleChatNotification`.
- Entdoppelung über `message_id`, Sub- und Follow-Zeitfenster.
- `package.json` mit `npm start`, `npm run check`, `engines.node >= 18`, dazu `package-lock.json`.
- Konstanten `EVENTSUB_WS_URL` und `EVENTSUB_RECONNECT_DELAY_MS`.
- `/token` liefert zusätzlich `client_id`, damit Widgets keine IDs selbst pflegen müssen.
- Umgebungsvariable `CORS_ORIGINS` (erlaubte Widget-Herkünfte, `*` als Notschalter), Anzeige in Startmeldung und `/status` (`allowed_origins`).
- `/token` loggt einmal je Herkunft, an welche Widget-Herkunft der Token ausgegeben wurde.

### Documentation
- BdU-Chat-Befehl `!BdU`: ADR 0014, `docs/specs/bdu-chat.md`, Eintrag in `docs/OFFEN.md` (umgesetzt, siehe Added).
- `CLAUDE.md` importiert `AGENTS.md`, damit Claude Code die Regeln in jeder Sitzung lädt.
- Doku-Abgleich mit dem Code (Nov. 2026): ADR 0002 und 0007 zum EventSub-Reconnect präzisiert, Antwort von `POST /api/bdu/answer` bei `quota`, Erkennung des Tageskontingents („täglich“), Konsolenhilfe ohne `whitelist add <id>`, BdU-Chat in README und `.env.example`, neuer offener Punkt K9 (`bdu_silence_until` in `/status`).

### Planned
- Vorgemerkt in `docs/OFFEN.md` („Ausbau zur Plattform“): Server-Konsole im Browser, Sicherheitsprüfung, Auslieferung der Widgets als optionale Module, öffentliche Veröffentlichung für andere Streamer.

### Changed
- Alle Antworten mit `Cache-Control: no-store`, damit OBS-Browser-Sources keine alten Antworten (z. B. von `/token`) aus dem Cache verwenden.
- ADR 0003 präzisiert: Widgets dürfen mit dem Server-Token Helix direkt aufrufen.
- Shoutouts vom Chat-Befehl auf `POST /helix/chat/shoutouts` umgestellt.
- Sub- und Gift-Effekte werden nicht mehr von `channel.subscribe`, `channel.subscription.message` und `channel.subscription.gift` ausgelöst, sondern von `channel.chat.notification`. Ein Gift-Bomb erzeugt einen Effekt.
- Die frühen Sub-Events aktualisieren nur noch den Sub-Goal-Cache.
- Projekt umbenannt in „Twitch Companion JS server“ (README, Startmeldung, `package.json`).
- `.env.example` mit Erklärung jedes Scopes.
- Doku: `docs/KONTEXT.md` (Einordnung im Ökosystem), Arbeitsweise in AGENTS.md, Abgleich mit dem Gesamtkontext in OFFEN.md.

### Fixed
- Effekt-Modus `off` verwirft jetzt auch eine wartende Bestätigung im Modus `manual`. Vorher löste `/api/effects/confirm` den Effekt trotz `off` aus. Umschalten per HTTP und Konsole über die gemeinsame Funktion `setEffectMode()` (OFFEN.md K3, docs/BUGS.md).
- Falscher EventSub-Typ `channel.stream.online` durch `stream.online` ersetzt.
- Konsolenbefehle durch korrigierte Regex und bereinigte Escapes wieder erkannt.
- Log-Spam bei Polling reduziert.
- Doppelte und zu frühe Sub-/Gift-Effekte (siehe Changed).
- `session_reconnect`: neue Verbindung erhält Event-Handler, alte wird erst nach dem Welcome geschlossen, kein doppelter Neuaufbau mehr (siehe docs/BUGS.md).

### Security
- CORS nicht mehr für alle Herkünfte offen: Browser-Anfragen fremder Webseiten werden mit 403 abgelehnt. Vorher konnte jede im Browser des Streaming-PCs geöffnete Webseite den Access-Token über `localhost:3000/token` lesen.
- `/token` antwortet nur noch auf lokale Aufrufe über `localhost`/`127.0.0.1` (kein Abruf aus dem LAN, Schutz vor DNS-Rebinding). Siehe ADR 0013.
- Hinweis: Neuere OBS-Versionen sperren Widgets, die als „Lokale Datei“ eingebunden sind, den Zugriff auf `localhost`. Widgets per URL `file:///…` einbinden (docs/BUGS.md).

### Hinweis
- Die 40-Tage-Aktivitätsprüfung für Shoutouts existiert nur in einem anderen Branch und ist hier nicht enthalten.
