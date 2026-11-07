# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [Semantic Versioning](https://semver.org/lang/de/). Version 1.0 fasst alles bis zum 05.11.2026 zusammen (exakte Zeitpunkte einzelner älterer Änderungen sind nicht belegt; Reihenfolge nach Doku-Stand 09.09.2026, 18.09.2026 und Code). Ab 1.0 erhält jede Version einen Git-Tag (`1.0`, `1.1`, `1.1.1`, …) und ein GitHub-Release.

## [Unreleased]

## [1.1.5] – 2026-11-07

Versionsnummer nach Wahl des Nutzers: Version 1.2 bleibt der geplanten Webkonsole vorbehalten. Nach Semantic Versioning wären die neuen Funktionen eine Minor-Version (1.2); 1.1.2 bis 1.1.4 gibt es nicht.

### Added
- UBOAT-Soldbuch: Chat-Befehl `!soldbuch` (auch `!Soldbuch`) antwortet (als Reply) mit dem Soldbuch des eigenen Crewmitglieds aus dem neuesten UBOAT-Spielstand: Name mit Jahrgang, Typ, Offiziersklasse, Stufe und Erfahrung (nur Offiziere und Kommandant), Auszeichnungen, Charakterzüge und Fähigkeiten (deutsche Spielnamen), ggf. Todesdatum; „Der Eintrag ist aktuell.“, wenn der Spielstand höchstens 60 min alt ist (keine Zeitangabe). Dazu „an Bord“ bzw. „in Reserve“ (Feld `status`, Werte im Spielcode bestätigt) und „verwundet“ bzw. „im Krankenhaus“ (Zustände mit `IWoundedStatus` im Spielcode, noch nicht an einem echten Verwundeten erprobt). Kein passendes Crewmitglied: keine Chat-Antwort, nur Hinweis in der Konsole. Nur in der Twitch-Kategorie UBOAT, je Zuschauer einmal pro Minute. Zuordnung über den Namen (ohne Rücksicht auf Groß-/Kleinschreibung, Leerzeichen, Umlaute) oder `uboat_crew_map.json`. Der Server liest den Saves-Ordner nur (`UBOAT_SAVES_DIR`), erst nach 3 s Ruhe, und behält bei defekten Dateien den letzten gültigen Stand. Neu: `lib/uboat-save.js`, `lib/uboat-crew.js`, Endpoint `/api/uboat/crew`, Felder `uboat_*` in `/status`, Konsolenbefehle `uboat show|reload|map|unmap`, EventSub `channel.update` für die Kategorie (ADR 0016).

- Modul-Schalter: Konsolenbefehle `bdu activate|deactivate` und `uboat activate|deactivate` schalten BdU-Chat bzw. UBOAT-Soldbuch ein und aus. Der Zustand steht in `modules.json` und gilt auch nach einem Neustart (fehlt die Datei: beide an). Deaktiviert werden die Chat-Befehle still ignoriert (nur Konsolenzeile); beim Deaktivieren des BdU-Chats werden offene Anfragen verworfen. Anzeige in der Startmeldung, in `bdu show`/`uboat show` und in `/status` (`modules`).

- Bot-Account „DerBdu“: BdU-Antworten (inkl. Warnung und Funkstille-Ansage) und Soldbuch kommen vom Bot statt vom Broadcaster, gesendet mit App-Access-Token, damit Twitch das „Chat Bot“-Abzeichen zeigt. DerBdu postet BdU-Antworten ohne „FT vom BdU: “; das Präfix steht nur noch davor, wenn der Broadcaster sendet. Einmalige Freigabe über `/login-bot` (nur lokal); gespeichert werden nur ID und Name in `bot.json`, keine Bot-Tokens. Lehnt Twitch den Bot ab (z. B. fehlende Moderatorrolle), sendet der Broadcaster. Konsolenbefehle `bot show` und `bot remove`, Felder `bot_*` in `/status` (ADR 0017).

### Changed
- `sendChatMessage` kann als Reply posten und kürzt auf 500 Zeichen (`CHAT_MAX_CHARS`).
- Versionsnummer in `package.json`/`package-lock.json` auf 1.1.5.

