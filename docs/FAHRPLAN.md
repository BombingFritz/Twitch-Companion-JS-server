# Fahrplan: Intro-Topics und Stream-Deck-Anbindung

Stand: 12.11.2026. Dies ist die **einzige** Stelle, an der Reihenfolge und Stand der repo-übergreifenden Arbeit stehen. Die anderen Repositories und Dokumente verweisen hierher und führen keinen eigenen Fahrplan.

Beteiligt sind drei Repositories:

| Teil | Repository | Inhalt |
|---|---|---|
| Server | `BombingFritz/Twitch-Companion-JS-server` (dieses) | Zustand, Endpoints, `topics.json`, Webkonsole, Effekte; **Schnittstellen-Specs** |
| Widget | [`BombingFritz/CheckTalk-Widget`](https://github.com/BombingFritz/CheckTalk-Widget) | OBS-Browserquelle mit der Topic-Liste; MIT |
| Stream-Deck-Plugin | [`BombingFritz/TwitchCompanion_Streamdeck_Plugin`](https://github.com/BombingFritz/TwitchCompanion_Streamdeck_Plugin) | ein Plugin für alle Server-Funktionen, nicht eines je Modul; MIT |

Zugehörige Dokumente: [Spec Intro-Topics](specs/intro-topics.md), [Spec Stream-Deck-Anbindung](specs/stream-deck.md), [ADR 0020](adr/0020-stream-deck-anbindung.md), [ADR 0021](adr/0021-intro-topics-modul.md).

## Spielregeln für die Koordination

1. **Schnittstellen nur hier ändern.** Endpoints, Ereignisse und Datenformate stehen in den Specs dieses Repositories. Widget und Plugin setzen sie um; brauchen sie etwas Neues, wird zuerst die Spec hier geändert.
2. **`server.js` nur in einer Session zur Zeit.** Server-Schritte beginnen erst, wenn keine andere Session an `server.js` arbeitet. Der Topics-Code liegt deshalb in `lib/topics.js`; `server.js` bekommt nur die Verdrahtung.
3. **ADR-Nummern 0020 und 0021 sind vergeben.** Andere Sessions nehmen ab 0022.
4. **Gemeinsame Doku-Dateien zuletzt.** `OFFEN.md`, `KONTEXT.md`, `ARCHITEKTUR.md`, `CHANGELOG.md` und `adr/README.md` werden in einem eigenen, letzten Commit je Schritt angepasst, direkt vor dem Merge und auf dem aktuellen `main`.
5. **Stand pflegen:** Wer einen Schritt abschließt, setzt hier die Spalte „Stand“ und verlinkt den Pull Request.

## Schritte

| # | Schritt | Repository | Hängt ab von | Stand |
|---|---|---|---|---|
| 0 | Specs, ADRs und dieser Fahrplan | Server | – | in Arbeit (Branch `docs/intro-topics-stream-deck`) |
| 1 | Widget 0.1 mit Demo-Modus: Liste, Zustände, Animationen, ohne Server testbar | Widget | 0 | Entwurf liegt vor, Design nach Screenshots abgestimmt (Theme `panel`, 12.11.2026); Abnahme in OBS offen |
| 2 | Server: `lib/topics.js` (Zustand, Liste), Endpoints und Events nach Spec, Tests | Server | 0; keine parallele Arbeit an `server.js` | offen |
| 3 | Widget 0.2: Anbindung an den Server, Test in OBS (2K horizontal, vertikal per Dualstream-Plugin) | Widget | 1, 2 | offen |
| 4 | Stream Deck vorläufig: Tasten über ein fertiges HTTP-Plugin (z. B. „API Request“) | – (Einrichtung) | 2 | offen |
| 5 | Webkonsole: Reiter „Topics“ zum Bearbeiten der Liste, Reset-Knopf | Server | 2 | offen |
| 6 | Effekte `topic_active`, `topic_done`, `topics_complete` über `scheduleEffect`; Lichtlogik in Home Assistant | Server (+ HA, außerhalb) | 2 | offen |
| 7 | Clip-Moment: `POST /api/clip/mark` (Statistik Stufe 6, Stream-Bericht 1e) | Server | 0 | offen |
| 8 | Stream-Deck-Plugin 0.1: Aktionen „Topics weiter“, „Topics zurück“, „Topics ein/aus“, „Clip-Moment“; Live-Anzeige auf den Tasten | Plugin | 2, 7 | offen |
| 9 | Plugin 0.2: mitgeliefertes Profil, Auslieferung der `.streamDeckPlugin`-Datei über GitHub-Releases | Plugin | 8 | offen |
| 10 | Später: Widget und Plugin über den Server ausliefern bzw. installieren (Modulsystem) | alle | OFFEN.md, „Module“ | Idee |

Schritt 1 und 2 können parallel laufen, weil das Widget bis Schritt 3 nur den Demo-Modus braucht. Schritt 7 ist unabhängig von den Topics und kann vorgezogen werden.

## Lizenzbereiche
Nach der Projektvorgabe „Lizenz- und Entwicklungskontext“ (12.11.2026; Ablage im Repository [UNGEKLÄRT]):
- **Server-Teil** (Schritte 2, 5, 6, 7: `lib/topics.js`, Endpoints, Webkonsole) ist eine Änderung am **Serverkern**, kein MIT-Modul. Er folgt der Lizenz des Servers (heute `ISC` laut `package.json`; Ziel PolyForm Perimeter 1.0.1, Umstellung ist eine eigene Entscheidung).
- **Widget und Plugin** sind eigenständige Module unter **MIT**. Sie nutzen nur die dokumentierte Schnittstelle und enthalten keinen kopierten Servercode.

## Entschieden (Nutzer, 12.11.2026)
- Repositories: `CheckTalk-Widget`, `TwitchCompanion_Streamdeck_Plugin`.
- Lizenz: siehe „Lizenzbereiche“.
- Ausgabe: OBS in 2K; vertikal über ein Dualstream-Plugin im selben OBS. Ein Design, zwei Browserquellen.
- Erledigte Themen: abgehakt und ausgegraut, **nicht** durchgestrichen.
- Design: Theme `panel` passend zur Programm-Tafel der Intro-Szene; vertikal im unteren schwarzen Bereich statt Dreh-Logo und Untertitel.
- Topic-Effekte erscheinen standardmäßig in keinem Log; nur ein Testschalter macht sie sichtbar (Spec, Abschnitt „Effekte“).

## Entscheidungen, die noch ausstehen
- Automatischer Reset der Liste beim Streamstart (Vorschlag in der Spec).
