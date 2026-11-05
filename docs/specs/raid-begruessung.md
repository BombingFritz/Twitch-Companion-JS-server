# Spec: Raid-Begrüßung (inkl. `!raidstats`)

## Ziel
Eingehende Raids automatisch im Chat begrüßen und die Raid-Statistik pflegen.

## Verhalten
- `channel.raid` wird in `raidQueue` eingereiht, die Queue arbeitet sequenziell.
- Pro Raid werden Spiel (`/helix/channels`) und Streamdauer (`/helix/streams`) des Raiders abgefragt.
- `trackRaid` erhöht `count` und `totalViewers` im aktuellen Zeitraum in `raids.json`: bis 2026 das Quartal, ab 2027 das Kalenderjahr (ADR 0012). Die Texte nennen „in diesem Quartal“ bzw. „in diesem Jahr“.
- Die Nachricht besteht aus Basisgruß, Spielinfo, optionalem Wiederholungs- oder Rang-Hinweis, optionalem Zuschauer-Rang-Hinweis und Abschluss. Texte werden aus je 3 Varianten zufällig gewählt.
- Gesendet wird über `POST /helix/chat/messages`.
- Danach folgt bei `viewers >= 3` ein Shoutout nach 2 s (siehe Spec Shoutout).
- `!raidstats` (nur Mods/Broadcaster) postet das Leaderboard: Top 3 Häufigkeit, Top 3 Zuschauer.

## Nicht-Ziele
- Kein Licht-Effekt bei Raids.
- Keine Aktivitätsprüfung des Raiders: Wer raidet, ist live (ADR 0015 gilt nur für Whitelist-Shoutouts).

## Akzeptanzkriterien
- Zwei Raids innerhalb von 90 s erzeugen zwei Begrüßungen mit mindestens 90 s Abstand.
- Eine doppelt zugestellte Raid-Notification (gleiche `message_id`) erzeugt genau einen Queue-Eintrag.
- Nach einem Raid steigt `count` des Raiders im aktuellen Zeitraum um 1 und `totalViewers` um die Zuschauerzahl.
- Ab `count >= 2` enthält die Nachricht einen Wiederholungs-Hinweis; bei Rang 1–5 nach Häufigkeit die Rang-Variante.
- Bei Rang 1–3 nach Zuschauern enthält die Nachricht den Zuschauer-Rang-Hinweis.
- Bei `viewers > 50` enthält der Basisgruß einen Zusatz.
- Schlägt der Abruf von Spiel oder Streamdauer fehl, wird trotzdem begrüßt (Spiel unbekannt, grammatisch passend je Textvariante: „Dort gab es zuletzt ein unbekanntes Spiel“, „Zuletzt lief bei ihnen ein unbekanntes Spiel“, „… einer Session mit einem unbekannten Spiel“).
- Kann kein Access-Token geladen werden, erfolgt weder Begrüßung noch Tracking.
- `!raidstats` von einem Nutzer ohne Mod- oder Broadcaster-Badge bleibt ohne Antwort.
- Ein zweites `!raidstats` innerhalb von 30 s bleibt ohne Antwort.
- Ab dem 01.01.2027 (Ortszeit) lautet der Zeitraum-Schlüssel `2027`, die Texte sagen „in diesem Jahr“; Quartalsdaten von 2026 bleiben in `raids.json` unverändert.
- Ohne Raids im Zeitraum lautet die Antwort „Noch keine Raids in <Periode> erfasst.“

## Berührte Funktionen/Dateien
`enqueueRaidEvent`, `processRaidQueue`, `handleRaidEvent`, `trackRaid`, `getRanks`, `getLeaderboardText`, `build*Message`, `handleChatCommand`; `raids.json`
