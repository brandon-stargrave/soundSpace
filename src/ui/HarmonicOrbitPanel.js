import { PROGRESSION_IDS } from '../core/ProgressionWalker.js';
import { CHORD_VOICINGS } from '../core/HarmonicOrbit.js';

/**
 * Global UI panel for the Harmonic Orbit — polygon + root progression +
 * pad/bass drones with their own synth config + external output routing.
 */
export class HarmonicOrbitPanel {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = false;

    const summary = document.createElement('summary');
    summary.textContent = 'Harmonic Orbit';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    const h = this.engine.harmonicOrbit;
    const p = h.params;

    // Enabled
    body.appendChild(this._createToggleRow('Enabled', p.enabled, (val) => {
      h.setParam('enabled', val);
    }));

    // Shape
    body.appendChild(this._createRangeRow('Sides', 3, 12, 1, p.sides, (val) => {
      h.setParam('sides', val);
    }));

    // Radius — with "match orbit 1" toggle
    const radiusIsAuto = p.radius === null || p.radius === undefined;
    const autoRadiusRow = this._createToggleRow('Match Orbit 1 Radius', radiusIsAuto, (val) => {
      if (val) {
        h.setParam('radius', null);
        this._syncRadiusRowVisibility(true);
      } else {
        const current = (this.engine.generators[0]?.params?.radius) ?? 3.0;
        h.setParam('radius', current);
        this._radiusRow.querySelector('input[type=range]').value = current;
        this._radiusRow.querySelector('.control-value').textContent = current.toFixed(2);
        this._syncRadiusRowVisibility(false);
      }
    });
    body.appendChild(autoRadiusRow);
    this._radiusRow = this._createRangeRow('Radius', 0.3, 6.0, 0.05, p.radius ?? 3.0, (val) => {
      h.setParam('radius', val);
    });
    body.appendChild(this._radiusRow);
    this._syncRadiusRowVisibility(radiusIsAuto);

    body.appendChild(this._createRangeRow('Traveler Size', 0.04, 0.4, 0.01, p.travelerSize, (val) => {
      h.setParam('travelerSize', val);
    }));

    // Motion
    body.appendChild(this._createDivider('Motion'));
    body.appendChild(this._createSelectRow('Speed Mode', ['free', 'periodSync'], p.speedMode, (val) => {
      h.setParam('speedMode', val);
      this._refreshMotionVisibility(val);
    }));
    // BPM — min 2 for ambient, max 240. Step 1.
    this._bpmRow = this._createRangeRow('Speed (BPM)', 2, 240, 1, p.speedBpm, (val) => {
      h.setParam('speedBpm', val);
    });
    body.appendChild(this._bpmRow);

    const orbitOptions = Array.from(
      { length: Math.max(this.engine.generators.length, 1) },
      (_, i) => String(i)
    );
    this._syncSourceRow = this._createSelectRow(
      'Sync Source Orbit',
      orbitOptions,
      String(p.syncSourceIndex),
      (val) => h.setParam('syncSourceIndex', parseInt(val, 10))
    );
    body.appendChild(this._syncSourceRow);
    // Sync ratio — extended range 0.125 .. 32 (5 octaves of slowing factor)
    this._syncRatioRow = this._createRangeRow('Sync Ratio', 0.125, 32, 0.125, p.syncRatio, (val) => {
      h.setParam('syncRatio', val);
    });
    body.appendChild(this._syncRatioRow);
    this._refreshMotionVisibility(p.speedMode);

    // Progression
    body.appendChild(this._createDivider('Progression'));
    body.appendChild(this._createSelectRow('Algorithm', PROGRESSION_IDS, p.progressionId, (val) => {
      h.setParam('progressionId', val);
    }));
    body.appendChild(this._createRangeRow('Transpose Chance', 0.05, 1.0, 0.05, p.transposeChance, (val) => {
      h.setParam('transposeChance', val);
    }));

    // Pad voice
    body.appendChild(this._createDivider('Pad Voice'));
    body.appendChild(this._createToggleRow('Pad Enabled', p.padEnabled, (val) => {
      h.setParam('padEnabled', val);
    }));
    body.appendChild(this._createRangeRow('Pad Volume', 0, 1, 0.01, p.padVolume, (val) => {
      h.setParam('padVolume', val);
    }));
    body.appendChild(this._createSelectRow('Chord Voicing', CHORD_VOICINGS, p.chordVoicing, (val) => {
      h.setParam('chordVoicing', val);
    }));
    body.appendChild(this._createRangeRow('Pad Octave', 1, 6, 1, p.padOctave, (val) => {
      h.setParam('padOctave', val);
    }));

    // Pad synth details (collapsible)
    body.appendChild(this._buildVoiceSynthSection('Pad Synth', 'pad'));

