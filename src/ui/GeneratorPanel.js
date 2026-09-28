import { section, divider, rangeRow, selectRow, toggleRow, numberRow } from './controls.js';
import { PARAM_GROUPS } from '../generators/orbitParams.js';

// Params that rebuild the orbit's geometry: while a slider drags, apply at
// most once per frame
const REBUILD_KEYS = new Set(['nodeCount', 'trailLength', 'nodeSize']);

// Selects whose change adds or removes the plugin's own controls
const PLUGIN_KEYS = new Set(['motionAlgorithm', 'triggerMethod', 'noteMapping']);

/**
 * Renders controls for the active generator's parameters, grouped into
 * Orbit, Motion, Trigger, Notes and Look. Built from the generator's
 * getParams() descriptors.
 */
export class GeneratorPanel {
  constructor(engine, orbitPosition = 0) {
    this.engine = engine;
    this._orbitPosition = orbitPosition;
    this.el = null;
    this.controlsContainer = null;
    this._pending = new Map();
    this._frame = null;
  }

  render() {
    const gen = this.engine.generators[this._orbitPosition];
    const num = gen ? gen.params.orbitIndex + 1 : 1;
    const { el, body } = section(`Orbit ${num} · Generator`, { open: true });
    this.controlsContainer = body;
    this.el = el;
    this._buildControls();
    return el;
  }

  _buildControls() {
    this.controlsContainer.innerHTML = '';
    const gen = this.engine.generators[this._orbitPosition];
    if (!gen) return;

    const params = gen.getParams();
    for (const group of PARAM_GROUPS) {
      const items = params.filter(p => (p.group || 'look') === group.id);
      if (!items.length) continue;
      this.controlsContainer.appendChild(divider(group.label));
      for (const param of items) {
        const row = this._createControl(param, gen);
        if (row) this.controlsContainer.appendChild(row);
      }
    }
  }

  /** Apply a value, coalescing geometry rebuilds to one per animation frame. */
  _set(gen, key, value) {
    if (!REBUILD_KEYS.has(key)) {
      gen.setParam(key, value);
      return;
    }
    this._pending.set(key, value);
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      for (const [k, v] of this._pending) gen.setParam(k, v);
      this._pending.clear();
    });
  }

  _createControl(param, gen) {
    const help = param.help;
    switch (param.type) {
      case 'range':
        return rangeRow({
          label: param.label,
          min: param.min, max: param.max, step: param.step,
          value: param.value,
          unit: param.unit,
          help: param.disabled ? 'Set by the Motion algorithm while one is selected.' : help,
          disabled: param.disabled,
          onInput: (v) => this._set(gen, param.key, v),
        });
      case 'select':
        return selectRow({
          label: param.label,
          options: param.options,
          labels: param.optionLabels || prettyLabels(param.options),
          value: param.value,
          help,
          onChange: (v) => {
            gen.setParam(param.key, v);
            // Show or hide the plugin's own controls (and Node Speed's disabled state)
            if (PLUGIN_KEYS.has(param.key)) requestAnimationFrame(() => this._buildControls());
          },
        });
      case 'toggle':
        return toggleRow({ label: param.label, value: param.value, help, onChange: (v) => gen.setParam(param.key, v) });
      case 'number':
        return numberRow({
          label: param.label, value: param.value,
          min: param.min ?? -Infinity, max: param.max ?? Infinity, step: param.step || 1,
          help, onChange: (v) => gen.setParam(param.key, v),
        });
      default:
        return null;
    }
  }

  refresh() {
    this._buildControls();
  }
}

/** 'euclidean' → 'Euclidean', 'random_walk' → 'Random walk'. */
function prettyLabels(options = []) {
  const labels = {};
  for (const opt of options) {
    if (typeof opt !== 'string') continue;
    const words = opt.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    labels[opt] = words.charAt(0).toUpperCase() + words.slice(1);
  }
  return labels;
}
