# Kontext: Einordnung im Stream-Ökosystem

Quelle: „Genereller Kontext Fritz, Okt. 2026“ (vom Nutzer gepflegtes Word-Dokument, am 08.11.2026 mit dem Stand von Server, Enigma- und Polling-Widget abgeglichen). Die Quelle ist eine lebendige Beschreibung und keine technische Spezifikation. Hier steht nur, was für diesen Server relevant ist. Bei Abweichungen gilt der Code (siehe AGENTS.md); Konflikte stehen in [OFFEN.md](OFFEN.md) unter „Abgleich mit dem Gesamtkontext“.

## Ziel des Ökosystems

Der Twitch-Stream soll interaktiver, immersiver und unterhaltsamer werden: Zuschauer-Interaktion (Widgets, Abstimmungen, Spiele, Chat-Reaktionen), Show-Effekte (Licht, WLED, Matter, später physische Effekte) und Stream-Automatisierung (Shoutouts, Raid-Begrüßung, Sub-Goals, Status). Schwerpunkt sind unter anderem U-Boot-Simulationen. Langfristig soll daraus eine zentrale, erweiterbare Infrastruktur werden („Stream-OS“) statt einzelner Tools.

## Rolle dieses Servers

Der Server ist die zentrale Software-Schnittstelle zwischen Twitch, den OBS-Widgets und Home Assistant:

```
Twitch (EventSub / Helix)
  └─ Twitch Companion JS server
       ├─ OBS-Browser-Widgets   (holen Token/Daten über HTTP)
       ├─ Effekt-Queue           (auto / manual / off)
       ├─ Bot-Account „DerBdu“   (sendet BdU- und Soldbuch-Antworten im Chat)
       └─ Home-Assistant-Webhook ──> Scripts, Szenen, WLED, Matter
UBOAT-Spielstände ──nur lesen──> Server (Soldbuch)
Stream Deck ──HTTP──> Server (Effekt-Modus, Bestätigung)
Stream Deck ──────> Home Assistant, OBS (direkt, nicht über den Server)
Arduino / ESP32 ──> Home Assistant (ESPHome, Serial, Webhook) bzw. USB-HID an den PC
```

Physische Eingaben (ESP32/ESPHome, Zugschnurcontroller) und Lichteffekte vom Stream Deck laufen direkt über Home Assistant. Sie berühren diesen Server nicht.

## Laufzeitmodell

| System | Betrieb | Bezug zum Server |
|---|---|---|
| Home Assistant | dauerhaft | Empfänger des Webhooks `HA_WEBHOOK_URL` |
| Streaming-PC | bei Arbeit oder Stream | Host des Servers |
| Dieser Server | vor dem Stream per Startskript | – |
| OBS | per Startskript, nach dem Server | Browser-Widgets pollen den Server |
| WLED-Controller | per Startskript | nur indirekt über Home Assistant |
| Stream Deck | bei Stream oder Arbeit | ruft Effekt-Endpoints auf |
| Spiel UBOAT | bei UBOAT-Streams | schreibt Spielstände, die der Server liest |

Startreihenfolge laut Kontext: zuerst der Server, danach mit zeitlichem Abstand OBS und der WLED-Controller. So initialisieren die OBS-Browser-Widgets zuverlässig. Den Server selbst startet `AuthServer.cmd` aus diesem Repository (Windows, eigenes Konsolenfenster im Projektordner). Die Gesamtreihenfolge mit den Wartezeiten steuert ein Skript auf dem Stream Deck: Es startet `AuthServer.cmd`, danach OBS und den WLED-Controller (Nutzer, 04.11.2026). Das Stream-Deck-Skript liegt nicht in diesem Repository; Wartezeiten [UNGEKLÄRT].

## Nachbarsysteme und Schnittstellen

### Home Assistant
- Empfängt Webhooks im Schema `{type, count, meta, timestamp}` (siehe ARCHITEKTUR.md, Abschnitt 8) und leitet sie an Scripts, WLED und Matter weiter.
- WLED wird über HA-Entities gesteuert, nicht direkt über die WLED-API. Der Server spricht deshalb nur Home Assistant an.
- Geplant: aufwendigere Lichtszenen je Eventtyp, Nebelmaschine, Aktoren für Interaktions-Gags. Für den Server heißt das: neue `type`-Werte über `scheduleEffect()`, das Schema bleibt gleich.

