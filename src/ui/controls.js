/**
 * Shared control builders for every panel: consistent markup, labels tied to
 * their inputs (so screen readers announce them), value readouts, optional
 * help text, and log-scaled sliders for frequencies.
 */

let _uid = 0;
const uid = (prefix) => `${prefix}-${++_uid}`;

/** Decimal places a slider step needs (0.01 → 2, 0.005 → 3, 1 → 0). */
function decimalsFor(step) {
  if (!step || step >= 1) return 0;
  return Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
}

function makeRow(label, help) {
  const row = document.createElement('div');
  row.className = 'control-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  if (help) {
    row.title = help;
    labelEl.classList.add('has-help');
  }
  row.appendChild(labelEl);
  return { row, labelEl };
}

function describe(input, help) {
  if (help) input.setAttribute('aria-description', help);
}

/**
 * A collapsible panel section.
 * @returns {{ el: HTMLDetailsElement, body: HTMLDivElement }}
 */
export function section(title, { open = false } = {}) {
  const el = document.createElement('details');
  el.className = 'config-section';
  el.open = open;
  const summary = document.createElement('summary');
  summary.textContent = title;
  el.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'section-body';
  el.appendChild(body);
  return { el, body };
}

/** A small heading with a rule, grouping the controls below it. */
export function divider(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'divider-group';
  const label = document.createElement('div');
  label.className = 'divider-label';
  label.textContent = text;
  const rule = document.createElement('div');
  rule.className = 'divider';
  wrapper.appendChild(label);
  wrapper.appendChild(rule);
  return wrapper;
}

/** Helper or status text. `live` announces changes to screen readers. */
export function note(text, { live = false } = {}) {
  const el = document.createElement('div');
  el.className = 'panel-note';
  if (live) el.setAttribute('role', 'status');
  el.textContent = text;
  return el;
}

/**
 * A slider with a value readout.
 * @param {object} o
 * @param {string} o.label
 * @param {number} o.min
 * @param {number} o.max
 * @param {number} [o.step]
 * @param {number} o.value
 * @param {(v: number) => void} [o.onInput] - every movement
 * @param {(v: number) => void} [o.onChange] - when the user lets go
 * @param {(v: number) => string} [o.format] - readout text
 * @param {string} [o.unit] - appended to the default readout
 * @param {'linear'|'log'} [o.scale] - log spreads frequencies evenly across the slider
 * @param {string} [o.help]
 * @param {boolean} [o.disabled]
 */
export function rangeRow(o) {
  const { row, labelEl } = makeRow(o.label, o.help);
  const input = document.createElement('input');
  input.type = 'range';
  input.id = uid('ctl');
  labelEl.htmlFor = input.id;
  describe(input, o.help);

  const log = o.scale === 'log' && o.min > 0;
  const decimals = decimalsFor(o.step ?? 0.01);
  const format = o.format || ((v) => {
    const text = Number(v).toFixed(log ? (v >= 100 ? 0 : decimals) : decimals);
    return o.unit ? `${text} ${o.unit}` : text;
  });

  // A log slider moves over 0..1000 positions mapped exponentially onto min..max
  const toPosition = (v) => log ? Math.round(1000 * Math.log(v / o.min) / Math.log(o.max / o.min)) : v;
  const fromPosition = (p) => {
    if (!log) return p;
    const v = o.min * Math.pow(o.max / o.min, p / 1000);
    return o.step ? Math.round(v / o.step) * o.step : v;
  };

  if (log) {
    input.min = 0;
    input.max = 1000;
    input.step = 1;
  } else {
    input.min = o.min;
    input.max = o.max;
    input.step = o.step ?? 0.01;
  }
  input.value = toPosition(o.value);
  input.disabled = !!o.disabled;

  const readout = document.createElement('output');
  readout.className = 'control-value';
  readout.htmlFor = input.id;
  readout.textContent = format(o.value);
  input.setAttribute('aria-valuetext', readout.textContent);

  const current = () => fromPosition(parseFloat(input.value));
  input.addEventListener('input', () => {
    const v = current();
    readout.textContent = format(v);
    input.setAttribute('aria-valuetext', readout.textContent);
    o.onInput?.(v);
  });
  if (o.onChange) input.addEventListener('change', () => o.onChange(current()));

  row.appendChild(input);
  row.appendChild(readout);
  row.setValue = (v) => {
    input.value = toPosition(v);
    readout.textContent = format(v);
  };
  row.input = input;
  return row;
}

/**
 * A dropdown. `options` are values, or `{ value, label }` pairs; `labels`
 * maps values to display names.
 */
export function selectRow({ label, options, value, onChange, labels = {}, help, disabled }) {
  const { row, labelEl } = makeRow(label, help);
  const select = document.createElement('select');
  select.id = uid('ctl');
  labelEl.htmlFor = select.id;
  describe(select, help);
  for (const opt of options) {
    const optValue = typeof opt === 'object' ? opt.value : opt;
    const optLabel = typeof opt === 'object' ? opt.label : (labels[opt] ?? opt);
    const option = document.createElement('option');
    option.value = optValue;
    option.textContent = optLabel;
    select.appendChild(option);
  }
  select.value = value;
  select.disabled = !!disabled;
  select.addEventListener('change', () => onChange?.(select.value));
  row.appendChild(select);
  row.input = select;
  return row;
}

/** An on/off switch. */
export function toggleRow({ label, value, onChange, help }) {
  const { row, labelEl } = makeRow(label, help);
  const toggle = document.createElement('label');
  toggle.className = 'toggle-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = uid('ctl');
  input.setAttribute('role', 'switch');
  labelEl.htmlFor = input.id;
  describe(input, help);
  input.checked = !!value;
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  slider.setAttribute('aria-hidden', 'true');
  input.addEventListener('change', () => onChange?.(input.checked));
  toggle.appendChild(input);
  toggle.appendChild(slider);
  row.appendChild(toggle);
  row.input = input;
  return row;
}

/** A text field; `onChange` fires when editing is committed (Enter or leaving the field). */
export function textRow({ label, value, onChange, placeholder, help, spellcheck = false }) {
  const { row, labelEl } = makeRow(label, help);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'text-input';
  input.id = uid('ctl');
  labelEl.htmlFor = input.id;
  describe(input, help);
  input.value = value ?? '';
  input.spellcheck = spellcheck;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('change', () => onChange?.(input.value.trim()));
  row.appendChild(input);
  row.input = input;
  return row;
}

/** A number field, clamped to min..max when committed. */
export function numberRow({ label, value, min, max, step = 1, onChange, help }) {
  const { row, labelEl } = makeRow(label, help);
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'text-input';
  input.id = uid('ctl');
  labelEl.htmlFor = input.id;
  describe(input, help);
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (!Number.isFinite(v)) v = value;
    v = Math.min(max, Math.max(min, v));
    input.value = v;
    onChange?.(v);
  });
  row.appendChild(input);
  row.input = input;
  return row;
}

/** A row of buttons: `[{ text, title, onClick }]`. */
export function buttonRow(buttons) {
  const row = document.createElement('div');
  row.className = 'btn-row';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = b.text;
    if (b.title) btn.title = b.title;
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  return row;
}
