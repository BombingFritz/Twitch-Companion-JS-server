# ADR 0024: Zentraler Twitch-Zugriff mit Drosselung und Token im Arbeitsspeicher

**Status:** Akzeptiert (14.11.2026). Setzt den Serverteil von Issue #50 (Abschnitt 2) um; Folge von ADR 0023.
Vom Nutzer vorgegeben: Der Server sendet insgesamt höchstens 3 Anfragen je Sekunde und höchstens 200 je Minute an Twitch; eine zentrale Stelle zählt mit, drosselt und wertet die Ratelimit-Header aus; Stand in der Webkonsole. Der Token soll robuster werden (Widget-Fehler 401 im Stream vom 11.11.2026).
Von Claude festgelegt, nicht einzeln zur Wahl gestellt: Modul `lib/twitch-api.js`; die 3 je Sekunde als Durchschnitt mit einer Spitze von 20 Anfragen auf einmal (siehe Kontext; vom Nutzer am 14.11.2026 bestätigt); Erneuerung des Tokens von sich aus 10 min vor Ablauf, nach Fehlschlag erst 10 min später wieder; bei 401 einmal erneuern und neu versuchen, bei 429 bis zum Reset (höchstens 60 s) warten und einmal neu versuchen, bei Shoutouts nicht (dort heißt 429 „Wartezeit läuft“); `expires_at` in `/token`; Umgebungsvariable `TWITCH_COMPANION_NO_THROTTLE=1` nur für Tests.

**Kontext:** Bis 1.1.5 standen in `server.js` 25 einzeln kopierte Helix-Aufrufe, jeder mit eigenem Token-Abruf und Header. `tokens.json` wurde vor jeder Anfrage von der Platte gelesen und direkt überschrieben; gleichzeitige Anfragen konnten den Token parallel erneuern. Erneuert wurde erst, wenn eine Anfrage einen fast abgelaufenen Token fand; ein Widget mit dem alten Token lief dann in einen 401. Eine harte Grenze von 3 Anfragen in jeder Sekunde verträgt sich nicht mit EventSub: Nach dem Welcome müssen die Abos (heute 17) binnen 10 s stehen, sonst trennt Twitch die Verbindung; mit den übrigen Startanfragen (Kategorie, Abgleich, Sub-Goal) wäre das knapp.

**Entscheidung:**
- **Token:** `createTokenStore` liest `tokens.json` einmal, hält den Stand im Arbeitsspeicher und schreibt atomar (`writeJsonAtomic`). Es läuft höchstens eine Erneuerung zur Zeit; gleichzeitige Aufrufer bekommen dasselbe Ergebnis. Ein Zeitgeber erneuert 10 min vor Ablauf.
- **Helix:** `createTwitchApi` ist die einzige Stelle für Helix-Anfragen (`twitchApi.get/post/…`, Pfad wie `/users?id=1`). Token des Broadcasters, App-Token (Bot) oder ein fester Token (Login) je Aufruf.
- **Drosselung:** Token-Bucket mit 3 je Sekunde im Schnitt und Spitze 20, dazu hart 200 in jedem gleitenden 60-s-Fenster. Wartende Anfragen kommen der Reihe nach dran, es wird nichts verworfen.
- **Fehler:** 401 → einmal erneuern und neu; 429 → bis `Ratelimit-Reset` warten und einmal neu (außer Shoutouts). Alles andere geht wie bisher an den Aufrufer.
- **Sichtbarkeit:** `twitch_api` in `/api/admin/overview` (Anfragen der letzten Minute, Grenzen, Wartende, letzter Stand von `Ratelimit-Limit`/`-Remaining`/`-Reset`), Zeile „API-Anfragen“ in der Karte „Twitch“.
- **Widgets:** `/token` liefert zusätzlich `expires_at`. Widgets, die noch selbst bei Twitch fragen, holen sich danach einen neuen Token; ihre Anfragen zählen am gemeinsamen Twitch-Kontingent mit, aber nicht in der Drosselung des Servers (Issue #50, Abschnitt 1).

**Verworfene Alternativen:**
- **Harte 3 je Sekunde ohne Spitze:** EventSub-Abos nach dem Welcome würden 6 s und mehr brauchen; Gefahr der Trennung.
- **EventSub-Abos an der Drosselung vorbei:** zählen bei Twitch trotzdem; die Vorgabe „insgesamt“ wäre verletzt.
- **Anfragen über der Grenze verwerfen:** Begrüßungen, Shoutouts oder Abos gingen verloren.
- **Bibliothek eines Drittanbieters:** neue Abhängigkeit für wenige Zeilen.

**Konsequenzen:**
- Bei vielen Anfragen kurz hintereinander (z. B. mehrere Raids und Whitelist-Prüfungen) kommen einzelne Antworten einige hundert Millisekunden später.
- Ändert jemand `tokens.json` von Hand, während der Server läuft, merkt der Server das erst nach einem Neustart.
- Tests, die viele Anfragen in Sekunden auslösen (`aktiv-test`, `bot-test`), schalten die Drosselung ab; geprüft wird sie in `test/twitch-api-test.js` mit künstlicher Uhr.
