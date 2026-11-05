# ADR 0015: Aktivitätsprüfung vor dem Whitelist-Shoutout

**Status:** Akzeptiert (Nutzer, 05.11.2026). Ersetzt die nicht mehr auffindbare 40-Tage-Prüfung aus einem früheren Branch; neu umgesetzt.

**Kontext:** Gelistete Streamer bekommen bei ihrer ersten Chat-Nachricht je Session automatisch einen Shoutout (Spec Whitelist). Schreibt ein Streamer, der seit Langem nicht mehr streamt, wirkt ein Shoutout komisch. Twitch bietet keinen Endpunkt „zuletzt live am“. Vergangene Übertragungen (VODs) bleiben je nach Konto nur begrenzt erhalten (laut Twitch bei den meisten Konten 7 Tage, bei Partnern, Turbo und Prime länger [UNGEKLÄRT, aktuelle Werte prüfen]); Highlights und Uploads bleiben dauerhaft.

**Entscheidung:**
- Vor dem Whitelist-Shoutout prüft `getChannelActivity()`, ob der Kanal in den letzten `SHOUTOUT_ACTIVITY_WINDOW_DAYS` (40) Tagen aktiv war: gerade live (`/helix/streams`) oder das neueste Video jeder Art (`/helix/videos`, `type=all`: vergangene Übertragung, Highlight, Upload) ist höchstens 40 Tage alt.
- Nicht aktiv, kein Video gefunden oder API-Fehler: kein Shoutout, Hinweis in der Konsole. Der Nutzer gilt für diese Session trotzdem als erledigt (keine erneute Prüfung bei jeder Nachricht); nach `stream.online` wird neu geprüft.
- Raid-Shoutouts werden nicht geprüft: Wer raidet, ist gerade live.
- Keine neuen Scopes; beide Endpunkte brauchen nur den vorhandenen Token.

**Verworfene Alternativen:**
- Nur vergangene Übertragungen (`type=archive`): Bei kurzer VOD-Speicherdauer gälte ein Streamer schon nach etwa einer Woche als inaktiv.
- Bei API-Fehler trotzdem shouten: widerspricht dem Ziel, Inaktive auszuschließen.
- Eigene Datei mit „zuletzt live gesehen“ je Streamer: genauer bei kurzer VOD-Speicherung, aber zusätzliche Laufzeitdaten; bei Bedarf später.
- Chat-Nachricht mit Datum und Spiel des letzten Streams (Idee aus dem früheren Branch): nicht übernommen [UNGEKLÄRT, ob gewünscht].

**Konsequenzen:**
- Streamer mit deaktivierten oder abgelaufenen VODs und ohne Highlights/Uploads in 40 Tagen bekommen keinen Shoutout, obwohl sie aktiv sein können. Die Konsole nennt dann „keine Übertragung, kein Highlight und kein Upload gefunden“.
- Ein Highlight oder Upload zählt als Aktivität, auch wenn es aus einem älteren Stream stammt (`created_at` ist das Erstelldatum).
- Zwei zusätzliche Helix-Abfragen je gelistetem Streamer und Session.
- Ein vorübergehender API-Fehler kostet den Shoutout für diese Session.