### OBS-Widgets
| Widget | Zweck | Status laut Kontext |
|---|---|---|
| Polling-Widget (SpargelPoll) | Abstimmungen mit Branding, Animation, Sound, Chat-Ausgabe; Referenz für neue Widgets. Repository `BombingFritz/TwitchPoll` (öffentlich), Stand 0.8.2: holt Token, Client-ID und Broadcaster-ID über `/token` | aktiv |
| Coinflip-Widget | Entscheidungshilfe, auch bei Poll-Gleichstand. Repository `BombingFritz/CoinFlip` (privat), Stand 0.1.0 | aktiv |
| Enigma-Widget | immersive Kommunikation für U-Boot-Streams; Repository `BombingFritz/Uboat-Widget` (öffentlich, MIT ab 1.3.1). Ab 1.2.0 Chat-Modus über den Server (`!BdU`, ADR 0014), aktuell 1.3.0 mit Benchmark zur Modellwahl; funktioniert ohne Server, der Chat-Modus ist dort optional und eingeklappt | aktiv |
| Companion-Widget | Anzeige und Steuerung von Sub-Goals, Effekten, Server-Daten | geplant / in Arbeit |
| Spiel-Statistik-Widgets | spielbezogene Statistiken | angefangen |
| Flavor-KI-Widgets | thematische KI-Interaktion | Idee / angefangen |

Widget-Prinzipien laut Kontext:
- Widgets holen Access-Token, Client-ID und Broadcaster-ID über `/token` und rufen danach Twitch Helix direkt auf oder nutzen Server-Endpoints (ADR 0003, präzisiert; Zugriffsschutz in ADR 0013).
- Twitch-Credentials liegen nie im Widget-Frontend.
- Flüchtiger Zustand darf im Widget liegen. Daten, die über einen Stream hinaus gelten oder korrigierbar sein sollen, kommen später persistent in den Server oder gezielt in den Browser-Speicher.

Welche Widgets welche Endpoints nutzen, ist hier nicht dokumentiert [UNGEKLÄRT].

### Bot-Account „DerBdu“
- Eigenes Twitch-Konto mit „Chat Bot“-Abzeichen und Moderatorrolle im Kanal. Es antwortet als BdU auf `!BdU` (Antwort vom Enigma-Widget) und gibt das Soldbuch aus. Raid- und Whitelist-Shoutouts kommen weiter vom Broadcaster (ADR 0017).
- Kein eigener Prozess: Der Server sendet im Namen des Bots. Lehnt Twitch den Bot ab, springt der Broadcaster ein.
- Einmalige Einrichtung: `/mod DerBdu` im Chat und `/login-bot` am Streaming-PC. Ein- und Ausschalten der Chat-Module im Reiter „Einstellungen“ der Webkonsole oder per Konsole (`bdu`/`uboat activate|deactivate`).
- Später denkbar: weitere Nachrichten über den Bot, Umstellung per Konsole, Bewertungen per Flüstern an den Bot (siehe OFFEN.md).

### Spiel UBOAT (Soldbuch)
- Zuschauer sind im Spiel Crewmitglieder. Mit `!soldbuch` erhalten sie die Daten „ihres“ Matrosen aus dem neuesten Spielstand (ADR 0016).
- Der Server liest die Spielstände nur, nach dem Speichern und erst nach kurzer Ruhezeit; am Spiel und an den Spielständen ändert sich nichts. Antworten nur in der Twitch-Kategorie UBOAT.
- Zuordnung Twitch-Name ↔ Name im Spiel automatisch, abweichende Namen per Konsole (`uboat map`).
- Später geplant: Widget „Heute an Bord“ (Daten über `/api/uboat/crew`), Crew-Ereignisse als Effekte und im Stream-Bericht.

### Stream Deck
- Heute: OBS-Szenen und Overlays, Sounds, Videos, HA-Lichteffekte, Startskript, Werbung, Marker, Audio.
- Laut Kontext geplant: Widget-Zustände und Show-Abläufe steuern. Effekt-Modus und Bestätigung laufen nicht über das Stream Deck, sondern über den Reiter „Einstellungen“ der Webkonsole (Nutzer, 08. und 09.11.2026, ADR 0010, ADR 0018).

## Leitlinien mit Bezug zum Server

- Neue Twitch-Events laufen über die zentrale Effekt-Queue (`scheduleEffect`) und bekommen klare `type`-Werte. Sie gehen nie direkt an Home Assistant (ADR 0004).
- Neue Hardware wird über Home Assistant angebunden, nicht über den Server.
- Lokale Kommunikation bevorzugen. Das LAN liegt hinter der Router-Firewall.
- Aktuelle Priorität: Standardisierung und Entwicklung über GitHub vor dem Ausbau neuer Features.

## Entwicklungsrichtungen mit Bezug zum Server

- ~~Shoutout-Branch (40-Tage-Prüfung) zusammenführen~~ – neu umgesetzt (ADR 0015).
- Companion-Widget: braucht Server-Daten zu Sub-Goal, Effekt-Modus, Queue und Events.
- Unterschiedliche WLED- und Matter-Effekte je Eventtyp (Server: `type`/`meta` liefern, Logik in Home Assistant).
- Persistente, korrigierbare Zustände über einzelne Streams hinaus.
- Stream-Daten, langfristige Daten und Testdaten besser trennen.
