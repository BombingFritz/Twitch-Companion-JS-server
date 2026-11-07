# Spec: BdU-Chat (`!BdU`)

## Ziel
Zuschauer schicken dem KI-BdU im Chat einen Funkspruch und erhalten „FT vom BdU: …“ als Antwort. Die Antwort erzeugt das Enigma-Widget (Repository `BombingFritz/Uboat-Widget`, `docs/specs/chat-modus.md`); der Server erkennt, begrenzt und postet. Entscheidung: ADR 0014.

## Verhalten
### Erkennung
- `channel.chat.message`, Text beginnt mit `!bdu` (Groß-/Kleinschreibung egal) gefolgt von Leerzeichen und Text. Eigene Funktion `handleBduCommand(evt)`, Aufruf neben `handleChatCommand`.
- Text nach dem Befehl trimmen und auf `BDU_MAX_INPUT_CHARS` (200) kürzen. Leerer Text: ignorieren, nichts zählen.
- Nachrichten aus fremdem Shared-Chat-Kanal ignorieren (`source_broadcaster_user_id`, wie in `handleChatNotification`).

### Prüfreihenfolge (erste zutreffende Regel gilt)
0. **Modul deaktiviert** (Konsole `bdu deactivate`, gespeichert in `modules.json`, Nutzer 07.11.2026): ignorieren, nichts zählen, keine Ausgabe im Chat; Konsolenzeile „ignoriert – BdU-Chat deaktiviert“.
1. **Kein Widget verbunden** (keine offene Events-Verbindung): ignorieren. Nichts zählen, keine Warnung.
2. **Funkstille aktiv:** ignorieren, keine Ausgabe.
3. **Tagesobergrenze erreicht** (`BDU_DAILY_LIMIT` = 60 je Kalendertag in Ortszeit des Servers, 0 = aus): ignorieren. Bei einem Stream über Mitternacht beginnt der Zähler um 0:00 neu; das ist so gewollt (Nutzer, 04.11.2026).
4. **Globales Limit:** Seit der letzten angenommenen Anfrage sind weniger als `BDU_GLOBAL_COOLDOWN_MS` (3 min) vergangen → Verstoß.
5. **Nutzerlimit:** Der Nutzer (`chatter_user_id`) hat in den letzten `BDU_USER_WINDOW_MS` (30 min) schon `BDU_USER_MAX` (3) angenommene Anfragen → Verstoß.
6. Sonst: **annehmen.** Zeitpunkt für globales und Nutzerlimit speichern (auch wenn die KI später scheitert), Anfrage `{id, text}` mit neuer `id` per Events an das Widget, Zuordnung `id → message_id` merken.

### Verstoß gegen ein Limit
- Liegt die letzte Warnung mindestens `BDU_WARNING_COOLDOWN_MS` (10 min) zurück: als Antwort auf die Chat-Nachricht „Funkverkehr einschränken, Feind peilt ein!“ posten.
- Sonst: keine Ausgabe.
- Keine Ausnahmen für Broadcaster oder Mods.

### Antwort des Widgets (`POST /api/bdu/answer`, JSON)
- `{id, status: "ok", text}`: Bekannte, noch offene `id` → Text, auf 500 Zeichen gekürzt (Twitch-Limit), per `POST /helix/chat/messages` mit `reply_parent_message_id` posten. Seit ADR 0017 über den Bot „DerBdu“, wenn eingerichtet (gilt auch für Warnung und Funkstille-Ansage), dann ohne Präfix (Nutzer, 07.11.2026: der Absender zeigt schon, wer spricht). Sendet der Broadcaster (kein Bot oder Rückfall), steht „FT vom BdU: “ davor; die Kürzung zählt das Präfix mit. Unbekannte oder abgelaufene `id`: verwerfen, loggen.
- `{id, status: "quota", error}`: **Funkstille** starten (siehe unten), nichts zur Anfrage posten. Antwort an das Widget: `{ok: true, silenceUntil}` (Zeitstempel in ms; beim Tageskontingent `null`).
- `{id, status: "error"}`: nichts posten, loggen.
- Kommt binnen `BDU_ANSWER_TIMEOUT_MS` (120 s; das Widget hält Anfragen bis zu 60 s für den Kaleu zurück) keine Antwort: Anfrage verwerfen, loggen.

### Funkstille (betrifft nur den Chat)
- Auslöser: `status: "quota"` vom Widget.
- Dauer: 30 min (`BDU_SILENCE_MS`). Deutet der Fehlertext auf das Tageskontingent hin (z. B. „per day“), bis zum nächsten `stream.online` bzw. Neustart. Erkennung über den Fehlertext („per day“, „perday“, „daily“, „täglich“, Groß-/Kleinschreibung egal).
- Beim Start einmal posten: „BdU befiehlt Funkstille bis HH:MM Uhr – Meldungen werden nicht beantwortet.“ (Ortszeit des Servers; beim Tageskontingent „bis auf Weiteres“).
- Erneuter Auslöser direkt nach Ablauf: Funkstille verlängern, ohne neue Ansage.

