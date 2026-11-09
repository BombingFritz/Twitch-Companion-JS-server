# Spec: Effekt-Queue

## Ziel
Follow-, Sub- und Gift-Ereignisse gebündelt und nacheinander als Home-Assistant-Webhook ausgeben.

## Verhalten
- Auslöser: siehe „Effekt-Auslöser“ in docs/ARCHITEKTUR.md.
- `scheduleEffect(type, meta)` bündelt Ereignisse desselben Typs. Der 2,5-s-Timer startet bei jedem Ereignis neu. Danach entsteht ein Job `{type, count, meta}`.
- `processEffectQueue` arbeitet Jobs sequenziell ab, mindestens 4 s nach dem vorherigen.
- `auto`: `triggerEffect` sofort. `off`: wartende Jobs werden verworfen (ohne Eintrag im Event-Log). Den früheren Modus `manual` gibt es nicht mehr (ADR 0010, Nachtrag 09.11.2026).
- Umgeschaltet wird nur über `setEffectMode(mode)`, sowohl von der Webkonsole (`POST /api/admin/effects/mode`, ADR 0018) als auch vom Konsolenbefehl `effects mode`.
- `triggerEffect` schreibt in `events.json` und sendet an `HA_WEBHOOK_URL`, falls gesetzt.
- Vor der Verarbeitung ignoriert der Server bereits gesehene `message_id`s.

## Nicht-Ziele
- Keine Effekte für Raids.
- Kein Retry bei Webhook-Fehlern.

## Akzeptanzkriterien
- 5 Follows innerhalb von 2,5 s erzeugen genau einen Webhook mit `count: 5`.
- Zwei Jobs werden mit mindestens 4 s Abstand ausgelöst.
- Ein Gift-Bomb mit 3 Subs erzeugt genau einen Webhook mit `type: "gift"` und `meta.giftCount: 3`.
- Die `frühen` Events `channel.subscribe`, `channel.subscription.gift` und `channel.subscription.message` erzeugen keinen Webhook.
- Eine `sub`-Chat-Ankündigung mit `is_gift` erzeugt keinen Webhook.
- Im Modus `off` wird kein Webhook gesendet und die Queue ist danach leer.
- Der Modus bleibt nach einem Neustart erhalten.
- Das Webhook-Payload entspricht dem Schema in docs/ARCHITEKTUR.md.

## Berührte Funktionen/Dateien
`scheduleEffect`, `enqueueEffect`, `processEffectQueue`, `setEffectMode`, `triggerEffect`, `handleChatNotification`, `isDuplicateMessage`, `wasRecentlyTriggered`, `loadEffectMode`, `saveEffectMode`; `effect_mode.json`, `events.json`