    // Bass voice
    body.appendChild(this._createDivider('Bass Voice'));
    body.appendChild(this._createToggleRow('Bass Enabled', p.bassEnabled, (val) => {
      h.setParam('bassEnabled', val);
    }));
    body.appendChild(this._createRangeRow('Bass Volume', 0, 1, 0.01, p.bassVolume, (val) => {
      h.setParam('bassVolume', val);
    }));
    body.appendChild(this._createRangeRow('Bass Octave', 0, 4, 1, p.bassOctave, (val) => {
      h.setParam('bassOctave', val);
    }));
    body.appendChild(this._buildVoiceSynthSection('Bass Synth', 'bass'));

    // External output
    body.appendChild(this._createDivider('External Output'));
    body.appendChild(this._createToggleRow('Send MIDI', p.midiEnabled, (val) => {
      h.setParam('midiEnabled', val);
    }));
    body.appendChild(this._createRangeRow('MIDI Pad Channel', 1, 16, 1, p.midiPadChannel, (val) => {
      h.setParam('midiPadChannel', val);
    }));
    body.appendChild(this._createRangeRow('MIDI Bass Channel', 1, 16, 1, p.midiBassChannel, (val) => {
      h.setParam('midiBassChannel', val);
    }));
    body.appendChild(this._createToggleRow('Send OSC', p.oscEnabled, (val) => {
      h.setParam('oscEnabled', val);
    }));
    const oscInfo = document.createElement('div');
    oscInfo.style.cssText = 'font-size: 9px; color: #556; margin-top: 4px;';
    oscInfo.textContent = 'OSC: /soundspace/harmonic/{pad|bass|transpose}';
    body.appendChild(oscInfo);

