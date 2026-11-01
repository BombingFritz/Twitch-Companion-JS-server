# Twitch Companion JS server

Node.js/Express-Dienst für Twitch-OAuth2 mit automatischem Token-Refresh. Er hält eine EventSub-WebSocket-Verbindung und automatisiert Raid-Begrüßungen, Shoutouts, eine Whitelist sowie Licht-Effekte über einen Home-Assistant-Webhook. Browser-Widgets (z. B. OBS-Overlays) lesen Daten über HTTP-Endpoints dieses Servers und benötigen keine eigenen Twitch-Secrets.

## Setup

1. Node.js installieren, mindestens Version 18 (Vorgabe von Express 5).
2. Abhängigkeiten installieren: `npm install` (liest `package.json` und `package-lock.json`).
3. `.env` anlegen: `cp .env.example .env`, Werte eintragen. `REDIRECT_URI` muss exakt der Twitch-Developer-Console entsprechen.
4. Syntax prüfen: `npm run check` (entspricht `node --check server.js`)
5. Starten: `npm start` (entspricht `node server.js`)
6. Einmalig anmelden: `http://localhost:3000/login` im Browser öffnen.
7. Prüfen: `http://localhost:3000/status`

## Features

- OAuth2 mit Auto-Refresh, Token-Ausgabe an Widgets (`/token`)
- Predictions-API und Sub-Goal-Counter für Widgets
- Raid-Begrüßung mit Warteschlange, Quartals-Leaderboard, `!raidstats`
- Shoutouts über die Helix-API (Raid ab 3 Zuschauern, Whitelist)
- Effekt-Queue mit Modi `auto`/`manual`/`off` und Home-Assistant-Webhook
- Event-Log (Follow/Sub/Gift) und Konsolenbefehle

## Dokumentation

- [AGENTS.md](AGENTS.md) – Regeln für KI-Assistenten
- [docs/KONTEXT.md](docs/KONTEXT.md) – Einordnung im Stream-Ökosystem
- [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) – Ist-Zustand
- [docs/adr/](docs/adr/) – Architekturentscheidungen
- [docs/specs/](docs/specs/) – Feature-Specs
- [docs/BUGS.md](docs/BUGS.md) – Fehlerhistorie
- [docs/OFFEN.md](docs/OFFEN.md) – offene Punkte
- [CHANGELOG.md](CHANGELOG.md)
