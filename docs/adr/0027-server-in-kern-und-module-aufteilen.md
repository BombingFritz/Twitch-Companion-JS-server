# ADR 0027: Server in Kern und Module aufteilen

**Status:** Akzeptiert (27.11.2026). Folgt auf das Release 1.2.0; ergänzt 0024 (zentraler Twitch-Zugriff) und 0018 (Webkonsole).

**Vom Nutzer entschieden:**
- 24.11.2026: Nach dem Release 1.2.0 wird der Server in funktionelle Gruppen aufgeteilt. Ziele: Weiterentwicklung straffen, Fehlersuche und Entwicklung je Bereich trennen.
- 27.11.2026:
  - Kern in `core/`, Module in `modules/<name>/`; `lib/` bleibt für reine Logik.
  - Zuerst die Kern-Grundlagen ohne Verhalten, dann die Anmeldung mit Topics als erstem Modul.
  - Neue Funktionen warten, bis ihr Bereich umgezogen ist; Fehlerbehebungen gehen jederzeit.
  - Einstellungen der Module für den gemeinsamen Reiter kommen später als eigener Schritt, nicht im Umbau.

**Von Claude festgelegt, nicht einzeln zur Wahl gestellt:**
- Aufteilung des Kerns in Dateien
- Form der Anmeldung eines Moduls
- Liste und Schnitt der Module
- Regeln für Abhängigkeiten mit internem Ereignisbus
- Reihenfolge ab Schritt 3
- volle Testreihe je Schritt
- Release 1.3.0 nach dem Umbau

## Kontext
- **Größe:** `server.js` hat 4168 Zeilen (Stand `5e44516`). Darin liegen Konstanten, Laufzeitzustand, Express-Endpunkte, der EventSub-Empfang, Chat- und Konsolenbefehle, die Webkonsole und rund 15 Funktionsbereiche nebeneinander.
- **Ausgelagert ist nur reine Logik:** 17 Dateien in `lib/` ohne Express und ohne Twitch, etwa `twitch-api`, `live-state`, `chat-bridge`, `stream-session`, `uboat-save`.
- **Verflechtung über gemeinsame Hilfsfunktionen.** Sie werden aus fast allen Bereichen aufgerufen:

| Hilfsfunktion | Aufrufe in `server.js` |
|---|---|
| `loadTokens` | 32 |
| `getValidAccessToken` | 27 |
| `logIfChanged` | 25 |
| `twitchApi` | 23 |
| `streamSession` | 20 |
| `stats.count` | 17 |
| `currentCategory` | 17 |
| `moduleSwitches` | 13 |
| `sendChatMessage` | 10 |

  Diese Funktionen gehören in einen Kern, auf den die Bereiche zugreifen, statt sie über die ganze Datei verstreut zu nutzen.
- **Drei Stellen sammeln zentral für alle Bereiche:**
  - der `if (subType === …)`-Block im EventSub-Empfang (rund 200 Zeilen),
  - der Konsolen-Handler `rl.on('line')` mit `printConsoleHelp` (rund 370 Zeilen),
  - die Übersicht der Webkonsole (`/api/admin/overview`).

  Jede neue Funktion ändert alle drei Stellen. Deshalb kommen sich parallele Sessions in die Quere; AGENTS.md erlaubt deshalb nur eine schreibende Session für `server.js`.
- **Bisheriges Vorgehen** (OFFEN, technische Schuld): nur auslagern, wenn ein Bereich ohnehin angefasst wird. Das hat reine Logik nach `lib/` gebracht, die Datei aber in knapp zwei Wochen von rund 3300 (14.11.2026) auf rund 4170 Zeilen wachsen lassen.
- **Produktausrichtung** (AGENTS.md): Eine Grundfunktion läuft ohne Module, und Module hängen so wenig wie möglich voneinander ab. Fernziel P3 in OFFEN: Module lassen sich an- und abschalten, später vielleicht installieren.

## Entscheidung

### 1. Drei Schichten
- **`server.js` setzt nur zusammen:**
  - Konfiguration laden
  - den Kern erzeugen
  - die Module in fester Reihenfolge anmelden
  - den Server starten

  Ziel: unter 200 Zeilen.
- **Kern** (`core/`): was jede Funktion braucht und was ohne Module laufen muss.

