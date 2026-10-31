# ADR 0005: Shoutout über die Helix-API

**Status:** Akzeptiert

**Kontext:** Shoutouts über den Chat-Befehl `/shoutout` waren unzuverlässig.

**Entscheidung:** Shoutouts gehen über `POST /helix/chat/shoutouts`. Der Scope `moderator:manage:shoutouts` ist Pflicht.

**Verworfene Alternativen:** Chat-Befehl `/shoutout`.

**Konsequenzen:** Ohne den Scope schlägt jeder Shoutout fehl (Fehler wird geloggt, kein Retry).
