# ADR 0010: Effekt-Modi mit Persistenz und HTTP-Steuerung

**Status:** Akzeptiert

**Kontext:** Effekte sollen im Stream abschaltbar oder bestätigungspflichtig sein. Laut Code-Kommentar wird per Stream Deck („Website öffnen“-Aktion) umgeschaltet.

**Entscheidung:** Drei Modi: `auto` (sofort), `manual` (Bestätigung über `/api/effects/confirm` binnen 30 s, sonst verworfen und nicht nachgeholt), `off` (wartende Jobs verwerfen). Der Modus wird in `effect_mode.json` gespeichert. Umschalten über GET-Endpoint und Konsole.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Zustandsändernde Aktionen laufen über GET ohne Authentifizierung. Bestätigen geht nur per HTTP, nicht per Konsole.
