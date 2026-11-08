# Architekturentscheidungen (ADR) – Übersicht

Ein ADR hält fest, **warum** etwas so gebaut ist. ADRs werden nicht gelöscht oder umgeschrieben: Ändert sich eine Entscheidung, bekommt das ADR einen Nachtrag oder ein neues ADR verweist darauf. Deshalb wächst der Ordner mit der Zeit; diese Seite ordnet ihn nach Themen.

Wie etwas **heute** funktioniert, steht in [ARCHITEKTUR.md](../ARCHITEKTUR.md); was ein Feature tun soll, in den [Specs](../specs/).

## Nach Themen

### Grundlagen des Servers
| ADR | Worum es geht |
|---|---|
| [0001](0001-json-dateien-statt-datenbank.md) | Jede Datenart liegt in einer eigenen JSON-Datei, keine Datenbank. |
| [0002](0002-einzelprozess-mit-ram-zustand.md) | Ein Node.js-Prozess hält alle Verbindungen und den flüchtigen Zustand im Arbeitsspeicher. |
| [0007](0007-eventsub-per-websocket.md) | Twitch-Ereignisse kommen über eine dauerhafte EventSub-WebSocket-Verbindung. |

### Widgets und Sicherheit
| ADR | Worum es geht |
|---|---|
| [0003](0003-widgets-nur-ueber-server-endpoints.md) | Widgets holen Token und Daten beim Server, nie mit eigenen Secrets. |
| [0013](0013-zugriffsschutz-token-und-herkunft.md) | `/token` und Login nur vom eigenen Rechner, Browser-Herkünfte per Liste. Präzisiert 0003; Nachträge: OBS-Test, Login nur lokal. |
| [0018](0018-webkonsole-nur-lokal-mit-reitern.md) | Webkonsole unter `/TwitchCompanionAdmin`, nur am Streaming-PC, mit Reitern. Ergänzt 0013, Nachträge in 0006 und 0010. |

### Effekte und Home Assistant
| ADR | Worum es geht |
|---|---|
| [0004](0004-effekte-nur-ueber-scheduleeffect.md) | Alle Licht- und Show-Effekte laufen über `scheduleEffect` und die Effekt-Queue. |
| [0008](0008-sub-gift-effekte-aus-chat-notification.md) | Sub- und Gift-Effekte löst die Chat-Ankündigung aus, ein Gift-Bomb nur einen Effekt. |
| [0009](0009-entdoppelung-message-id-und-zeitfenster.md) | Doppelt gelieferte Twitch-Ereignisse werden erkannt und nur einmal verarbeitet. |
| [0010](0010-effekt-modi-mit-persistenz-und-http-steuerung.md) | Effekt-Modi `auto`/`manual`/`off`, umschaltbar per Stream Deck und Konsole. |

### Raids und Shoutouts
| ADR | Worum es geht |
|---|---|
| [0005](0005-shoutout-ueber-helix-api.md) | Shoutouts über die Twitch-API statt Chat-Befehl. |
| [0006](0006-whitelist-nur-per-konsole.md) | Die Shoutout-Whitelist wird nur per Konsole gepflegt. |
| [0011](0011-raid-begruessung-per-warteschlange.md) | Raid-Begrüßungen über eine Warteschlange mit Mindestabstand. |
| [0012](0012-quartals-schluessel-raid-statistik.md) | Raid-Statistik je Quartal bis 2026, ab 2027 je Jahr. |
| [0015](0015-aktivitaetspruefung-vor-whitelist-shoutout.md) | Whitelist-Shoutout nur für Kanäle, die in den letzten 40 Tagen aktiv waren; mit Prüfprotokoll. |

### UBOAT-Stream und Chat-Funktionen
| ADR | Worum es geht |
|---|---|
| [0014](0014-bdu-chat-ueber-widget.md) | `!BdU`: Der Server prüft Limits, die KI-Antwort kommt vom Enigma-Widget. |
| [0016](0016-uboat-crew-aus-spielstand.md) | `!soldbuch`: Crew-Daten aus dem UBOAT-Spielstand, Parser als eigenes Modul. |
| [0017](0017-bot-account-derbdu.md) | Bot-Account „DerBdu“ sendet BdU- und Soldbuch-Antworten. Ändert den Absender aus 0014 und 0016. |

## Herkunft

- **Nachträglich festgehalten** aus vorhandenem Code und älterer Doku (Entscheidung lag schon vor, Begründung und Alternativen teils `[UNGEKLÄRT]`): 0001–0011; ausdrücklich „aus dem Code abgeleitet“ sind 0002 und 0007.
- **Mit dem Nutzer entschieden oder geändert:** 0003 (Präzisierung), 0012 (Änderung 05.11.2026), 0013–0018. Was Claude dabei selbst festgelegt hat, steht im jeweiligen Status (z. B. 0017).

## Neues ADR anlegen

1. Nächste freie Nummer, Dateiname `NNNN-kurzer-titel.md`, Aufbau wie die vorhandenen (Status, Kontext, Entscheidung, Verworfene Alternativen, Konsequenzen).
2. Im Status festhalten, wer entschieden hat; eigene Festlegungen von KI-Assistenten als solche kennzeichnen.
3. Hier eine Zeile in der passenden Gruppe ergänzen (oder eine neue Gruppe anlegen) und Verweise auf betroffene ADRs eintragen.
4. Ändert sich eine bestehende Entscheidung: dort einen Nachtrag mit Datum, nicht den alten Text überschreiben.
