# Spec: Stream-Bericht mit Clip-Kandidaten und Spielbewertung

**Stand 14.11.2026 (Inventur):** Teil 1 „Stream-Dokumentation“ ist weitgehend in [statistik.md](statistik.md) umgesetzt (Stream-Ablauf, Bericht je Stream als `.txt`/`.json`, Knopf „Streamlog beenden“, Raids, Follows, Subs, Gifts, aktivste Chatter, Zuschauerverlauf; ADR 0019, 0022, 0023). Offen nach dieser Spec bleiben Spielbewertung, Clip-Kandidaten, Marker, Hype Train und Alarm-Endpoint; die Abschnitte unten sind dafür der Plan, für Umgesetztes gilt `statistik.md`.

**Status:** geplant, nicht umgesetzt. Vorlage des Nutzers vom 04.11.2026, übernommen am 05.11.2026; ergänzt um den Abgleich mit Code und ADRs (Abschnitt „Abgleich“). Vor der Umsetzung eigenes ADR. Scopes, Event-Versionen und API-Endpunkte vor dem Bauen gegen die aktuelle Twitch-Doku prüfen.

## Ziel
Nach jedem Stream erzeugt der Server automatisch einen Bericht mit zwei Teilen (Nutzer, 05.11.2026):

1. **Stream-Dokumentation:** die wichtigsten Daten zum Stream, z. B. Datum, Titel, Kategorien, Dauer, Raids und die Spielbewertung aus dem Chat.
2. **Clip-Kandidaten:** alle clipbaren Momente mit Timecode, Anlass und direktem VOD-Link. So lassen sich die Kandidaten am nächsten Tag der Reihe nach durchgehen, ohne Timecodes zu merken oder im VOD zu spulen.

Raids gehören nur in Teil 1, sie sind keine Clip-Kandidaten.

## Ausgangslage
- Server mit Twitch OAuth, EventSub, zentraler Effekt-Queue und HA-Payload `{type, count, meta, timestamp}`.
- Das Stream Deck setzt bereits Twitch-Marker. Diese Integration bleibt unverändert.
- Das Enigma-Widget erzeugt Antworten, die zu Kandidaten werden sollen. Die Vorlage nennt es „UboatWidget 2“; im Repository `BombingFritz/Uboat-Widget` [UNGEKLÄRT, ob dasselbe Projekt].
- Alle Streams werden bereits automatisch transkribiert. Ort und Format [UNGEKLÄRT], erst ab Stufe 3 nötig.

## Stufe 1

### Kandidaten-Quellen
| Quelle | Erkennung | `type` |
|---|---|---|
| Enigma-Antwort | Widget oder Server meldet das Event an den Kandidaten-Sammler (je nachdem, wo die Antwort entsteht) | `enigma_answer` |
| Hype Train | EventSub `channel.hype_train.begin` / `.end` | `hype_train` |
| Stream-Deck-Alarm | zusätzlicher HTTP-Aufruf an den Server (aus dem HA-Skript oder per Stream-Deck-Aktion) | `alarm` |
| Stream-Deck-Marker | nach Streamende per Get Stream Markers abholen | `marker` |

### Ablauf
1. **`stream.online`:** Session anlegen (`stream_id`, `started_at`).
2. **Jedes Kandidaten-Event:**
   - Der Server ruft Create Stream Marker auf (`description` = Typ + Kurztext, max. 140 Zeichen) und speichert `position_seconds`.
   - Schlägt das fehl, wird der Offset aus Zeitstempel minus `started_at` berechnet und als „geschätzt“ markiert.
   - Kandidaten innerhalb von 20 Sekunden werden zu einem zusammengefasst.
3. **`stream.offline`:** warten, bis das VOD verfügbar ist.
   - VOD-ID über Get Videos (`type=archive`, passende `stream_id`) ermitteln.
   - Stream-Deck-Marker per Get Stream Markers (`video_id`) abholen und einsortieren.
