# ADR 0009: Entdoppelung über message_id und Zeitfenster

**Status:** Akzeptiert

**Kontext:** Twitch kann dieselbe Benachrichtigung erneut zustellen. Follows und Subs können für denselben Nutzer kurz nacheinander eintreffen.

**Entscheidung:** Jede `metadata.message_id` wird 10 Minuten gemerkt und nur einmal verarbeitet. Zusätzlich löst pro Nutzer höchstens ein Sub-Effekt und ein Follow-Effekt je 60 s aus. Anonyme Nutzer ohne Schlüssel werden nicht entdoppelt.

**Verworfene Alternativen:** [UNGEKLÄRT]

**Konsequenzen:** Ein echter zweiter Sub desselben Nutzers innerhalb von 60 s löst keinen zweiten Effekt aus. Der Zustand liegt im RAM und geht beim Neustart verloren.
