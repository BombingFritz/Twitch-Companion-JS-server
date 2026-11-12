# ADR 0021: Intro-Topics als Server-Modul mit eigenem Widget

**Status:** Akzeptiert und umgesetzt (12.11.2026). Vom Nutzer entschieden: Anbindung an den Server, Liste bearbeitbar, Klickfolge aktiv → erledigt → nächstes, eigene Taste Ein/Aus, Ausblenden 5 s nach dem letzten Thema, ruhiges halbtransparentes Design im Channel-Branding, Widget in eigenem Repository (`BombingFritz/CheckTalk-Widget`, MIT), erledigte Themen abgehakt und ausgegraut statt durchgestrichen, Topic-Effekte standardmäßig in keinem Log (nur mit Testschalter). Von Claude festgelegt: Zustand als eine Schrittzahl, „Weiter“ bei ausgeblendeter Liste blendet nur ein, kein Ausblend-Timer nach manuellem Einblenden, Effekt-Typen.

**Kontext:** Beim Intro sollen die Themen des Tages als abhakbare Liste im Stream stehen, bedient per Stream Deck, mit optionalem Lichteffekt (z. B. Talk-Licht → Spiel-Licht). Es gibt eine horizontale und eine vertikale Szene. Module sollen langfristig einzeln installierbar sein (OFFEN.md).

**Entscheidung:**
- Der Server hält den Zustand: Liste in `topics.json` (ADR 0001), Fortschritt und Sichtbarkeit im Arbeitsspeicher (ADR 0002). Der Fortschritt ist eine Zahl `step`; Status je Thema und „Zurück“ folgen daraus.
- Das Widget ist reine Anzeige und bekommt den Zustand per Server-Sent Events. Es liegt in einem eigenen Repository wie SpargelPoll und Enigma.
- Der Server-Code liegt in `lib/topics.js` mit schmaler Schnittstelle, damit er später als eigenständiges Modul herausgelöst werden kann. `server.js` verdrahtet nur.
- Effekte über `scheduleEffect` (ADR 0004) mit eigenen `type`-Werten. Sie sind „still“: keine Log-Zeilen, kein Event-Log, keine Statistik, außer mit dem Testschalter `topics debug on`.

**Verworfene Alternativen:**
- Eigenständiges Widget mit Zustand im Browser: Das Stream Deck kann eine OBS-Browserquelle nicht direkt ansprechen; zwei Quellen (horizontal, vertikal) liefen auseinander; Liste nur per Datei editierbar.
- Zustand im Widget, Server nur als Relais: Neuladen der Quelle verlöre den Stand; Effekte und Plugin-Anzeige bräuchten Rückmeldungen vom Widget.
- Widget im Server-Repository: widerspräche dem Muster der übrigen Widgets und der späteren Modul-Installation.

**Konsequenzen:**
- Ein Server-Neustart setzt den Fortschritt zurück (Liste bleibt). Für ein Intro von wenigen Minuten vertretbar.
- Neue Effekt-Typen erscheinen beim HA-Webhook; HA ignoriert unbekannte Typen nur, wenn die Automation das so vorsieht [UNGEKLÄRT, in HA prüfen].
- Erste stille Effekt-Typen: `enqueueEffect`/`triggerEffect` brauchen eine Ausnahme, die das Payload-Schema nicht berührt.
- Lizenzbereiche nach der Projektvorgabe vom 12.11.2026: Der Server-Teil ist Serverkern (Lizenz des Servers), das Widget ein eigenständiges MIT-Modul.

**Nachtrag (12.11.2026, Nutzer): Anzeige-Einstellungen im Server.** Überschrift (Standard „Tagesthemen“), Design und Hintergrund je Ausgabe (horizontal/vertikal, durchscheinend/deckend) sind in der Webkonsole einstellbar, liegen in `topics.json` und gehen mit dem Zustand an die Widgets. Begründung: ein Ort für alle Einstellungen, beide Browserquellen bleiben gleich, ohne URL-Parameter von Hand zu pflegen. URL-Parameter überschreiben nur für eine Quelle. „Deckend“ füllt die ganze Browserquelle, damit die Liste im Hochformat Dreh-Logo und Untertitel überdeckt. Von Claude festgelegt: Parameter `output`, Standard vertikal deckend, Standardliste beim ersten Start, Reset bei neuer Stream-Session.
