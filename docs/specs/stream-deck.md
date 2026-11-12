# Spec: Stream-Deck-Anbindung

Stand: Entwurf 12.11.2026. Fahrplan: [FAHRPLAN.md](../FAHRPLAN.md). Entscheidung: [ADR 0020](../adr/0020-stream-deck-anbindung.md).

## Ziel
Das Stream Deck steuert Server-Funktionen (zuerst Intro-Topics und Clip-Moment) über eine einheitliche, abgesicherte HTTP-Schnittstelle. Langfristig über ein eigenes Plugin mit fertigen Aktionen und Live-Anzeige auf den Tasten; bis dahin über ein beliebiges HTTP-Plugin.

## Zugriff (gilt für alle Endpoints, die das Stream Deck aufruft)
- Zustandsänderungen nur per **POST** mit `Content-Type: application/json`; der Body darf `{}` sein.
- Nur vom eigenen Rechner: Loopback-Adresse und Host `localhost`/`127.0.0.1`/`[::1]` (wie `/token`, ADR 0013).
- Ohne `Origin` (Stream Deck, `curl`) oder mit erlaubter Herkunft; fremde Herkünfte lehnt die bestehende Prüfung mit 403 ab.
- Antwort immer JSON: `{ "ok": true, ... }` bzw. `{ "ok": false, "error": "…" }`. Modul aus: 503. Kein laufender Stream, wo einer nötig ist: 409.
- Antwort schnell (Ziel unter 200 ms); längere Arbeit läuft danach weiter.

## Endpoints

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/deck` | Übersicht für das Plugin: Serverversion, verfügbare Aktionen, Modulstatus |
| POST | `/api/topics/next`, `/back`, `/toggle`, `/reset` | siehe [intro-topics.md](intro-topics.md) |
| GET | `/api/topics/stream` | Live-Zustand für Taste und Widget |
| POST | `/api/clip/mark` | Clip-Moment festhalten |

### `GET /api/deck`
```json
{
  "server": "twitch-companion-js-server",
  "version": "1.x",
  "actions": {
    "topics": { "enabled": true },
    "clip":   { "enabled": true, "stream_live": false }
  }
}
```

### `POST /api/clip/mark`
- Body optional: `{ "note": "Kurztext, max. 100 Zeichen", "source": "streamdeck" }`.
- Legt einen Clip-Kandidaten vom Typ `alarm` an (Statistik Stufe 6, Stream-Bericht 1e): Uhrzeit, berechnete Position im Stream, Notiz. Twitch-Marker setzt der Server erst, wenn die Scopes aus `stream-bericht.md` 1d da sind.
- Ohne laufenden Stream: 409, nichts gespeichert.
- Zwei Aufrufe innerhalb von 20 s ergeben einen Kandidaten (Regel aus `stream-bericht.md`).
- Gedacht als zusätzliche Aktion in vorhandenen Multi-Aktionen (Alarm-Taste, Marker-Taste).

## Wege vom Stream Deck zum Server

| Weg | Wann |
|---|---|
| Eigenes Plugin ([TwitchCompanion_Streamdeck_Plugin](https://github.com/BombingFritz/TwitchCompanion_Streamdeck_Plugin), MIT) | Ziel. Fertige Aktionen, Live-Anzeige, Fehleranzeige, Profil |
| Fertiges HTTP-Plugin, z. B. „API Request“ oder „API Ninja“ | Übergang und für Nutzer, die das eigene Plugin nicht installieren |
| Eingebaute Aktion „Website“ (nur GET) | nicht unterstützt: GET ändert keinen Zustand (ADR 0018) |

## Eigenes Plugin

### Grundlagen (Stand SDK `@elgato/streamdeck` 3.0.4, Okt. 2026)
- Node.js-Plugin, die Laufzeit bringt die Stream-Deck-Software mit. Gerüst per `@elgato/cli` (`streamdeck create`), Entwicklung mit `streamdeck link`, Paket mit `streamdeck pack` → `.streamDeckPlugin`, Installation per Doppelklick, kein Marketplace nötig.
- Tasten: `setTitle`, `setImage` (auch SVG), `setState` (2 Zustände), `showOk`, `showAlert`. Titel und Bild nur, solange der Nutzer sie nicht selbst festgelegt hat.
- Aktionen sind standardmäßig in Multi-Aktionen und Key Logic (ab Stream Deck 7.0: drücken, doppelt, halten) nutzbar.
- Ein Plugin bekommt nur die Tastendrücke seiner eigenen Aktionen. Vorhandene Tasten werden nicht „mitgehört“; sie werden zu Multi-Aktionen mit der Plugin-Aktion.
- Profile können mit dem Plugin ausgeliefert und bei der Installation angeboten werden (`Profiles` im Manifest).
- Offen: Mindestversionen von Stream-Deck-Software und Node.js gegen die Elgato-Doku prüfen (docs.elgato.com war bei der Recherche nicht erreichbar) [UNGEKLÄRT].

### Aktionen (Plugin 0.1)
| Aktion | Aufruf | Anzeige auf der Taste |
|---|---|---|
| Topics weiter | `POST /api/topics/next` | „2/5“ und Kurztitel des aktuellen Themas; „fertig“; ausgeblendet gedimmt |
| Topics zurück | `POST /api/topics/back` | – |
| Topics ein/aus | `POST /api/topics/toggle` | Zustand 0/1 = ausgeblendet/sichtbar |
| Clip-Moment | `POST /api/clip/mark` | `showOk` bei Erfolg, `showAlert` bei Fehler oder ohne Stream |

- Globale Einstellung: Server-Adresse (Standard `http://localhost:3000`).
- Live-Anzeige über `GET /api/topics/stream`; ohne Server zeigen alle Tasten des Plugins einen Fehlerzustand.
- Vorschlag für eine einzige Topics-Taste per Key Logic: drücken = weiter, doppelt = zurück, halten = ein/aus.

## Lizenzbereich
Die Endpoints gehören zum Serverkern (Lizenz des Servers). Das Plugin ist ein eigenständiges MIT-Modul, nutzt nur diese Schnittstelle und enthält keinen kopierten Servercode.

## Nicht-Ziele
- Keine Lichtsteuerung über das Plugin; Licht bleibt bei Home Assistant.
- Keine OBS-Steuerung über den Server.
- Effekte an/aus bleiben in der Webkonsole (ADR 0018).

## Akzeptanzkriterien
- Alle Stream-Deck-Endpoints lehnen Aufrufe aus dem LAN und mit fremder Herkunft ab und ändern bei GET nichts.
- `curl -X POST -H "Content-Type: application/json" -d "{}" http://localhost:3000/api/topics/next` funktioniert ohne weitere Einrichtung.
- Plugin: Taste zeigt den Stand innerhalb von 1 s nach einer Änderung, auch wenn die Änderung aus der Webkonsole kam.
