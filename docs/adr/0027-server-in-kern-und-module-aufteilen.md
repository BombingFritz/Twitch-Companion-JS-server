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

## Nachtrag 27.11.2026: Ist-Form der Anmeldung, `ctx` und Reihenfolge ab Schritt 3

**Anlass:** Zwei Reviews des Umbaus nach Schritt 3a (vom Nutzer eingebracht, 27.11.2026). Claude hat die Befunde E1 bis E17 am Code geprüft und bewertet; hier steht, was davon übernommen wird.

**Vom Nutzer entschieden (27.11.2026):**
- Bewertung der Befunde und dieser Nachtrag freigegeben.
- Unbehandelte asynchrone Fehler: lieber Stabilität, wenn der Zustand klar erkennbar ist und protokolliert wird (Abschnitt 10).
- Komplexe Module dürfen eigene Regeln für KI-Sessions haben (Anregung des Nutzers, Abschnitt 8).
- Die Abhängigkeitsregeln werden fest geprüft, nicht nur beschrieben (Abschnitt 8).

**Von Claude festgelegt, nicht einzeln zur Wahl gestellt:**
- Teilung von Schritt 3 in 3a bis 3d
- Form der Haken
- Regeln für `ctx` und Zustand
- eigener Architekturtest statt dependency-cruiser

