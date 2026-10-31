# Spec: Event-Log

## Ziel
Ausgelöste Effekte nachvollziehbar speichern und für Home Assistant abfragbar machen.

## Verhalten
- `appendEvent(type, payload)` hängt `{type, ...payload, timestamp}` an `events.json` an und behält die letzten 200 Einträge.
- Aufgerufen wird `appendEvent` von `triggerEffect` und, im Modus `manual` bei Timeout, mit `skippedManualTimeout: true`.
- `/api/homeassistant/events` liefert den letzten Eintrag, die letzten 20, Zähler je Typ und die Gesamtzahl.
- `events show` gibt die letzten 10 Einträge aus.

## Nicht-Ziele
- Kein Logging von Raids, Chat oder unbestätigten Rohereignissen.
- Keine unbegrenzte Historie.

## Akzeptanzkriterien
- Nach einem ausgelösten Effekt steht ein Eintrag mit `type`, `count`, Meta-Feldern und `timestamp` in `events.json`.
- `events.json` enthält nie mehr als 200 Einträge.
- `counts` zählt nur `follow`, `sub`, `gift` und schließt Einträge mit `skippedManualTimeout` ein.
- Ohne Datei antwortet der Endpoint mit `lastEvent: null` und `totalLogged: 0`.
- Auch ohne `HA_WEBHOOK_URL` werden Einträge geschrieben.

## Berührte Funktionen/Dateien
`loadEventLog`, `saveEventLog`, `appendEvent`, `triggerEffect`, `runManualConfirmation`, `/api/homeassistant/events`, `rl.on('line')`; `events.json`
