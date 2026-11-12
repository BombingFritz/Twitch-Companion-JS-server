# ADR 0008: Sub- und Gift-Effekte aus channel.chat.notification

**Status:** Akzeptiert

**Kontext:** Laut Code-Kommentar treffen `channel.subscribe`, `channel.subscription.message` und `channel.subscription.gift` oft Sekunden vor der Chat-Ankündigung ein. Effekte feuerten dadurch zu früh und teils doppelt. Die genaue Twitch-seitige Ursache steht nicht im Material [UNGEKLÄRT].

**Entscheidung:** Effekte für `sub` und `gift` löst nur `channel.chat.notification` aus, also die Chat-Ankündigung. Ein Gift-Bomb erzeugt über `community_sub_gift` genau einen Effekt, einzelne `sub_gift`-Meldungen mit `community_gift_id` zählen nicht. Die frühen Events aktualisieren nur den Sub-Goal-Cache.

**Verworfene Alternativen:** Abgleich der frühen Events mit der Chat-Ankündigung in einem 2-Sekunden-Fenster [UNGEKLÄRT, nur im Chat-Verlauf, nicht in den Anhängen].

**Konsequenzen:** Schlägt `subscribeToChatNotifications` fehl, gibt es keine Sub-/Gift-Effekte (Fehler wird geloggt). Die Feldnamen der Payload sind nicht gegen reale Events belegt (siehe OFFEN.md).

**Nachtrag (12.11.2026, Nutzer: „erst protokollieren, nichts am Verhalten ändern“):** Im Co-Stream vom 11.11.2026 kam für einen Nutzer `channel.subscribe` ohne jede Chat-Ankündigung (kein Effekt, keine Zählung); bei einem anderen kam die Ankündigung `resub` erst 33 s nach `channel.subscribe`, als er seine Nachricht teilte. Twitchs Stream-Übersicht nannte 5 neue Abonnements, genau die Summe aus Subs (3) und verschenkten Subs (2) der Statistik; beim Stream vom 10.11. ebenso (3 und 3). Ob dem Nutzer ohne Ankündigung ein Sub fehlt, ist offen [UNGEKLÄRT]. Deshalb bleibt das Verhalten unverändert, das Protokoll wird genauer: Sub-Ereignisse nennen Stufe, „geschenkt“ bzw. „nicht geschenkt“, Monate und gekaufte Dauer; `sub`/`resub` nennen Prime bzw. Stufe und Monate; jede andere Ankündigung des eigenen Kanals erscheint als „nicht ausgewertet“ (außer `raid`, das über `channel.raid` läuft). Ankündigungen aus fremden Kanälen (`shared_chat_*`, `source_broadcaster_user_id`) werden weiter nicht protokolliert. Von Claude festgelegt: Wortlaut der Protokollzeilen, Ausnahme `raid`. Über einen Ersatzweg (Sub ohne Ankündigung nach einer Frist doch zählen) wird nach weiteren Streams entschieden.
