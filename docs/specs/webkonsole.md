# Spec: Webkonsole (`/TwitchCompanionAdmin`)

## Ziel
Eine Oberfläche im Browser des Streaming-PCs, mit der sich der Server ansehen und nach und nach bedienen lässt (OFFEN.md P1, ADR 0018). Die erste Stufe ist eine reine Statusseite, die schon als Hauptseite mit Reitern aufgebaut ist.

## Stufen (je ein PR)
| Stufe | Inhalt | Stand |
|---|---|---|
| 1 | Hauptseite „Übersicht“ und Reiter-Gerüst, nur ansehen | umgesetzt |
| 2 | Knöpfe „Server beenden“ und „Server neu starten“ auf der Hauptseite (erste ändernde Aktion) | umgesetzt |
| 3 | Reiter „Live-Log“: Puffer im Server, Live-Anzeige per Server-Sent Events | später, eigene Ergänzung dieser Spec |
| 4 | Reiter „Einstellungen“: Modul-Schalter, Effekt-Modus mit Bestätigung (GET-Endpoints entfallen), Bot-Zuordnung | später |
| 5 | Reiter „Whitelist“: anzeigen, hinzufügen, entfernen | später |
| 6 | Reiter „Statistik“ | später, Inhalt [UNGEKLÄRT] |

Der Knopf „Streamlog beenden“ kommt auf die Hauptseite, sobald es den Streamlog gibt (Spec `stream-bericht.md`, eigenes ADR). Die Reihenfolge der Stufen 2 bis 6 ist ein Vorschlag von Claude.

## Verhalten Stufe 1
### Aufruf
- `http://localhost:<PORT>/TwitchCompanionAdmin` im Browser des Streaming-PCs (Groß-/Kleinschreibung egal). Beim Start nennt die Konsole die Adresse.
- Aus dem Netzwerk oder mit fremdem Host: 403 (`requireLocalRequest`).

### Aufbau
- Kopfzeile: Name des Servers, Version aus `package.json`, Verbindungsanzeige („verbunden“ / „Server nicht erreichbar“).
- Reiterleiste: „Übersicht“ aktiv; „Live-Log“, „Einstellungen“, „Whitelist“ und „Statistik“ sichtbar, aber ausgegraut, solange sie noch nicht gebaut sind.
- Der aktive Reiter steht in der Adresse (`/TwitchCompanionAdmin#uebersicht`), damit ein Neuladen ihn behält.
- Jeder Reiter ist ein Eintrag `{id, title, ready, render}` in einer Liste; ein neuer Reiter braucht nur einen neuen Eintrag und seine Render-Funktion.

### Inhalt der Übersicht
| Karte | Angezeigt | Quelle |
|---|---|---|
| Server | Prozess-ID, läuft seit, Port | `pid`, `started_at` |
| Twitch | Konto, Token gültig, EventSub verbunden, aktuelle Kategorie | Status, `currentCategory` |
| Bot | DerBdu eingerichtet, Funktionen über den Bot | `bot_*` |
| *Gruppe „Optionale Module“:* | | |
| HA-Effekte | Webhook eingetragen, Modus (`auto`/`manual`/`off`), Warteschlange, wartende Bestätigung, letzte 5 Effekte | `ha_webhook_configured`, Status, `pendingManualConfirmation`, `events.json` |
| UBOAT-Soldbuch | Modul an oder aus, Kategorie aktiv, Spielstand und sein Stand | `modules`, `uboat_*` |
| BdU-Chat | Modul an oder aus, Enigma-Widget verbunden, Funkstille bis | `modules`, `bdu_*` |
| Sub-Goal | Stand, Ziel, Titel | `subgoal_cache.json` |

Die Whitelist hat keine Karte auf der Übersicht, sie bekommt den eigenen Reiter (Stufe 5).

### Gruppe „Optionale Module“
Die Zusatzfunktionen stehen unter einer eigenen, einklappbaren Überschrift. Beim ersten Aufruf ist die Gruppe aufgeklappt; der Zustand wird im Browser gespeichert (`localStorage`) und überlebt Neuladen. Fehlt der Speicher, bleibt sie aufgeklappt.

Eingeklappt steht dort je Modul nur der Name mit einem Licht (Grund als Tooltip); Sub-Goal zeigt nur den Namen:

| Modul | Grün (funktioniert) | Grau (nur nicht aktiv) | Rot (Fehler) |
|---|---|---|---|
| HA-Effekte | Webhook eingetragen, Modus `auto` oder `manual` | Modus `off` | kein Webhook eingetragen |
| UBOAT-Soldbuch | eingerichtet, eingeschaltet, Spielstand gelesen | nicht eingerichtet oder ausgeschaltet | eingerichtet und eingeschaltet, aber kein Spielstand gelesen |
| BdU-Chat | eingeschaltet, Enigma-Widget verbunden, keine Funkstille | ausgeschaltet, Widget nicht verbunden oder Funkstille | – |