4. **Bericht schreiben:** `data/reports/YYYY-MM-DD_<kategorie>.md` und `.json` (Ordner in `.gitignore`).
   - **Teil 1, Stream-Dokumentation:** Datum, Titel, Kategorie(n), Dauer; Raids (Raider, Uhrzeit, Zuschauer, Spiel des Raiders; aus `channel.raid`, die separate Raid-Statistik mit `!raidstats` bleibt unverändert, ADR 0012); Spielbewertung (siehe unten). Dazu (Nutzer, 05.11.2026):
     - Follows, Subs (neu/Resub) und Gifts mit Namen und Anzahl. Hinweis: `events.json` speichert gebündelte Effekte mit nur dem letzten Namen je Bündel; für den Bericht braucht es eine eigene Erfassung je Ereignis während der Session.
     - Hype Trains (Beginn, Ende, erreichtes Level); zusätzlich als Clip-Kandidat in Teil 2.
     - Watch-Serien (Watch Streaks), soweit über EventSub erfassbar [UNGEKLÄRT, ob und über welches Event Twitch geteilte Watch-Serien liefert].
     - Top 10 der häufigsten Chatter des Abends: Nachrichten je Nutzer aus `channel.chat.message` zählen (schon abonniert); ob Broadcaster und Bots ausgenommen werden [UNGEKLÄRT].
     - Whitelist-Auffälligkeiten der Session aus dem Prüfprotokoll `whitelist_checks.json` (ADR 0015, Nutzer 05.11.2026): wer beim Chatten selbst live war (mit Spiel; kann problematisch sein, muss aber nicht), wer seit mehr als 40 Tagen nicht aktiv ist, bei wem die Aktivität nicht feststellbar war. Zweck: die Whitelist anhand der Berichte überarbeiten.
     - In ferner Zukunft (nicht jetzt): genauere Statistik im Hintergrund, z. B. über mehrere Streams hinweg.
   - **Teil 2, Clip-Kandidaten** nach Zeit sortiert: `hh:mm:ss` · Typ · Kontext (Enigma-Text, Hype-Train-Level, Marker-Beschreibung) · Link `https://www.twitch.tv/videos/<vod_id>?t=<h>h<m>m<s>s`. Der Link startet etwa 20 Sekunden vor dem Moment.
5. **Optional:** Benachrichtigung „Bericht fertig“ über Home Assistant.

### Spielbewertung
- `!spielgut` und `!spielschlecht`, eine Stimme pro User-ID, jederzeit änderbar (die letzte zählt), nur während der Stream läuft.
- Bei einem Kategoriewechsel (`channel.update`) wird je Spiel getrennt gezählt, wichtig für gemischte Mittwochsabende.
- Ergebnis im Bericht: gut, schlecht, Anteil in Prozent, Zahl der Abstimmenden. Optional `!bewertung` für den Zwischenstand im Chat.
- **Idee (Nutzer, 05.11.2026): verdeckt abstimmen**, damit die Bewertung nicht offen im Chat steht. Optionen, noch nicht entschieden:
  - Flüstern an den Bot „DerBdu“ (z. B. „gut“/„schlecht“): EventSub `user.whisper.message` für das Bot-Konto, Scope des Bots `user:read:whispers` oder `user:manage:whispers` [UNGEKLÄRT, prüfen]. Setzt den Bot-Login voraus (OFFEN.md, Bot-Account). Einschränkung: Wer Flüstern von Fremden blockiert oder Twitch-Einschränkungen für neue Konten unterliegt, erreicht den Bot evtl. nicht [UNGEKLÄRT]. Bestätigung per Flüstern zurück bräuchte eine verifizierte Telefonnummer am Bot-Konto [UNGEKLÄRT].
  - Chat-Befehl wie geplant, der Server löscht die Nachricht sofort nach dem Zählen (Scope `moderator:manage:chat_messages`): kurz sichtbar, aber ohne neues Konto.
  - **Kanalpunkte-Belohnungen (vom Nutzer bevorzugt, 05.11.2026): je eine für „Vote für das Spiel“ und „Vote gegen das Spiel“. Namen [UNGEKLÄRT, Nutzer entscheidet],** sofern sich die Einlösung im Chat unsichtbar machen lässt und der Server sie trotzdem registriert. Erfassung über EventSub `channel.channel_points_custom_reward_redemption.add` (Scope `channel:read:redemptions`; eine vom Server per API angelegte Belohnung bräuchte `channel:manage:redemptions`) [UNGEKLÄRT, gegen die Twitch-Doku prüfen]. Eine Stimme je Nutzer, die letzte Einlösung zählt. Ob eine Einlösung ohne Texteingabe im Chat erscheint, ist [UNGEKLÄRT]; Test durch den Nutzer: Belohnung ohne „Zuschauer muss Text eingeben“ und mit „Warteschlange überspringen“ anlegen, einlösen, Chat beobachten. Kosten: z. B. 1 Kanalpunkt.
  - Vorschlag: Ist die Einlösung unsichtbar, die Bewertung direkt über Kanalpunkte bauen; sonst zuerst offen im Chat (1a) und verdeckt nachrüsten, sobald der Bot angebunden ist.
