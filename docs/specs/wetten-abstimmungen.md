# Spec: Wetten und Abstimmungen über den Server

**Status:** Schritt 1 vereinbart (Nutzer, 14.11.2026: „Du kannst mit Schritt 1 loslegen“). Schritte 2–4 Entwurf. Bezug: Issue #50 (Abschnitt 1), Issue #44 (Glückspilz), ADR 0023.

## Ziel
Der Server führt den Stand von Wetten (Predictions) und Abstimmungen (Polls) über EventSub mit. Widgets holen ihn beim Server ab, statt Twitch selbst zu fragen. Der Server sendet die Ergebniszeilen in den Chat und ermittelt den Glückspilz des Abends.

## Schritte (je ein Pull Request)
1. **Wette als letzter Stand:** `/api/twitch/prediction/current` fragt Twitch nicht mehr je Abruf.
2. **Abstimmung als letzter Stand:** neuer Endpunkt `/api/twitch/poll/current`.
3. **Ergebniszeilen über den Server:** Texte der Widgets übernehmen, `!privat` zentral beachten.
4. **Glückspilz des Abends** (Issue #44).

Erst wenn Schritt 1 und 2 auf `main` sind, stellen die Widgets in ihren Repositories um. Bis dahin bleiben ihre direkten Twitch-Abfragen zugelassen (Übergang nach Issue #50).

## Twitch-Quellen (geprüft an der EventSub-Referenz, 14.11.2026)
| Ereignis | Version | Scope | Felder |
|---|---|---|---|
| `channel.prediction.begin` / `.progress` | 1 | `channel:read:predictions` (vorhanden) | `id`, `title`, `outcomes`, `started_at`, `locks_at` |
| `channel.prediction.lock` | 1 | ebenso | wie oben, `locked_at` statt `locks_at` |
| `channel.prediction.end` | 1 | ebenso | zusätzlich `winning_outcome_id`, `status` (`resolved`, `canceled`), `ended_at` |
| `channel.poll.begin` / `.progress` | 1 | `channel:read:polls` (vorhanden) | `id`, `title`, `choices`, `bits_voting`, `channel_points_voting`, `started_at`, `ends_at` |
| `channel.poll.end` | 1 | ebenso | zusätzlich `status` (`completed`, `archived`, `terminated`), `ended_at` statt `ends_at` |

- Ausgang (`outcomes[]`): `id`, `title`, `color`, `users`, `channel_points`, `top_predictors[]` mit `user_id`, `user_login`, `user_name`, `channel_points_used`, `channel_points_won`.
- `channel_points_won` ist bei `progress` und `lock` immer `null` und steht erst bei `end`. Bei verlorenem Ausgang oder Abbruch ist der Wert 0.
- `top_predictors` sind die Zuschauer mit den meisten Punkten auf diesem Ausgang, laut Helix-Doku bis zu 10. Weitere Tipper nennt Twitch nicht.
- Die Ereignisse enthalten kein `prediction_window`. Der Server berechnet es aus `locks_at − started_at`.
- `channel.prediction.end` und `channel.poll.end` sind schon für die Statistik abonniert. Neu sind 5 Abos: 22 statt 17.

## Schritt 1: Wette als letzter Stand

### Verhalten
- Neue Abos: `channel.prediction.begin`, `.progress` und `.lock`. `.end` gibt es schon, es speist künftig auch den Stand.
- Der Stand liegt nur im Arbeitsspeicher, es gibt keine neue Datei. Begründung: Während einer Wette kommen mehrere `progress`-Ereignisse je Sekunde, der Projektordner liegt in der Cloud.
- **Ausgangsstand:** einmal je Verbindung nach `session_welcome` über `GET /helix/predictions?first=1`, wie heute beim Sub-Goal. Damit kennt der Server nach einem Neustart oder Neuaufbau der Verbindung auch eine laufende oder lange gesperrte Wette.
- **Kontrolle bei offener Wette:** Solange der Stand `ACTIVE` oder `LOCKED` ist und 5 Minuten (`PREDICTION_RECHECK_MS`) kein Ereignis zur Wette kam, fragt der Server einmal `GET /helix/predictions?first=1`. Jedes Ereignis setzt die Frist neu. Das fängt ein verlorenes `end`-Ereignis bei bestehender Verbindung ab. Kosten: 12 Anfragen je Stunde, nur bei offener Wette. Von Claude festgelegt, nachdem der Nutzer gefragt hatte, ob eine lange gesperrte Wette ohne Ereignisse robust abgebildet ist (14.11.2026).
- **Was bei einer langen Sperre passiert:** Der Stand bleibt `LOCKED` im Arbeitsspeicher, ohne dass Ereignisse nötig sind. Ein Neustart, eine getrennte Verbindung oder ein verlorenes Ereignis werden durch den Ausgangsabruf bzw. die Kontrolle ausgeglichen. Bei einem `session_reconnect` überträgt Twitch die Abos ohne Lücke.
- **Status** wie bei Helix in Großbuchstaben: `begin`/`progress` → `ACTIVE`, `lock` → `LOCKED`, `end` → `RESOLVED` oder `CANCELED`. Ohne bekannte Wette: `{status: 'WAITING'}` wie bisher.
- **Reihenfolge:** Ereignisse einer anderen Wette ersetzen den Stand. Ein verspätetes `progress` nach `lock` oder `end` derselben Wette setzt den Status nicht zurück, Zahlen übernimmt es nur bei `ACTIVE`.
- **Top-Tipper:** Bei `lock` und `progress` übernimmt der Server sie mit `channelPointsWon: 0`, das bisherige Verhalten bei `null`. Bei `end` kommt der echte Wert.
- **Log:** nur Statuswechsel über `logIfChanged('prediction', …)`, keine Zeile je `progress`.

### Schnittstelle `GET /api/twitch/prediction/current`
- Zugriff unverändert: Widget-Herkünfte (ADR 0013). Löst keine Twitch-Anfrage mehr aus.
- **Bisherige Felder bleiben** (rückwärtskompatibel): `predictionId`, `title`, `status`, `outcomes[]` (`id`, `title`, `channelPoints`, `users`, `color`, `topPredictors[]` mit `userName`, `userLogin`, `channelPointsUsed`, `channelPointsWon`), `createdAt`, `locksAt`, `endsAt`, `lockedAt`, `endedAt`, `predictionWindow`, `winningOutcomeId`.
- **Neu:**
  - `updatedAt`: Zeitpunkt des letzten Ereignisses oder Abrufs beim Server (ISO)
  - `topPredictors[].userId`: Twitch-ID, damit Widgets die `!privat`-Liste ohne Namensvergleich anwenden können
- `createdAt` kommt aus `started_at`, `locksAt` aus `locks_at`. Twitch liefert bei `lock` kein `locks_at` mehr, dann bleibt der vorige Wert.
- **Fehlerfall:** Scheitert der Ausgangsabruf, bleibt der letzte Stand. Ohne jeden Stand: `{status: 'WAITING'}`. Kein HTTP 500 mehr, weil der Endpunkt nichts mehr abfragt.

### Akzeptanzkriterien
- Abos für `begin`, `progress` und `lock` (v1) nach `session_welcome`, insgesamt 20 statt 17.
- Nach `begin` liefert der Endpunkt `ACTIVE` mit Ausgängen, `locksAt` und `predictionWindow`, ohne Twitch zu fragen.
- `progress` aktualisiert `users`, `channelPoints` und `topPredictors`. Viele Widget-Abrufe lösen keine Anfrage an `helix/predictions` aus.
- `lock` setzt `LOCKED` und `lockedAt`. Ein danach eintreffendes `progress` ändert den Status nicht.
- `end` mit `resolved` setzt `RESOLVED`, `winningOutcomeId`, `endedAt` und die echten `channelPointsWon`. `canceled` setzt `CANCELED`.
- Statistik wie bisher: nur `resolved` zählt.
- Ausgangsstand einmal je Verbindung.
- Bei `ACTIVE` oder `LOCKED` eine Kontrollabfrage je `PREDICTION_RECHECK_MS`. Meldet sie die Wette als beendet, übernimmt der Server das Ende. Bei `WAITING`, `RESOLVED` und `CANCELED` gibt es keine Kontrollabfrage.
- Bisherige Felder unverändert vorhanden.

## Schritt 2: Abstimmung als letzter Stand (Entwurf)
- Neue Abos: `channel.poll.begin` und `.progress`. `.end` ist vorhanden.
- Neu `GET /api/twitch/poll/current`, Zugriff wie oben. Felder: `pollId`, `title`, `status`, `choices[]` (`id`, `title`, `votes`, `channelPointsVotes`, `bitsVotes`), `channelPointsVoting`, `bitsVoting`, `startedAt`, `endsAt`, `endedAt`, `updatedAt`.
- Status in Großbuchstaben wie bei Helix: `ACTIVE`, `COMPLETED`, `TERMINATED`, `ARCHIVED`. Ohne Abstimmung: `WAITING`.
- Ausgangsstand einmal je Verbindung über `GET /helix/polls?first=1`.
- [UNGEKLÄRT] Was SpargelPoll genau braucht, prüfe ich vor diesem Schritt im Widget-Code.

## Schritt 3: Ergebniszeilen über den Server (Entwurf)
- Texte wie heute in den Widgets (Spec `chat-nachricht.md` des Wetten-Widgets bzw. von SpargelPoll). Gesendet wird bei `end`, genau einmal je Wette oder Abstimmung.
- **Migration:** Schalter je Zeile, anfangs aus. Ein Widget, das umgestellt hat, sendet selbst nicht mehr, dann schaltet der Nutzer den Server-Versand ein. So kommt keine Zeile doppelt.
- **Absender konfigurierbar** (Nutzer, 14.11.2026): Broadcaster (wie heute) oder Bot-Konto. Vorgabe Broadcaster.
- [UNGEKLÄRT] Ort der Schalter: gemeinsamer Einstellungs-Reiter (AGENTS.md) oder vorerst Konsolenbefehl.

## Schritt 4: Glückspilz des Abends (Entwurf, Issue #44)
- **Wertung nach Reingewinn** (Nutzer, 14.11.2026): je Wette `channel_points_won − channel_points_used`, über die erfasste Stream-Session summiert.
- Grundlage sind nur die `top_predictors` aus `channel.prediction.end`, bis zu 10 je Ausgang. Wer außerhalb davon setzt, wird nicht erfasst. Der größte Gewinner einer Wette ist fast immer der Top-Tipper mit dem höchsten Einsatz auf dem Siegerausgang, also enthalten.
- Gespeichert in `stream_stats.json` (ADR 0019), nach der Regel aus ADR 0022 anonymisierbar.
- [UNGEKLÄRT] Gleichstand
- [UNGEKLÄRT] abgebrochene Wetten (vermutlich 0)
- [UNGEKLÄRT] Untergrenze (zum Beispiel nur mit Reingewinn über 0)
- [UNGEKLÄRT] Ausgabe: Endpunkt, Chat, Bericht

## Nicht-Ziele
- Wetten oder Abstimmungen starten, sperren oder auflösen (bräuchte `channel:manage:*`).
- Anzeige- oder Quotenlogik der Widgets im Server.
- Neue Datei für den laufenden Stand.

## Berührte Funktionen/Dateien (Schritt 1)
Neu `lib/prediction-state.js` (`createPredictionTracker`: `handleEvent`, `refresh`, `snapshot`, Kontrolle mit einstellbarem Timer). In `server.js`: `subscribeToPredictionEnd` → `subscribeToPredictions`, `predictionTracker`, `/api/twitch/prediction/current`, `session_welcome`-Block, `recordPredictionEnd` unverändert. Tests: `test/prediction-test.js` (Modultest mit künstlichen Timern), `test/admin-test.js` (Szenario `wette`), `test/keepalive-test.js` (Zahl der Abos).
