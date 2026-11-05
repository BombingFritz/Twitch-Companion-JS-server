# ADR 0015: Aktivitätsprüfung und Chat-Hinweis vor dem Whitelist-Shoutout

**Status:** Akzeptiert (Nutzer, 05.11.2026). Ersetzt die nicht mehr auffindbare 40-Tage-Prüfung aus einem früheren Branch; neu umgesetzt. **Testphase:** Bei unklarer Aktivität wird vorerst trotzdem geshoutet (`SHOUTOUT_ACTIVITY_STRICT = false`); nach erfolgreicher Beobachtung auf `true` umstellen.

**Kontext:** Gelistete Streamer bekommen bei ihrer ersten Chat-Nachricht je Session automatisch einen Shoutout (Spec Whitelist). Schreibt ein Streamer, der seit Langem nicht mehr streamt, wirkt ein Shoutout komisch. Die Helix-API hat keinen Endpunkt „zuletzt live am“. Vergangene Übertragungen (VODs) bleiben je nach Konto nur begrenzt erhalten (laut Twitch bei den meisten Konten 7 Tage, bei Partnern, Turbo und Prime länger [UNGEKLÄRT, aktuelle Werte prüfen]); Highlights und Uploads bleiben dauerhaft. Drittanbieter wie TwitchTracker führen eine lange Stream-Historie, bieten aber keine offizielle Schnittstelle [UNGEKLÄRT].

**Entscheidung:**
- Vor dem Whitelist-Shoutout prüft `getChannelActivity()`, ob der Kanal in den letzten `SHOUTOUT_ACTIVITY_WINDOW_DAYS` (40) Tagen aktiv war: gerade live (`/helix/streams`) oder das neueste Video jeder Art (`/helix/videos`, `type=all`, bis 20 Einträge: vergangene Übertragung, Highlight, Upload) ist höchstens 40 Tage alt.
- Ergebnis „nicht aktiv“ (neuestes Video älter als 40 Tage, nicht live): kein Hinweis, kein Shoutout, Konsolenhinweis mit Datum.
- Ergebnis „unklar“ (kein Video gefunden oder API-Fehler): in der Testphase trotzdem Hinweis und Shoutout, Konsolenhinweis; mit `SHOUTOUT_ACTIVITY_STRICT = true` kein Shoutout. Wunsch des Nutzers: Die Funktion soll nicht ausfallen, nur weil die Prüfung scheitert.
- Vor dem Shoutout postet der Server wie bei der Raid-Begrüßung eine Chat-Nachricht (`buildWhitelistShoutoutMessage`, je drei Varianten), nach `WHITELIST_SHOUTOUT_DELAY_MS` (2 s) folgt der Shoutout:
  - live: „gerade live mit <Spiel>“,
  - sonst mit Datum der letzten gespeicherten Übertragung (`type=archive`) und Spiel: „Zuletzt live am <Datum> mit <Spiel>“,
  - ohne gespeicherte Übertragung: ohne Datum, mit Spiel, falls bekannt.
  - Spiel: Kategorie des Kanals (`/helix/channels`), bei Offline-Kanälen meist das zuletzt gestreamte Spiel; live: Spiel des laufenden Streams.
- Je Session nur eine Prüfung; nach `stream.online` neu.
- Raid-Shoutouts werden nicht geprüft und erhalten keinen zusätzlichen Hinweis (die Raid-Begrüßung nennt Spiel und Dauer schon).
- Keine neuen Scopes.

**Verworfene Alternativen:**
- Nur vergangene Übertragungen (`type=archive`) als Aktivität: Bei kurzer VOD-Speicherdauer gälte ein Streamer schon nach etwa einer Woche als inaktiv.
- Daten von TwitchTracker abrufen: keine offizielle Schnittstelle bekannt, Abruf der Webseite wäre fehleranfällig (Seitenaufbau, Bot-Schutz) und ggf. gegen deren Nutzungsbedingungen [UNGEKLÄRT, nicht geprüft]; zusätzliche Abhängigkeit von einem Drittanbieter.
- Eigene Datei mit „zuletzt live gesehen“ je Streamer: genauer bei kurzer VOD-Speicherung, aber zusätzliche Laufzeitdaten; bei Bedarf später.
- Datum eines Highlights oder Uploads im Chat-Text: sagt nichts über den letzten Livestream.

**Konsequenzen:**
- Streamer mit deaktivierten oder abgelaufenen VODs und ohne Highlights/Uploads gelten als „unklar“: in der Testphase Shoutout ohne Datum, später kein Shoutout.
- Ein Highlight oder Upload zählt als Aktivität, auch wenn es aus einem älteren Stream stammt (`created_at` ist das Erstelldatum).
- Drei zusätzliche Helix-Abfragen je gelistetem Streamer und Session.
- Der Hinweis wird auch vor dem eigenen Streamstart gepostet; der Shoutout selbst scheitert dann bei Twitch (400, siehe Spec Shoutout).
