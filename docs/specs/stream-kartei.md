# Spec: Stream-Kartei – Spieldaten auf einer öffentlichen Website

**Status:** Entwurf (21.11.2026), noch nicht vereinbart und nicht umgesetzt. Issue #84. Stufe 1 (UBOAT-Crew) zuerst, RimWorld folgt als Stufe 2. Ein ADR folgt mit der Vereinbarung: Das ist der erste Datenfluss des Servers ins offene Internet, mit einem neuen Secret.

## Ziel
Zuschauer sind im Spiel mit Figuren verknüpft: UBOAT-Crew über `!soldbuch` (Spec `uboat-personalakte.md`), RimWorld-Pawns über die Mod (`BombingFritz/TwitchCompanion_RimWorld`). Den jeweils letzten Stand dieser Figuren sollen Zuschauer jederzeit auf einer Website ansehen können, auch wenn Stream und Server aus sind. Die Seite nennt, von wann der Stand ist.

## Entscheidungen des Nutzers (21.11.2026)
- **Twitch-Namen** erscheinen nicht auf der Website. Die Namen im Spiel ähneln ihnen ohnehin. Spieldaten einer verknüpften Figur gelten nicht als persönliche Daten.
- **`!privat`:**
  - Wer `!privat` eingeschaltet hat, kann nicht mit einer Figur verknüpft werden.
  - Wer es später einschaltet, verschwindet sofort von der Website. Die Zuordnung bleibt gespeichert und gilt wieder, wenn er `!privat` ausschaltet.
- **UBOAT:** die ganze Crew mit Spieldaten; Gefallene in einer Ehrentafel.
- **Ort:** ein öffentliches Repository `BombingFritz/StreamKartei` mit GitHub Pages für beide Spiele.
  - Eine Startseite zur Auswahl des Spiels.
  - Je Spiel eine eigene Seite, die nur dieses Spiel zeigt.
  - Das Repository hat der Nutzer am 21.11.2026 angelegt; der Name `StreamKartei` gibt auch dem Modul den Namen „Stream-Kartei“.
- **Kosten:** keine laufenden Zusatzkosten.
- **Reihenfolge:** UBOAT zuerst.

## Von Claude vorgeschlagen, noch zur Prüfung
- Aufteilung:
  - Der Server veröffentlicht nur Daten (JSON nach festem Format).
  - Die Website ist ein eigener Verbraucher im Repository `StreamKartei` und baut nur die Darstellung.
- Daten in einem eigenen Zweig `data` mit genau einem, jeweils ersetzten Commit:
  - kein Pages-Build je Update,
  - keine wachsende Historie,
  - alte Stände, auch ausgeblendete `!privat`-Figuren, bleiben nicht im Zweig.
- Mindestabstand 10 min zwischen Veröffentlichungen; Ausnahme: Ausblenden nach `!privat` sofort.
- Namen der `!privat`-Zuschauer zum Ausblenden über Twitch nachschlagen; ohne Ergebnis nicht veröffentlichen (siehe unten).
- Modulname „Stream-Kartei“, Adressen, Feldnamen.

## Aufbau
```
Server (Streaming-PC) ──liest──> UBOAT-Spielstand (schon heute, lib/uboat-crew.js)
       │
       └─GitHub-API (Token nur für StreamKartei)──> Zweig „data“: index.json, uboat/crew.json
                                                         │
Website (GitHub Pages, Zweig „main“) ──fetch──> raw.githubusercontent.com/…/data/…
```
- Der Server nimmt von außen nichts an; er bleibt nur lokal erreichbar.
- Die Website lädt die Daten im Browser des Zuschauers von `https://raw.githubusercontent.com/BombingFritz/StreamKartei/data/<pfad>`. Dort erlaubt GitHub jede Herkunft (`Access-Control-Allow-Origin: *`). GitHub hält die Datei bis zu etwa 5 min im Cache.
- Ist der Server aus, bleibt der letzte veröffentlichte Stand stehen.

