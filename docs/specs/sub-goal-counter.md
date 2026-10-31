# Spec: Sub-Goal-Counter

## Ziel
Den aktuellen Sub-Goal-Stand für Widgets bereitstellen, ohne bei jeder Abfrage Twitch zu belasten.

## Verhalten
- `refreshSubGoalCache` lädt `/helix/goals`. Es wählt zuerst ein aktives Ziel vom Typ `subscription` oder `subscription_count`, sonst irgendein Ziel dieser Typen.
- Der Stand wird in `subgoal_cache.json` geschrieben.
- Refresh-Auslöser: `stream.online`, jedes `channel.subscribe`, `channel.subscription.gift` und `channel.subscription.message`, Konsolenbefehl `subgoal refresh`, `/api/twitch/subcounter` bei leerem Cache.
- Bei Fehler oder ohne passendes Ziel bleibt der bisherige Cache erhalten.

## Nicht-Ziele
- Kein Polling von Twitch durch den Server.
- Kein Effekt-Auslöser.

## Akzeptanzkriterien
- `/api/twitch/subcounter` liefert `current`, `target`, `title`, `goalId`, `status`, `lastUpdated`, `apiStatus`.
- Bei leerem Cache führt der erste Aufruf einen Refresh durch.
- Bei Twitch-Fehler wird der bisherige Cache geliefert und der Fehler geloggt.
- Ohne Sub-Goal bei Twitch bleibt der Cache unverändert und eine Warnung erscheint einmalig im Log.
- `subgoal show` zeigt `current / target`, Titel und Zeitstempel oder „nie geladen“.
- Der Scope `channel:read:goals` ist in `SCOPES` enthalten.

## Berührte Funktionen/Dateien
`loadSubGoalCache`, `saveSubGoalCache`, `refreshSubGoalCache`, `logIfChanged`, `/api/twitch/subcounter`; `subgoal_cache.json`
