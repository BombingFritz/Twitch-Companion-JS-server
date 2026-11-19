# Spec: Chat-Brücke für lokale Verbraucher

**Status:** vereinbart für Teil A und B (Nutzer, 20.11.2026: Entscheidungen unten), beide umgesetzt im Branch `feature/chat-bruecke`. Teil A setzt Issue #74 um, Teil B Issue #79. ADR 0025.
Erste Verbraucher: RimWorld-Mod (`BombingFritz/TwitchCompanion_RimWorld`, Stufe 1, dort Spec `docs/specs/mod.md`) und CoinFlip (`BombingFritz/CoinFlip`, Glücksrad geplant).

## Ziel
Lokale Verbraucher (OBS-Widgets, Programme wie die RimWorld-Mod) bekommen Chat-Befehle vom Server und schreiben über den Server in den Chat. Sie brauchen dafür keine eigene EventSub-Verbindung und keinen Token. Grundsatz ADR 0023: Nur der Server spricht mit Twitch.

## Entscheidungen des Nutzers (20.11.2026)
- Befehle, die der Server selbst beantwortet (`!bdu`, `!soldbuch`, `!privat`, `!raidstats`), gehen **nicht** an Verbraucher.
- Nachrichten von Zuschauern mit `!privat` gehen **mit Kennzeichen** `private: true` an Verbraucher. Dazu gibt es ein Ereignis, sobald jemand `!privat` ein- oder ausschaltet.
- Chat-Funktion `rimworld` unter „Chat-Absender“, **Vorgabe Bot**. `coinflip` mit Vorgabe Broadcaster, wie bisher bei CoinFlip.

Von Claude festgelegt, nicht einzeln zur Wahl gestellt:
- Adressen und Feldnamen
- Präfix- und Wortanmeldung über Abfrageparameter
- Mindestabstand beim Senden von 1 s je Funktion
- Fenster von 60 Minuten für aktive Chatter, Obergrenze 2000 Einträge
- nichts davon in eine Datei

## Zugriff (beide Teile)
- Nur lokal: Aufruf über `127.0.0.1`/`::1` und Host `localhost` bzw. `127.0.0.1`, wie `/api/bdu/stream`. Sonst 403.
- Herkunft wie bei den übrigen Widget-Endpunkten (ADR 0013):
  - Programme ohne `Origin` sind erlaubt.
  - Browser-Widgets mit `null` oder einer eingetragenen Herkunft ebenso.
  - Eine fremde Herkunft bekommt 403.
- Kein Token nötig.

## Teil A: Chat-Befehle empfangen und senden (#74)

### `GET /api/chat/stream` (Server-Sent Events)
**Abfrageparameter:**
- `client`: Name des Verbrauchers für Log und Webkonsole, z. B. `rimworld` oder `coinflip`. 1–32 Zeichen `a-z0-9_-`. Pflicht.
- `commands`: kommagetrennte Wörter, z. B. `flip,!flip`.
  - Eine Nachricht passt, wenn ihr erstes Wort (bis zum ersten Leerzeichen, Groß- und Kleinschreibung egal) einem Wort gleicht.
  - Höchstens 100 Wörter, je 1–32 Zeichen.
- `prefixes`: kommagetrennte Präfixe, z. B. `!,$`.
  - Eine Nachricht passt, wenn sie (nach führenden Leerzeichen) damit beginnt.
  - Höchstens 5, je 1–3 Zeichen.
  - Ein Komma als Präfix ist nicht möglich.
- Mindestens `commands` oder `prefixes`, sonst 400 `{error}`. Bei ungültigen Werten ebenfalls 400.

**Ereignisse:**
- `hello`, sofort nach dem Verbinden: `{server: 'twitch-companion-js-server', version, client, commands, prefixes, botLogin}`
  - `commands` in Kleinbuchstaben. `botLogin` ist der Bot oder `null`.
  - Kommt `hello` erneut (nach Wiederverbindung), hat der Server womöglich neu gestartet. Verpasstes wird nicht nachgeliefert.
