# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [Semantic Versioning](https://semver.org/lang/de/). Version 1.0 fasst alles bis zum 05.11.2026 zusammen (exakte Zeitpunkte einzelner älterer Änderungen sind nicht belegt; Reihenfolge nach Doku-Stand 09.09.2026, 18.09.2026 und Code). Ab 1.0 erhält jede Version einen Git-Tag (`1.0`, `1.1`, `1.1.1`, …) und ein GitHub-Release.

## [Unreleased]

### Added
- Webkonsole, Stufe 1: Statusseite unter `http://localhost:<PORT>/TwitchCompanionAdmin`, nur am Streaming-PC und nur zum Ansehen. Hauptseite mit Server, Twitch, Effekten, Modulen, Bot, BdU-Chat, UBOAT, Whitelist und Sub-Goal, Aktualisierung alle 5 s, Anzeige „Server nicht erreichbar“ und Hinweis auf einen neuen Serverprozess. Die letzten Effekte zeigen bei älteren Einträgen auch das Datum. Reiter für Live-Log, Einstellungen, Whitelist und Statistik sind angelegt und folgen nach und nach. Neu: `public/admin/`, `GET /api/admin/overview` (strenge Herkunftsprüfung, keine Tokens), Zeile in der Startanzeige (ADR 0018, Spec `webkonsole.md`).
- Webkonsole, Stufe 2: Knöpfe „Server neu starten“ und „Server beenden“ in der Karte „Server“, je mit Rückfrage. Die Kopfzeile zeigt danach „Server beendet um HH:MM (PID …)“ oder „Neustart läuft …“ und warnt, wenn derselbe Prozess weiterläuft. Neu: `POST /api/admin/server/shutdown` und `/restart` (nur POST mit JSON und eigener Herkunft), `can_restart` in `/api/admin/overview`. `AuthServer.cmd` startet den Server bei Exit-Code 75 im selben Fenster neu; ohne das Skript ist der Neustart-Knopf ausgegraut (ADR 0018, Spec `webkonsole.md`).
- Webkonsole: Einklappbare Gruppe „Optionale Module“ mit HA-Effekte, UBOAT-Soldbuch, BdU-Chat und Sub-Goal; eingeklappt nur Name und Licht (grün, grau, rot). Die Karte „Module“ entfällt, ihre Angaben stehen in den einzelnen Karten. Die Karte „Whitelist“ entfällt, die Whitelist bekommt einen eigenen Reiter. Neu: `ha_webhook_configured` in `/api/admin/overview`, ohne die Adresse (ADR 0018, Spec `webkonsole.md`).
- Webkonsole, Stufe 3: Reiter „Live-Log“ zeigt alle Konsolenzeilen fortlaufend, mit Filter und „Nur Warnungen und Fehler“. Neu: Puffer der letzten 1000 Zeilen im Arbeitsspeicher und `GET /api/admin/log/stream` (Server-Sent Events). Secrets, Tokens, Webhook-Adresse und private Netzwerkadressen werden dort entfernt, das Konsolenfenster bleibt unverändert (ADR 0018, Spec `webkonsole.md`).
- Fehlerprotokoll: Die letzten 1000 Fehlermeldungen bleiben mit Uhrzeit in `error_log.json` erhalten, auch nach Beenden, Neustart oder Absturz. Anzeige über den Umschalter „Fehlerprotokoll“ im Reiter „Live-Log“. Neu: `GET /api/admin/log/errors` (ADR 0018, Spec `webkonsole.md`).
- Webkonsole, Stufe 5: Reiter „Whitelist“ zeigt alle Einträge mit Filter, nimmt Streamer per Name, `@Name` oder ID auf und entfernt sie mit Rückfrage. Neu: `GET /api/admin/whitelist`, `POST /api/admin/whitelist/add` und `/remove` (nur POST mit JSON und eigener Herkunft). Die Konsolenbefehle bleiben (ADR 0006, ADR 0018, Spec `webkonsole.md`).
- Webkonsole, Stufe 4 (Teil): Reiter „Einstellungen“ mit Schaltern für BdU-Chat und UBOAT-Soldbuch. Neu: `POST /api/admin/modules` (nur POST mit JSON und eigener Herkunft). Konsole und Webkonsole nutzen dafür `switchModule` (ADR 0018, Spec `webkonsole.md`).
- Webkonsole, Stufe 4 (Teil): Schalter An/Aus für die HA-Effekte im Reiter „Einstellungen“. Neu: `POST /api/admin/effects/mode` (ADR 0010, ADR 0018, Spec `webkonsole.md`).

### Security
- Entfernt: `GET /api/effects/mode/:mode` und `GET /api/effects/confirm`. Sie änderten ohne Schutz den Zustand des Servers; Einbindungen ohne `Origin` konnten sie auslösen. Stream-Deck-Tasten auf diese Adressen funktionieren nicht mehr, Ersatz ist der Reiter „Einstellungen“. `GET /api/effects/mode` (nur lesen) und die Konsolenbefehle bleiben (ADR 0018).
- Login-CSRF geschlossen: `/login`, `/login-bot` und `/callback` nehmen nur noch Aufrufe vom eigenen Rechner an (wie `/token`). Der Broadcaster-Login trägt jetzt einen zufälligen, einmal gültigen `state`; `/callback` speichert nur mit gültigem `state`. Vorher konnte ein Gerät im Heimnetz einen Code für ein fremdes Konto an `/callback` schicken und `tokens.json` überschreiben (ADR 0013, Nachtrag 07.11.2026).
- Das HTTP-Protokoll in der Konsole zeigt `code` und `state` aus der URL nicht mehr.

