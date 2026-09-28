import { SCALES, NOTE_NAMES, NOTE_NAME_TO_SEMITONE } from '../util/constants.js';
import { section, selectRow, note } from './controls.js';

const MAPPING_LABELS = {
  linear: 'Even spread',
  wrap: 'Two passes',
  nearest: 'Ends inclusive',
  random_in_scale: 'Random',
};

const SCALE_LABELS = {
  minor_natural: 'Natural minor',
  minor_harmonic: 'Harmonic minor',
  minor_melodic: 'Melodic minor',
  pentatonic_major: 'Major pentatonic',
  pentatonic_minor: 'Minor pentatonic',
  whole_tone: 'Whole tone',
  hungarian_minor: 'Hungarian minor',
  bebop_dominant: 'Bebop dominant',
  custom: 'Custom (click notes below)',
};

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function scaleLabel(id) {
  if (SCALE_LABELS[id]) return SCALE_LABELS[id];
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, ' ');
}

/**
 * Scale and key configuration panel.
 * Controls root note, scale type, octave range, and how raw values spread
 * across the notes. The note row shows the scale from its root and can be
 * clicked to build a custom scale.
 */
export class ScalePanel {
  constructor(scaleQuantizer, engine = null) {
    this.quantizer = scaleQuantizer;
    this.engine = engine;
    this.el = null;
  }

  render() {
    const { el, body } = section('Scale', { open: true });
    const config = this.quantizer.getConfig();

    const harmonic = this.engine?.harmonicOrbit;
    if (harmonic?.params.enabled) {
      body.appendChild(note('The Harmonic Orbit is on and sets the key as it plays. Root changes here become this orbit\'s home key.'));
    }

    body.appendChild(selectRow({
      label: 'Root',
      options: NOTE_NAMES,
      value: harmonic?.homeRootFor(this._orbit()) ?? config.root,
      onChange: (val) => {
        if (harmonic && this._orbit()) harmonic.setHomeRoot(this._orbit(), val);
        else this.quantizer.setConfig({ root: val });
        this._renderNotes();
      },
    }));

    this._scaleRow = selectRow({
      label: 'Scale',
      options: [...Object.keys(SCALES), 'custom'].map(id => ({ value: id, label: scaleLabel(id) })),
      value: config.scaleType,
      onChange: (val) => {
        if (val === 'custom' && !this.quantizer.getConfig().customDegrees?.length) {
          // Start from the scale that was selected, so the sound doesn't collapse to one note
          this.quantizer.setConfig({ customDegrees: this._degrees() });
        }
        this.quantizer.setConfig({ scaleType: val });
        this._renderNotes();
      },
    });
    body.appendChild(this._scaleRow);

    body.appendChild(this._octaveRow(config));

    body.appendChild(selectRow({
      label: 'Pitch Layout',
      options: Object.keys(MAPPING_LABELS),
      labels: MAPPING_LABELS,
      value: config.mappingMode,
      help: 'How the pitch value spreads across the notes in range. Two passes climbs the whole range twice around the ring.',
      onChange: (val) => this.quantizer.setConfig({ mappingMode: val }),
    }));

    this._notesContainer = document.createElement('div');
    body.appendChild(this._notesContainer);
    this._renderNotes();

    this.el = el;
    return el;
  }

  /** The orbit this panel edits (the one whose quantizer it holds). */
  _orbit() {
    return this.engine?.generators.find(g => g._scaleQuantizer === this.quantizer) ?? null;
  }

  _octaveRow(config) {
    const row = document.createElement('div');
    row.className = 'control-row';
    const label = document.createElement('label');
    label.textContent = 'Octaves';
    row.appendChild(label);
    const make = (value, name) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'text-input';
      input.min = 0;
      input.max = 8;
      input.step = 1;
      input.value = value;
      input.style.flex = '0 0 52px';
      input.setAttribute('aria-label', name);
      return input;
    };
    const low = make(config.octaveLow, 'Lowest octave');
    const high = make(config.octaveHigh, 'Highest octave');
    label.htmlFor = low.id = `oct-low-${Math.random().toString(36).slice(2, 8)}`;
    const commit = () => {
      let lo = Math.round(Number(low.value));
      let hi = Math.round(Number(high.value));
      if (!Number.isFinite(lo)) lo = this.quantizer.getConfig().octaveLow;
      if (!Number.isFinite(hi)) hi = this.quantizer.getConfig().octaveHigh;
      lo = Math.min(8, Math.max(0, lo));
      hi = Math.min(8, Math.max(0, hi));
      if (lo > hi) [lo, hi] = [hi, lo];
      low.value = lo;
      high.value = hi;
      this.quantizer.setConfig({ octaveLow: lo, octaveHigh: hi });
    };
    low.addEventListener('change', commit);
    high.addEventListener('change', commit);
    const dash = document.createElement('span');
    dash.textContent = 'to';
    dash.className = 'control-value';
    dash.style.minWidth = '0';
    row.appendChild(low);
    row.appendChild(dash);
    row.appendChild(high);
    return row;
  }

  /** Interval set of the scale currently selected (custom or preset). */
  _degrees() {
    const config = this.quantizer.getConfig();
    return config.scaleType === 'custom' && config.customDegrees?.length
      ? [...config.customDegrees]
      : [...(SCALES[config.scaleType] || SCALES.pentatonic_minor)];
  }

  /**
   * The 12 notes starting from the root, lit where the scale has them.
   * Clicking a note adds or removes it (switching to a custom scale); the
   * root always stays.
   */
  _renderNotes() {
    this._notesContainer.innerHTML = '';
    const config = this.quantizer.getConfig();
    const rootSemitone = NOTE_NAME_TO_SEMITONE[config.root] ?? 0;
    const degrees = new Set(this._degrees());

    const row = document.createElement('div');
    row.className = 'scale-editor';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Notes in the scale');
    for (let i = 0; i < 12; i++) {
      const pitchClass = (rootSemitone + i) % 12;
      const btn = document.createElement('button');
      btn.className = 'scale-note-btn';
      if (BLACK_KEYS.has(pitchClass)) btn.classList.add('black-key');
      if (i === 0) btn.classList.add('root');
      const on = degrees.has(i);
      btn.classList.toggle('active', on);
      btn.textContent = NOTE_NAMES[pitchClass];
      btn.setAttribute('aria-pressed', String(on));
      btn.title = i === 0 ? 'Root (always in the scale)' : `${on ? 'Remove' : 'Add'} ${NOTE_NAMES[pitchClass]}`;
      if (i !== 0) {
        btn.addEventListener('click', () => {
          const next = new Set(this._degrees());
          if (next.has(i)) next.delete(i); else next.add(i);
          next.add(0);
          this.quantizer.setConfig({ scaleType: 'custom', customDegrees: [...next].sort((a, b) => a - b) });
          this._scaleRow.input.value = 'custom';
          this._renderNotes();
        });
      }
      row.appendChild(btn);
    }
    this._notesContainer.appendChild(row);
  }
}
