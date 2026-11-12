# Spec: Intro-Topics („Topics of the day“)

Stand: Entwurf 12.11.2026. Fahrplan: [FAHRPLAN.md](../FAHRPLAN.md). Entscheidung: [ADR 0021](../adr/0021-intro-topics-modul.md). Stream-Deck-Seite: [stream-deck.md](stream-deck.md).

## Ziel
Beim Intro in der Vollbild-Cam zeigt eine ruhige, halbtransparente Liste die Themen des Tages (Neuigkeiten, Streamplan …). Der Streamer hakt sie per Stream Deck ab. Der Server hält den Zustand; Widget, Stream Deck und Home Assistant folgen ihm.

## Begriffe
- **Liste:** die Themen, in der Webkonsole bearbeitbar, gespeichert in `topics.json`.
- **Schritt:** Zahl `step` von `0` bis `2 × Anzahl`. Aus ihr ergibt sich der Status jedes Themas. Zurück heißt `step − 1`.
- **Sichtbar:** ob die Liste eingeblendet ist. Unabhängig vom Schritt.

## Status je Thema
Für Thema `i` (ab 0):

| Bedingung | Status | Darstellung im Widget |
|---|---|---|
| `step < 2i + 1` | `offen` | halbtransparent |
| `step = 2i + 1` | `aktiv` | etwas weniger transparent, hervorgehoben |
| `step ≥ 2i + 2` | `erledigt` | abgehakt, Text ausgegraut und noch transparenter; **nicht** durchgestrichen (Nutzer, 12.11.2026) |

Alle erledigt: `step = 2 × Anzahl`.

## Verhalten

### Taste „Weiter“ (`POST /api/topics/next`)
- Liste ausgeblendet: nur einblenden, `step` bleibt. So ändert sich nichts unsichtbar.
- Sonst `step + 1`, höchstens bis „alle erledigt“. Das ergibt die gewünschte Folge: 1. Klick aktiv, 2. Klick erledigt, 3. Klick nächstes Thema aktiv.
- Wird damit das letzte Thema erledigt, startet der **Ausblend-Timer** (5 s). Danach `visible = false` mit Grund `auto`; das Widget blendet sanft aus.

### Taste „Zurück“ (`POST /api/topics/back`)
- `step − 1`, nicht unter 0. Bricht den Ausblend-Timer ab. Ausgeblendet: nur einblenden (wie „Weiter“).

### Taste „Ein/Aus“ (`POST /api/topics/toggle`)
- Schaltet `visible` um, `step` bleibt erhalten. Bricht den Ausblend-Timer ab.
- Nach manuellem Einblenden einer fertigen Liste (z. B. Recap am Streamende) startet **kein** Ausblend-Timer; sie bleibt, bis sie wieder ausgeblendet wird.

### Reset (`POST /api/topics/reset`, Webkonsole, Konsole `topics reset`)
- `step = 0`, `visible = false`, Timer ab.
- Vorschlag [vom Nutzer zu bestätigen]: automatisch bei einer **neuen** Stream-Session (`stream.online`, nicht bei Wiederaufnahme nach Unterbrechung).

### Liste bearbeiten
- Webkonsole, Reiter „Topics“: Themen hinzufügen, umbenennen, verschieben, löschen; speichern schreibt `topics.json` und setzt `step = 0`.
- Grenzen: 1–10 Themen (Empfehlung im UI: höchstens 7, sonst schlecht lesbar), Titel 1–60 Zeichen, ohne Zeilenumbruch.

### Modul
- Schalter „Intro-Topics“ in der Gruppe „Optionale Module“ (wie BdU-Chat). Aus: Endpoints antworten `503`, das Widget bleibt unsichtbar.

## Datenformate

`topics.json` (persistente Liste, ADR 0001):
```json
{ "items": [ { "title": "Neuigkeiten" }, { "title": "Streamplan" } ], "updated_at": "2026-11-12T18:00:00.000Z" }
```

Zustand (Antwort aller Topics-Endpoints und Inhalt des Ereignisses `state`):
```json
{
  "enabled": true,
  "visible": true,
  "hide_reason": null,
  "step": 3,
  "total": 4,
  "current": 1,
  "complete": false,
  "items": [
    { "title": "Neuigkeiten", "status": "erledigt" },
    { "title": "Streamplan",  "status": "aktiv" },
    { "title": "Community",   "status": "offen" },
    { "title": "Heute im Spiel", "status": "offen" }
  ],
  "revision": 17
}
```
- `current`: Index des aktiven oder zuletzt erledigten Themas, `null` bei `step = 0`.
- `hide_reason`: `"auto"` nach dem Ausblend-Timer, `"manual"` nach „Ein/Aus“, sonst `null`. Das Widget nutzt es nur für die Länge der Ausblendung.
- `revision`: zählt jede Änderung hoch; Widget und Plugin verwerfen ältere Stände.

