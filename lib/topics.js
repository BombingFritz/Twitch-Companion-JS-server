'use strict';
// Intro-Topics (ADR 0021, docs/specs/intro-topics.md): abhakbare Themenliste fürs Intro.
// Die Liste und die Anzeige-Einstellungen sind persistent (topics.json), Fortschritt und Sichtbarkeit nur im Arbeitsspeicher.
// Der Fortschritt ist eine Zahl `step` von 0 bis 2 × Anzahl; der Status jedes Themas folgt daraus.
// Das Modul kennt weder Express noch Twitch: server.js verdrahtet Endpoints, Ereignisse und Effekte.

const MAX_ITEMS = 10;
const MAX_TITLE_LENGTH = 60;
const MAX_HEADING_LENGTH = 40;
const THEMES = ['panel', 'spargel', 'neutral'];
const BACKGROUNDS = ['transparent', 'solid'];
const OUTPUTS = ['horizontal', 'vertikal'];
const DEFAULT_ITEMS = ['Begrüßung', 'Neuigkeiten', 'Streamplan'];
const DEFAULT_DISPLAY = {
  title: 'Tagesthemen',
  theme: 'panel',
  background: { horizontal: 'transparent', vertikal: 'solid' },
};

// Ein Titel: Text ohne Zeilenumbruch, Leerraum zusammengefasst, 1 bis maxLength Zeichen.
function cleanText(value, maxLength, allowEmpty = false) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text && !allowEmpty) return null;
  if ([...text].length > maxLength) return null;
  return text;
}

// Liefert { items } oder { error }. Akzeptiert ["A", "B"] und [{ title: "A" }, …].
function validateItems(input) {
  if (!Array.isArray(input)) return { error: 'items muss eine Liste sein' };
  if (input.length < 1 || input.length > MAX_ITEMS) return { error: `1 bis ${MAX_ITEMS} Themen` };
  const items = [];
  for (const entry of input) {
    const title = cleanText(typeof entry === 'string' ? entry : entry && entry.title, MAX_TITLE_LENGTH);
    if (title === null) return { error: `Jedes Thema braucht einen Titel mit 1 bis ${MAX_TITLE_LENGTH} Zeichen` };
    items.push({ title });
  }
  return { items };
}

// Liefert { display } oder { error }. Fehlende Felder bleiben wie in `current`.
function validateDisplay(input, current = DEFAULT_DISPLAY) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'display muss ein Objekt sein' };
  const display = { ...current, background: { ...current.background } };
  if (input.title !== undefined) {
    const title = cleanText(input.title, MAX_HEADING_LENGTH, true);
    if (title === null) return { error: `Überschrift höchstens ${MAX_HEADING_LENGTH} Zeichen` };
    display.title = title;
  }
  if (input.theme !== undefined) {
    if (!THEMES.includes(input.theme)) return { error: `Design: ${THEMES.join(', ')}` };
    display.theme = input.theme;
  }
  if (input.background !== undefined) {
    if (!input.background || typeof input.background !== 'object') return { error: 'background muss ein Objekt sein' };
    for (const [output, value] of Object.entries(input.background)) {
      if (!OUTPUTS.includes(output)) return { error: `Ausgabe: ${OUTPUTS.join(', ')}` };
      if (!BACKGROUNDS.includes(value)) return { error: `Hintergrund: ${BACKGROUNDS.join(', ')}` };
      display.background[output] = value;
    }
  }
  return { display };
}

function statusOf(index, step) {
  if (step < 2 * index + 1) return 'offen';
  if (step === 2 * index + 1) return 'aktiv';
  return 'erledigt';
}

// Gespeicherte Daten prüfen; Unbrauchbares fällt auf die Standardwerte zurück, damit der Server immer startet.
function readConfig(raw, warn) {
  const config = { items: DEFAULT_ITEMS.map(title => ({ title })), display: { ...DEFAULT_DISPLAY, background: { ...DEFAULT_DISPLAY.background } }, updated_at: null };
  if (!raw) return config;
  const items = validateItems(raw.items);
  if (items.items) config.items = items.items;
  else warn(`[Topics] Gespeicherte Liste unbrauchbar (${items.error}), Standardliste wird verwendet`);
  if (raw.display) {
    const display = validateDisplay(raw.display, config.display);
    if (display.display) config.display = display.display;
    else warn(`[Topics] Gespeicherte Anzeige-Einstellungen unbrauchbar (${display.error}), Standardwerte werden verwendet`);
  }
  if (typeof raw.updated_at === 'string') config.updated_at = raw.updated_at;
  return config;
}