### 1. Reihenfolge ab Schritt 3
Ersetzt Schritt 3 und den Anfang von Schritt 4 unter „Regeln für den Umbau“:
- **3a** `core/auth.js`: Tokens, Login, Bot-Freigabe, Twitch-Zugriff (PR #107)
- **3b** `core/chat.js`: Chat-Versand, Absender je Funktion (Branch `umbau/chat`)
- **3c** `core/state.js` und `core/events.js`: gemeinsamer Stand (Kategorie, Stream live, `!privat`-Liste, Modul-Schalter) und Ereignisbus
- **3d** `core/eventsub.js`: Verbindung, Keepalive, Entdopplung, Abo-Register und Verteiler nach Ereignistyp; dazu die Anmeldung von Chat-Befehlen. Pilot ist `subgoal` (EventSub-Abo und Endpunkt); es zieht damit aus Schritt 4 vor.
- **vor 3d:** ein Vertragsschnappschuss als Test, aufgenommen auf `5e44516` (Ausgangsstand des Umbaus). Er enthält:
  - Ausgabe von `help`
  - Routen mit Methode
  - Abo-Liste mit Typ, Version und Bedingung
  - Felder von `/api/admin/overview`
  - Home-Assistant-Payloads je Effekttyp

  Abweichungen davon nur, wo ein PR sie nennt.
- **Schritt 4** wie bisher, ohne `subgoal`: `kartei`, `uboat`, `bdu`, `chat-bridge`, `privacy`, `predictions`, `stats`, `whitelist`, `raid`, `effects`. Zuletzt `admin`.
- **Prüfpunkte im Stream:**
  - **B** nach 3d: Der Kern ist dann vollständig.
  - **C** nach `raid` und `effects`.
  - Danach, wie bisher, der Teststream vor dem Release 1.3.0.
- **`core/console.js`** entsteht, wenn im Konsolen-Handler nur noch Kernbefehle übrig sind. Bis dahin laufen die Befehle der Module über `core/modules.js`.

### 2. Ist-Form der Modul-Anmeldung
Ersetzt die Skizze unter „1. Drei Schichten“. Ein Modul exportiert `create…Module(ctx)` und gibt ein Objekt mit diesen Teilen zurück. Alle Teile sind freiwillig.

| Teil | seit | Zweck |
|---|---|---|
| `name` | 2 | Kurzname; Schlüssel in `/api/admin/overview` und Präfix für Fehlermeldungen des Modul-Hosts |
| `routes.widget(app)`, `routes.admin(app)` | 2 | Endpunkte. `widget` an der alten Stelle, `admin` nach dem Schutz der Webkonsole |
| `consoleCommands: [{ name, help, handle(parts) }]` | 2 | Konsolenbefehle mit Hilfezeilen |
| `overview()` | 2 | eigener Teil der Übersicht |
| `on: { '<ereignis>': fn }` | 2 | Reaktion auf interne Ereignisse (Abschnitt 6) |
| `isQuiet(req, res)` | 2 | erfolgreicher Abruf erscheint nicht im HTTP-Protokoll (Abfragen im Sekundentakt, z. B. Stream Deck) |
| `showsSilentEffects()` | 2 | Nur Topics. Wandert mit `effects` in den Effektdienst. |
| `eventsub: [{ type, version, condition, handle(evt) }]` | 3d | EventSub-Abos |
| `chatCommands: [{ name, modOnly, cooldownMs, handle(evt, args) }]` | 3d | Chat-Befehle |
| `switchable` | 3c | Das Modul erscheint als Modul-Schalter. Der Schalter liegt in `core/state.js`, nicht mehr in `server.js`. |
| `start()`, `stop()` | erstes Modul mit eigenem Timer | Lebenszyklus (Abschnitt 7) |

**Regeln:**
- **Neue Haken:** Ein neuer Haken kommt nur mit Begründung in diesem ADR dazu. Nutzt ihn nur ein Modul, steht dabei, warum er nicht in einen Kerndienst gehört.
- **Doppelte Anmeldungen:** `add()` bricht beim Start mit klarer Meldung ab bei:
  - doppelten Modulnamen
  - doppelten Konsolen- oder Chat-Befehlen
  - einem Modulbefehl, der einen eingebauten Befehl überdecken würde; die Liste der eingebauten Befehle gibt `server.js` mit

  Doppelte Routen prüft der Host nicht, weil Express sie ohne eigene Hülle nicht meldet. Die Pfade stehen in den Specs.
- **Gleiche Abos:** Melden zwei Module dasselbe Abo an (Typ, Version, Bedingung), legt der Verteiler es einmal an und ruft beide Handler auf. Die Abo-Liste bei Twitch bleibt so unverändert.

### 3. `ctx`
- **Einmal gebaut:** `server.js` baut die Kerndienste einmal (Composition Root) und gibt jedem Modul nur die, die es nutzt. Das sind Objekte, keine losen Einzelfunktionen:
  - `config`, `store`, `log`, `access` (Herkunft, Admin-Schutz)
  - `twitch` (`twitchApi`), `chat`, `state`, `events`
  - `effects`, `stats`
- **Grenzen:**
  - Kein Modul bekommt Funktionen oder Zustand eines anderen Moduls.
  - Kein fester Höchstwert für die Breite von `ctx`. Braucht ein Modul viele Einzelwerte aus `server.js`, fehlt ein Kerndienst.
- **Zugriffe nach außen:**
  - Twitch nur über `ctx.twitch` (ADR 0024).
  - Home Assistant nur über `ctx.effects`.
  - Andere externe Dienste (z. B. die KI des BdU) laden ihren Client wie bisher selbst; die Tests ersetzen ihn weiter über `Module._load`.
- **Topics** stellt in 3c auf diese Form um: `ctx.state` statt `isEnabled`, `switchModule` und `stateLabel`.

### 4. Zustand
- **Besitzer:** Jede veränderliche Variable auf oberster Ebene von `server.js` (Stand 3b: 27) bekommt beim Umzug ihres Bereichs genau einen Besitzer: das Modul (privat) oder `core/state.js`.
- **`core/state.js`** hält nur, was mindestens zwei Bereiche lesen: Kategorie, Stream live, `!privat`-Liste, Modul-Schalter.
- **Zugriff:** Andere Bereiche lesen und ändern den Zustand nur über Funktionen seines Besitzers. Eine Änderung läuft über genau eine Funktion (Regel aus `BUGS.md`, Effekt-Modus).
- **Übersicht:** `ARCHITEKTUR.md` führt eine Tabelle mit Bereich, Stand des Umzugs, Besitz des Zustands und Test ohne Server.
- **Ort der Logik:** Reine Logik, die nur ein Modul nutzt, darf auch im Modulordner liegen, als eigene Datei und ohne Server testbar. Gemeinsam genutzte reine Logik bleibt in `lib/`.

### 5. Effekte und Statistik
Beide behalten ihren festen Platz in `ctx` (Abschnitt 3 des ADR). Der Vertrag gilt schon heute und bleibt beim Umzug von `effects` und `stats` gleich:
- **`ctx.effects.schedule(type, meta)`:**
  - kehrt sofort zurück und wirft nicht
  - bündelt und reiht ein wie bisher
  - Ohne `HA_WEBHOOK_URL` oder bei Effekt-Modus „aus“ geht nichts hinaus, ohne Fehler.
  - Die Payload `{type, count, meta, timestamp}` bleibt unverändert.
- **`ctx.stats.count(name)`** wirkt auch bei abgeschalteter Statistik und tut dann nichts.
- **Keine Voraussetzung:** Kein Modul setzt voraus, dass Home Assistant eingerichtet oder die Statistik an ist.

### 6. Interne Ereignisse
- **Fehler je Handler:** `core/events.js` (3c) fängt je Handler synchrone Fehler **und abgelehnte Promises** und loggt sie mit dem Modulnamen. Bisher fing `moduleHost.emit` nur synchrone Fehler. Ein abgelehntes Promise hätte den Server beendet, weil es keinen Fänger für `unhandledRejection` gibt. Ein Test sichert das ab.
- **Katalog:** `ARCHITEKTUR.md` bekommt einen Abschnitt „Interne Ereignisse“ mit Ereignis, Erzeuger, Bedeutung und Empfängern. Ein neues Ereignis kommt nur mit Eintrag dort.
- **Ereignis oder Aufruf:** Ein Ereignis benachrichtigt beliebig viele Empfänger. Eine Anfrage, die eine Antwort braucht, ist ein direkter Aufruf eines Kerndienstes.
- **Ketten:** Ein Handler löst kein weiteres Ereignis aus, außer der Katalog nennt die Kette und ihr Ende.

### 7. Lebenszyklus
- **Haken:** `start()` und `stop()` sind freiwillig.
  - Der Host ruft `start()` nach dem Anmelden aller Module auf, vor `listen`.
  - `stop()` ruft er beim Beenden und Neustart des Servers auf.
- **Timer:** Timer, Intervalle und offene Verbindungen (z. B. SSE) eines Moduls beginnen in `start()` und enden in `stop()`.
- **Einführung:** Kommt mit dem ersten Modul, das eigene Timer hat. Der Prüftimer der Tokens in `createAuth` zieht dann ebenfalls in `start()`.
- **„Deaktiviert“:** Für jedes schaltbare Modul legt seine Spec fest, was „deaktiviert“ heißt: neue Aktionen ablehnen, laufende beenden oder auslaufen lassen.
- **Später (P3):** Ein Test „Prozess endet nach `stop()` aller Module von selbst“ folgt mit dem An- und Abschalten von Modulen zur Laufzeit.

### 8. Absicherung
- **Architekturtest:** `test/architektur-test.js` gehört zur Testreihe. Ein Verstoß macht `npm test` und damit den CI-Lauf rot, und gemergt wird nur bei grünem Lauf. Der Test prüft:
  - `modules/*` importiert kein anderes Modul.
  - `core/*` importiert nichts aus `modules/`.
  - `lib/*` importiert nichts aus `core/` oder `modules/`.
  - Keine Datei importiert `server.js`.
  - Es gibt keine Zyklen.
  - `fs.writeFileSync` steht nur in `core/store.js`; bis zum eigenen Fehlerbehebungs-PR gilt eine Liste der bekannten Stellen, die nur schrumpfen darf.
  - `axios` steht nur an den vereinbarten Stellen.
- **Syntax:** `npm run check` prüft alle projekteigenen JS-Dateien, nicht nur `server.js`. Die CI nutzt diesen Befehl.
- **Regeln je Modul:** Ein komplexes Modul darf eigene Regeln für KI-Sessions in `modules/<name>/AGENTS.md` haben, dazu eine `CLAUDE.md` mit `@AGENTS.md` wie im Hauptordner. Claude Code liest diese Datei, sobald es dort arbeitet. Dafür gilt:
  - Kandidaten sind Module mit eigenen Stolperfallen, voraussichtlich `uboat` (Spielstand, Last, Autosave), `bdu` (KI, Abklingzeiten, Datenschutz) und `effects` (Warteschlange, Effekt-Modus). Dazu kommt der Kern-Teil `core/eventsub.js` (Wiederverbindung, Entdopplung).
  - Die Datei enthält nur, was nur für dieses Modul gilt: Stolperfallen (aus `BUGS.md` übernommen oder verlinkt), eigene Laufzeitdateien und Grenzen, Verweis auf die Spec. Sie wiederholt nichts aus der zentralen `AGENTS.md`, und bei einem Widerspruch gilt die zentrale.
  - Sie entsteht mit dem Umzug des Moduls, nicht vorher. Die zentrale `AGENTS.md` nennt in „Wo was steht“, dass es solche Dateien gibt.

### 9. Neue Funktionen während des Umbaus
Ergänzt „Während des Umbaus“:
- Sobald der Kern mit 3d steht, dürfen ganz neue Bereiche gleich als neues Modul entstehen.
- Erweiterungen bestehender Bereiche warten weiter auf deren Umzug.
- Eine Zeitbox gibt es nicht.

### Verworfen
- **dependency-cruiser oder madge als Werkzeug** (verworfen ist das Werkzeug, nicht die Prüfung):
  - Beide prüfen nur Importe. `writeFileSync` und `axios` prüfen sie nicht, dafür bräuchte es ohnehin einen eigenen Test.
  - dependency-cruiser bringt eigene Pakete mit, also mehr für `npm audit` (#57).
  - Alle Importe im Projekt sind einfache `require('./…')`, die ein kleiner Test sicher liest.
  - Werden die Regeln deutlich mehr, ist ein Wechsel auf dependency-cruiser leicht, die Regeln bleiben dieselben.
- **Fester Höchstwert für `ctx` (etwa 8):** Er zählt Einzelwerte, nicht die Kopplung.
- **Eigene Datei `docs/EREIGNISSE.md`:** ein weiterer Ort, der veralten kann. Ein Abschnitt in `ARCHITEKTUR.md` genügt.
- **`axios` und `ws` über `ctx`, damit die Tests gültig bleiben:** Unnötig, `Module._load` ersetzt sie für alle Dateien.
- **Atomares Schreiben erst beim Umzug jedes Bereichs:** Ein eigener Fehlerbehebungs-PR für alle Stellen macht den Architekturtest sofort streng.

### Konsequenzen
- **`AGENTS.md`:** Der Absatz „Umgezogene Bereiche“ wird um die Haken, `ctx` und die Ereignisregeln ergänzt, jeweils im PR, der sie einführt (3c, 3d).
- **Prüfpunkte B und C** stehen im Issue der Zwischentests (#104). Die Reihenfolge des Umbaus steht nur hier; `docs/FAHRPLAN.md` ordnet Arbeit über mehrere Repositories und bleibt unverändert.
- **Eigene kleine PRs vor 3d, jederzeit möglich:**
  - Prüfungen (Architekturtest, `check` für alle Dateien)
  - atomares Schreiben aller Laufzeitdateien (15 Stellen, auch die `.txt`-Berichte)
  - Vertragsschnappschuss
  - unbehandelte asynchrone Fehler abfangen und anzeigen (Abschnitt 10)
- **Abschluss:** Vor dem Release 1.3.0 prüft ein unabhängiges Abschlussreview den Umbau nach dem Prüfauftrag des Nutzers.

### 10. Unbehandelte asynchrone Fehler (Nutzer, 27.11.2026: „lieber Stabilität, falls der Zustand klar erkennbar ist und protokolliert wird“)
- **Abfangen statt Beenden:** Ein abgelehntes Promise, das niemand abfängt (`unhandledRejection`), beendet den Server nicht mehr. Heute endet er dann; `AuthServer.cmd` startet ihn nur nach einem Neustart aus der Webkonsole (Code 75) neu, nach einem Absturz nicht. Der Stream liefe also ohne Server weiter.
- **Erkennbar:**
  - Der Fehler kommt mit Meldung und Stack ins Fehlerprotokoll und ins Live-Log.
  - Die Übersicht der Webkonsole zeigt, wie viele solcher Fehler es seit dem Start gab und wann der letzte war. Das ist ein neues Feld, rückwärtskompatibel, und steht in der Spec der Webkonsole.
  - Die Konsole zeigt dasselbe bei `status`.
  - Gleiche Fehler kurz hintereinander erscheinen über `logIfChanged` nur einmal im Log, werden aber alle gezählt.
- **Nicht für `uncaughtException`:** Ein synchroner Fehler außerhalb jedes Fängers beendet den Server weiter. Danach ist der Zustand nach der Node.js-Doku nicht mehr verlässlich.
- **Eigener kleiner PR:** Das ist eine Verhaltensänderung, kein Umzug, und hat einen eigenen Test. Der Fänger je Handler in `core/events.js` (Abschnitt 6) bleibt trotzdem: Er nennt das Modul.
