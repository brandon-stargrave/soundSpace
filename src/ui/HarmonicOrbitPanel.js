import { PROGRESSION_IDS } from '../core/ProgressionWalker.js';
import { CHORD_VOICINGS, SYNTH_TYPES } from '../util/constants.js';
import { section, divider, rangeRow, selectRow, toggleRow, note } from './controls.js';

const PROGRESSION_LABELS = {
  pedal: 'Pedal (home key, brief IV/V/♭VII)',
  romanPopAxis: 'I–V–vi–IV (pop)',
  romanCanonical: 'I–IV–V–I',
  romanJazzii_v_I: 'ii–V–I (jazz)',
  randomWalk: 'Random walk',
  fifthsUp: 'Circle of fifths (changes key)',
  fifthsRandom: 'Fifths up or down (changes key)',
};

const VOICING_LABELS = {
  triad: 'Triad',
  sus2: 'Sus2',
  sus4: 'Sus4',
  seventh: 'Seventh',
  octaveDoubled: 'Open (octave doubled)',
};

const pct = (v) => `${Math.round(v * 100)}%`;
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const sec = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);

/**
 * Global UI panel for the Harmonic Orbit — polygon traveler, chord
 * progression, pad/bass drones with their own synth settings, and MIDI/OSC
 * routing for the drones.
 */
