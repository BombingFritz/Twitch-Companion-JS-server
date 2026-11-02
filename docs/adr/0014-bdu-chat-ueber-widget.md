# ADR 0014: BdU-Chat-Befehl, Antwort über das Enigma-Widget

**Status:** Angenommen; Nutzer bestätigt (02.11.2026). Umgesetzt (Gegenstück: Enigma-Widget 1.2.0).

**Kontext:** Zuschauer sollen dem KI-BdU aus dem Enigma-Widget (Repository `BombingFritz/Uboat-Widget`) per Chat Funksprüche schicken. Die KI, der Prompt und der Funkverlauf liegen im Widget (Browser, `localStorage`). Gegenstück: ADR 0004 und `docs/specs/chat-modus.md` im Widget-Repository.

**Entscheidung:**
- Der Server erkennt `!BdU …` in `channel.chat.message`, kürzt den Text und prüft Limits und Funkstille. Angenommene Anfragen gehen per Server-Sent Events an das verbundene Widget. Das Widget erzeugt die Antwort mit der KI und schickt sie per POST zurück. Der Server postet sie per Helix als Antwort auf die Chat-Nachricht.
- Warnung und Funkstille-Ansage postet der Server selbst, ohne KI.
- Limits gelten für alle Nutzer, ausdrücklich ohne Ausnahme für Broadcaster und Mods (Abweichung vom Muster `handleChatCommand` mit Mod-Check in AGENTS.md; Wunsch des Nutzers).
- Beide neuen Endpoints nur über Loopback (wie `/token`, ADR 0013).
- Zustand im RAM (ADR 0002); Limits beginnen nach einem Neustart neu.

**Verworfene Alternativen:**
- Widget postet selbst per Helix (Muster SpargelPoll): Twitch-Logik und Token im öffentlichen Widget, Chat-Ausgaben aus zwei Stellen.
- Widget fragt den Server periodisch ab: Chrome drosselt Timer in Hintergrund-Tabs; der Server wüsste nicht, ob ein Widget läuft.
- Server ruft die KI selbst auf: Prompt, Kontext und Verlauf müssten doppelt gepflegt werden.

**Konsequenzen:**
- Erster POST-Endpoint und erster Server-Sent-Events-Endpoint des Servers (Abweichung vom GET-Muster in AGENTS.md, bewusst: Zustandsänderung per GET ist in OFFEN.md Priorität 2 als Schwachstelle notiert). `express.json()` wird benötigt.
- Ohne verbundenes Widget bleibt `!BdU` still und verbraucht kein Kontingent.
- Neue Chat-Ausgaben nutzen den vorhandenen Scope `user:write:chat`; keine neuen Scopes.