    section.appendChild(body);
    this.el = section;
    return section;
  }

  /** Pad or bass collapsible synth config panel. */
  _buildVoiceSynthSection(titleText, voiceKey) {
    const wrapper = document.createElement('details');
    wrapper.className = 'config-subsection';
    wrapper.style.cssText = 'margin-top: 6px; border-left: 2px solid rgba(0,255,255,0.15); padding-left: 8px;';

    const sum = document.createElement('summary');
    sum.textContent = titleText;
    sum.style.cssText = 'cursor: pointer; font-size: 11px; color: #aacce0; padding: 4px 0;';
    wrapper.appendChild(sum);

    const h = this.engine.harmonicOrbit;
    const cfg = voiceKey === 'pad' ? h.getPadConfig() : h.getBassConfig();
    if (!cfg) {
      const msg = document.createElement('div');
      msg.style.cssText = 'font-size: 10px; color: #668; padding: 6px 0;';
      msg.textContent = '(voice not initialized — start audio first)';
      wrapper.appendChild(msg);
      return wrapper;
    }

    // Synth type
    wrapper.appendChild(this._createSelectRow(
      'Synth Type',
      ['Synth', 'FMSynth', 'AMSynth', 'MonoSynth'],
      cfg.synthType,
      (val) => {
        if (voiceKey === 'pad') h.setPadConfig({ synthType: val });
        else h.setBassConfig({ synthType: val });
      }
    ));

    // Oscillator type
    const osc = cfg.synthOptions?.oscillator;
    if (osc) {
      wrapper.appendChild(this._createSelectRow(
        'Oscillator',
        ['sine', 'triangle', 'sawtooth', 'square'],
        osc.type || 'sine',
        (val) => {
          if (voiceKey === 'pad') h._pad?.setSynthParam('oscillator.type', val);
          else h._bass?.setSynthParam('oscillator.type', val);
        }
      ));
    }

    // Envelope ADSR
    const env = cfg.synthOptions?.envelope;
    if (env) {
      const envDiv = document.createElement('div');
      envDiv.style.marginTop = '4px';
      const envLabel = document.createElement('div');
      envLabel.style.cssText = 'font-size: 9px; color: #667; letter-spacing: 0.5px; margin-bottom: 3px;';
      envLabel.textContent = 'ENVELOPE (ADSR)';
      envDiv.appendChild(envLabel);
      const voiceRef = voiceKey === 'pad' ? h._pad : h._bass;
      envDiv.appendChild(this._createRangeRow('Attack', 0.001, 5, 0.01, env.attack ?? 0.1, (v) => voiceRef?.setSynthParam('envelope.attack', v)));
      envDiv.appendChild(this._createRangeRow('Decay', 0.001, 5, 0.01, env.decay ?? 0.3, (v) => voiceRef?.setSynthParam('envelope.decay', v)));
      envDiv.appendChild(this._createRangeRow('Sustain', 0, 1, 0.01, env.sustain ?? 0.5, (v) => voiceRef?.setSynthParam('envelope.sustain', v)));
      envDiv.appendChild(this._createRangeRow('Release', 0.01, 10, 0.01, env.release ?? 1.0, (v) => voiceRef?.setSynthParam('envelope.release', v)));
      wrapper.appendChild(envDiv);
    }

    // Effects — Filter + Chorus + Reverb + EQ3
    for (const fx of cfg.effects || []) {
      wrapper.appendChild(this._buildEffectSection(voiceKey, fx));
    }

    return wrapper;
  }

  _buildEffectSection(voiceKey, fx) {
    const h = this.engine.harmonicOrbit;
    const setter = voiceKey === 'pad'
      ? (name, value) => h.setPadEffectParam(fx.type, name, value)
      : (name, value) => h.setBassEffectParam(fx.type, name, value);

    const wrap = document.createElement('details');
    wrap.style.cssText = 'margin-top: 4px;';
    const sum = document.createElement('summary');
    sum.textContent = fx.type;
    sum.style.cssText = 'font-size: 10px; color: #99aadd; cursor: pointer;';
    wrap.appendChild(sum);

    // Wet always available
    if (fx.wet !== undefined) {
      wrap.appendChild(this._createRangeRow('Wet', 0, 1, 0.01, fx.wet, (v) => setter('wet', v)));
    }

    const opts = fx.options || {};
    switch (fx.type) {
      case 'Filter':
        wrap.appendChild(this._createRangeRow('Frequency', 40, 8000, 10, opts.frequency ?? 1000, (v) => setter('frequency', v)));
        wrap.appendChild(this._createRangeRow('Q', 0.1, 20, 0.1, opts.Q ?? 1, (v) => setter('Q', v)));
        wrap.appendChild(this._createSelectRow('Type', ['lowpass', 'highpass', 'bandpass', 'notch'], opts.type ?? 'lowpass', (v) => setter('type', v)));
        break;
      case 'Chorus':
        wrap.appendChild(this._createRangeRow('Rate', 0.05, 10, 0.05, opts.frequency ?? 1, (v) => setter('frequency', v)));
        wrap.appendChild(this._createRangeRow('Depth', 0, 1, 0.01, opts.depth ?? 0.5, (v) => setter('depth', v)));
        break;
      case 'Reverb':
        wrap.appendChild(this._createRangeRow('Decay', 0.1, 10, 0.1, opts.decay ?? 2, (v) => setter('decay', v)));
        wrap.appendChild(this._createRangeRow('PreDelay', 0, 0.2, 0.001, opts.preDelay ?? 0.01, (v) => setter('preDelay', v)));
        break;
      case 'FeedbackDelay':
      case 'PingPongDelay':
        wrap.appendChild(this._createRangeRow('Feedback', 0, 0.95, 0.01, opts.feedback ?? 0.3, (v) => setter('feedback', v)));
        break;
      case 'EQ3':
        wrap.appendChild(this._createRangeRow('Low', -24, 12, 0.5, opts.low ?? 0, (v) => setter('low', v)));
        wrap.appendChild(this._createRangeRow('Mid', -24, 12, 0.5, opts.mid ?? 0, (v) => setter('mid', v)));
        wrap.appendChild(this._createRangeRow('High', -24, 12, 0.5, opts.high ?? 0, (v) => setter('high', v)));
        break;
    }

    return wrap;
  }

  _syncRadiusRowVisibility(hidden) {
    if (this._radiusRow) this._radiusRow.style.display = hidden ? 'none' : '';
  }

  _refreshMotionVisibility(mode) {
    const show = (row, visible) => {
      if (row) row.style.display = visible ? '' : 'none';
    };
    show(this._bpmRow, mode === 'free');
    show(this._syncSourceRow, mode === 'periodSync');
    show(this._syncRatioRow, mode === 'periodSync');
  }

  // ── Helpers ──

  _createToggleRow(labelText, value, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    input.addEventListener('change', () => onChange(input.checked));
    toggle.appendChild(input);
    toggle.appendChild(slider);
    row.appendChild(toggle);
    return row;
  }

  _createRangeRow(labelText, min, max, step, value, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    const display = document.createElement('span');
    display.className = 'control-value';
    display.textContent = Number.isInteger(value) ? value : Number(value).toFixed(2);
    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      display.textContent = Number.isInteger(val) ? val : val.toFixed(2);
      onChange(val);
    });
    row.appendChild(input);
    row.appendChild(display);
    return row;
  }

  _createSelectRow(labelText, options, value, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    const select = document.createElement('select');
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === value) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    row.appendChild(select);
    return row;
  }

  _createDivider(text) {
    const wrapper = document.createElement('div');
    wrapper.style.marginTop = '10px';
    const label = document.createElement('div');
    label.style.cssText = 'font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #666688; margin-bottom: 6px;';
    label.textContent = text;
    const div = document.createElement('div');
    div.className = 'divider';
    wrapper.appendChild(label);
    wrapper.appendChild(div);
    return wrapper;
  }
}
