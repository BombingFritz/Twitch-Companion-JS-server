# Spec: Shoutout-System

## Ziel
Andere Streamer automatisch über die offizielle Twitch-Funktion shouten.

## Verhalten
- `sendShoutout(toId, toName)` ruft `POST /helix/chat/shoutouts` mit `from_broadcaster_id`, `to_broadcaster_id`, `moderator_id` (je Broadcaster) auf.
- Auslöser 1: Raid mit `viewers >= 3`, 2 s nach der Begrüßung. Der Raider wird schon bei der Begrüßung in `shoutedOutThisSession` eingetragen, damit seine erste Chat-Nachricht (Whitelist) keinen zweiten Shoutout auslöst. Scheitert der Raid-Shoutout, wird der Eintrag wieder entfernt (außer er bestand schon vorher).
- Auslöser 2: erste Chat-Nachricht eines Whitelist-Nutzers in der laufenden Session (siehe Spec Whitelist).
- `sendShoutout` liefert `true` bei Erfolg, sonst `false`.
- Fehler werden geloggt, es gibt keinen Retry. Erwartbare Ablehnungen von Twitch erscheinen als kurzer Hinweis statt als Fehler: 400 „not streaming live“ (Kanal noch nicht live) und 429 (Twitch-Wartezeit: 2 min zwischen Shoutouts, 60 min je Streamer).

## Nicht-Ziele
- Keine Aktivitätsprüfung bei Raid-Shoutouts (der Raider ist live). Whitelist-Shoutouts prüfen die Aktivität der letzten 40 Tage, entfallen bei Streamern, die gerade selbst live sind, und posten vorher einen Chat-Hinweis mit dem Spiel (ADR 0015, Spec Whitelist).
- Schwelle ist nicht konfigurierbar (hart im Code).

## Akzeptanzkriterien
- Ein Raid mit 2 Zuschauern löst keinen Shoutout aus und schreibt „Kein Shoutout“ ins Log.
- Ein Raid mit 3 Zuschauern löst genau einen Shoutout nach der Begrüßung aus.
- Ohne den Scope `moderator:manage:shoutouts` wird der Fehler geloggt und der Server läuft weiter.
- Es wird kein Chat-Befehl `/shoutout` gesendet.
- Ein Raider mit mindestens 3 Zuschauern, der auf der Whitelist steht und danach im Chat schreibt, erhält genau einen Shoutout (auch wenn er vor Ablauf der 2 s schreibt).
- Scheitert der Raid-Shoutout, versucht die erste Chat-Nachricht des Raiders (Whitelist) einen neuen Shoutout.
- Ablehnung mit 400 „not streaming live“ oder 429 erzeugt einen kurzen Hinweis, keine Fehlerausgabe.

## Berührte Funktionen/Dateien
`sendShoutout`, `handleRaidEvent`, `handleWhitelistShoutout`, `getChannelActivity`
