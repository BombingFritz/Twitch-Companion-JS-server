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

## Stufen
| Stufe | Inhalt | Stand |
|---|---|---|
| 1 | Grundgerüst `lib/stats.js`, Bereich Server-Instanz, Reiter „Statistik“ | umgesetzt, siehe unten |
| 2 | Stream-Ablauf und einfache Stream-Zahlen, `stream_stats.json` | offen |
| 3 | Archiv je Stream und globale Summe | offen |
| 4 | Polls, Wetten, Stimmen, Shoutouts, Hype Trains, Bits, Kanalpunkte, Spielbewertung, Ranglisten, Feld „Genutzte Chat-Bots“ | offen |
| 5 | Endscreen | offen |
| 6 | Clip-Kandidaten mit Alarm und Marker | offen |
