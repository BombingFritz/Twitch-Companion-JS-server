# Spec: Statistik

**Status:** Ziele des Nutzers vom 09.11.2026, noch nicht vollständig. Grundgerüst und Reihenfolge sind abgestimmt (ADR 0019). Umsetzung in Stufen, siehe unten.

## Ziel
Der Reiter „Statistik“ der Webkonsole (Stufe 6, ADR 0018) trennt drei Bereiche. Zugleich entsteht eine Infrastruktur, aus der sich später ein Endscreen bauen lässt.

### 1. Aktuelle Server-Instanz
Was seit dem Einschalten des Servers passiert ist: Fehler, Effekte, Follows, Subs, Chatnachrichten, Laufzeit, API-Anfragen.

### 2. Laufender oder letzter Stream
Beginnt mit dem Streambeginn und endet mit dem Streamende. Die Werte bleiben danach stehen und springen erst mit dem nächsten Streambeginn auf 0.

Startzeit, Follows, Subs, Raids, Gifts, Hype Trains, Anzahl der Kandidaten für Clips (Enigma-Antworten, Hype Trains, Alarm-Taste, Stream-Deck-Marker, siehe `stream-bericht.md`), Botnachrichten, Anzahl wiederkehrender Chatter, Anzahl erster Chatter, Anzahl Shoutouts, Anzahl Abstimmungen, Anzahl Wetten, Menge der eingesetzten Kanalpunkte, Menge der abgegebenen Stimmen, Chatnachrichten insgesamt.

### 3. Global
Setzt sich aus den Berichten der einzelnen Streams zusammen und addiert sie auf.

### 2b. Endscreen (später)
Ein Widget, das zum Ende des Streams eingeblendet wird und die wichtigsten Zahlen des heutigen Streams zeigt, die Zuschauer interessieren könnten: wie sehr interagiert und unterstützt wurde, wann der Stream losging, wie lange er dauerte, wer am meisten interagiert hat, mit monetärem Support oder mit Chat- und Poll-Interaktion. Widgets erhalten nie Client-Secrets (AGENTS.md).

Der Endscreen wird schon gezeigt, bevor der Stream ganz zu Ende ist, er liest also die laufenden Werte. Er hat eine eigene, in OBS einbindbare Adresse und holt die Zahlen beim Server; auf die Daten der Webkonsole im Browser hat er keinen Zugriff. Später vorgemerkt: Aktualisieren im Sekundentakt, solange er in OBS sichtbar ist.

Für später gemerkt, nicht für den Anfang: eine kurze Textzusammenfassung.

## Vorgehen (Nutzer, 09.11.2026)
1. Zuerst das Grundgerüst überlegen: stabil, ausbaufähig, einfach zu untersuchen, zu ergänzen und wieder zu beschneiden.
2. Danach die Punkte einteilen: schnell und einfach umzusetzen, zu testen und zu untersuchen; mehr Arbeit, aber wenig Probleme; kompliziert oder heikel, kann Fehler auslösen oder anderes behindern.
3. Gemeinsam abwägen, dann umsetzen.

## Bezug zu anderen Vorhaben
- **Stream-Bericht und Streamlog** (`stream-bericht.md`, OFFEN.md) brauchen denselben Ablauf von Streambeginn und Streamende, einschließlich der 2-Stunden-Regel, des Knopfs „Streamlog beenden“ und des Abschluss-Raids. Das soll nur einmal gebaut werden.
- **Raid-Statistik** (`raids.json`, `!raidstats`, ADR 0012) bleibt eigenständig.

## Geprüfte Twitch-Angaben (Twitch-Doku, 09.11.2026)
| Ereignis | Version | Scope | Für die Statistik |
|---|---|---|---|
| `stream.online`, `stream.offline` | 1 | keiner | Beginn und Ende |
| `channel.poll.begin/progress/end` | 1 | `channel:read:polls` | `choices[].votes`, `bits_votes`, `channel_points_votes` |
| `channel.prediction.begin/progress/lock/end` | 1 | `channel:read:predictions` | `outcomes[].users`, `outcomes[].channel_points` |
| `channel.shoutout.create`, `.receive` | 1 | `moderator:read:shoutouts` | Shoutouts |
| `channel.hype_train.begin/progress/end` | 2 | `channel:read:hype_train` | `level`, `total` |
| `channel.cheer` | 1 | `bits:read` | `bits` |
| `channel.channel_points_custom_reward_redemption.add` | 1 | `channel:read:redemptions` | eingelöste Belohnungen |

- `.env.example` enthält `channel:read:polls`, `channel:read:predictions` und `moderator:read:shoutouts`, nicht aber `channel:read:hype_train`, `bits:read` und `channel:read:redemptions`.
- `channel.chat.message` liefert kein Feld für eine erste Nachricht oder einen wiederkehrenden Chatter. IRC kannte `first-msg` und `returning-chatter`. Über EventSub muss der Server das selbst ermitteln.