Die Webhook-Adresse selbst erscheint nicht auf der Seite, `/api/admin/overview` meldet nur `ha_webhook_configured`.

Die letzten Effekte zeigen bei Einträgen von heute nur die Uhrzeit, bei älteren zusätzlich das Datum (Tag und Monat), weil `events.json` Einträge mehrerer Tage enthält.

Ohne Twitch-Login zeigt die Karte „Twitch“ einen Link auf `/login`, die übrigen Karten zeigen, was der Server ohne Login weiß.

### Aktualisierung
- Die Seite ruft alle `ADMIN_POLL_MS` (5 s) `GET /api/admin/overview` ab, nur solange der Tab sichtbar ist.
- Ist der Server nicht erreichbar: Anzeige „Server nicht erreichbar“, letzte Werte bleiben ausgegraut stehen, die Abfrage läuft weiter. Kommt der Server zurück und hat sich `pid` geändert, zeigt die Kopfzeile das kurz an.

### `GET /api/admin/overview`
- Antwort: Felder wie `/status` (ohne `allowed_origins`, ohne `broadcaster_id`), dazu `version`, `port`, `poll_ms`, `can_restart`, `ha_webhook_configured`, `category`, `pending_confirmation`, `recent_effects` (letzte 5), `subgoal`.
- `/status` bleibt unverändert; beide nutzen dieselben Hilfsfunktionen (`buildAuthStatus`, `buildRuntimeStatus`), damit die Werte nicht auseinanderlaufen.
- Erfolgreiche Abrufe erscheinen nicht im HTTP-Protokoll der Konsole, sonst stünde dort alle 5 s eine Zeile. Abgelehnte Abrufe erscheinen weiterhin.

## Verhalten Stufe 2: Server beenden und neu starten
- Zwei Knöpfe in der Karte „Server“, je mit Rückfrage, damit ein Fehlklick im Stream nichts auslöst. Die Rückfrage nennt, dass wartende Effekte und Raid-Begrüßungen verloren gehen (sie liegen nur im Arbeitsspeicher). Der Bestätigungsknopf ist die ersten 500 ms gesperrt (`CONFIRM_LOCK_MS`), damit ein Doppelklick nicht gleich bestätigt; ohne Antwort schließt sich die Rückfrage nach 15 s (`CONFIRM_MS`).
- `POST /api/admin/server/shutdown` und `POST /api/admin/server/restart`, Antwort `{ok:true, pid, at}`. Der Server schreibt `[Webkonsole] Server wird beendet …` bzw. `… neu gestartet …` in die Konsole, antwortet und endet nach `ADMIN_EXIT_DELAY_MS` (300 ms). Ein zweiter Auftrag in dieser Zeit: 409. Die Anfrage braucht `Origin` wie in „Zugriffsschutz“ (sonst 403) und `Content-Type: application/json` mit Inhalt (sonst 415).
- Beenden: Exit-Code 0. Das Fenster von `AuthServer.cmd` bleibt mit `pause` offen und zeigt die letzten Zeilen.
- Neustart: Exit-Code `SERVER_RESTART_EXIT_CODE` (75). `AuthServer.cmd` setzt `TWITCH_COMPANION_SUPERVISED=1` und startet bei diesem Code im selben Fenster neu; bei jedem anderen Code greift `pause`. `/api/admin/overview` meldet `can_restart`; ohne das Skript ist der Knopf ausgegraut mit Hinweis darunter, und der Endpoint antwortet 409, statt den Server nur zu beenden.
- Anzeige nach dem Beenden: „Server beendet um HH:MM (PID …)“, statt des allgemeinen „Server nicht erreichbar“. Antwortet nach 5 s noch dieselbe Prozess-ID: Warnung „Server läuft noch“. Antwortet eine andere Prozess-ID, zeigt die Kopfzeile das an.
- Anzeige nach dem Neustart: „Neustart läuft“, bis eine neue Prozess-ID antwortet; kommt binnen 30 s keine, Warnung mit Hinweis auf das Konsolenfenster.
- Akzeptanzkriterien: POST ohne eigene Herkunft, GET und Aufruf aus dem Netzwerk beenden den Server nicht (403 bzw. 404); der Exit-Code stimmt; die Schleife in `AuthServer.cmd` startet nur bei Code 75 neu.

