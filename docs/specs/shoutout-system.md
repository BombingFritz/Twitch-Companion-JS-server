# Spec: Shoutout-System

## Ziel
Andere Streamer automatisch über die offizielle Twitch-Funktion shouten.

## Verhalten
- `sendShoutout(toId, toName)` ruft `POST /helix/chat/shoutouts` mit `from_broadcaster_id`, `to_broadcaster_id`, `moderator_id` (je Broadcaster) auf.
- Auslöser 1: Raid mit `viewers >= 3`, 2 s nach der Begrüßung.
- Auslöser 2: erste Chat-Nachricht eines Whitelist-Nutzers in der laufenden Session (siehe Spec Whitelist).
- Fehler werden geloggt, es gibt keinen Retry.

## Nicht-Ziele
- Keine Aktivitätsprüfung des Zielkanals. Eine 40-Tage-Prüfung existiert nur in einem anderen Branch, nicht in diesem Code.
- Schwelle ist nicht konfigurierbar (hart im Code).

## Akzeptanzkriterien
- Ein Raid mit 2 Zuschauern löst keinen Shoutout aus und schreibt „Kein Shoutout“ ins Log.
- Ein Raid mit 3 Zuschauern löst genau einen Shoutout nach der Begrüßung aus.
- Ohne den Scope `moderator:manage:shoutouts` wird der Fehler geloggt und der Server läuft weiter.
- Es wird kein Chat-Befehl `/shoutout` gesendet.

## Berührte Funktionen/Dateien
`sendShoutout`, `handleRaidEvent`, `handleWhitelistShoutout`
