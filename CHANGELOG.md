# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/). Bis zur ersten bestätigten Version steht alles unter [Unreleased]. Die Reihenfolge folgt dem Doku-Stand (09.09.2026, 18.09.2026) und dem aktuellen Code. Exakte Zeitpunkte einzelner Änderungen sind nicht belegt.

## [Unreleased]

### Added
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

### Changed
- Shoutouts vom Chat-Befehl auf `POST /helix/chat/shoutouts` umgestellt.
- Sub- und Gift-Effekte werden nicht mehr von `channel.subscribe`, `channel.subscription.message` und `channel.subscription.gift` ausgelöst, sondern von `channel.chat.notification`. Ein Gift-Bomb erzeugt einen Effekt.
- Die frühen Sub-Events aktualisieren nur noch den Sub-Goal-Cache.
- Projekt umbenannt in „Twitch Companion JS server“ (README, Startmeldung, `package.json`).
- `.env.example` mit Erklärung jedes Scopes.
- Doku: `docs/KONTEXT.md` (Einordnung im Ökosystem), Arbeitsweise in AGENTS.md, Abgleich mit dem Gesamtkontext in OFFEN.md.

### Fixed
- Falscher EventSub-Typ `channel.stream.online` durch `stream.online` ersetzt.
- Konsolenbefehle durch korrigierte Regex und bereinigte Escapes wieder erkannt.
- Log-Spam bei Polling reduziert.
- Doppelte und zu frühe Sub-/Gift-Effekte (siehe Changed).
- `session_reconnect`: neue Verbindung erhält Event-Handler, alte wird erst nach dem Welcome geschlossen, kein doppelter Neuaufbau mehr (siehe docs/BUGS.md).

### Hinweis
- Die 40-Tage-Aktivitätsprüfung für Shoutouts existiert nur in einem anderen Branch und ist hier nicht enthalten.