## Zugriffsschutz (ADR 0018)
- `/TwitchCompanionAdmin` und `/api/admin/…`: nur lokal (`requireLocalRequest`).
- `/api/admin/…`: Ist `Origin` gesetzt, muss er `http://localhost:<PORT>` oder `http://127.0.0.1:<PORT>` sein, sonst 403. Gilt auch bei `CORS_ORIGINS=*`.
- Ab Stufe 2: ändernde Aktionen nur POST mit JSON und gesetzter eigener Herkunft.
- Die Seite ist nicht einbettbar: `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`.
- Texte nur per `textContent` einsetzen.
- Dateien kommen aus `path.join(__dirname, 'public', 'admin')`, verwiesen wird mit relativen Pfaden (`admin.js`; die Adresse ohne `/` am Ende leitet weiter, der Pfad steht so nur in `ADMIN_PAGE_PATH`), versteckte Dateien werden nicht ausgeliefert. `__dirname` statt Arbeitsverzeichnis, weil die Tests in einem eigenen Ordner laufen.
- Keine Tokens, Secrets, Webhook-Adressen oder privaten Netzwerkadressen in Antworten oder auf der Seite.

## Konstanten (oben in `server.js`)
`ADMIN_POLL_MS` wird der Seite über `/api/admin/overview` mitgegeben (`poll_ms`), damit der Wert nur an einer Stelle steht. `ADMIN_DIR`, `ADMIN_PAGE_PATH`, `ADMIN_OVERVIEW_PATH`, `ADMIN_RECENT_EFFECTS = 5`, `ADMIN_CSP`, `ADMIN_SHUTDOWN_PATH`, `ADMIN_RESTART_PATH`, `ADMIN_EXIT_DELAY_MS = 300`, `SERVER_RESTART_EXIT_CODE = 75`, `SERVER_SUPERVISED`.

## Nicht-Ziele Stufe 1
- Keine ändernden Aktionen, keine neuen POST-Endpoints.
- Keine Änderung an HA-Payload, Effekt-Queue, Konsolenbefehlen und Widget-Endpoints.
- Kein Zugriff vom Handy oder aus dem Heimnetz.
- Keine Auslieferung der OBS-Widgets (P3).
- Kein Live-Log, kein Live-Status des Streams.

## Akzeptanzkriterien Stufe 1
- `GET /TwitchCompanionAdmin` lokal liefert die Seite, die Übersicht zeigt die Werte des laufenden Servers.
- Dieselben Aufrufe aus dem Netzwerk oder mit fremdem Host: 403.
- `GET /api/admin/overview` mit `Origin: null`, `http://absolute` oder einer fremden Herkunft: 403, auch bei `CORS_ORIGINS=*`.
- Die Antwort enthält keinen Token und kein Secret.
- Dateien außerhalb von `public/admin` sind nicht abrufbar (z. B. `/TwitchCompanionAdmin/../.env`, `/TwitchCompanionAdmin/%2e%2e/tokens.json`).
- `/status` liefert weiterhin genau seine bisherigen Felder.
- Server gestoppt: Die Seite meldet „Server nicht erreichbar“ und erholt sich nach dem Neustart ohne Neuladen.
- Tests ohne echten Twitch-Chat und ohne Home Assistant (Attrappen, eigenes Arbeitsverzeichnis, AGENTS.md), neuer `test/admin-test.js` in `test/run-all.js`.

## Berührte Funktionen/Dateien
`server.js` (Middleware für Konsole, `GET /TwitchCompanionAdmin`, `GET /api/admin/overview`, Hilfsfunktion für die Statuswerte, Zeile in der Startanzeige), neu `public/admin/` (`index.html`, `admin.css`, `admin.js`), neu `test/admin-test.js`, `test/run-all.js`, Doku (ARCHITEKTUR, README, CHANGELOG, OFFEN).

## Status
Konzept vom Nutzer gebilligt (ADR 0018, 08.11.2026). Stufe 1 umgesetzt: Tests mit Attrappen (`test/admin-test.js`), Seite mit Attrappen im Browser geprüft (Anzeige, Server weg und zurück, schmale Breite). Vom Nutzer am echten Server mit echtem Twitch-Login gesehen (08.11.2026). Aufruf von einer fremden IP-Adresse ist nicht getestet (Test läuft über 127.0.0.1, geprüft wird der fremde Host-Header). Stufe 2 umgesetzt: Server-Endpoints mit Attrappen (`test/admin-test.js`, Szenarien `server-beenden` und `server-neustart`), die Schleife in `AuthServer.cmd` mit dem echten Skript und einem Ersatz für `server.js` (`test/authserver-test.js`), die Seite im Browser mit Attrappen (Rückfrage, echter Neustart des Prozesses über dieselbe Schleife, Beenden, Warnung „Server läuft noch“, „Neustart ausgeblieben“, schmale Breite). Vom Nutzer am echten Server getestet (08.11.2026). Gruppe „Optionale Module“ umgesetzt: Lichter im Test `test/admin-format-test.js`, Einklappen und Merken im Browser mit Attrappen. Stufen 3 bis 6 offen. [UNGEKLÄRT]: Inhalt des Reiters „Statistik“.
