# ADR 0020: Stream-Deck-Anbindung über POST-Endpoints und eigenes Plugin

**Status:** Vorgeschlagen (12.11.2026). Grundsatz vom Nutzer bestätigt (eigenes Plugin als Ziel, Server-Schnittstelle zuerst). Pfade, Antwortformat und JSON-Pflicht hat Claude festgelegt.

**Kontext:** Das Stream Deck soll Server-Funktionen auslösen: Intro-Topics (ADR 0021) und Clip-Momente aus vorhandenen Multi-Aktionen (ADR 0019, „Alarm und Marker“). Die eingebaute Aktion „Website“ kann nur GET; GET-Endpoints mit Zustandsänderung hat ADR 0018 entfernt. Die Elgato-Hilfe nennt „GET request in background“ für Webhooks; Nutzer berichten von Aussetzern. Laut KONTEXT.md spricht das Stream Deck bisher nur Home Assistant und OBS direkt an.

**Entscheidung:**
- Der Server bietet für das Stream Deck POST-Endpoints mit JSON, nur vom eigenen Rechner (Loopback und Host wie `/token`, ADR 0013), ohne `Origin` oder mit erlaubter Herkunft.
- Für Live-Anzeigen gibt es Server-Sent-Events-Endpoints je Funktion (Muster `/api/bdu/stream`, ADR 0014) und eine Übersicht `GET /api/deck`.
- Ziel ist ein eigenes Stream-Deck-Plugin im Repository `BombingFritz/TwitchCompanion_Streamdeck_Plugin` (MIT), eines für alle Server-Funktionen. Bis dahin funktionieren dieselben Endpoints mit fertigen HTTP-Plugins.
- Die Schnittstelle steht in `docs/specs/stream-deck.md` dieses Repositories; das Plugin-Repository verweist darauf.

**Verworfene Alternativen:**
- Aktion „Website“ mit GET: widerspricht ADR 0018; keine Rückmeldung auf der Taste.
- Umweg über Home Assistant (Stream Deck → HA → Server): setzt HA voraus, entgegen der Produktausrichtung in AGENTS.md (Nutzer ohne HA zuerst).
- Steuerung über OBS (Hotkeys oder obs-websocket an das Widget): Zustand läge im Widget, Effekte und Stream-Bericht bekämen nichts davon mit, zwei Widgets (horizontal, vertikal) liefen auseinander.
- Ein Plugin je Modul: mehr Pflege, mehrfache Server-Einstellungen beim Nutzer.

**Konsequenzen:**
- Erste Endpoints, die ohne `Origin` Zustand ändern dürfen. Restlücke wie bei ADR 0013: Herkunft `null` (abgeschottete iframes) ist erlaubt.
- Ein weiteres Repository mit Build (Node, TypeScript laut SDK-Vorlage) und Pflege bei SDK-Änderungen.
- Lizenzbereiche nach der Projektvorgabe vom 12.11.2026: Endpoints sind Serverkern, das Plugin ist ein eigenständiges MIT-Modul.
- Ein Plugin sieht nur Drücke seiner eigenen Aktionen; vorhandene Tasten müssen zu Multi-Aktionen erweitert werden.