## Festlegungen des Nutzers (09.11.2026)
- **API-Anfragen und erste oder wiederkehrende Chatter:** zurückgestellt. Gemini ruft das Enigma-Widget direkt auf, davon sieht der Server nichts; erste und wiederkehrende Chatter gäbe es nur über eine zusätzliche IRC-Verbindung.
- **Abstimmungen und Stimmen:** Twitch-Polls (auch das eigene Poll-Widget läuft darüber) und die noch zu bauende Spielbewertung per Kanalpunkte-Belohnungen (`stream-bericht.md`). Die Belohnungen legt der Nutzer noch an.
- **Kanalpunkte und monetärer Support:** jeweils alles zusammen, also auch eingelöste Belohnungen und Bits.
- **Ausnahmen:** Broadcaster und Bots zählen nicht bei Chatnachrichten und in Ranglisten. Vorbelegt sind Nightbot, StreamElements und DerBdu; das Feld „Genutzte Chat-Bots“ wird im Reiter „Whitelist“ bearbeitbar.
- **Alarm und Marker:** per zusätzlicher Aktion in der Stream-Deck-Multi-Aktion direkt an den Server, auch für Nutzer ohne Home Assistant.

## Verhalten Stufe 1
- `lib/stats.js`: `createStats({metrics, enabled, now, warn})` liefert `count(key, menge = 1)` und `snapshot()`. Die Kennzahlen stehen in `METRICS` (Schlüssel, Bezeichnung, Bereiche). `count` wirft nie; ein unbekannter Schlüssel wird einmal gewarnt und nicht gezählt. `STATS_ENABLED` in `server.js` schaltet alles ab.
- Bereich Server-Instanz, nur im Arbeitsspeicher, beginnt mit dem Prozess: Laufzeit, Fehler (`console.error`), ausgelöste Effekte (einer je ausgeführtem Job), Follows, Subs, verschenkte Subs, Chatnachrichten.
- Gezählt wird nach der Entdoppelung. Gift-Empfänger zählen nicht als Sub, ein Gift-Bomb zählt mit der Anzahl der Subs. Chatnachrichten ohne Broadcaster, `STATS_EXCLUDED_CHATTERS` und Nachrichten aus fremden Kanälen (Shared Chat).
- `GET /api/admin/stats`: `{enabled, instance: {started_at, uptime_seconds, metrics: [{key, label, value}]}}`. Zugriff wie alle `/api/admin/…`, erfolgreiche Abrufe erscheinen nicht im HTTP-Protokoll.
- Reiter „Statistik“: Karte „Diese Server-Instanz“, aktualisiert mit der Abfrage alle 5 s.
- Geprüft mit `test/stats-test.js` und dem Szenario `statistik` in `test/admin-test.js`, im Browser mit Attrappen; am echten Server noch nicht.

## Stream-Ablauf (Nutzer, 09.11.2026)
Gezählt wird von `stream.online` bis zum Ende der Erfassung, auch während der Stream kurz offline ist. Die Erfassung endet auf einem von drei Wegen:

| Ende | Wann | Als Streamende gilt |
|---|---|---|
| Raid zu einem anderen Kanal | sofort, automatisch erkannt | Zeitpunkt des Raids; war der Stream schon offline, das letzte Offline |
| Knopf „Streamlog beenden“ (Stufe 3) | sofort | Knopfdruck; war der Stream schon offline, das letzte Offline |
| Fallback | 2 Stunden nach dem letzten Offline ohne neues Live | das letzte Offline |

Sonderfälle: Der Server gleicht sich bei jeder frischen Verbindung einmal mit Twitch ab (`syncStreamWithTwitch`). Twitchs Antwort kann einige Minuten alt sein, deshalb zählt ein bekanntes Ereignis mehr als die Abfrage.

| Gespeichert | Twitch meldet | Verhalten |
|---|---|---|
| live | live, bekannte Stream-ID | weiterzählen |
| live | live, neue ID, letztes Speichern binnen 2 Stunden | derselbe Stream |
| live | live, neue ID, länger her | alten Stream als abgebrochen abschließen, neuen mit „spät begonnen“ beginnen |
| live | nicht live | offline ab dem letzten Speichern, als abgebrochen markiert; Frist schon vorbei: sofort abschließen. In den ersten 5 Minuten eines Streams wird „nicht live“ ignoriert |
| offline | live, neue ID | derselbe Stream läuft weiter |
| offline | live, bekannte ID | bleibt offline (vermutlich alte Antwort) |
| kein Stream, abgeschlossen | live, neue ID | neuer Stream, „spät begonnen“ |
| abgeschlossen | live, bekannte ID | bleibt abgeschlossen (nach dem Raid läuft derselbe Stream noch) |

