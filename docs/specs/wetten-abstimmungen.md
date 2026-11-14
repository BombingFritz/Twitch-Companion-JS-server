# Spec: Wetten und Abstimmungen über den Server

**Status:** Schritt 1 umgesetzt (PR #64). Schritt 2 vereinbart (Nutzer, 14.11.2026). Schritte 3 und 4 Entwurf. Bezug: Issue #50 (Abschnitt 1), Issue #44 (Glückspilz), ADR 0023.

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

## Schritt 2: Abstimmung als letzter Stand
Vereinbart (Nutzer, 14.11.2026: „weiter mit 2“). Was SpargelPoll braucht, wurde im Widget-Code geprüft (0.8.2, `checkForActivePoll`, `getPollEndsAt`): `id`, `title`, `status`, je Auswahl `id`, `title` und `votes`, dazu das Ende als `ends_at` oder `started_at + duration`.

### Verhalten
- Neue Abos: `channel.poll.begin` und `.progress`. `.end` gibt es schon, es speist künftig auch den Stand. Insgesamt 22 Abos.
- Ablauf wie bei der Wette, gemeinsamer Kern in `lib/live-state.js`:
  - Stand nur im Arbeitsspeicher
  - Ausgangsstand einmal je Verbindung über `GET /helix/polls?first=1`
  - Kontrolle bei `ACTIVE` nach 5 Minuten ohne Ereignis (`POLL_RECHECK_MS`)
  - Ein verspätetes `begin` derselben Abstimmung ändert nichts.
- **Status** in Großbuchstaben wie bei Helix: `begin`/`progress` → `ACTIVE`; `end` → `COMPLETED`, `TERMINATED` oder `ARCHIVED`. Aus Helix können auch `MODERATED` und `INVALID` kommen. Ohne Abstimmung: `{status: 'WAITING'}`.
- **Reihenfolge:** `ARCHIVED` folgt bei Twitch auf `COMPLETED` bzw. `TERMINATED` derselben Abstimmung und wird übernommen. Ein früherer Zustand ersetzt nie einen späteren.
- **Log:** nur Statuswechsel über `logIfChanged('poll', …)`.

### Schnittstelle `GET /api/twitch/poll/current` (neu)
- Zugriff: Widget-Herkünfte (ADR 0013). Löst keine Twitch-Anfrage aus.
- **Felder:**
  - `pollId`, `title`, `status`
  - `choices[]`: `id`, `title`, `votes`, `channelPointsVotes`, `bitsVotes`
  - `channelPointsVoting` und `bitsVoting`, je `{isEnabled, amountPerVote}`
  - `startedAt`, `endsAt`, `endedAt`, `duration` (s), `updatedAt`
- Schreibweise camelCase wie bei `/api/twitch/prediction/current`. Von Claude festgelegt; SpargelPoll muss beim Umstellen nur wenige Felder umbenennen.
- `endsAt`: aus Helix `started_at + duration`, aus EventSub `ends_at`. Das End-Ereignis liefert kein `ends_at`, dann bleibt der vorige Wert. `duration` aus EventSub ist `ends_at − started_at`.

### Akzeptanzkriterien
- Abos für `begin`, `progress` und `end` (v1) nach `session_welcome`.
- Nach `begin` und `progress` liefert der Endpunkt `ACTIVE` mit Auswahl, Stimmen, `endsAt` und `duration`, ohne Twitch zu fragen.
- `end` setzt den Endstatus, `endedAt` und den Endstand; ein danach eintreffendes `progress` ändert nichts.
- `archived` nach `completed` wird übernommen, `completed` nach `archived` nicht.
- Ausgangsstand einmal je Verbindung; Kontrolle nur bei `ACTIVE`.
- Statistik wie bisher (`recordPollEnd`, `archived` zählt nicht doppelt).

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
Neu `lib/prediction-state.js` (`createPredictionTracker`: `handleEvent`, `refresh`, `snapshot`, Kontrolle mit einstellbarem Timer); seit Schritt 2 auf dem gemeinsamen Kern `lib/live-state.js`, dazu `lib/poll-state.js`, `test/poll-test.js` und das Szenario `abstimmung`. In `server.js`: `subscribeToPredictionEnd` → `subscribeToPredictions`, `predictionTracker`, `/api/twitch/prediction/current`, `session_welcome`-Block, `recordPredictionEnd` unverändert. Tests: `test/prediction-test.js` (Modultest mit künstlichen Timern), `test/admin-test.js` (Szenario `wette`), `test/keepalive-test.js` (Zahl der Abos).
