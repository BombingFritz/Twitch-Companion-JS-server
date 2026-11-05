# Spec: Effekt-Queue

## Ziel
Follow-, Sub- und Gift-Ereignisse gebündelt und nacheinander als Home-Assistant-Webhook ausgeben.

## Verhalten
- Auslöser: siehe „Effekt-Auslöser“ in docs/ARCHITEKTUR.md.
- `scheduleEffect(type, meta)` bündelt Ereignisse desselben Typs. Der 2,5-s-Timer startet bei jedem Ereignis neu. Danach entsteht ein Job `{type, count, meta}`.
- `processEffectQueue` arbeitet Jobs sequenziell ab, mindestens 4 s nach dem vorherigen.
- `auto`: `triggerEffect` sofort. `manual`: 30 s Wartezeit auf `/api/effects/confirm`, danach verworfen. `off`: wartende Jobs werden verworfen, ebenso eine gerade wartende Bestätigung (ohne Eintrag im Event-Log).
- Umgeschaltet wird nur über `setEffectMode(mode)`, sowohl vom Endpoint `/api/effects/mode/:mode` als auch vom Konsolenbefehl `effects mode`.
- `triggerEffect` schreibt in `events.json` und sendet an `HA_WEBHOOK_URL`, falls gesetzt.
- Vor der Verarbeitung ignoriert der Server bereits gesehene `message_id`s.

## Nicht-Ziele
- Keine Effekte für Raids.
- Kein Nachholen unbestätigter Effekte im Modus `manual`.
- Kein Retry bei Webhook-Fehlern.

## Akzeptanzkriterien
- 5 Follows innerhalb von 2,5 s erzeugen genau einen Webhook mit `count: 5`.
- Zwei Jobs werden mit mindestens 4 s Abstand ausgelöst.
- Ein Gift-Bomb mit 3 Subs erzeugt genau einen Webhook mit `type: "gift"` und `meta.giftCount: 3`.
- Die `frühen` Events `channel.subscribe`, `channel.subscription.gift` und `channel.subscription.message` erzeugen keinen Webhook.
- Eine `sub`-Chat-Ankündigung mit `is_gift` erzeugt keinen Webhook.
- Im Modus `off` wird kein Webhook gesendet und die Queue ist danach leer.
- Im Modus `manual` ohne Bestätigung innerhalb von 30 s wird kein Webhook gesendet, `events.json` erhält einen Eintrag mit `skippedManualTimeout: true`.
- Eine Bestätigung ohne wartenden Effekt liefert `{ok:false, message}`.
- Wird während der Wartezeit im Modus `manual` auf `off` umgeschaltet (per HTTP oder Konsole), liefert `/api/effects/confirm` danach `{ok:false, message}`, es wird kein Webhook gesendet und `events.json` erhält keinen Eintrag.
- Der Modus bleibt nach einem Neustart erhalten.
- Das Webhook-Payload entspricht dem Schema in docs/ARCHITEKTUR.md.

## Berührte Funktionen/Dateien
`scheduleEffect`, `enqueueEffect`, `processEffectQueue`, `runManualConfirmation`, `setEffectMode`, `triggerEffect`, `handleChatNotification`, `isDuplicateMessage`, `wasRecentlyTriggered`, `loadEffectMode`, `saveEffectMode`; `effect_mode.json`, `events.json`
