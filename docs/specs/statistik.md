# Spec: Statistik

**Status:** Ziele des Nutzers vom 09.11.2026, noch nicht vollständig, nicht umgesetzt. Grundgerüst und Reihenfolge werden vor der Umsetzung gemeinsam abgewogen; danach folgt ein eigenes ADR.

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

## Offen [UNGEKLÄRT]
- „API-Anfragen“: nur Anfragen an Twitch oder auch an Home Assistant?
- „Erste“ und „wiederkehrende Chatter“: Was genau zählt?
- „Abstimmungen“ und „Stimmen“: nur Twitch-Polls oder auch das eigene Poll-Widget?
- „Eingesetzte Kanalpunkte“: nur Wetten und Polls oder auch eingelöste Belohnungen?
- „Monetärer Support“: Gehören Bits dazu?
- Zählen Broadcaster und Bots bei Chatnachrichten und in Ranglisten mit?
