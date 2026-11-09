# Twitch Companion JS server

Node.js/Express-Dienst für Twitch-OAuth2 mit automatischem Token-Refresh. Er hält eine EventSub-WebSocket-Verbindung und automatisiert Raid-Begrüßungen, Shoutouts, eine Whitelist sowie Licht-Effekte über einen Home-Assistant-Webhook. Browser-Widgets (z. B. OBS-Overlays) lesen Daten über HTTP-Endpoints dieses Servers und benötigen keine eigenen Twitch-Secrets.

## Setup

Hinweis: Liegt der Projektordner in OneDrive o. Ä., werden `.env` und `tokens.json` (Zugangsdaten) mit synchronisiert. Im Betrieb bisher ohne Probleme. Meldet Git Fehler (z. B. `index.lock`, beschädigtes Repository), den Klon außerhalb des Sync-Ordners neu anlegen und die Laufzeitdateien hineinkopieren.

1. Node.js installieren, mindestens Version 18 (Vorgabe von Express 5).
2. Abhängigkeiten installieren: `npm install` (liest `package.json` und `package-lock.json`).
3. `.env` anlegen: `cp .env.example .env`, Werte eintragen. `REDIRECT_URI` muss exakt der Twitch-Developer-Console entsprechen.
4. Syntax prüfen: `npm run check` (entspricht `node --check server.js`). Optional alle Tests: `npm test` (Attrappen statt Twitch und Home Assistant, eigenes temporäres Verzeichnis, rührt die Laufzeitdateien nicht an; etwa 3 Minuten)
5. Starten: `npm start` (entspricht `node server.js`), unter Windows alternativ per Doppelklick auf `AuthServer.cmd` (eigenes Konsolenfenster, bleibt nach einem Absturz offen, nur so geht der Neustart aus der Webkonsole; so startet auch das Stream-Deck-Skript den Server)
6. Einmalig anmelden: `http://localhost:3000/login` im Browser öffnen.
7. Prüfen: `http://localhost:3000/TwitchCompanionAdmin` (Webkonsole) oder `http://localhost:3000/status`

## Features

- OAuth2 mit Auto-Refresh (Login nur am Streaming-PC), Token-Ausgabe an Widgets (`/token` mit Token, Client-ID und Broadcaster-ID; nur lokal und für erlaubte Widget-Herkünfte, siehe ADR 0013)
- Predictions-API und Sub-Goal-Counter für Widgets
- Raid-Begrüßung mit Warteschlange, Quartals-Leaderboard, `!raidstats`
- Shoutouts über die Helix-API (Raid ab 3 Zuschauern, Whitelist nur an Streamer, die in den letzten 40 Tagen aktiv waren)
- Effekt-Queue, in der Webkonsole oder per Konsole ein- und ausschaltbar, mit optionalem Home-Assistant-Webhook (Hooks lassen sich zusätzlich selbst auslösen, z. B. per Stream-Deck-Multi-Aktion, siehe `docs/specs/effekt-queue.md`)
- Event-Log (Follow/Sub/Gift) und Konsolenbefehle
- BdU-Chat `!BdU <Text>`: Funksprüche aus dem Chat, beantwortet vom Enigma-Widget (KI), gepostet von DerBdu bzw. ohne Bot als „FT vom BdU: …“ (ADR 0014, 0017)
- UBOAT-Soldbuch `!soldbuch`: Zuschauer erhalten die Daten ihres Crewmitglieds aus dem neuesten UBOAT-Spielstand, nur in der Kategorie UBOAT (optional über `UBOAT_SAVES_DIR`, ADR 0016)
- Bot-Account „DerBdu“: sendet BdU- und Soldbuch-Nachrichten mit „Chat Bot“-Abzeichen; einmalig `/mod DerBdu` und `http://localhost:3000/login-bot` als DerBdu (ADR 0017)
- Modul-Schalter: BdU-Chat und Soldbuch in der Webkonsole oder per Konsole ein- und ausschalten (`bdu activate|deactivate`, `uboat activate|deactivate`), bleibt nach Neustart erhalten
- Webkonsole `http://localhost:3000/TwitchCompanionAdmin`: Statusseite nur am Streaming-PC mit Knöpfen zum Beenden und Neustarten des Servers, Live-Log mit Fehlerprotokoll, Whitelist-Verwaltung, Effekte an/aus, Modul-Schaltern und Statistik zur laufenden Server-Instanz, weitere Bereiche folgen (ADR 0018, 0019)

## Dokumentation

- [AGENTS.md](AGENTS.md) – Regeln für KI-Assistenten (`CLAUDE.md` importiert sie für Claude Code)
- [docs/KONTEXT.md](docs/KONTEXT.md) – Einordnung im Stream-Ökosystem
- [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) – Ist-Zustand
- [docs/adr/](docs/adr/) – Architekturentscheidungen, nach Themen geordnet in [docs/adr/README.md](docs/adr/README.md)
- [docs/specs/](docs/specs/) – Feature-Specs
- [docs/BUGS.md](docs/BUGS.md) – Fehlerhistorie
- [test/](test/) – Tests mit Attrappen, Start mit `npm test`
- [docs/OFFEN.md](docs/OFFEN.md) – offene Punkte
- [CHANGELOG.md](CHANGELOG.md)