### Fixed
- Tests: Unter Windows brachen alle älteren Tests beim Aufräumen mit `EPERM` ab, weil der Prozess noch im zu löschenden Arbeitsverzeichnis stand; sie wechseln jetzt vorher heraus.

### Documentation
- ADR 0016 (UBOAT-Crew aus dem Spielstand), Spec `uboat-personalakte.md`, ARCHITEKTUR, OFFEN, `.env.example`.
- Modul-Schalter in ARCHITEKTUR, Spec `bdu-chat.md` und `uboat-personalakte.md`.
- ADR 0017 (Bot-Account DerBdu), Spec `bot-account.md`, ARCHITEKTUR, OFFEN (inkl. Vorgaben zum Stream-Bericht).

## [1.1.1] – 2026-11-06

Wartungs-Version ohne Codeänderung am Server.

### Added
- Tests mit Attrappen im Repository (`test/`, `npm test`): K3, Shoutouts und Startanzeige, belegter Port, `/status`, EventSub-Keepalive, K9, Jahresbasis der Raid-Statistik, Aktivitätsprüfung und Hinweis beim Whitelist-Shoutout; kein Netzwerk, eigenes temporäres Arbeitsverzeichnis je Test.

### Changed
- Versionsnummer in `package.json`/`package-lock.json` auf 1.1.1 (der Tag `1.1` trägt dort noch 1.0.0).
- CHANGELOG nach Versionen aufgeteilt.

### Documentation
- AGENTS.md: `npm test` als Pflicht-Check vor jeder Auslieferung, Muster für neue Tests in `test/`.

## [1.1] – 2026-11-06

Enthält #10, #11 und #12.

### Added
- EventSub-Keepalive: Bleibt länger als `keepalive_timeout_seconds` plus 5 s jede Nachricht von Twitch aus, gilt die Verbindung als still abgebrochen, wird getrennt und neu aufgebaut (Konsolenhinweis). Vorher hätte der Server bis zum Neustart keine Ereignisse mehr erhalten.
- Whitelist-Shoutout nur an aktive Streamer: gerade live oder neuestes Video (Übertragung, Highlight, Upload) höchstens 40 Tage alt (`SHOUTOUT_ACTIVITY_WINDOW_DAYS`, ADR 0015). Testphase: bei unklarer Aktivität trotzdem Shoutout (`SHOUTOUT_ACTIVITY_STRICT = false`). Streamer, die beim Chatten selbst live sind, erhalten keinen Shoutout. Vor dem Shoutout der Chat-Hinweis „Welch netter Besuch! Wir begrüßen @<name>! Dort gab es zuletzt <Spiel>. Lasst gern mal nen Follow da!“ (ohne Datum). Auffälligkeiten (live, inaktiv, unklar) landen im Prüfprotokoll `whitelist_checks.json`, Konsolenbefehl `whitelist checks`. Raid-Shoutouts unverändert.

### Changed
- Raid-Statistik ab 2027 je Kalenderjahr statt je Quartal (`RAID_YEARLY_FROM_YEAR`, ADR 0012 geändert); Texte sagen dann „in diesem Jahr“. 2026 bleibt quartalsweise, bestehende Daten bleiben erhalten.

### Fixed
- `/status`: `bdu_silence_until` zeigt nach Ablauf einer Funkstille `null` statt der alten Uhrzeit (OFFEN.md K9).
- Konsolenhilfe nennt auch `whitelist add <id>` (Name wird aufgelöst).
- Raid-Begrüßung ohne Spielinfo: „ein unbekanntes Spiel“ bzw. „einem unbekannten Spiel“ je nach Satz statt immer „einem unbekannten Spiel“ (vorher grammatisch falsch in zwei von drei Varianten).

### Documentation
- AGENTS.md: Pflicht-Check vor dem Commit (`git diff --cached --stat`, Änderungen an mehreren Dateien ganz oder gar nicht).
- ADR 0015 (Aktivitätsprüfung, Chat-Hinweis und Prüfprotokoll beim Whitelist-Shoutout).

