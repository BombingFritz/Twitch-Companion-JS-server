# ADR 0015: Aktivitätsprüfung, Chat-Hinweis und Prüfprotokoll beim Whitelist-Shoutout

**Status:** Akzeptiert (Nutzer, 05.11.2026). Ersetzt die nicht mehr auffindbare 40-Tage-Prüfung aus einem früheren Branch; neu umgesetzt. **Testphase:** Bei unklarer Aktivität wird vorerst trotzdem geshoutet (`SHOUTOUT_ACTIVITY_STRICT = false`); nach erfolgreicher Beobachtung auf `true` umstellen.

**Kontext:** Gelistete Streamer bekommen bei ihrer ersten Chat-Nachricht je Session automatisch einen Shoutout (Spec Whitelist). Schreibt ein Streamer, der seit Langem nicht mehr streamt, wirkt ein Shoutout komisch. Chattet ein Streamer, während er selbst live ist, ist ein Shoutout unpassend; das Verhalten kann problematisch sein, muss es aber nicht, und soll deshalb festgehalten werden. Die Helix-API hat keinen Endpunkt „zuletzt live am“. Vergangene Übertragungen (VODs) bleiben je nach Konto nur begrenzt erhalten (laut Twitch bei den meisten Konten 7 Tage, bei Partnern, Turbo und Prime länger [UNGEKLÄRT, aktuelle Werte prüfen]); Highlights und Uploads bleiben dauerhaft. Drittanbieter wie TwitchTracker führen eine lange Stream-Historie, bieten aber keine offizielle Schnittstelle [UNGEKLÄRT].

**Entscheidung:**
- Vor dem Whitelist-Shoutout ermittelt `getChannelActivity()` den Zustand des Kanals: gerade live (`/helix/streams`), neuestes Video jeder Art (`/helix/videos`, `type=all`, bis 20 Einträge: vergangene Übertragung, Highlight, Upload) und Kategorie (`/helix/channels`).
- Ergebnisse:
  - **live** (chattet hier, während er selbst live ist): kein Hinweis, kein Shoutout, Eintrag im Prüfprotokoll.
  - **inaktiv** (neuestes Video älter als `SHOUTOUT_ACTIVITY_WINDOW_DAYS` = 40 Tage): kein Hinweis, kein Shoutout, Eintrag im Prüfprotokoll.
  - **unklar** (kein Video gefunden oder API-Fehler): Eintrag im Prüfprotokoll; in der Testphase trotzdem Hinweis und Shoutout, mit `SHOUTOUT_ACTIVITY_STRICT = true` keiner. Wunsch des Nutzers: Die Funktion soll nicht ausfallen, nur weil die Prüfung scheitert.
  - **aktiv** (neuestes Video höchstens 40 Tage alt): Hinweis und Shoutout, kein Protokolleintrag.
- Chat-Hinweis vor dem Shoutout, Text vom Nutzer vorgegeben: „Welch netter Besuch! Wir begrüßen @<name>! Dort gab es zuletzt <Spiel>. Lasst gern mal nen Follow da!“ Kein Datum. Ohne bekanntes Spiel entfällt der mittlere Satz. Spiel: Kategorie des Kanals, bei Offline-Kanälen meist das zuletzt gestreamte Spiel. Der Shoutout folgt nach `WHITELIST_SHOUTOUT_DELAY_MS` (2 s).
- **Prüfprotokoll** `whitelist_checks.json` (ADR 0001, `loadWhitelistChecks`/`saveWhitelistChecks`, höchstens `WHITELIST_CHECKS_MAX` = 500 Einträge): `{timestamp, userId, userName, result: live|inaktiv|unklar, shoutout, lastActiveAt, lastLiveAt, game, error?}`. Anzeige mit dem Konsolenbefehl `whitelist checks`. Später Teil des Stream-Berichts (specs/stream-bericht.md), damit die Whitelist anhand der Berichte überarbeitet werden kann.
- Je Session nur eine Prüfung; nach `stream.online` neu.
- Raid-Shoutouts werden nicht geprüft und erhalten keinen zusätzlichen Hinweis (die Raid-Begrüßung nennt Spiel und Dauer schon).
- Keine neuen Scopes.

**Verworfene Alternativen:**
- Nur vergangene Übertragungen (`type=archive`) als Aktivität: Bei kurzer VOD-Speicherdauer gälte ein Streamer schon nach etwa einer Woche als inaktiv.
- Daten von TwitchTracker abrufen: keine offizielle Schnittstelle bekannt, Abruf der Webseite wäre fehleranfällig (Seitenaufbau, Bot-Schutz) und ggf. gegen deren Nutzungsbedingungen [UNGEKLÄRT, nicht geprüft]; zusätzliche Abhängigkeit von einem Drittanbieter.
- Eigene Datei mit „zuletzt live gesehen“ je Streamer: genauer bei kurzer VOD-Speicherung, aber zusätzliche Laufzeitdaten; bei Bedarf später.
- Datum des letzten Streams im Chat-Hinweis: vom Nutzer nicht gewünscht (steht im Prüfprotokoll als `lastLiveAt`, sofern bekannt).
- Live-Streamern trotzdem einen Shoutout geben: vom Nutzer nicht gewünscht.

**Konsequenzen:**
- Streamer mit deaktivierten oder abgelaufenen VODs und ohne Highlights/Uploads gelten als „unklar“: in der Testphase Shoutout, später keiner; in beiden Fällen Protokolleintrag.
- Ein Highlight oder Upload zählt als Aktivität, auch wenn es aus einem älteren Stream stammt (`created_at` ist das Erstelldatum).
- Drei zusätzliche Helix-Abfragen je gelistetem Streamer und Session.
- Neue Laufzeitdatei `whitelist_checks.json` (in `.gitignore`).
- Der Hinweis wird auch vor dem eigenen Streamstart gepostet; der Shoutout selbst scheitert dann bei Twitch (400, siehe Spec Shoutout).
