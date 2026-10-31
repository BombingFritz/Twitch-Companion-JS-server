# ADR 0004: Effekte nur über scheduleEffect

**Status:** Akzeptiert

**Kontext:** Follow-, Sub- und Gift-Ereignisse lösen Licht-Effekte über Home Assistant aus. Mehrere Ereignisse können kurz nacheinander eintreffen.

**Entscheidung:** Alle Effekte laufen über `scheduleEffect(type, meta)`. Ereignisse desselben Typs werden gebündelt, die `effectQueue` arbeitet sie sequenziell mit Mindestabstand ab. Direkte `axios.post`-Aufrufe an `HA_WEBHOOK_URL` sind nicht vorgesehen.

**Verworfene Alternativen:** Direkter Webhook-Aufruf je Ereignis (laut Doku zu vermeiden). Weitere: [UNGEKLÄRT]

**Konsequenzen:** Überlappende Effekte werden vermieden. `meta` eines Bündels enthält nur das letzte Ereignis. Alle Auslösungen landen in `events.json`.