- `chat`, je passender Nachricht: `{messageId, userId, userLogin, userName, text, at, badges: {broadcaster, moderator, vip, subscriber}, private}`
  - `at` ist der Empfang beim Server (ISO).
  - Die Abzeichen kommen aus den Abzeichen der Nachricht: `broadcaster`, `moderator`, `vip`, `subscriber` (auch `founder` zählt als Subscriber).
  - `private` ist `true` für Zuschauer auf der `!privat`-Liste.
- `privacy`, wenn jemand `!privat` ein- oder ausschaltet: `{userId, userLogin, private, at}`. Geht an alle verbundenen Verbraucher, unabhängig von ihren Befehlen.
- Lebenszeichen als Kommentarzeile alle 30 s; `retry: 5000`.

**Welche Nachrichten weitergehen:**
- Nur Nachrichten aus dem eigenen Kanal. Nachrichten aus einem fremden Kanal im geteilten Chat gehen nicht weiter.
- Nachrichten des Broadcasters gehen weiter, zum Beispiel für Admin-Befehle im Spiel.
- Nachrichten des Bot-Kontos und der Bots aus `STATS_EXCLUDED_CHATTERS` gehen **nicht** weiter. Sonst antwortet sich ein Spiel selbst.
- Die eigenen Befehle des Servers gehen nicht weiter: erstes Wort `!bdu`, `!soldbuch`, `!privat` oder `!raidstats`.
- Je Nachricht höchstens einmal je Verbindung. Doppelt zugestellte EventSub-Nachrichten filtert der Server schon vorher (ADR 0009).
- Mehrere Verbindungen gleichzeitig sind möglich, jede mit eigener Anmeldung. Eine neue Anmeldung ist eine neue Verbindung; die alte schließt der Verbraucher.

**Log:** Verbinden und Trennen je eine Zeile mit `client`, ohne Nachrichtentext. Der Text kann personenbezogen sein.

### `POST /api/chat/send`
- JSON `{feature, message}`, höchstens 2 KB; `Content-Type: application/json`, sonst 415.
- `feature`: eine Chat-Funktion der Brücke, `rimworld` oder `coinflip`. Sonst 400.
  - Der Absender richtet sich nach „Chat-Absender“ (Spec `bot-account.md`): `rimworld` hat die Vorgabe Bot, `coinflip` die Vorgabe Broadcaster.
  - Rückfall auf den Broadcaster bei HTTP-Fehler des Bots, wie dort beschrieben.
- `message`: Text, 1–500 Zeichen nach dem Kürzen von Leerzeichen am Rand. Leer: 400. Länger: wird auf 500 gekürzt, wie jede Chat-Nachricht des Servers.
- **Mindestabstand** je Funktion 1 s (`CHAT_BRIDGE_MIN_GAP_MS`). Zu früh: 429 `{ok: false, sent: false, error, retryAfterMs}`, nichts gesendet. Die Drosselung aller Twitch-Anfragen (ADR 0024) gilt zusätzlich.
- **Antwort 200:** `{ok: true, sent, sender}`.
  - `sent`: hat Twitch die Nachricht angenommen (`is_sent`)?
  - `sender`: `bot` oder `broadcaster`, wie eingestellt. Der Rückfall wird nicht gemeldet.
  - Bei `sent: false` steht der Grund im Serverprotokoll.
- Ohne Anmeldung des Broadcasters (`tokens.json` fehlt): 503 `{ok: false, sent: false, error}`.

## Teil B: aktive Chatter und Kategorie (#79)