Twitch nicht erreichbar: keine Änderung am Ablauf, aber deutlicher Fehler in der Kopfzeile.

Abgebrochene Streams werden immer gespeichert, mit allem bis zum letzten Speichern (höchstens 30 s fehlen, ohne Änderung bis 5 Minuten). Ob sich das Ende aus der VOD-Länge nachtragen lässt, ist vor Stufe 3 gegen die Twitch-Doku zu prüfen [UNGEKLÄRT].

## Weitere Vorgaben (Nutzer, 09.11.2026)
- **Abschlussmeldung (Stufe 3):** Sichtbar, ob und wann der Streamlog erfolgreich abgeschlossen wurde, damit klar ist, dass der Knopf nicht mehr nötig ist, mit Link zur Logdatei. Den Link liefert der Server aus, weil Browser aus einer Webseite heraus keine lokalen Dateien öffnen.
- **Warnung bei ungewöhnlichen Berichten (Stufe 3):** Hinweis, wenn der letzte Bericht auffällig ist, etwa unter einer Stunde lang oder abgebrochen. Berichte lassen sich löschen. Eine feste Regel für kurze Streams gibt es nicht.
- **Tags und Kategorien:** Berichte können markiert werden (etwa „Frontpage-Promotion“, „Teststream“). Kategorien werden auch als Tags geführt. Tags sind nachträglich bearbeitbar, die Statistik lässt sich danach filtern. Das kommt später; `tags` und `categories` mit der Dauer je Kategorie sind von Anfang an im Stand enthalten.
- **Alarm „Stream läuft nach dem Raid weiter“:** Läuft der Stream 30 bis 3000 Sekunden nach dem Raid noch, droht ungewollte Aufzeichnung. Eigener Schritt nach Stufe 3. Twitchs Antworten können einige Minuten alt sein (nur Forenangaben, 1 bis 3, beim Offline bis etwa 5 Minuten), deshalb in Stufen: ab 30 Sekunden Banner, ab 2 Minuten Ton und optional Home-Assistant-Effekt. Grundfunktion ohne Module, quittierbar. Genauer wäre eine Abfrage von OBS selbst über dessen WebSocket-Schnittstelle [UNGEKLÄRT, vor dem Bau prüfen].

## Verhalten Stufe 2
- `lib/stream-session.js`: Zustände `none`, `live`, `offline`, `closed` wie oben, ohne Abhängigkeit von Twitch oder Dateien. `count` zählt nur bei `live` und `offline`.
- `stream_stats.json`, Schema-Version 1, atomar geschrieben: sofort bei Beginn, Offline und Abschluss, sonst höchstens alle 30 s bei Änderung und alle 5 Minuten als Lebenszeichen, solange live. Beim Beenden über die Webkonsole wird vorher gespeichert.
- Neue Ereignisse: `stream.offline`, `channel.raid` mit `from_broadcaster_user_id`. Ausgehende Raids werden nicht begrüßt und nicht als Raid gezählt.
- Stream-Kennzahlen: Follows, Subs, verschenkte Subs, eingehende Raids, Chatnachrichten, Botnachrichten (nur über den Bot gesendete), eigene Shoutouts, Enigma-Antworten.
- `GET /api/admin/stats` liefert zusätzlich `stream` mit `{status, started_at, ended_at, offline_at, closes_at, close_reason, aborted, late_start, duration_seconds, interruptions, interruption_seconds, categories, tags, metrics}`.
- Reiter „Statistik“: Karte „Laufender oder letzter Stream“. Die Kopfzeile meldet „Twitch nicht erreichbar“, wenn EventSub länger als 20 s getrennt ist.
- Geprüft mit `test/stream-session-test.js` und dem Szenario `statistik`, im Browser mit Attrappen; am echten Stream noch nicht.

## Stufen
| Stufe | Inhalt | Stand |
|---|---|---|
| 1 | Grundgerüst `lib/stats.js`, Bereich Server-Instanz, Reiter „Statistik“ | umgesetzt, siehe oben |
| 2 | Stream-Ablauf und einfache Stream-Zahlen, `stream_stats.json` | umgesetzt, siehe oben |
| 3 | Archiv je Stream, Knopf „Streamlog beenden“, Abschlussmeldung mit Link, Warnung bei auffälligen Berichten, globale Summe | offen |
| 3b | Alarm „Stream läuft nach dem Raid weiter“ | offen |
| 4 | Polls, Wetten, Stimmen, Shoutouts, Hype Trains, Bits, Kanalpunkte, Spielbewertung, Ranglisten, Feld „Genutzte Chat-Bots“ | offen |
| 5 | Endscreen | offen |
| 6 | Clip-Kandidaten mit Alarm und Marker | offen |