### Planned
- Stream-Bericht mit Clip-Kandidaten und Spielbewertung: Spec `docs/specs/stream-bericht.md` (Vorlage des Nutzers, mit Abgleich gegen Code und ADRs; Bericht in zwei Teilen: Stream-Dokumentation inkl. Raids, Follows, Subs, Gifts, Hype Trains, Watch-Serien, Top 10 der Chatter, Whitelist-Auffälligkeiten, Spielbewertung; Clip-Kandidaten; Abstimmung bevorzugt über zwei Kanalpunkte-Belohnungen), Eintrag in `docs/OFFEN.md`. Bot „DerBdu“ wird als normaler Bot geführt.

## [1.0] – 2026-11-05

In mehreren Livestreams (03.–05.11.2026) erprobter Stand.

### Added
- `/status` liefert `pid` und `started_at`, die Startanzeige nennt die Prozess-ID samt `taskkill`-Befehl. So ist erkennbar, welcher Prozess antwortet (05.11.2026).
- `AuthServer.cmd` (Windows-Start im eigenen Konsolenfenster, vom Stream-Deck-Skript genutzt, bisher nur lokal) im Repository, Titel und Banner mit neuem Namen; `.gitattributes` sorgt für CRLF-Zeilenenden. `.gitignore` schließt Token-Sicherungen (`*tokens*.json`) aus. README: Hinweis zu OneDrive und Git.
- BdU-Chat `!BdU <Text>` (ADR 0014, `docs/specs/bdu-chat.md`): Server prüft Limits (1 Anfrage je 3 min, 3 je Nutzer in 30 min, Warnung „Funkverkehr einschränken, Feind peilt ein!“ höchstens 1× je 10 min, Tagesobergrenze 60), reicht angenommene Anfragen per Server-Sent Events (`GET /api/bdu/stream`) an das Enigma-Widget weiter und postet dessen Antwort (`POST /api/bdu/answer`) als „FT vom BdU: …“ (Reply). Funkstille bei erschöpftem KI-Kontingent (30 min bzw. bis Streamstart) mit einmaliger Ansage. Beide Endpoints nur lokal. Konsole `bdu show`, `bdu silence off`; `/status` mit `bdu_widget_connected`, `bdu_silence_until`. Getestet mit Attrappen (35/35), Ende-zu-Ende mit dem Widget (18/18) und im Livestream (03.11.2026).
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

### Changed
- Shoutout-Ablehnungen „Kanal nicht live“ (400) und „Twitch-Wartezeit“ (429) als kurzer Hinweis statt als Fehlerausgabe; `sendShoutout` liefert `true`/`false`.
- Startanzeige: abgelaufener Token als „abgelaufen – wird beim ersten Zugriff automatisch erneuert“ statt negativer Minuten; neue Zeile, ob `HA_WEBHOOK_URL` eingetragen ist (ohne die Adresse).
- Alle Antworten mit `Cache-Control: no-store`, damit OBS-Browser-Sources keine alten Antworten (z. B. von `/token`) aus dem Cache verwenden.
- ADR 0003 präzisiert: Widgets dürfen mit dem Server-Token Helix direkt aufrufen.
- Shoutouts vom Chat-Befehl auf `POST /helix/chat/shoutouts` umgestellt.
- Sub- und Gift-Effekte werden nicht mehr von `channel.subscribe`, `channel.subscription.message` und `channel.subscription.gift` ausgelöst, sondern von `channel.chat.notification`. Ein Gift-Bomb erzeugt einen Effekt.
- Die frühen Sub-Events aktualisieren nur noch den Sub-Goal-Cache.
- Projekt umbenannt in „Twitch Companion JS server“ (README, Startmeldung, `package.json`).
- `.env.example` mit Erklärung jedes Scopes.
- Doku: `docs/KONTEXT.md` (Einordnung im Ökosystem), Arbeitsweise in AGENTS.md, Abgleich mit dem Gesamtkontext in OFFEN.md.