- Später optional als Overlay im Design des Polling-Widgets.
- Später (nach der Bot-Anbindung und wenn die Abstimmung zuverlässig läuft): Der Bot postet einmal pro Stunde den Zwischenstand und erinnert ans Abstimmen.

### Scopes (laut Vorlage; gegen die Twitch-Doku prüfen)
- `channel:manage:broadcast`: Create Stream Marker
- `user:read:broadcast`: Get Stream Markers (möglicherweise schon durch `channel:manage:broadcast` abgedeckt [UNGEKLÄRT])
- `channel:read:hype_train`: EventSub Hype Train
- ab Stufe 2: `editor:manage:clips` oder `channel:manage:clips`

Keiner dieser Scopes steht bisher in `SCOPES` (`.env.example`). Nach dem Ergänzen ist ein neuer Login über `/login` nötig.

## Spätere Stufen (Architektur offen halten, jetzt nicht bauen)
- **Stufe 2, Ein-Klick-Clip:** Kandidaten im Bericht auswählen. Der Server legt den Clip über Create Clip From VOD an (laut Vorlage `POST /helix/videos/clips`; `vod_id`, `vod_offset` = Ende des Clips, `duration` 5–60 s, `title`) [UNGEKLÄRT, Endpunkt und Parameter gegen die Twitch-Doku prüfen]. Nicht alle Kandidaten automatisch, weil Clips öffentlich sind.
- **Stufe 3, Shorts-Werkstatt:** Download über Get Clips Download (laut Vorlage offene Beta [UNGEKLÄRT]), hochkant mit Facecam und Branding schneiden, Untertitel aus den Transkripten, danach Buffer oder YouTube-Upload mit Termin.
- **Weitere Quellen:** Chat-Spitzen (Nachrichten pro 30 Sekunden deutlich über dem Median) und `!clip` für Zuschauer mit Rate-Limit.

## Rahmenbedingungen
- `node --check server.js` vor jedem Test.
- Keine Tokens in Berichten, Logs oder im Repository.
- Marker gibt es nur bei aktiver VOD-Speicherung. Bei einem Stream-Abbruch kann ein zweites VOD entstehen, dann Kandidaten dem richtigen VOD zuordnen.

