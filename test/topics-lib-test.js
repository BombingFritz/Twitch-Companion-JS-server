// lib/topics.js (ADR 0021, docs/specs/intro-topics.md): läuft ohne Server, mit künstlichem Timer.
const path = require('path');
const { createTopics, validateItems, validateDisplay } = require(path.join(__dirname, '..', 'lib', 'topics.js'));

const results = []; const check = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

function setup(stored = { items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }, options = {}) {
  const saved = [], effects = [], changes = [], warnings = [];
  const timers = [];
  let enabled = true;
  const topics = createTopics({
    load: () => stored,
    save: d => saved.push(JSON.parse(JSON.stringify(d))),
    onChange: s => changes.push(s),
    onEffect: (type, meta) => effects.push({ type, ...meta }),
    isEnabled: () => enabled,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: t => { t.cleared = true; },
    now: () => Date.UTC(2026, 10, 12, 20, 0, 0),
    warn: m => warnings.push(m),
    ...options,
  });
  const fire = () => { const t = timers.filter(x => !x.cleared && !x.fired).pop(); if (t) { t.fired = true; t.fn(); } return t; };
  const pending = () => timers.filter(x => !x.cleared && !x.fired).length;
  return { topics, saved, effects, changes, warnings, timers, fire, pending, setEnabled: v => { enabled = v; } };
}
const statuses = s => s.items.map(i => i.status[0]).join('');

// Grundzustand
let t = setup();
let s = t.topics.getState();
check('T1 Start: ausgeblendet, Schritt 0, alles offen', !s.visible && s.step === 0 && s.total === 3 && statuses(s) === 'ooo' && s.current === null && !s.complete, JSON.stringify(s));
check('T2 Anzeige-Standard: Tagesthemen, panel, horizontal transparent, vertikal deckend',
  s.display.title === 'Tagesthemen' && s.display.theme === 'panel' && s.display.background.horizontal === 'transparent' && s.display.background.vertikal === 'solid', JSON.stringify(s.display));

// Weiter bei ausgeblendeter Liste blendet nur ein
s = t.topics.next();
check('T3 Weiter bei ausgeblendeter Liste: nur einblenden', s.visible && s.step === 0 && t.effects.length === 0, JSON.stringify(s));

// Klickfolge aktiv → erledigt → nächstes aktiv
const seq = [];
for (let i = 0; i < 6; i++) seq.push(statuses(t.topics.next()));
check('T4 Klickfolge 6 × weiter', seq.join(',') === 'aoo,eoo,eao,eeo,eea,eee', seq.join(','));
s = t.topics.getState();
check('T5 Alles erledigt: complete, current = letztes', s.complete && s.current === 2 && s.visible, JSON.stringify(s));
check('T6 Effekte in der richtigen Folge', t.effects.map(e => e.type).join(',') === 'topic_active,topic_done,topic_active,topic_done,topic_active,topic_done,topics_complete', JSON.stringify(t.effects));
check('T7 Effekt-Meta: index, title, total', t.effects[2].index === 1 && t.effects[2].title === 'B' && t.effects[2].total === 3 && t.effects[6].total === 3, JSON.stringify(t.effects[2]));
check('T8 Ausblend-Timer läuft mit 5 s', t.pending() === 1 && t.timers[t.timers.length - 1].ms === 5000);

// Weiter nach „fertig“ ändert nichts
const before = t.topics.getState().revision;
t.topics.next();
check('T9 Weiter nach fertig: keine Änderung, Timer bleibt', t.topics.getState().revision === before && t.pending() === 1 && t.effects.length === 7);

// Timer blendet aus
t.fire();
s = t.topics.getState();
check('T10 Nach 5 s ausgeblendet mit Grund auto', !s.visible && s.hide_reason === 'auto' && s.complete, JSON.stringify(s));

// Ein/Aus zeigt die fertige Liste dauerhaft
s = t.topics.toggle();
check('T11 Ein/Aus nach Ausblenden: sichtbar, kein neuer Timer', s.visible && s.hide_reason === null && t.pending() === 0, JSON.stringify(s));
s = t.topics.toggle();
check('T12 Ein/Aus erneut: manuell ausgeblendet, Stand bleibt', !s.visible && s.hide_reason === 'manual' && s.complete);

// Zurück während des Ausblend-Timers bricht ab
t = setup();
t.topics.next();
for (let i = 0; i < 6; i++) t.topics.next();
check('T13 Timer läuft', t.pending() === 1);
s = t.topics.back();
check('T14 Zurück bricht das Ausblenden ab und nimmt einen Schritt zurück', t.pending() === 0 && s.visible && statuses(s) === 'eea', JSON.stringify(s));
const effectsBefore = t.effects.length;
t.topics.back();
check('T15 Zurück löst keinen Effekt aus', t.effects.length === effectsBefore);
for (let i = 0; i < 10; i++) t.topics.back();
check('T16 Zurück endet bei 0', t.topics.getState().step === 0);
t.topics.toggle();
s = t.topics.back();
check('T17 Zurück bei ausgeblendeter Liste: nur einblenden', s.visible && s.step === 0);