### Fixed
- Start bei belegtem Port bricht jetzt mit Fehlermeldung ab. Vorher meldete der zweite Start „Server läuft auf …“ und lief ohne HTTP-Teil, aber mit eigener EventSub-Verbindung weiter (Express 5 ruft den `listen`-Callback auch im Fehlerfall auf). Folge: zwei Server parallel, Widgets nur mit dem ersten verbunden (05.11.2026).
- Effekt-Modus `off` verwirft jetzt auch eine wartende Bestätigung im Modus `manual`. Vorher löste `/api/effects/confirm` den Effekt trotz `off` aus. Umschalten per HTTP und Konsole über die gemeinsame Funktion `setEffectMode()` (OFFEN.md K3, docs/BUGS.md).
- Kein zweiter Shoutout mehr für einen Raider, der danach im Chat schreibt und auf der Whitelist steht (Twitch lehnte mit 429 ab, Livestream 03.11.2026). Der Raid-Shoutout trägt den Raider in `shoutedOutThisSession` ein; scheitert er, darf die Whitelist es erneut versuchen.
- Falscher EventSub-Typ `channel.stream.online` durch `stream.online` ersetzt.
- Konsolenbefehle durch korrigierte Regex und bereinigte Escapes wieder erkannt.
- Log-Spam bei Polling reduziert.
- Doppelte und zu frühe Sub-/Gift-Effekte (siehe Changed).
- `session_reconnect`: neue Verbindung erhält Event-Handler, alte wird erst nach dem Welcome geschlossen, kein doppelter Neuaufbau mehr (siehe docs/BUGS.md).

### Security
- CORS nicht mehr für alle Herkünfte offen: Browser-Anfragen fremder Webseiten werden mit 403 abgelehnt. Vorher konnte jede im Browser des Streaming-PCs geöffnete Webseite den Access-Token über `localhost:3000/token` lesen.
- `/token` antwortet nur noch auf lokale Aufrufe über `localhost`/`127.0.0.1` (kein Abruf aus dem LAN, Schutz vor DNS-Rebinding). Siehe ADR 0013.
- Hinweis: Neuere OBS-Versionen sperren Widgets, die als „Lokale Datei“ eingebunden sind, den Zugriff auf `localhost`. Widgets per URL `file:///…` einbinden (docs/BUGS.md).

### Documentation
- `CLAUDE.md` importiert `AGENTS.md`, damit Claude Code die Regeln in jeder Sitzung lädt.
- BdU-Chat-Befehl `!BdU`: ADR 0014, `docs/specs/bdu-chat.md`, Eintrag in `docs/OFFEN.md`.
- Doku-Abgleich mit dem Code (Nov. 2026): ADR 0002 und 0007 zum EventSub-Reconnect präzisiert, Antwort von `POST /api/bdu/answer` bei `quota`, Erkennung des Tageskontingents („täglich“), Konsolenhilfe ohne `whitelist add <id>`, BdU-Chat in README und `.env.example`, neuer offener Punkt K9 (`bdu_silence_until` in `/status`).

### Planned
- Vorgemerkt in `docs/OFFEN.md` („Ausbau zur Plattform“): Server-Konsole im Browser, Sicherheitsprüfung, Auslieferung der Widgets als optionale Module, öffentliche Veröffentlichung für andere Streamer.

### Hinweis
- Die 40-Tage-Aktivitätsprüfung für Shoutouts existierte nur in einem anderen, nicht mehr auffindbaren Branch und ist in 1.0 nicht enthalten; in 1.1 neu umgesetzt (ADR 0015).

[Unreleased]: https://github.com/BombingFritz/Twitch-Companion-JS-server/compare/1.1.1...HEAD
[1.1.1]: https://github.com/BombingFritz/Twitch-Companion-JS-server/compare/1.1...1.1.1
[1.1]: https://github.com/BombingFritz/Twitch-Companion-JS-server/compare/1.0...1.1
[1.0]: https://github.com/BombingFritz/Twitch-Companion-JS-server/releases/tag/1.0