## Abgleich mit Code, ADRs und AGENTS.md (05.11.2026)
- **Kandidaten sind keine Effekte.** Die Vorlage verlangt „neue Events über das zentrale Event-/Queue-Muster“. `scheduleEffect()` (ADR 0004) bündelt Ereignisse und sendet sie an Home Assistant; Kandidaten sollen aber einzeln mit Zeitpunkt erfasst werden und nicht zwingend Licht auslösen. Vorschlag: eigener Kandidaten-Sammler (`recordCandidate(type, meta)`) mit demselben Schema `{type, meta, timestamp}`; nur die optionale Meldung „Bericht fertig“ läuft über `scheduleEffect()`. [Entscheidung offen]
- **Neue EventSub-Typen:** `stream.offline`, `channel.update` (Kategoriewechsel) und `channel.hype_train.*` werden bisher nicht abonniert. Je eigene `subscribeTo…()`-Funktion im `session_welcome`-Block (AGENTS.md). Version der Hype-Train-Events [UNGEKLÄRT, prüfen].
- **Enigma-Antworten im Chat-Modus** kennt der Server schon: `POST /api/bdu/answer` mit `status: ok` (ADR 0014) ist der natürliche Erfassungspunkt. Antworten, die im Widget ohne Chat entstehen (Funksprüche des Kaleu), erreichen den Server bisher nicht; dafür bräuchte das Widget einen neuen Endpoint (berührt die ADRs im Widget-Repository).
- **Alarm-Endpoint:** zustandsändernd, also kein ungeschütztes GET (OFFEN.md Priorität 2, P2). Kommt der Aufruf aus Home Assistant, kommt er aus dem LAN; ein Loopback-Schutz wie bei `/token` (ADR 0013) passt dann nicht. Absicherung [UNGEKLÄRT], berührt K1.
- **Chat-Befehle für alle:** `!spielgut`/`!spielschlecht` sind für alle Zuschauer gedacht. Das weicht wie beim BdU-Chat (ADR 0014) vom Muster „Mod-Check“ in AGENTS.md ab; im ADR festhalten. Cooldown: eine Stimme je Nutzer, Mehrfachstimmen überschreiben nur.
- **Zustand während des Streams:** Nach ADR 0002 läge die Session im RAM und ginge bei einem Neustart mitten im Stream verloren. Vorschlag: Session und Kandidaten laufend in eine JSON-Datei schreiben (ADR 0001, `load…()`/`save…()`), Bericht daraus erzeugen.
- **Sicherheit von `/token`:** `/token` gibt den Broadcaster-Token an die Widgets weiter. Mit `channel:manage:broadcast` könnte ein abgegriffener Token auch Titel und Kategorie ändern, mit Clip-Scopes Clips anlegen. Vor dem Ergänzen der Scopes abwägen (P2). Option: Widgets erhalten einen Token mit weniger Rechten [UNGEKLÄRT, aufwendig].
- **VOD-Verfügbarkeit:** Das Archiv-Video existiert bei Twitch nach meinem Kenntnisstand schon während des Streams; eine lange Wartezeit nach `stream.offline` ist dann unnötig [UNGEKLÄRT, prüfen].
- **Testdaten:** Ein Teststream schreibt Berichte und setzt echte Marker. Das berührt K8 (Test- und Live-Daten trennen).

## Vorschlag Teilschritte (Stufe 1)
1. **1a Spielbewertung:** `stream.online`/`stream.offline`/`channel.update` abonnieren, Stimmen je Spiel zählen und in einer JSON-Datei halten, `!bewertung`. Keine neuen Scopes nötig [prüfen], eigenständig testbar. Verdeckte Abstimmung später (siehe Spielbewertung).
2. **1b Kandidaten-Sammler:** `recordCandidate()`, Erfassung von Enigma-Antworten (Chat-Modus), Offset aus `started_at` (geschätzt). Noch ohne Marker und ohne neue Scopes.
3. **1c Bericht:** nach `stream.offline` VOD-ID ermitteln, Bericht als `.md`/`.json` schreiben (Teil 1 mit Raids, Teil 2 Kandidaten).
4. **1d Marker und Hype Train:** neue Scopes und neuer Login, Create Stream Marker, Get Stream Markers, Hype-Train-Events.
5. **1e Alarm-Endpoint:** nach Klärung der Absicherung.

## Akzeptanzkriterien
- Nach einem Teststream liegt ein Bericht mit allen Enigma-Antworten, Alarm-Tasten, Stream-Deck-Markern und Hype Trains vor.
- Jeder Link springt auf etwa 10 Sekunden genau an die richtige Stelle im VOD.
- Jede Person zählt bei der Bewertung einmal, geänderte Stimmen werden übernommen.