export class HarmonicOrbitPanel {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
  }

  render() {
    const { el, body } = section('Harmonic Orbit');
    const h = this.engine.harmonicOrbit;
    const p = h.params;
    const set = (key) => (val) => h.setParam(key, val);

    body.appendChild(note('A traveler circles a polygon and, at each corner, moves the harmony to the next chord. Pad and bass drones follow it.'));
    body.appendChild(toggleRow({ label: 'Enabled', value: p.enabled, onChange: (val) => { h.setParam('enabled', val); this._showNow(); } }));

    this._now = note('', { live: true });
    this._now.classList.add('harmonic-now');
    body.appendChild(this._now);
    h.onHarmonyChange = () => this._showNow();
    this._showNow();

    // Shape
    body.appendChild(divider('Shape'));
    body.appendChild(rangeRow({ label: 'Sides', min: 3, max: 12, step: 1, value: p.sides, onInput: set('sides'), help: 'Corners per cycle: how many chord changes the traveler makes each lap.' }));
    const radiusRow = rangeRow({ label: 'Radius', min: 0.3, max: 6, step: 0.05, value: p.radius ?? 3, onInput: set('radius') });
    radiusRow.hidden = p.radius === null || p.radius === undefined;
    body.appendChild(toggleRow({
      label: 'Match Orbit 1 Radius',
      value: radiusRow.hidden,
      onChange: (val) => {
        if (val) {
          h.setParam('radius', null);
        } else {
          const current = this.engine.generators[0]?.params?.radius ?? 3;
          h.setParam('radius', current);
          radiusRow.setValue(current);
        }
        radiusRow.hidden = val;
      },
    }));
    body.appendChild(radiusRow);
    body.appendChild(rangeRow({ label: 'Traveler Size', min: 0.04, max: 0.4, step: 0.01, value: p.travelerSize, onInput: set('travelerSize') }));

    // Motion
    body.appendChild(divider('Motion'));
    this._bpmRow = rangeRow({
      label: 'Speed', min: 2, max: 240, step: 1, value: p.speedBpm, unit: 'corners/min', onInput: set('speedBpm'),
      help: 'How many corners the traveler reaches per minute.',
    });
    this._syncSourceRow = selectRow({
      label: 'Follow Orbit', options: [], value: '',
      help: 'The traveler completes a lap each time this orbit\'s first node does (times the ratio below).',
      onChange: (val) => h.setParam('syncSourceIndex', parseInt(val, 10)),
    });
    this._syncRatioRow = rangeRow({ label: 'Laps per Cycle', min: 0.125, max: 32, step: 0.125, value: p.syncRatio, onInput: set('syncRatio') });
    body.appendChild(selectRow({
      label: 'Timing', options: ['free', 'periodSync'],
      labels: { free: 'Own speed', periodSync: 'Follow an orbit' },
      value: p.speedMode,
      onChange: (val) => { h.setParam('speedMode', val); this._refreshMotionVisibility(val); },
    }));
    body.appendChild(this._bpmRow);
    body.appendChild(this._syncSourceRow);
    body.appendChild(this._syncRatioRow);
    this.refreshSyncSources();
    this._refreshMotionVisibility(p.speedMode);

    // Progression
    body.appendChild(divider('Progression'));
    body.appendChild(selectRow({
      label: 'Chords', options: PROGRESSION_IDS, labels: PROGRESSION_LABELS, value: p.progressionId,
      onChange: set('progressionId'),
    }));
    body.appendChild(rangeRow({
      label: 'Change Chance', min: 0.05, max: 1, step: 0.05, format: pct, value: p.transposeChance,
      onInput: set('transposeChance'), help: 'Chance that each corner moves to the next chord.',
    }));

    // Pad voice
    body.appendChild(divider('Pad'));
    body.appendChild(toggleRow({ label: 'Pad', value: p.padEnabled, onChange: set('padEnabled') }));
    body.appendChild(rangeRow({ label: 'Pad Level', min: 0, max: 1, step: 0.01, format: pct, value: p.padVolume, onInput: set('padVolume') }));
    body.appendChild(selectRow({ label: 'Voicing', options: CHORD_VOICINGS, labels: VOICING_LABELS, value: p.chordVoicing, onChange: set('chordVoicing') }));
    body.appendChild(rangeRow({ label: 'Pad Octave', min: 1, max: 6, step: 1, value: p.padOctave, onInput: set('padOctave') }));
    body.appendChild(this._buildVoiceSynthSection('Pad Synth', 'pad'));

    // Bass voice
    body.appendChild(divider('Bass'));
    body.appendChild(toggleRow({ label: 'Bass', value: p.bassEnabled, onChange: set('bassEnabled') }));
    body.appendChild(rangeRow({ label: 'Bass Level', min: 0, max: 1, step: 0.01, format: pct, value: p.bassVolume, onInput: set('bassVolume') }));
    body.appendChild(rangeRow({ label: 'Bass Octave', min: 1, max: 4, step: 1, value: Math.max(1, p.bassOctave), onInput: set('bassOctave') }));
    body.appendChild(this._buildVoiceSynthSection('Bass Synth', 'bass'));

    // External output
    body.appendChild(divider('MIDI / OSC'));
    body.appendChild(toggleRow({ label: 'Send MIDI', value: p.midiEnabled, onChange: set('midiEnabled'), help: 'Also needs MIDI turned on in the MIDI / OSC section.' }));
    body.appendChild(rangeRow({ label: 'Pad Channel', min: 1, max: 16, step: 1, value: p.midiPadChannel, onInput: set('midiPadChannel') }));
    body.appendChild(rangeRow({ label: 'Bass Channel', min: 1, max: 16, step: 1, value: p.midiBassChannel, onInput: set('midiBassChannel') }));
    body.appendChild(toggleRow({ label: 'Send OSC', value: p.oscEnabled, onChange: set('oscEnabled') }));

    this.el = el;
    return el;
  }

  /** Show the current key and pad chord. */
  _showNow() {
    if (!this._now) return;
    const h = this.engine.harmonicOrbit;
    if (!h.params.enabled) {
      this._now.textContent = 'Off.';
      return;
    }
    const chord = h.currentChordNames();
    this._now.textContent = chord.length ? `Now: ${chord.join(' ')} (key of ${h.homeKeyName()})` : 'Starting…';
  }

  /** Pad or bass collapsible synth config panel. */
  _buildVoiceSynthSection(titleText, voiceKey) {
    const wrapper = document.createElement('details');
    wrapper.className = 'config-subsection';
    const sum = document.createElement('summary');
    sum.textContent = titleText;
    wrapper.appendChild(sum);

    const h = this.engine.harmonicOrbit;
    const cfg = voiceKey === 'pad' ? h.getPadConfig() : h.getBassConfig();
    if (!cfg) {
      wrapper.appendChild(note('Starts with the audio. Click anywhere if the sound hasn\'t started.'));
      return wrapper;
    }
    const voice = () => (voiceKey === 'pad' ? h._pad : h._bass);

    wrapper.appendChild(selectRow({
      label: 'Voice', options: SYNTH_TYPES.filter(t => ['Synth', 'FMSynth', 'AMSynth', 'MonoSynth'].includes(t)),
      labels: { Synth: 'Basic', FMSynth: 'FM', AMSynth: 'AM', MonoSynth: 'Mono (filtered)' },
      value: cfg.synthType,
      onChange: (val) => (voiceKey === 'pad' ? h.setPadConfig({ synthType: val }) : h.setBassConfig({ synthType: val })),
    }));

    const osc = cfg.synthOptions?.oscillator;
    if (osc) {
      wrapper.appendChild(selectRow({
        label: 'Wave', options: ['sine', 'triangle', 'sawtooth', 'square'],
        labels: { sine: 'Sine', triangle: 'Triangle', sawtooth: 'Saw', square: 'Square' },
        value: osc.type || 'sine',
        onChange: (val) => voice()?.setSynthParam('oscillator.type', val),
      }));
    }

    const env = cfg.synthOptions?.envelope;
    if (env) {
      wrapper.appendChild(divider('Envelope'));
      const envRow = (label, key, min, max, fallback, format = sec) => rangeRow({
        label, min, max, step: 0.01, value: env[key] ?? fallback, format,
        onInput: (v) => voice()?.setSynthParam(`envelope.${key}`, v),
      });
      wrapper.appendChild(envRow('Attack', 'attack', 0.01, 5, 0.1));
      wrapper.appendChild(envRow('Decay', 'decay', 0.01, 5, 0.3));
      wrapper.appendChild(envRow('Sustain', 'sustain', 0, 1, 0.5, pct));
      wrapper.appendChild(envRow('Release', 'release', 0.01, 10, 1.0));
    }

    for (const fx of cfg.effects || []) {
      wrapper.appendChild(this._buildEffectSection(voiceKey, fx));
    }
    return wrapper;
  }

  _buildEffectSection(voiceKey, fx) {
    const h = this.engine.harmonicOrbit;
    const setter = (name) => (value) => (voiceKey === 'pad'
      ? h.setPadEffectParam(fx.type, name, value)
      : h.setBassEffectParam(fx.type, name, value));
    const opts = fx.options || {};

    const titles = { Filter: 'Filter', Chorus: 'Chorus', Reverb: 'Reverb', EQ3: 'EQ', FeedbackDelay: 'Delay', PingPongDelay: 'Delay' };
    const wrap = document.createElement('div');
    wrap.appendChild(divider(titles[fx.type] || fx.type));

    // Filter and EQ have no wet/dry mix, so a Mix slider would do nothing
    if (fx.wet !== undefined && fx.type !== 'Filter' && fx.type !== 'EQ3') {
      wrap.appendChild(rangeRow({ label: 'Mix', min: 0, max: 1, step: 0.01, format: pct, value: fx.wet, onInput: setter('wet') }));
    }

    switch (fx.type) {
      case 'Filter':
        wrap.appendChild(rangeRow({ label: 'Cutoff', min: 40, max: 8000, step: 1, scale: 'log', format: hz, value: opts.frequency ?? 1000, onInput: setter('frequency') }));
        wrap.appendChild(rangeRow({ label: 'Resonance', min: 0.1, max: 12, step: 0.1, format: (v) => `${v.toFixed(1)} dB`, value: Math.min(opts.Q ?? 1, 12), onInput: setter('Q') }));
        wrap.appendChild(selectRow({
          label: 'Type', options: ['lowpass', 'highpass', 'bandpass', 'notch'],
          labels: { lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', notch: 'Notch' },
          value: opts.type ?? 'lowpass', onChange: setter('type'),
        }));
        break;
      case 'Chorus':
        wrap.appendChild(rangeRow({ label: 'Rate', min: 0.05, max: 10, step: 0.05, unit: 'Hz', value: opts.frequency ?? 1, onInput: setter('frequency') }));
        wrap.appendChild(rangeRow({ label: 'Depth', min: 0, max: 1, step: 0.01, format: pct, value: opts.depth ?? 0.5, onInput: setter('depth') }));
        break;
      case 'Reverb':
        wrap.appendChild(rangeRow({ label: 'Decay', min: 0.1, max: 10, step: 0.1, format: sec, value: opts.decay ?? 2, onInput: setter('decay') }));
        wrap.appendChild(rangeRow({ label: 'Pre-Delay', min: 0, max: 0.2, step: 0.001, format: sec, value: opts.preDelay ?? 0.01, onInput: setter('preDelay') }));
        break;
      case 'FeedbackDelay':
      case 'PingPongDelay':
        wrap.appendChild(rangeRow({ label: 'Feedback', min: 0, max: 0.95, step: 0.01, format: pct, value: opts.feedback ?? 0.3, onInput: setter('feedback') }));
        break;
      case 'EQ3': {
        const db = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
        wrap.appendChild(rangeRow({ label: 'Low', min: -24, max: 12, step: 0.5, format: db, value: opts.low ?? 0, onInput: setter('low') }));
        wrap.appendChild(rangeRow({ label: 'Mid', min: -24, max: 12, step: 0.5, format: db, value: opts.mid ?? 0, onInput: setter('mid') }));
        wrap.appendChild(rangeRow({ label: 'High', min: -24, max: 12, step: 0.5, format: db, value: opts.high ?? 0, onInput: setter('high') }));
        break;
      }
    }
    return wrap;
  }

  _refreshMotionVisibility(mode) {
    this._bpmRow.hidden = mode !== 'free';
    this._syncSourceRow.hidden = mode !== 'periodSync';
    this._syncRatioRow.hidden = mode !== 'periodSync';
  }

  /**
   * List the orbits in the Follow Orbit dropdown, by orbit number. Call after
   * orbits are added or removed; if the followed orbit is gone, follow the first.
   */
  refreshSyncSources() {
    const select = this._syncSourceRow?.input;
    if (!select) return;
    const h = this.engine.harmonicOrbit;
    const numbers = this.engine.generators.map(g => g.params.orbitIndex);
    if (!numbers.length) return;
    if (!numbers.includes(h.params.syncSourceIndex)) h.setParam('syncSourceIndex', numbers[0]);

    select.innerHTML = '';
    for (const n of numbers) {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = `Orbit ${n + 1}`;
      select.appendChild(option);
    }
    select.value = String(h.params.syncSourceIndex);
  }
}
