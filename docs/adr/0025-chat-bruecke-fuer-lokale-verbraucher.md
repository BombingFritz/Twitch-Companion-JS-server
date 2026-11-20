# ADR 0025: Chat-Brücke für lokale Verbraucher

**Status:** Akzeptiert (20.11.2026). Setzt Issue #74 um, Teil B Issue #79; folgt ADR 0023.

**Vom Nutzer entschieden (20.11.2026):**
- Die eigenen Befehle des Servers (`!bdu`, `!soldbuch`, `!privat`, `!raidstats`) gehen nicht an Verbraucher.
- Zuschauer mit `!privat` kommen mit Kennzeichen an, dazu ein Ereignis beim Umschalten.
- Die Chat-Funktion `rimworld` sendet in der Vorgabe über den Bot.
- Die RimWorld-Mod entsteht in ihrem eigenen Repository.

**Von Claude festgelegt, nicht einzeln zur Wahl gestellt:**
- Server-Sent Events statt WebSocket, wie `/api/bdu/stream` und `/api/topics/stream`
- Anmeldung über Abfrageparameter (`client`, `commands`, `prefixes`)
- Senden über `POST /api/chat/send` mit fester Liste von Chat-Funktionen
- Mindestabstand von 1 s je Funktion
- Logik in `lib/chat-bridge.js`
- nichts in eine Datei

**Kontext:** CoinFlip öffnete eine eigene EventSub-Verbindung und sendete selbst als Broadcaster (#74). Die RimWorld-Mod (über RICS) hätte dasselbe gebraucht. Beides läuft an Drosselung (ADR 0024), `!privat` (ADR 0022) und „Chat-Absender“ vorbei und verbraucht ein zweites EventSub-Kontingent. Für den BdU-Chat (ADR 0014) gab es schon einen Strom, aber nur für `!BdU` und ein Widget.

**Entscheidung:**
- **Ein allgemeiner Ereignisstrom `GET /api/chat/stream`**, nur lokal und ohne Token.
  - Verbraucher melden Wörter (`commands`, erstes Wort) oder Präfixe (`prefixes`) an und bekommen nur passende Nachrichten aus dem eigenen Kanal, mit Abzeichen und `private`.
  - Bot-Nachrichten, fremder geteilter Chat und die eigenen Befehle des Servers gehen nicht weiter.
  - `privacy` meldet das Umschalten von `!privat`.
- **Senden über `POST /api/chat/send`** mit einer Chat-Funktion aus `CHAT_BRIDGE_FEATURES` (`rimworld`, `coinflip`). Der Absender kommt aus „Chat-Absender“ (ADR 0017, Nachtrag), die Drosselung gilt wie für alles.
- **Aktive Chatter und Kategorie** (#79) als Leseendpunkte nach ADR 0023, nur im Arbeitsspeicher.
- Spec: `docs/specs/chat-bruecke.md`.

**Verworfene Alternativen:**
- **Token an Verbraucher, die selbst EventSub öffnen:** widerspricht ADR 0023 und braucht ein zweites Kontingent.
- **Alle Chat-Nachrichten an alle Verbraucher:** mehr Daten als nötig. Zwar ist der Chat öffentlich, die Verbraucher speichern aber teils über den Stream hinaus (RICS).
- **WebSocket:** mehr Aufwand ohne Gewinn, da Verbraucher nur empfangen und über HTTP senden.
- **Befehle im Server auswerten:** Die Spiel- und Widgetlogik gehört zu den Verbrauchern (AGENTS.md).

**Konsequenzen:**
- Neue Verbraucher mit Chat-Befehlen brauchen nur eine Anmeldung. Eine neue Chat-Funktion zum Senden kommt in `CHAT_BRIDGE_FEATURES` und `CHAT_FEATURES`.
- Der Server sieht, welcher `client` verbunden ist (Log). Name und Version in der Webkonsole folgen mit #70.
- Verpasste Nachrichten werden nicht nachgeliefert. Ein neues `hello` zeigt dem Verbraucher den Neustart.
- Ein Verbraucher, der `!` als Präfix anmeldet, bekommt alle übrigen Befehle; Überschneidungen mit künftigen Server-Befehlen kommen in `SERVER_CHAT_COMMANDS`.

## Nachtrag 20.11.2026: Abstimmung starten und Raid melden (#81, #80)
**Auftrag des Nutzers:** Ergebnis und Raid als Ereignis im vorhandenen Strom; Ablehnung mit Grund, wenn schon eine Abstimmung offen ist.

**Entscheidung:**
- Der Strom trägt neben Chat auch Ereignisse des Kanals: `raid` an alle, `poll_result` nur an den startenden Verbraucher. Verbraucher ignorieren Ereignisse, die sie nicht kennen; neue kommen ohne neue Anmeldung dazu.
- Verbraucher dürfen über den Server eine Twitch-Abstimmung anlegen (`POST /api/twitch/poll/start`). Damit spricht weiter nur der Server mit Twitch (ADR 0023), mit Drosselung (ADR 0024). Der Server bricht nie eine laufende Abstimmung ab.
- Dafür braucht der Broadcaster-Token `channel:manage:polls` und eine neue Anmeldung.

Von Claude festgelegt, nicht einzeln zur Wahl gestellt: Adresse, Felder, `reason`-Werte, Ablehnen statt Kürzen, 5 s zwischen Startversuchen, Aufträge nur im Arbeitsspeicher. Spec `chat-bruecke.md`, Teil C und D.

**Verworfen:**
- **Ergebnis an alle Verbraucher:** Nur der Starter kann es zuordnen.
- **Eigene Anmeldung für `raid`:** Ohne Daten, die über den Raid hinausgehen, ist sie unnötiger Aufwand; der Raid ist öffentlich.
- **Verbraucher legen die Abstimmung selbst an:** Das bräuchte den Token beim Verbraucher (ADR 0023).

**Konsequenz:** Ein abgegriffener Broadcaster-Token (`/token` für Widgets) könnte nun auch Abstimmungen anlegen. Das wiegt weniger als die schon vorhandenen Rechte zum Schreiben im Chat und für Shoutouts; die Frage nach weniger Rechten für Widgets bleibt bei #57.