## Einrichtung (einmalig, Nutzer)
1. Öffentliches Repository `BombingFritz/StreamKartei` anlegen (erledigt am 21.11.2026) und Pages aus Zweig `main` einschalten (Stand 21.11.: noch aus). Den Zweig `data` legt der Server selbst an.
2. Fein abgestuftes Token (GitHub, „Fine-grained personal access token“) anlegen:
   - nur für das Repository `StreamKartei`
   - Recht „Contents: Read and write“, sonst nichts
   - Ablaufdatum höchstens 1 Jahr
3. In `.env`:
   - `STREAM_KARTEI_REPO=BombingFritz/StreamKartei`
   - `STREAM_KARTEI_TOKEN=<GITHUB_TOKEN>`
   - Ohne Token ist das Modul aus.
4. Neustart.

## Server: Veröffentlichen

### Wann
- Grundsatz: nur wenn sich der Inhalt geändert hat. Vergleich ohne `publishedAt`, über einen Hash.
- **Auslöser:**
  - Nach jedem erfolgreich eingelesenen Spielstand.
  - Wenn jemand `!privat` ein- oder ausschaltet.
  - Beim Start einmal: Der Server liest den veröffentlichten Stand und vergleicht ihn.
- **Abstand:** Mindestens `STREAM_KARTEI_MIN_GAP_MS` (10 min) zwischen zwei Veröffentlichungen. Ändert sich der Inhalt in der Zeit, geht der neueste Stand nach Ablauf raus.
- **Ausnahme `!privat`:** Ein Ausblenden nach `!privat` geht sofort raus, ohne auf den Abstand zu warten.
- **Unabhängig vom Stream:** Es läuft, solange der Server läuft und das Modul an ist, auch offline. Die Kategorie spielt keine Rolle; die Website zeigt immer den letzten Spielstand.

### Wie (GitHub-API, je Veröffentlichung etwa 5 Anfragen)
1. Stand des Zweigs lesen: `GET /repos/{repo}/git/ref/heads/data`. Fehlt der Zweig, wird er neu angelegt.
2. Baum mit den geänderten Dateien anlegen: `POST /git/trees`, mit `base_tree` des bisherigen Commits, damit die Dateien anderer Spiele bleiben.
3. Commit ohne Vorgänger anlegen: `POST /git/commits` mit `parents: []`.
4. Zweig darauf setzen: `PATCH /git/refs/heads/data` mit `force: true`, beim ersten Mal `POST /git/refs`.
- Anfragen gehen an `api.github.com`, nicht über `twitchApi` (ADR 0024 gilt nur für Twitch). Eigener kleiner Client, Zeitlimit 15 s.
- **Fehler:**
  - Netzwerkfehler oder 5xx: Der letzte Stand bleibt. Neuer Versuch beim nächsten Auslöser, spätestens nach 10 min.
  - 401 oder 403 (Token abgelaufen oder ohne Recht): einmal Warnung im Log und in der Webkonsole, keine Wiederholung bis zum Neustart.
- Das Token erscheint nie im Log und nie in `/api/admin/overview`. Es kommt in die Liste der Secrets, die das Live-Log entfernt.

### `!privat` beim Veröffentlichen
- `privacy_optouts.json` kennt nur Twitch-IDs. Zum Ausblenden schlägt der Server Login und Anzeigenamen nach:
  - über `twitchApi`, `GET /users?id=…`, bis zu 100 IDs je Anfrage
  - zwischengespeichert für 1 h im Arbeitsspeicher
- Eine Figur fehlt auf der Website, wenn sie zu einem `!privat`-Zuschauer gehört. Das gilt nach denselben Regeln wie bei `!soldbuch`:
  - Eintrag in `uboat_crew_map.json`,
  - oder Login bzw. Anzeigename gleich Name im Spiel nach Normalisierung.
  - Das gilt auch für die Ehrentafel.
- **Sicher im Zweifel:** Gibt es `!privat`-Zuschauer, aber ihre Namen sind nicht bekannt (Twitch nicht erreichbar, kein Zwischenstand), veröffentlicht der Server nicht. Er versucht es später erneut.
- **Verknüpfen gesperrt:** `uboat map <login> <Name>` lehnt einen Login ab, der zu einem `!privat`-Zuschauer gehört, mit Hinweis in der Konsole. Die Zuordnung prüft der Server über `GET /users?login=…`.

