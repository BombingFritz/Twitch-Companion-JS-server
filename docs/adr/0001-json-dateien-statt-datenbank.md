# ADR 0001: JSON-Dateien statt Datenbank

**Status:** Akzeptiert (im Code umgesetzt)

**Kontext:** Persistente Daten: Tokens, Raid-Statistik, Whitelist, Sub-Goal-Cache, Event-Log, Effekt-Modus. Die Doku sieht für neue Daten ausdrücklich eine eigene JSON-Datei vor.

**Entscheidung:** Jede Datenart liegt in einer eigenen JSON-Datei mit `load…()`/`save…()`-Paar.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Keine Abhängigkeit zu einer Datenbank. Dateien liegen im Arbeitsverzeichnis und gehören in `.gitignore`. Nebenläufiger Zugriff durch mehrere Prozesse ist nicht abgesichert [UNGEKLÄRT].