### Removed
- Effekt-Modus `manual` samt Bestätigung. Es bleiben `auto` und `off`; ein gespeichertes `manual` gilt beim Start als `auto`. `/api/effects/mode` und `/api/admin/overview` liefern kein Feld zur wartenden Bestätigung mehr (ADR 0010).

### Changed
- `BOT_LOGIN_STATE_TTL_MS` heißt jetzt `LOGIN_STATE_TTL_MS` und gilt für beide Logins.
- Raid-Begrüßung und `!raidstats` senden über `sendChatMessage` (Kürzung auf 500 Zeichen, Prüfung von `is_sent`). Der Raid-Shoutout folgt nur, wenn Twitch die Begrüßung angenommen hat.
- Aufgeräumt nach der Code-Prüfung: `BDU_CHAT_MAX_CHARS` entfernt (gleich `CHAT_MAX_CHARS`), `formatDateDe` in `lib/uboat-crew.js` heißt `formatIsoDateDe`, die UBOAT-Module exportieren nur noch, was `server.js` nutzt, das BdU-Nutzerlimit löscht abgelaufene Einträge.

### Tests
- Neuer Test `test/admin-test.js` (Zugriffsschutz, Herkunft, keine Secrets, Pfade außerhalb von `public/admin`, `/status` unverändert).
- Neuer Test `test/admin-format-test.js` (Zeitangabe in der Effektliste, auch über Mitternacht; Lichter der optionalen Module).
- `test/admin-test.js`: Szenarien `server-beenden` und `server-neustart` (abgelehnte Aufrufe, Exit-Code, zweiter Auftrag).
- Neuer Test `test/authserver-test.js` (die Schleife in `AuthServer.cmd` startet nur bei Code 75 neu).
- `test/admin-test.js`: Szenario `live-log` (Zugriff, Live-Zeilen, Bereinigung, Begrenzung des Puffers), Szenarien `fehler-protokoll` und `fehler-defekt` (Erhalt über Läufe, nur Fehler, Bereinigung, Begrenzung, defekte Datei), Szenario `whitelist` (Zugriff, Eingaben, Twitch-Fehler, Hinzufügen, Entfernen), Szenario `module` (Zugriff, Eingaben, Schalten, Speichern), Szenario `effekte` (alte Adressen 404, Zugriff, Eingaben, Umschalten).
- `test/k3-test.js` prüft jetzt `auto` und `off` über Webkonsole und Konsole und dass `manual` abgelehnt wird. Szenario `effekte-alt` in `test/admin-test.js`.
- Bot-Test: Prüfung des Quelltexts (A22) ersetzt durch Verhaltenstests, dass `!raidstats` und Raid-Begrüßung auch mit Bot vom Broadcaster kommen.

### Documentation
- ADR 0019 (Grundgerüst der Statistik). AGENTS.md: Produktausrichtung (Grundfunktion ohne Module, Home Assistant optional, Dateigrößen in der Cloud). Spec `effekt-queue.md`: Home Assistant auch ohne den Server auslösen.
- OFFEN: Ausbau der Webkonsole und spätere Module vorgemerkt (mehr Einstellungen, Soldbuch, Trennung von Modulen und Grundeinstellungen, Bot-Timer, Channel-Emotes, ESP32-Monitor, Chat-Auswertung).
- Neue Spec `statistik.md`: Ziele für Statistik und Endscreen, geprüfte Twitch-Angaben, offene Fragen. Noch kein Code.
- Konzept der Webkonsole: ADR 0018, Spec `webkonsole.md`, Nachträge in ADR 0006 und 0010, Vorgaben zum Streamlog in OFFEN. Noch kein Code.
- ADR 0013 (Nachtrag), ARCHITEKTUR, Spec `bot-account.md`, OFFEN (K1). Neuer Test `test/login-test.js`.
- Doku-Lücken aus der Code-Prüfung: KONTEXT mit eigenen Abschnitten zu DerBdu und UBOAT-Soldbuch; ARCHITEKTUR mit Zugriffsschutz-Funktionen, `armKeepalive`, `MODULE_NAMES`, `WHITELIST_CHECK_LABELS`; Status der Specs `bdu-chat`, `bot-account`, `uboat-personalakte` aktualisiert; README nennt Modul-Schalter und Login nur am Streaming-PC.
- Neue Übersicht `docs/adr/README.md`: ADRs nach Themen gruppiert, je ein Satz, Verweise und Herkunft, Anleitung für neue ADRs; Verweis in README und AGENTS.md.
- KONTEXT: Enigma-Widget steht ab 1.3.1 unter MIT (vorher CC-BY 4.0).
- KONTEXT: Widget-Tabelle mit Repositories und Ständen (SpargelPoll 0.8.2, CoinFlip 0.1.0, Enigma 1.3.0); Quelle „Genereller Kontext“ am 08.11.2026 abgeglichen.
- Abgleich mit Enigma-Widget 1.3.0 (Schnittstelle unverändert): Spec `bdu-chat.md` mit neuem Abschnitt „Verhalten des Widgets“, Einleitung nennt DerBdu statt nur „FT vom BdU“, `hello`-Ereignis beschrieben; OFFEN und KONTEXT nennen die aktuelle Widget-Version.

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