### `GET /api/chat/active`
- `{updatedAt, windowMinutes: 60, chatters: [{id, login, name, lastChatAt, moderator, vip, subscriber}]}`, nach `lastChatAt` absteigend.
- `updatedAt` ist der Zeitpunkt der letzten erfassten Nachricht, ohne Nachricht `null`.
- **Wer zählt:** Wer im eigenen Kanal geschrieben hat, egal was, also auch ohne Befehl, in den letzten 60 Minuten.
- **Ohne:**
  - den Broadcaster,
  - das Bot-Konto und die Bots aus `STATS_EXCLUDED_CHATTERS`,
  - Nachrichten aus fremdem geteiltem Chat,
  - Zuschauer mit `!privat`. Wer `!privat` einschaltet, fällt sofort heraus.
  - Lurker fehlen, das ist gewollt.
- **Abzeichen:** Stand der letzten Nachricht.
- **Speicherung:** nur im Arbeitsspeicher, höchstens 2000 Einträge; darüber fällt der am längsten stille heraus. Nach einem Serverstart ist die Liste leer.
- Die Liste wird geführt, solange der Server läuft, unabhängig davon, ob ein Stream erfasst wird.

### `GET /api/twitch/channel`
- `{category, categoryChangedAt, live, updatedAt}`
  - `category`: aktuelle Twitch-Kategorie, `null` wenn unbekannt.
  - `categoryChangedAt`: wann sich die Kategorie zuletzt geändert hat (ISO), `null` wenn unbekannt.
  - `live`: ob ein Stream gerade erfasst wird und live ist.
  - `updatedAt`: wann der Server die Kategorie zuletzt bestätigt hat (Abruf beim Verbinden oder `channel.update`).
- Die Kategorie kommt aus `channel.update` und dem Abruf beim Verbindungsaufbau (`refreshChannelCategory`). Der Endpunkt fragt Twitch nicht (ADR 0023).
- Ob gerade RimWorld läuft, prüft der Verbraucher selbst anhand von `category`.

## Akzeptanzkriterien
**Teil A**
- Mit `prefixes=$` kommen `$beer` und `$beer 5` an, „hallo“ nicht.
- Mit `commands=!bal` kommt `!BAL` an, `!balance` nicht.
- Eigene Befehle des Servers kommen nicht an.
- Broadcaster-Nachrichten kommen an, Bot-Nachrichten nicht, fremder geteilter Chat nicht.
- Zuschauer mit `!privat`: `private: true`. Beim Umschalten kommt `privacy` an alle.
- Zwei Verbindungen mit verschiedenen Befehlen bekommen jeweils nur ihre.
- Senden mit `rimworld` geht über den eingestellten Absender. Zu früh gibt 429, unbekannte Funktion 400, fremde Herkunft 403.
- Trennen und Wiederverbinden: neues `hello`.

**Teil B**
- Zwei Zuschauer schreiben: Beide stehen mit Zeitpunkt und Abzeichen in der Liste.
- Nach 61 Minuten Stille fehlt einer.
- Broadcaster, Bot, `nightbot` und `!privat`-Zuschauer fehlen.
- Nach `channel.update` liefert `/api/twitch/channel` die neue Kategorie mit Zeitpunkt.

## Nicht-Ziele
- Keine Nachlieferung verpasster Nachrichten.
- Keine Flüstern.
- Keine Auswertung der Befehle im Server; die bleibt beim Verbraucher.
- Kein Schalter in der Webkonsole außer „Chat-Absender“. Name und Version der Verbraucher in der Webkonsole folgen mit #70.

## Berührte Funktionen/Dateien
`server.js`:
- Chat-Handler im EventSub-Block
- neu `chatBridgeClients`, `forwardChatToBridge`, `notifyPrivacyChange`
- `/api/chat/stream`, `/api/chat/send`, `/api/chat/active`, `/api/twitch/channel`
- `CHAT_FEATURES`
- `handlePrivacyCommand`, `setCurrentCategory`

`lib/chat-bridge.js` (Filter und Anmeldung, testbar ohne Server).

Tests in `test/chat-bridge-test.js` und im Szenario `chat-bruecke` von `test/admin-test.js`.
