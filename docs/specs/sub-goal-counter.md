# Spec: Sub-Goal-Counter

## Ziel
Den aktuellen Sub-Goal-Stand für Widgets bereitstellen, ohne bei jeder Abfrage Twitch zu belasten.

## Verhalten
- Seit Issue #60 (14.11.2026) kommt der Stand aus den EventSub-Ereignissen `channel.goal.begin`, `channel.goal.progress` und `channel.goal.end` (Version 1, Bedingung `broadcaster_user_id`, Scope `channel:read:goals`); `handleGoalEvent` schreibt ihn in `subgoal_cache.json`. Es gilt ADR 0023: Der Server fragt Twitch nicht je Sub.
- Berücksichtigt werden Ziele vom Typ `subscription` und `subscription_count` (`SUB_GOAL_TYPES`, wie bisher bei der Abfrage); andere Ziele (z. B. `follow`) ändern den Cache nicht.
- Twitch kann `channel.goal.begin` nach `channel.goal.progress` schicken. Ein Begin zu einem Ziel, das schon im Cache steht (`goalId`), ändert deshalb nichts.
- `status`: `active` bei Begin und Progress; bei End `achieved` (Ziel erreicht) oder `ended`.
- `refreshSubGoalCache` lädt `/helix/goals` (über `twitchApi`, ADR 0024). Es wählt zuerst ein aktives Ziel vom Typ `subscription` oder `subscription_count`, sonst irgendein Ziel dieser Typen. Auslöser: einmal je frischer EventSub-Verbindung (Ausgangsstand), `stream.online`, Konsolenbefehl `subgoal refresh`, `/api/twitch/subcounter` bei leerem Cache. Die Sub-Ereignisse (`channel.subscribe`, `channel.subscription.gift`, `channel.subscription.message`) lösen keine Abfrage mehr aus.
- Bei Fehler oder ohne passendes Ziel bleibt der bisherige Cache erhalten.

## Nicht-Ziele
- Kein Polling von Twitch durch den Server.
- Kein Effekt-Auslöser.

## Akzeptanzkriterien
- `/api/twitch/subcounter` liefert `current`, `target`, `title`, `goalId`, `status`, `lastUpdated`, `apiStatus` (unverändert).
- Ein Goal-Ereignis aktualisiert den Cache ohne Twitch-Abfrage; Sub-Ereignisse fragen nicht ab.
- Bei leerem Cache führt der erste Aufruf einen Refresh durch.
- Bei Twitch-Fehler wird der bisherige Cache geliefert und der Fehler geloggt.
- Ohne Sub-Goal bei Twitch bleibt der Cache unverändert und eine Warnung erscheint einmalig im Log.
- `subgoal show` zeigt `current / target`, Titel und Zeitstempel oder „nie geladen“.
- Der Scope `channel:read:goals` ist in `SCOPES` enthalten.
- Geprüft im Szenario `subgoal` von `test/admin-test.js` (G1–G7).

## Berührte Funktionen/Dateien
`loadSubGoalCache`, `saveSubGoalCache`, `refreshSubGoalCache`, `handleGoalEvent`, `subscribeToGoals`, `logIfChanged`, `/api/twitch/subcounter`; `subgoal_cache.json`