### Server-Sent Events (`GET /api/bdu/stream`)
- Nur Loopback (Muster `/token`, ADR 0013), Herkunftsprüfung wie bei allen Browser-Anfragen.
- Ereignis `request` mit `{id, text}`; Kommentarzeile alle 30 s gegen Verbindungsabbruch.
- Mehrere Verbindungen: Anfrage nur an die zuletzt verbundene.

### Konstanten (oben in `server.js`)
`BDU_MAX_INPUT_CHARS = 200`, `BDU_GLOBAL_COOLDOWN_MS = 3 min`, `BDU_USER_WINDOW_MS = 30 min`, `BDU_USER_MAX = 3`, `BDU_WARNING_COOLDOWN_MS = 10 min`, `BDU_ANSWER_TIMEOUT_MS = 120 s`, `BDU_SILENCE_MS = 30 min`, `BDU_REPLY_PREFIX = 'FT vom BdU: '` (nur beim Versand als Broadcaster), Texte für Warnung und Funkstille.

### Zustand (RAM, ADR 0002)
Letzte angenommene Anfrage, angenommene Zeitpunkte je Nutzer, letzte Warnung, Funkstille bis, offene Anfragen `id → {message_id, angenommen}`, verbundene Events-Clients.

### Status und Konsole
- `/status`: `bdu_widget_connected`, `bdu_silence_until`, `modules.bdu`.
- Konsole: `bdu show` (Schalter, Limits, Funkstille, offene Anfrage), `bdu silence off` (Funkstille beenden), `bdu activate` / `bdu deactivate` (Modul ein- bzw. ausschalten, bleibt nach Neustart; beim Deaktivieren werden offene Anfragen verworfen, eine späte Antwort des Widgets bekommt 404 und wird nicht gepostet; die Widget-Verbindung bleibt bestehen).

## Nicht-Ziele
- KI-Aufruf, Prompt oder Funkverlauf im Server.
- Absendernamen in der Antwort; Ausnahmen von den Limits.
- Persistenz der Limits über Neustarts.
- Home-Assistant-Effekte für BdU-Funksprüche (später über `scheduleEffect` denkbar).

## Akzeptanzkriterien
- `!BdU Feindkontakt` mit verbundenem Widget: genau eine Events-Nachricht; nach Antwort genau eine Chat-Nachricht als Reply (von DerBdu ohne Präfix, ohne Bot „FT vom BdU: …“ vom Broadcaster).
- Ohne verbundenes Widget: keine Ausgabe, und die nächste Anfrage nach dem Verbinden wird angenommen.
- Zweite Anfrage (anderer Nutzer) nach 2 min: keine Weiterleitung; Warnung, wenn seit 10 min keine Warnung kam.
- Vierte angenommene Anfrage eines Nutzers binnen 30 min: Verstoß.
- Zwei Verstöße binnen 10 min: höchstens eine Warnung.
- `status: "quota"`: eine Funkstille-Ansage; danach 30 min keine Weiterleitung und keine Warnungen.
- Antwort nach 120 s oder mit unbekannter `id`: kein Chat-Post.
- Text über 200 Zeichen kommt gekürzt beim Widget an; Antwort über 500 Zeichen wird gekürzt gepostet.
- Aufruf von `/api/bdu/stream` oder `/api/bdu/answer` aus dem Netzwerk: 403.
- Tests ohne echten Twitch-Chat (Attrappen, eigenes Arbeitsverzeichnis, AGENTS.md).

## Berührte Funktionen/Dateien
`server.js`: neue Konstanten, `handleBduCommand`, Helfer für Limits/Funkstille/Chat-Post, `GET /api/bdu/stream`, `POST /api/bdu/answer`, `express.json()`, Aufruf in `channel.chat.message`, `stream.online` (Funkstille Tageskontingent beenden), `/status`, Konsolenbefehle.

## Status
umgesetzt, zusammen mit Enigma-Widget 1.2.0. Test mit Attrappen (EventSub per lokalem WebSocket, Helix-Aufrufe protokolliert, steuerbare Uhr, eigenes Arbeitsverzeichnis): 35/35 Akzeptanzprüfungen; Ende-zu-Ende mit dem Widget im Headless-Chromium: 18/18. Mit echtem Twitch und im Livestream erprobt (03.11.2026, siehe OFFEN.md); seit 07.11.2026 auch über DerBdu (ADR 0017). Limits, Warnung und Funkstille unter Last noch nicht erreicht. Offene Feldfrage: `source_broadcaster_user_id` für Shared Chat ist wie bei `handleChatNotification` nicht gegen reale Events belegt [UNGEKLÄRT].