| Datei | Inhalt |
|---|---|
| `core/config.js` | `.env`, Konstanten des Kerns |
| `core/store.js` | `writeJsonAtomic`, `load…`/`save…`-Hilfen für JSON-Dateien |
| `core/log.js` | `logIfChanged`, Bereinigung, Fehlerprotokoll, Puffer des Live-Logs |
| `core/http.js` | Express-App, Herkunftsprüfung, `isLocalWidgetRequest`, Admin-Schutz, HTTP-Protokoll |
| `core/auth.js` | Tokens, `/login`, `/callback`, `/token`, Bot-Freigabe |
| `core/eventsub.js` | Verbindung, Keepalive, Entdopplung, Abo-Liste und Verteiler nach Ereignistyp |
| `core/chat.js` | `sendChatMessage`, Bot-Absender, „Chat-Absender“ je Funktion |
| `core/console.js` | Befehlsliste und Hilfe |
| `core/state.js` | gemeinsamer Laufzeitstand: Kategorie, Stream live, `!privat`-Liste, Modul-Schalter |
| `core/events.js` | kleiner interner Ereignisbus (Node `EventEmitter`) |

  `lib/twitch-api.js` bleibt, wie es ist (ADR 0024).
- **Module** (`modules/<name>/index.js`): je Funktionsbereich ein Ordner. Ein Modul meldet beim Start an, was es braucht:

```js
module.exports = function create(ctx) {   // ctx: config, store, log, http, twitch, chat, state, events, effects, stats
  return {
    name: 'topics',
    switchable: true,                     // erscheint als Modul-Schalter
    routes(router) { … },                 // eigene Endpunkte
    eventsub: [{ type, version, condition, handle }],
    chatCommands: [{ match, handle }],
    consoleCommands: [{ name, help, handle }],
    overview() { … },                     // Beitrag zu /api/admin/overview
    on: { 'stream.online': …, 'category.changed': … },
  };
};
```

  Reine Logik bleibt in `lib/` und bleibt ohne Server testbar. Das Modul verbindet sie mit dem Kern.

### 2. Vorgeschlagene Module
Die Zeilenzahlen sind grob nach dem heutigen Stand geschätzt.

| Modul | Inhalt | etwa Zeilen |
|---|---|---|
| `effects` | Home-Assistant-Effekte, Warteschlange, `events.json`, Effekt-Modus | 250 |
| `raid` | Begrüßung, Raid-Log, Rangliste, `!raidstats`, Warteschlange, Raid-Shoutout | 400 |
| `whitelist` | Whitelist, Aktivitätsprüfung, Begrüßungs-Shoutout | 250 |
| `subgoal` | Sub-Goal über EventSub, `/api/twitch/subcounter` | 120 |
| `stats` | Statistik, Stream-Ablauf, Berichte, Zuschauer, Glückspilz | 300 |
| `predictions` | Wette und Abstimmung, Ergebniszeilen, Abstimmung für Verbraucher | 200 |
| `chat-bridge` | Chat-Brücke, aktive Chatter, Kanal-Infos | 200 |
| `privacy` | `!privat` | 80 |
| `bdu` | BdU-Chat | 250 |
| `uboat` | Soldbuch, Verlauf, Zuordnung | 300 |
| `kartei` | Stream-Kartei | 150 |
| `topics` | Intro-Topics, Stream-Deck-Endpunkte | 200 |
| `admin` | Webkonsole: Seite, Übersicht, Einstellungen, Server-Steuerung | 400 |

### 3. Regeln für Abhängigkeiten
- **Module hängen nur am Kern, nicht aneinander.**
  - Brauchen zwei Module dieselbe Information, liegt sie im Kern (`state`) oder kommt als Ereignis über `core/events.js`.
  - Beispiele für Ereignisse: `chat.message`, `raid.in`, `raid.out`, `stream.online`, `stream.offline`, `category.changed`, `privacy.changed`.
  - Ein abgeschaltetes Modul bricht so nichts anderes.
- **Der Kern kennt keine Module.**
  - Er ruft sie nur über die angemeldeten Listen auf: Abos, Befehle, Routen, Übersicht.
  - `effects` und `stats` sind Ausnahmen mit festem Platz in `ctx`, weil viele Module Effekte auslösen oder zählen. Ohne Home Assistant bleibt `effects` ein stiller Dienst.
- **Die Webkonsole sammelt nur ein:**
  - Jedes Modul liefert seinen Teil der Übersicht und seine Einstellungen selbst.
  - Der gemeinsame Einstellungs-Reiter (Nutzer, 13.11.2026) wird damit später einfacher.