## Endpoints
Zugriff nach [stream-deck.md](stream-deck.md), Abschnitt „Zugriff“.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/topics` | Zustand lesen |
| GET | `/api/topics/stream` | Server-Sent Events: `state` beim Verbinden und nach jeder Änderung, Ping alle 30 s |
| POST | `/api/topics/next` | Weiter |
| POST | `/api/topics/back` | Zurück |
| POST | `/api/topics/toggle` | Ein/Aus |
| POST | `/api/topics/reset` | Reset |
| GET/POST | `/api/admin/topics` | Liste lesen/speichern (Webkonsole, Schutz wie alle `/api/admin/…`) |

## Effekte (Home Assistant, optional)
Über `scheduleEffect(type, meta)` (ADR 0004); Payload-Schema unverändert. Die Lichtlogik liegt in Home Assistant.

| `type` | Wann | `meta` |
|---|---|---|
| `topic_active` | ein Thema wird aktiv | `{ index, title, total }` |
| `topic_done` | ein Thema wird erledigt | `{ index, title, total }` |
| `topics_complete` | das letzte Thema wird erledigt | `{ total }` |

Hinweise:
- Die Effekt-Queue bündelt gleiche Typen 2,5 s und hält 4 s Abstand. Lichtwechsel kommen also mit bis zu einigen Sekunden Verzögerung. Für „Talk-Licht → Spiel-Licht“ eignet sich `topics_complete`.
- Im Effekt-Modus `off` kommen keine Topic-Effekte an.
- **Kein Log (Nutzer, 12.11.2026):** Topic-Effekte erscheinen standardmäßig in keinem Log: keine Konsolenzeilen („Effekt eingereiht/ausgelöst“), kein Live-Log, kein Event-Log (`events.json`), keine letzten Effekte in der Webkonsole, keine Zählung in Statistik und Stream-Bericht. Umsetzung als Liste stiller Effekt-Typen (`SILENT_EFFECT_TYPES`) in `enqueueEffect`/`triggerEffect`; Queue, Abstand und Effekt-Modus gelten unverändert.
- **Testschalter für Funktionstests:** Konsolenbefehl `topics debug on|off`, nur im Arbeitsspeicher, nach Neustart aus. Eingeschaltet erscheinen Topic-Effekte und Topic-Tastendrücke in Konsole und Live-Log; Event-Log und Statistik bleiben auch dann unberührt.
- Fehler beim Senden an Home Assistant bleiben sichtbar (einmal je Fehlertext über `logIfChanged`), damit ein kaputter Webhook auffällt [Festlegung von Claude, vom Nutzer zu bestätigen].
- Zurück löst keinen Effekt aus.

## Widget ([CheckTalk-Widget](https://github.com/BombingFritz/CheckTalk-Widget), MIT)
- Verbindet sich per `EventSource` mit `/api/topics/stream`, baut neu auf, wenn der Server fehlt; ohne Verbindung unsichtbar.
- Animiert nur: Abhaken (Haken, Text ausgegraut), Zurücktreten erledigter Themen, Hervortreten des aktiven Themas, Aus- und Einblenden der Liste. Keine weiteren Bewegungen.
- Ein Design für horizontal und vertikal: Das Widget füllt seine Browserquelle, Schriftgröße folgt der Quellgröße. Lage und Größe legt die OBS-Quelle je Canvas fest. Ausgabe beim Nutzer: 2K horizontal, vertikal über ein Dualstream-Plugin im selben OBS; beide Quellen sind gleichzeitig verbunden und zeigen denselben Stand.
- URL-Parameter: `server` (Standard `http://localhost:3000`), `theme` (`brand` | `neutral`), `demo=1` (ohne Server, Tasten im Browser).

## Nicht-Ziele
- Keine Zuschauer-Interaktion, keine Chat-Ausgabe.
- Keine mehreren gespeicherten Listen (später denkbar).
- Kein Timer je Thema.

## Akzeptanzkriterien
- Folge mit 3 Themen: 6 × Weiter ergibt aktiv/erledigt im Wechsel, danach blendet die Liste nach 5 s aus.
- Zurück innerhalb der 5 s bricht das Ausblenden ab.
- Ein/Aus nach dem Ausblenden zeigt die fertige Liste dauerhaft.
- Weiter bei ausgeblendeter Liste blendet nur ein.
- Neustart des Servers: Liste bleibt, `step = 0`, ausgeblendet.
- Zwei Widgets (horizontal, vertikal) zeigen stets denselben Stand.
- Aufruf von einem anderen Rechner im LAN: 403. Aufruf mit fremder `Origin`: 403.
- Ohne Testschalter erzeugt ein kompletter Durchlauf keine einzige Zeile in Konsole, Live-Log, `events.json` und Statistik.
- Tests in `test/topics-test.js`, eingetragen in `test/run-all.js`.

## Berührte Dateien
Neu: `lib/topics.js`, `topics.json` (Laufzeit, nicht im Repository), `test/topics-test.js`. Geändert: `server.js` (Verdrahtung, Endpoints, Modulschalter, Konsolenbefehl `topics`, stille Effekt-Typen), `public/admin/` (Reiter „Topics“).

## Lizenzbereich
Serverkern (Lizenz des Servers), kein MIT-Modul. Das Widget ist ein eigenständiges MIT-Modul und nutzt nur die hier beschriebene Schnittstelle.