/**
 * @param {object} o
 * @param {() => object|null} o.load        gespeicherte Daten oder null
 * @param {(data: object) => void} o.save
 * @param {(state: object) => void} [o.onChange]  nach jeder Änderung mit dem neuen Zustand
 * @param {(type: string, meta: object) => void} [o.onEffect]
 * @param {() => boolean} [o.isEnabled]
 * @param {number} [o.autoHideMs]
 * @param {() => number} [o.now]
 * @param {(fn: Function, ms: number) => any} [o.setTimer]
 * @param {(handle: any) => void} [o.clearTimer]
 * @param {(message: string) => void} [o.warn]
 */
function createTopics({
  load, save, onChange = () => {}, onEffect = () => {}, isEnabled = () => true, autoHideMs = 5000,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, warn = () => {},
}) {
  let config = readConfig(load(), warn);
  let step = 0;
  let visible = false;
  let hideReason = null;
  let revision = 1;
  let timer = null;

  const total = () => config.items.length;
  const complete = () => step === 2 * total();

  function getState() {
    return {
      enabled: Boolean(isEnabled()),
      visible,
      hide_reason: visible ? null : hideReason,
      step,
      total: total(),
      current: step === 0 ? null : Math.floor((step - 1) / 2),
      complete: complete(),
      items: config.items.map((item, i) => ({ title: item.title, status: statusOf(i, step) })),
      display: { ...config.display, background: { ...config.display.background } },
      revision,
    };
  }

  function changed() {
    revision += 1;
    onChange(getState());
  }

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function show() {
    visible = true;
    hideReason = null;
  }

  function persist() {
    config.updated_at = new Date(now()).toISOString();
    save({ items: config.items, display: config.display, updated_at: config.updated_at });
  }

  function next() {
    // Fertige, sichtbare Liste: nichts ändern, ein laufender Ausblend-Timer läuft weiter.
    if (visible && complete()) return getState();
    stopTimer();
    if (!visible) {
      show();
      changed();
      return getState();
    }
    step += 1;
    const index = Math.floor((step - 1) / 2);
    const meta = { index, title: config.items[index].title, total: total() };
    onEffect(step % 2 === 1 ? 'topic_active' : 'topic_done', meta);
    if (complete()) {
      onEffect('topics_complete', { total: total() });
      timer = setTimer(() => {
        timer = null;
        visible = false;
        hideReason = 'auto';
        changed();
      }, autoHideMs);
    }
    changed();
    return getState();
  }

  function back() {
    stopTimer();
    if (!visible) show();
    else if (step > 0) step -= 1;
    else return getState();
    changed();
    return getState();
  }

  function toggle() {
    stopTimer();
    if (visible) {
      visible = false;
      hideReason = 'manual';
    } else {
      show();
    }
    changed();
    return getState();
  }

  function reset() {
    stopTimer();
    step = 0;
    visible = false;
    hideReason = 'manual';
    changed();
    return getState();
  }

  // Neue Liste: Fortschritt beginnt von vorn, Sichtbarkeit bleibt.
  function setItems(input) {
    const result = validateItems(input);
    if (result.error) return result;
    stopTimer();
    config = { ...config, items: result.items };
    step = 0;
    persist();
    changed();
    return { state: getState() };
  }

  function setDisplay(input) {
    const result = validateDisplay(input, config.display);
    if (result.error) return result;
    config = { ...config, display: result.display };
    persist();
    changed();
    return { state: getState() };
  }

  // Modul ein/aus: Zustand bleibt, Widgets erfahren es über `enabled`.
  function notifyEnabledChanged() {
    if (!isEnabled()) stopTimer();
    changed();
  }

  function getConfig() {
    return { items: config.items.map(i => ({ ...i })), display: getState().display, updated_at: config.updated_at };
  }

  return { getState, getConfig, next, back, toggle, reset, setItems, setDisplay, notifyEnabledChanged };
}

module.exports = {
  createTopics, validateItems, validateDisplay,
  MAX_ITEMS, MAX_TITLE_LENGTH, MAX_HEADING_LENGTH, THEMES, BACKGROUNDS, OUTPUTS, DEFAULT_DISPLAY,
};