### Steuerung
- **Webkonsole, Reiter „Einstellungen“** (gemeinsamer Reiter für die Einstellungen aller Module, kein eigener Reiter):
  - Schalter „Stream-Kartei“
  - Repository
  - zuletzt veröffentlicht
  - letzter Fehler
  - Knopf „Jetzt veröffentlichen“: hält sich an den Abstand, nur wenn sich etwas geändert hat
- **Übersicht, Gruppe „Optionale Module“:** Karte und Licht „Stream-Kartei“.
- **Konsole:**
  - `kartei show`
  - `kartei publish`
  - `kartei activate|deactivate` (gespeichert in `modules.json`)
- Ohne `STREAM_KARTEI_TOKEN` ist das Modul aus; Karte und Licht zeigen „nicht eingerichtet“.

## Datenformat (Vertrag mit der Website)
Alle Zeitpunkte als ISO. `schemaVersion` steigt nur bei nicht rückwärtskompatiblen Änderungen. Neue Felder kommen ohne neue Version dazu; die Website ignoriert unbekannte Felder.

### `index.json` (für die Startseite)
```json
{ "schemaVersion": 1, "publishedAt": "…", "games": [ { "game": "uboat", "title": "UBOAT", "path": "uboat/crew.json", "savedAt": "…", "publishedAt": "…" } ] }
```

### `uboat/crew.json`
```json
{
  "schemaVersion": 1,
  "game": "uboat",
  "savedAt": "…",
  "publishedAt": "…",
  "gameVersion": "2026.1 Patch 21",
  "crew": [ { "name": "…", "typeLabel": "Offizier", "classLabel": "Funker", "level": 3, "experiencePoints": 479, "experiencePointsFromLastPatrol": 135,
              "born": "1915-03-02", "decorations": 1, "statusLabel": "an Bord", "woundLabel": null, "traits": ["Ängstlich"], "skills": ["Gutes Gehör"] } ],
  "fallen": [ { "name": "…", "typeLabel": "Matrose", "classLabel": null, "level": 0, "born": "…", "died": "…", "decorations": 0, "traits": [], "skills": [] } ]
}
```
- `savedAt`: Änderungszeit des gelesenen Spielstands. `publishedAt`: Zeitpunkt der Veröffentlichung.
- `crew`: alle mit Status an Bord oder in Reserve, Felder wie bei `/api/uboat/crew` (Spec `uboat-personalakte.md`).
- `fallen`: alle mit Todesdatum, für die Ehrentafel.
- Sortierung: Kommandant, Offiziere, Matrosen; innerhalb nach Name.
- **Nicht enthalten:**
  - Twitch-Logins und -Namen, Zuordnungen
  - Dateiname und Ordner des Spielstands
  - interne Schlüssel (`type`, `characterClass`, `status`)
  - Figuren von `!privat`-Zuschauern
- Größe bei 29 Crewmitgliedern etwa 20 KB.

## Website (Verbraucher, Repository `StreamKartei`, eigene Session)
Nur als Anforderung an den Verbraucher; die Gestaltung liegt dort.
- **Startseite:** Spiele aus `index.json` mit „Stand vom …“, Auswahl führt auf die Seite des Spiels.
- **UBOAT-Seite:**
  - Crew an Bord und in Reserve, Suche nach Namen
  - Ehrentafel
  - Kopf mit „Spielstand vom …“ und „veröffentlicht …“
  - Ist der Stand älter als 7 Tage, ein Hinweis, dass länger nicht gespielt wurde
- Ohne Daten oder bei Ladefehler: freundlicher Hinweis statt leerer Seite.
- Keine Twitch-Anbindung, keine Cookies, kein Tracking.