// Reset
t.topics.next(); t.topics.next();
s = t.topics.reset();
check('T18 Reset: Schritt 0, ausgeblendet', s.step === 0 && !s.visible && s.hide_reason === 'manual');

// Revision steigt mit jeder Änderung, onChange bekommt den Zustand
check('T19 Revision steigt, onChange je Änderung', t.changes.length > 0 && t.changes.every((c, i) => i === 0 || c.revision > t.changes[i - 1].revision));

// Liste setzen
t = setup();
t.topics.next(); t.topics.next(); t.topics.next();
let r = t.topics.setItems(['  Eins  ', 'Zwei\nDrei']);
check('T20 Neue Liste: bereinigt, gespeichert, Schritt 0, sichtbar bleibt', r.state && r.state.items.map(i => i.title).join('|') === 'Eins|Zwei Drei' && r.state.step === 0 && r.state.visible && t.saved.length === 1 && t.saved[0].items.length === 2 && t.saved[0].updated_at === '2026-11-12T20:00:00.000Z', JSON.stringify(r));
r = t.topics.setItems([]);
check('T21 Leere Liste abgelehnt', r.error && t.saved.length === 1);
r = t.topics.setItems(Array.from({ length: 11 }, (_, i) => `T${i}`));
check('T22 Mehr als 10 Themen abgelehnt', Boolean(r.error));
r = t.topics.setItems(['x'.repeat(61)]);
check('T23 Titel über 60 Zeichen abgelehnt', Boolean(r.error));
r = t.topics.setItems(['ok', '   ']);
check('T24 Leerer Titel abgelehnt', Boolean(r.error));
r = t.topics.setItems('kein Array');
check('T25 Keine Liste abgelehnt', Boolean(r.error));

// Anzeige setzen
r = t.topics.setDisplay({ title: 'Themen heute', theme: 'spargel', background: { vertikal: 'transparent' } });
check('T26 Anzeige teilweise ändern, Rest bleibt', r.state && r.state.display.title === 'Themen heute' && r.state.display.theme === 'spargel' && r.state.display.background.vertikal === 'transparent' && r.state.display.background.horizontal === 'transparent' && t.saved[t.saved.length - 1].display.theme === 'spargel', JSON.stringify(r));
r = t.topics.setDisplay({ title: '' });
check('T27 Leere Überschrift erlaubt (keine Überschrift)', r.state && r.state.display.title === '');
for (const bad of [{ theme: 'pink' }, { background: { quer: 'solid' } }, { background: { horizontal: 'rot' } }, { title: 'x'.repeat(41) }, null, []]) {
  r = t.topics.setDisplay(bad);
  check(`T28 Ungültige Anzeige abgelehnt: ${JSON.stringify(bad)}`, Boolean(r.error), JSON.stringify(r));
}

// Laden
t = setup(null);
check('T29 Ohne Datei: Standardliste', t.topics.getState().items.map(i => i.title).join('|') === 'Begrüßung|Neuigkeiten|Streamplan' && t.warnings.length === 0);
t = setup({ items: 'kaputt', display: { theme: 'pink' } });
s = t.topics.getState();
check('T30 Defekte Datei: Standardwerte und Warnungen', s.items.length === 3 && s.display.theme === 'panel' && t.warnings.length === 2, JSON.stringify(t.warnings));
t = setup({ items: [{ title: 'X' }], display: { title: 'Agenda', background: { vertikal: 'transparent' } } });
s = t.topics.getState();
check('T31 Gespeicherte Anzeige wird übernommen, fehlende Felder ergänzt', s.display.title === 'Agenda' && s.display.theme === 'panel' && s.display.background.vertikal === 'transparent' && s.display.background.horizontal === 'transparent', JSON.stringify(s.display));

// Modul aus
t = setup();
t.topics.next(); for (let i = 0; i < 6; i++) t.topics.next();
t.setEnabled(false);
t.topics.notifyEnabledChanged();
check('T32 Modul aus: enabled false, Ausblend-Timer gestoppt', t.topics.getState().enabled === false && t.pending() === 0);

// Validierung direkt
check('T33 validateItems akzeptiert Objekte', validateItems([{ title: 'a' }]).items[0].title === 'a');
check('T34 validateDisplay ohne Änderung liefert Standard', validateDisplay({}).display.title === 'Tagesthemen');

// Ein Effekt-Fehler bricht die Bedienung nicht (server.js fängt ab); hier nur: getState ist eine Kopie
t = setup();
s = t.topics.getState();
s.items[0].title = 'verändert'; s.display.background.horizontal = 'solid';
check('T35 getState liefert eine Kopie', t.topics.getState().items[0].title === 'A' && t.topics.getState().display.background.horizontal === 'transparent');

for (const x of results) console.log(`${x.ok ? 'OK  ' : 'FAIL'} ${x.name}${x.ok ? '' : '  -> ' + x.info}`);
process.exit(results.every(x => x.ok) ? 0 : 1);
