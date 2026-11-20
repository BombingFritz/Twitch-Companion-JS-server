# Spec: Chat-Brücke für lokale Verbraucher

**Status:** Teil A und B vereinbart (Nutzer, 20.11.2026: Entscheidungen unten) und auf `main` (PR #82). Teil C und D vereinbart mit dem Auftrag des Nutzers vom 20.11.2026, umgesetzt im Branch `feature/abstimmung-und-raid-fuer-verbraucher`. Teil A setzt Issue #74 um, Teil B #79, Teil C #81, Teil D #80. ADR 0025.
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
- `poll_result` (Teil C) und `raid` (Teil D), siehe dort.
- Lebenszeichen als Kommentarzeile alle 30 s; `retry: 5000`.
- **Unbekannte Ereignisse ignorieren** (von Claude festgelegt, 20.11.2026): Neue Ereignisse kommen rückwärtskompatibel dazu, ohne neue Anmeldung. Ein Verbraucher wertet nur die Ereignisse aus, die er kennt.

**Welche Nachrichten weitergehen:**
- Nur Nachrichten aus dem eigenen Kanal. Nachrichten aus einem fremden Kanal im geteilten Chat gehen nicht weiter.
- Nachrichten des Broadcasters gehen weiter, zum Beispiel für Admin-Befehle im Spiel.
- Nachrichten des Bot-Kontos und der Bots aus `STATS_EXCLUDED_CHATTERS` gehen **nicht** weiter. Sonst antwortet sich ein Spiel selbst.
- Die eigenen Befehle des Servers gehen nicht weiter: erstes Wort `!bdu`, `!soldbuch`, `!privat` oder `!raidstats`.
- Je Nachricht höchstens einmal je Verbindung. Doppelt zugestellte EventSub-Nachrichten filtert der Server schon vorher (ADR 0009).
- Mehrere Verbindungen gleichzeitig sind möglich, jede mit eigener Anmeldung. Eine neue Anmeldung ist eine neue Verbindung; die alte schließt der Verbraucher.

**Log:** Verbinden und Trennen je eine Zeile mit `client`, ohne Nachrichtentext. Der Text kann personenbezogen sein.

**Webkonsole** (Wunsch aus dem ersten Test mit der Mod, 20.11.2026): Übersicht, Gruppe „Optionale Module“, Karte und Licht „Chat-Brücke“. Grün, sobald ein Verbraucher verbunden ist, mit `client` und Uhrzeit der Verbindung; sonst „keiner verbunden“ und nur nicht aktiv. Dafür liefert `/api/admin/overview` zusätzlich `chat_bridge: {clients: [{client, connectedAt}]}`.

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

## Teil C: Abstimmung im Auftrag eines Verbrauchers (#81)
Der Chat stimmt über Spielereignisse ab. Es sind echte Twitch-Abstimmungen: SpargelPoll zeigt sie, die Ergebniszeile kommt wie bisher vom Server (Spec `wetten-abstimmungen.md`, Schritt 3b).

**Vom Nutzer gewünscht (Auftrag 20.11.2026):** Ergebnis als Ereignis im vorhandenen Strom, Ablehnung mit Grund, wenn schon eine Abstimmung offen ist. Eine fremde Abstimmung bricht der Server nie ab.

**Von Claude festgelegt, nicht einzeln zur Wahl gestellt:**
- Adresse und Felder
- `reason`-Werte
- Ablehnen statt Kürzen
- Ergebnis nur an den startenden Verbraucher
- 5 s Mindestabstand zwischen Startversuchen
- Aufträge nur im Arbeitsspeicher

### Voraussetzung: Scope `channel:manage:polls`
- Neu in `SCOPES` (`.env.example`). Danach muss sich der Broadcaster **einmal neu anmelden** (`http://localhost:<PORT>/login`). Der Bot braucht nichts Neues.
- Ohne den Scope läuft alles wie bisher. Nur der Start antwortet mit `missing_scope`. Danach fragt der Server Twitch bis zur nächsten Anmeldung nicht mehr.
- Twitch erlaubt Abstimmungen nur für Partner und Affiliates; sonst kommt `not_eligible`.
- **Abwägung:** Der Broadcaster-Token geht über `/token` an lokale Widgets. Mit dem neuen Scope könnte ein abgegriffener Token auch Abstimmungen anlegen und beenden. Das ist geringer als die schon vorhandenen Rechte `user:write:chat` und `moderator:manage:shoutouts`. Weniger Rechte für Widgets bleibt ein Thema von #57.

### `POST /api/twitch/poll/start`
- Zugriff wie Teil A: nur lokal, ohne Token, keine fremde Herkunft. JSON höchstens 2 KB, `Content-Type: application/json`, sonst 415.
- **Body:** `{client, title, choices, durationS, channelPointsPerVote?}`
  - `client`: Name wie bei `/api/chat/stream?client=` (1–32 Zeichen `a-z0-9_-`). An die Verbindungen mit diesem Namen geht das Ergebnis.
  - `title`: 1–60 Zeichen.
  - `choices`: 2–5 Texte zu je 1–25 Zeichen.
  - `durationS`: ganze Sekunden, 15–1800.
  - `channelPointsPerVote`: optional, ganze Zahl 1–1.000.000. Damit kosten Zusatzstimmen so viele Kanalpunkte. Ohne Angabe oder `null` gibt es keine Kanalpunkte-Stimmen.
  - Text wird am Rand getrimmt, aber **nicht gekürzt**. Zu lang ist ein Fehler (400). Gezählt werden Zeichen, ein Emoji zählt einfach.
- **Antwort 200:** `{ok: true, pollId, startedAt, endsAt}`. Die Abstimmung läuft; `GET /api/twitch/poll/current` zeigt sie sofort.
- **Ablehnung:** `{ok: false, reason, error}`. Es wurde nichts gestartet.

| HTTP | `reason` | Bedeutung |
|---|---|---|
| 400 | `invalid` | Feld fehlt oder ist außerhalb der Grenzen; `error` nennt das Feld |
| 403 | `forbidden` | fremder Host oder fremde Herkunft |
| 403 | `missing_scope` | Dem Broadcaster-Token fehlt `channel:manage:polls` |
| 403 | `not_eligible` | Twitch erlaubt dem Kanal keine Abstimmung (kein Partner oder Affiliate) |
| 409 | `poll_active` | Es läuft schon eine Abstimmung, auch eine von Hand oder aus SpargelPoll. Zusätzlich `activePollId` und `endsAt`, wenn der Server sie kennt. Der Verbraucher versucht es später. |
| 429 | `too_fast` | Startversuch binnen 5 s nach dem letzten (`POLL_START_MIN_GAP_MS`); dazu `retryAfterMs` |
| 502 | `twitch_rejected` | Twitch lehnt die Anfrage ab, z. B. AutoMod bei einer Option oder Kanalpunkte im Kanal aus; `error` enthält die Meldung von Twitch |
| 502 | `twitch_error` | anderer Twitch- oder Netzwerkfehler |
| 503 | `not_logged_in` | Broadcaster nicht angemeldet |

- **Offene Abstimmung:** Kennt der Server eine laufende Abstimmung, lehnt er ab, ohne Twitch zu fragen. Ausnahme: Ihr Ende liegt schon in der Vergangenheit, dann entscheidet Twitch. Twitch lehnt eine zweite Abstimmung selbst ab (400). Das wird ebenfalls `poll_active`.
- **Log:** eine Zeile je Start mit `client`, Titel, Zahl der Optionen, Dauer und Kanalpunkten; je Ablehnung durch Twitch eine Warnung mit `reason`.

### Ereignis `poll_result`
- Geht einmal je gestarteter Abstimmung, sobald ihr Endstand vorliegt, an **alle Verbindungen des startenden `client`**, sonst an niemanden.
- `{pollId, title, status, choices: [{id, title, votes, channelPointsVotes}], totalVotes, winners: [{id, title, votes}], startedAt, endedAt, at}`
  - `status` wie bei Twitch:
    - `COMPLETED`: regulär zu Ende
    - `TERMINATED`: in der Twitch-Oberfläche vorzeitig beendet
    - `ARCHIVED`: entfernt
    - selten aus der Kontrolle: `MODERATED` oder `INVALID`
  - `votes` enthält die Kanalpunkte-Stimmen; `channelPointsVotes` nennt sie getrennt.
  - `winners`: alle Optionen mit der höchsten Stimmenzahl, bei Gleichstand mehrere. Ohne jede Stimme sind es alle Optionen; `totalVotes` ist dann 0.
  - `at`: Versand durch den Server (ISO).
- **Quelle:** derselbe Stand wie `GET /api/twitch/poll/current` (EventSub `channel.poll.*`, Kontrolle nach 5 min ohne Ereignis). Bleibt das Ende-Ereignis aus, kommt das Ergebnis spätestens mit der Kontrolle.
- **Ergebniszeile im Chat:** unverändert, wie bei jeder Abstimmung (Schalter `results poll`).
- **Nicht zustellbar:** Ist der Verbraucher am Ende nicht verbunden, läuft die Abstimmung zu Ende und das Ergebnis geht verloren. Das ist kein Fehler, nur eine Logzeile. Nach einem Neustart des Servers sind offene Aufträge vergessen; ein neues `hello` zeigt das. Aufträge ohne Endstand fallen nach 2 Stunden weg.

## Teil D: eingehende Raids (#80)
**Von Claude festgelegt, nicht einzeln zur Wahl gestellt:**
- Raid an alle verbundenen Verbraucher, ohne eigene Anmeldung, wie `privacy`
- `id` aus der EventSub-Nachricht
- `at` als Empfangszeit

Raidende Kanäle sind öffentlich (Nutzer: Raids sind ok).

### Ereignis `raid`
- `{id, at, fromId, fromLogin, fromName, viewers}`
  - `id`: `message_id` der EventSub-Benachrichtigung. Sie ist eindeutig je Raid und bei erneuter Zustellung gleich.
  - `at`: Empfang beim Server (ISO).
  - `fromId`, `fromLogin`, `fromName`: der raidende Kanal.
  - `viewers`: mitgebrachte Zuschauer.
- Kommt sofort beim Eingang von `channel.raid`, vor der Raid-Begrüßung, die womöglich in der Warteschlange wartet.
- **Genau einmal je Raid:** Doppelt zugestellte EventSub-Nachrichten filtert der Server vorher (ADR 0009).
- Ausgehende Raids melden nichts.
- Begrüßung, Shoutout und Statistik bleiben unverändert (Spec `raid-begruessung.md`).
- Ist kein Verbraucher verbunden, passiert nichts. Verpasste Raids werden nicht nachgeliefert.
- Rolle, Gruppe und Beitritt (`!joinraid` über Teil A, Zuschauer aus Teil B) regelt der Verbraucher.

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

**Teil C**
- Start mit 3 Optionen und 60 s: Twitch-Abstimmung läuft, SpargelPoll zeigt sie, die Antwort nennt die ID.
- Mit `channelPointsPerVote: 3000` kosten Zusatzstimmen 3000 Kanalpunkte; ohne Angabe gibt es keine Kanalpunkte-Stimmen.
- Nach dem Ende: genau ein `poll_result` an den startenden Verbraucher, andere bekommen keins. Die Ergebniszeile im Chat kommt wie bisher.
- Läuft schon eine Abstimmung, fehlt der Scope oder ist eine Angabe ungültig: sofortige Antwort mit `reason`, nichts gestartet.
- In der Twitch-Oberfläche abgebrochen: `poll_result` mit `TERMINATED`.
- Verbraucher nicht mehr verbunden: Die Abstimmung läuft zu Ende, das Ergebnis geht verloren, kein Fehler.

**Teil D**
- Eingehender Raid mit 12 Zuschauern: genau ein `raid` mit Name und Zahl an jeden verbundenen Verbraucher.
- Doppelt zugestellt: ein `raid`. Ausgehender Raid: keiner.
- Begrüßung und Statistik unverändert.

## Nicht-Ziele
- Keine Nachlieferung verpasster Nachrichten.
- Keine Flüstern.
- Keine Auswertung der Befehle im Server; die bleibt beim Verbraucher.
- Kein Schalter in der Webkonsole außer „Chat-Absender“. Die Version der Verbraucher folgt mit #70.
- Teil C: Abstimmungen beenden oder fremde abbrechen; Wetten starten (eigenes Issue, wenn es so weit ist); Ergebnis nachliefern.

## Berührte Funktionen/Dateien
`server.js`:
- Chat-Handler im EventSub-Block
- neu `chatBridgeClients`, `forwardChatToBridge`, `notifyPrivacyChange`
- `/api/chat/stream`, `/api/chat/send`, `/api/chat/active`, `/api/twitch/channel`
- `CHAT_FEATURES`
- `handlePrivacyCommand`, `setCurrentCategory`

`lib/chat-bridge.js` (Filter und Anmeldung, testbar ohne Server).

Teil C:
- `lib/consumer-polls.js`: Prüfung, Helix-Body, Einordnung der Twitch-Fehler, `poll_result`, offene Aufträge
- `lib/live-state.js`: `applyHelix` für die Antwort von „Create Poll“
- `server.js`: `POST /api/twitch/poll/start`, `deliverConsumerPollResult` im `onChange` des `pollTracker`, Rücksetzen von `consumerPollScopeMissing` in `/callback`

Teil D: `chatBridge.raidEvent` und `notifyRaidToBridge` im `channel.raid`-Zweig.

Tests:
- `test/chat-bridge-test.js`, `test/consumer-polls-test.js`
- Szenarien `chat-bruecke` (B21, B22 für Teil D) und `abstimmung-start` (P1–P15) von `test/admin-test.js`