### 4. Regeln für den Umbau
- **Schrittweise, je Bereich ein PR.** Nur verschieben und anschließen, ohne das Verhalten zu ändern. Kein neues Feature im selben PR.
- **Gleiches Verhalten nach außen:**
  - Endpunkte, Felder, Logzeilen, Konsolenbefehle und Laufzeitdateien bleiben gleich.
  - Die Tests prüfen viele Logzeilen wörtlich und sind damit das Sicherheitsnetz.
  - Tests ändern sich nur, wo ein Pfad oder Dateiname wechselt.
- **Volle Testreihe:** je Schritt lokal und in der CI, nicht nur gezielte Tests, weil sich beim Verschieben Nebenwirkungen zeigen können.
- **Reihenfolge:**
  1. Kern-Grundlagen ohne Verhalten: `config`, `store`, `log`, `http`
  2. Anmeldung von Konsolenbefehlen, Routen und EventSub-Abos, dazu `topics` als erstes Modul; es nutzt fast alle Arten der Anmeldung
  3. `auth`, `chat`, `state`, `events`
  4. die übrigen Module, die am wenigsten verflochtenen zuerst: `subgoal`, `kartei`, `uboat`, `bdu`, `chat-bridge`, `privacy`, `predictions`, `stats`, `whitelist`, `raid`, `effects`
  5. zuletzt `admin`
- **Nach dem Umbau** prüft ein Teststream den Gesamtstand, dann folgt das Release 1.3.0.
- **Während des Umbaus:**
  - Neue Funktionen kommen erst nach dem Umzug ihres Bereichs, dann gleich in das Modul. Das betrifft zum Beispiel #92, #93, #98 und #100.
  - Fehlerbehebungen gehen immer.
  - Einstellungen der Module werden im Umbau nicht neu angemeldet; der gemeinsame Einstellungs-Reiter folgt als eigener Schritt auf der neuen Struktur.
  - Je Kern-Schritt arbeitet nur eine Session am Server. Sind die Module getrennt, darf je Modul eine Session arbeiten.

## Verworfene Alternativen
- **Neu schreiben in einem Zug:** zu großes Risiko für den laufenden Streambetrieb; Fehler wären nicht mehr einem Schritt zuzuordnen.
- **Weiter wie bisher** (auslagern, wenn ohnehin angefasst): Die Datei wächst dabei schneller, als sie schrumpft (siehe Kontext).
- **Mehrere Prozesse oder Dienste je Modul:** mehr Betrieb, mehr Startprobleme und ein zweites EventSub-Kontingent, ohne Gewinn für einen lokalen Server.
- **Framework oder TypeScript einführen:** mehr Umbau als nötig. Die Trennung geht mit einfachen CommonJS-Modulen und bleibt mit dem heutigen Testgerüst (`Module._load`) kompatibel.
- **Nur Dateien nach Zeilen teilen, ohne Anmeldung:** Die drei zentralen Stellen (EventSub, Konsole, Übersicht) blieben, und jede neue Funktion müsste sie weiter anfassen.

## Konsequenzen
- **Mehr Dateien.** Dafür ist jeder Bereich für sich lesbar, und ein Fehler im Log (`[BdU]`, `[UBOAT]` …) führt in einen Ordner.
- **AGENTS.md ändert sich an zwei Stellen,** jeweils im PR, der die neue Form einführt. Bis dahin gelten die heutigen Konventionen:
  - Die Architekturkonventionen werden neu geschrieben: neues Modul statt „eigene `subscribeToXYZ` im `session_welcome`-Block“, Konsolenbefehl im Modul statt im `rl.on('line')`-Block.
  - Die Regel „nur eine schreibende Session für `server.js`“ gilt künftig für den Kern; Module können parallel bearbeitet werden.
- **ARCHITEKTUR.md** wird nach Kern und Modulen gegliedert.
- **Die Tests** bleiben als Verhaltenstests gültig. Neue Module bekommen eigene Tests nach dem Muster der heutigen.
- **Die Modul-Schalter** werden einheitlich: Jedes Modul mit `switchable` erscheint in Konsole und Webkonsole, ohne eigene Zeilen dort.
- **Grundlage für P3:** Module lassen sich später als optionale Bausteine ausliefern.

## Verworfen bei der Entscheidung (27.11.2026)
- **Alles unter `src/`:** zusätzliche Pfadänderungen in Tests und Doku ohne Gewinn.
- **Gleich ein Pilot-Modul:** Der erste PR wäre größer geworden; das Muster zeigt sich mit Topics in Schritt 2 früh genug.
- **Dringende Funktionen vorher noch in `server.js`:** Sie hätten später ein zweites Mal umziehen müssen.
- **Einstellungen gleich mit anmelden:** Das hätte den Umbau vergrößert und Verhalten geändert.