## Stufe 2: RimWorld (Ausblick, eigenes Issue)
- Die Mod liefert ihre Pawn-Liste lokal an den Server, etwa `POST /api/kartei/rimworld` mit eigenem Format. Der Server veröffentlicht sie mit demselben Modul als `rimworld/pawns.json`.
- Das Token liegt nur beim Server.
- Die Mod sperrt das Verknüpfen von `!privat`-Zuschauern selbst; das Kennzeichen `private` hat sie aus der Chat-Brücke.
- Inhalt und Felder entscheiden Mod und Nutzer; dafür legt die Mod eine Serveranforderung an.

## Später möglich, nicht Teil dieses Entwurfs
- Daten zum U-Boot selbst (Typ, Name, Tonnage, Feindfahrten). Der Server liest sie heute nicht; sie müssten erst im Spielstand gefunden werden [UNGEKLÄRT].
- `!soldbuch` antwortet mit einem Link auf die Website.
- **Eigener Webhost:** Nicht nötig. GitHub Pages ist kostenlos. Eine eigene Adresse lässt sich später auf Pages legen; dann kostet nur die Domain. Durch das feste Datenformat bleibt ein Umzug einfach.

## Offene Fragen
- **`!soldbuch` für `!privat`-Zuschauer:** Heute antwortet es auch ihnen, weil sie selbst fragen. Vorschlag: so lassen; die Website blendet trotzdem aus. Alternativ antwortet es nicht mehr. [ZU ENTSCHEIDEN]
- **Namensgleichheit ohne Absicht:** Heißt eine Figur zufällig wie ein `!privat`-Zuschauer, fehlt sie ebenfalls. Vorschlag: hinnehmen. [ZU ENTSCHEIDEN]
- **Ablauf des Tokens:** Fein abgestufte Tokens laufen nach höchstens einem Jahr ab. Vorschlag: Die Webkonsole warnt 14 Tage vorher, wenn GitHub das Ablaufdatum liefert. [UNGEKLÄRT, ob die API es liefert]

## Akzeptanzkriterien (Stufe 1)
- Mit Token und Repository legt der Server beim ersten Spielstand den Zweig `data` mit `index.json` und `uboat/crew.json` an. Die Website zeigt die Crew mit „Spielstand vom …“.
- Neuer Spielstand mit geänderter Crew: veröffentlicht frühestens 10 min nach der letzten Veröffentlichung. Unveränderter Inhalt: keine Veröffentlichung.
- Der Zweig `data` hat nach mehreren Veröffentlichungen genau einen Commit.
- Gefallene stehen in `fallen`, nicht in `crew`.
- Keine Twitch-Namen, keine Zuordnungen, kein Dateiname in den Daten.
- `!privat` eingeschaltet: Die Figur des Zuschauers fehlt beim nächsten Abruf (sofort veröffentlicht). Ausgeschaltet: Sie erscheint wieder, die Zuordnung ist erhalten.
- `!privat`-Namen nicht ermittelbar: keine Veröffentlichung, Hinweis im Log.
- `uboat map` für einen `!privat`-Zuschauer wird abgelehnt.
- Server aus: Die Website zeigt weiter den letzten Stand.
- Token falsch oder abgelaufen: eine Warnung, kein Absturz, sonst alles wie bisher. Ohne Token: Modul aus.
- Das Token steht nie im Log, nicht im Live-Log und nicht in der Webkonsole.
- Tests mit einer Attrappe der GitHub-API, keine Anfrage an GitHub im Test.

## Berührte Funktionen/Dateien (voraussichtlich)
- Neu:
  - `lib/stream-kartei.js`: Format, Hash, Takt, Ausblenden
  - `lib/github-publisher.js`: Git-Data-API, Zweig ersetzen
  - `test/stream-kartei-test.js`
- `server.js`:
  - Konstanten, Modulschalter
  - Auslöser nach dem Einlesen des Spielstands und in `handlePrivacyCommand`
  - `uboat map`-Prüfung, Konsolenbefehle, Overview, Webkonsole
- `.env.example`: `STREAM_KARTEI_REPO`, `STREAM_KARTEI_TOKEN`.
- Doku: DATENKATALOG (neuer öffentlicher Datenfluss), ARCHITEKTUR, Webkonsole-Spec, neues ADR.
