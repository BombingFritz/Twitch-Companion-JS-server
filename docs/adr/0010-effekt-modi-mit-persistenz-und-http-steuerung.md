# ADR 0010: Effekt-Modi mit Persistenz und HTTP-Steuerung

**Status:** Akzeptiert

**Kontext:** Effekte sollen im Stream abschaltbar oder bestätigungspflichtig sein. Laut Code-Kommentar wird per Stream Deck („Website öffnen“-Aktion) umgeschaltet.

**Entscheidung:** Drei Modi: `auto` (sofort), `manual` (Bestätigung über `/api/effects/confirm` binnen 30 s, sonst verworfen und nicht nachgeholt), `off` (wartende Jobs verwerfen). Der Modus wird in `effect_mode.json` gespeichert. Umschalten über GET-Endpoint und Konsole.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Zustandsändernde Aktionen laufen über GET ohne Authentifizierung. Bestätigen geht nur per HTTP, nicht per Konsole. `off` ist als Notschalter gedacht (z. B. bei Spam- oder Bot-Attacken): Der Wechsel auf `off` verwirft auch eine gerade wartende Bestätigung, ohne Eintrag im Event-Log, damit das Log bei einer Attacke nicht überläuft (Nachtrag Nov. 2026, OFFEN.md K3).

**Nachtrag (08.11.2026):** Der Nutzer hat entschieden, dass die Webkonsole die Stream-Deck-Tasten für den Effekt-Modus ersetzen kann (ADR 0018). Mit dem Reiter „Einstellungen“ entfallen deshalb `GET /api/effects/mode/:mode` und `GET /api/effects/confirm` zugunsten geschützter POST-Endpoints; das Mitnehmen der Bestätigung hat Claude vorgeschlagen. Bis dahin gilt dieses ADR unverändert. Die drei Modi, ihre Speicherung und die Konsolenbefehle bleiben.

**Nachtrag (09.11.2026):** Umgesetzt und vom Nutzer freigegeben: Umschalten und Bestätigen gehen nur noch über `POST /api/admin/effects/mode` und `/confirm` oder die Konsole, die beiden GET-Endpoints sind entfernt (ADR 0018).
