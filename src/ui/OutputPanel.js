/**
 * Output configuration panel: synth settings, MIDI, OSC.
 */
export class OutputPanel {
  constructor(toneOutput) {
    this.toneOutput = toneOutput;
    this.el = null;
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = false;

    const summary = document.createElement('summary');
    summary.textContent = 'Synth';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    const toneConfig = this.toneOutput.getConfig();

    // Synth type selector
    const synthTypes = ['Synth', 'FMSynth', 'AMSynth', 'MonoSynth', 'MembraneSynth', 'MetalSynth', 'PluckSynth'];
    body.appendChild(this._createSelectRow('Type', synthTypes, toneConfig.synthType, (val) => {
      this.toneOutput.setConfig({ synthType: val });
    }));

    // Note duration
    const durations = ['32n', '16n', '8n', '4n', '2n', '1n'];
    body.appendChild(this._createSelectRow('Duration', durations, toneConfig.noteDuration, (val) => {
      this.toneOutput.setConfig({ noteDuration: val });
    }));

    // Velocity scale
    body.appendChild(this._createRangeRow('Volume', 0.1, 1.5, 0.05, toneConfig.velocityScale, (val) => {
      this.toneOutput.setConfig({ velocityScale: val });
    }));

    // Envelope
    const envelope = toneConfig.synthOptions?.envelope || {};
    body.appendChild(this._createDivider('Envelope'));

    body.appendChild(this._createRangeRow('Attack', 0.001, 1, 0.001, envelope.attack || 0.005, (val) => {
      this._updateEnvelope('attack', val);
    }));
    body.appendChild(this._createRangeRow('Decay', 0.01, 2, 0.01, envelope.decay || 0.3, (val) => {
      this._updateEnvelope('decay', val);
    }));
    body.appendChild(this._createRangeRow('Sustain', 0, 1, 0.01, envelope.sustain || 0.1, (val) => {
      this._updateEnvelope('sustain', val);
    }));
    body.appendChild(this._createRangeRow('Release', 0.01, 4, 0.01, envelope.release || 0.8, (val) => {
      this._updateEnvelope('release', val);
    }));

    // Filter
    const filterFx = toneConfig.effects.find(f => f.type === 'Filter');
    if (filterFx) {
      body.appendChild(this._createDivider('Filter'));

      body.appendChild(this._createRangeRow('Frequency', 20, 20000, 1, filterFx.options.frequency || 2000, (val) => {
        this.toneOutput.setEffectParam('Filter', 'frequency', val);
      }));
      body.appendChild(this._createSelectRow('Type', ['lowpass', 'highpass', 'bandpass', 'notch'], filterFx.options.type || 'lowpass', (val) => {
        this.toneOutput.setEffectParam('Filter', 'type', val);
      }));
      body.appendChild(this._createRangeRow('Resonance (Q)', 0.1, 15, 0.1, filterFx.options.Q || 1, (val) => {
        this.toneOutput.setEffectParam('Filter', 'Q', val);
      }));
      body.appendChild(this._createSelectRow('Rolloff', ['-12', '-24', '-48', '-96'], String(filterFx.options.rolloff || -12), (val) => {
        this.toneOutput.setEffectParam('Filter', 'rolloff', parseInt(val));
      }));
    }

    // Chorus
    const chorusFx = toneConfig.effects.find(f => f.type === 'Chorus');
    if (chorusFx) {
      body.appendChild(this._createDivider('Chorus'));

      body.appendChild(this._createRangeRow('Mix', 0, 1, 0.01, chorusFx.wet, (val) => {
        this.toneOutput.setEffectParam('Chorus', 'wet', val);
      }));
      body.appendChild(this._createRangeRow('Rate', 0.1, 10, 0.1, chorusFx.options.frequency || 1.5, (val) => {
        this.toneOutput.setEffectParam('Chorus', 'frequency', val);
      }));
      body.appendChild(this._createRangeRow('Delay', 0.5, 20, 0.5, chorusFx.options.delayTime || 3.5, (val) => {
        this.toneOutput.setEffectParam('Chorus', 'delayTime', val);
      }));
      body.appendChild(this._createRangeRow('Depth', 0, 1, 0.05, chorusFx.options.depth || 0.7, (val) => {
        this.toneOutput.setEffectParam('Chorus', 'depth', val);
      }));
    }

    // Reverb
    const reverbFx = toneConfig.effects.find(f => f.type === 'Reverb');
    if (reverbFx) {
      body.appendChild(this._createDivider('Reverb'));

      body.appendChild(this._createRangeRow('Rev Mix', 0, 1, 0.01, reverbFx.wet, (val) => {
        this.toneOutput.setEffectParam('Reverb', 'wet', val);
      }));
      body.appendChild(this._createRangeRow('Rev Decay', 0.1, 10, 0.1, reverbFx.options.decay || 2.5, (val) => {
        this.toneOutput.setEffectParam('Reverb', 'decay', val);
      }));
      body.appendChild(this._createRangeRow('Rev Pre-Delay', 0, 0.1, 0.001, reverbFx.options.preDelay || 0.01, (val) => {
        this.toneOutput.setEffectParam('Reverb', 'preDelay', val);
      }));
    }

    // Delay
    const delayFx = toneConfig.effects.find(f => f.type === 'FeedbackDelay' || f.type === 'PingPongDelay');
    if (delayFx) {
      body.appendChild(this._createDivider('Delay'));

      body.appendChild(this._createSelectRow('Dly Type', ['FeedbackDelay', 'PingPongDelay'], delayFx.type, (val) => {
        this.toneOutput.swapDelayType(val);
      }));

      // Use generic type for param calls — works for both FeedbackDelay and PingPongDelay
      const dlyType = delayFx.type;

      body.appendChild(this._createRangeRow('Dly Mix', 0, 1, 0.01, delayFx.wet, (val) => {
        this.toneOutput.setEffectParam(dlyType, 'wet', val);
      }));
      body.appendChild(this._createRangeRow('Dly Feedback', 0, 0.9, 0.01, delayFx.options.feedback || 0.3, (val) => {
        this.toneOutput.setEffectParam(dlyType, 'feedback', val);
      }));

      // Delay time — note division select + free time slider
      const noteValues = ['32n', '16n', '8n', '4n', '2n', '1n'];
      const currentTime = delayFx.options.delayTime || '8n';
      const isNoteValue = noteValues.includes(currentTime);

      body.appendChild(this._createSelectRow('Dly Sync', ['free', ...noteValues], isNoteValue ? currentTime : 'free', (val) => {
        if (val === 'free') {
          this.toneOutput.setEffectParam(dlyType, 'delayTime', parseFloat(freeTimeSlider.value));
          freeTimeRow.style.display = 'flex';
        } else {
          this.toneOutput.setEffectParam(dlyType, 'delayTime', val);
          freeTimeRow.style.display = 'none';
        }
      }));

      // Free time slider (visible when sync = 'free')
      const freeTimeRow = this._createRangeRow('Dly Time (s)', 0.01, 2.0, 0.01,
        typeof currentTime === 'number' ? currentTime : 0.25,
        (val) => {
          this.toneOutput.setEffectParam(dlyType, 'delayTime', val);
        }
      );
      const freeTimeSlider = freeTimeRow.querySelector('input[type="range"]');
      freeTimeRow.style.display = isNoteValue ? 'none' : 'flex';
      body.appendChild(freeTimeRow);
    }

    // EQ3
    const eq3Fx = toneConfig.effects.find(f => f.type === 'EQ3');
    if (eq3Fx) {
      body.appendChild(this._createDivider('EQ'));

      body.appendChild(this._createRangeRow('Low', -12, 12, 0.5, eq3Fx.options.low || 0, (val) => {
        this.toneOutput.setEffectParam('EQ3', 'low', val);
      }));
      body.appendChild(this._createRangeRow('Mid', -12, 12, 0.5, eq3Fx.options.mid || 0, (val) => {
        this.toneOutput.setEffectParam('EQ3', 'mid', val);
      }));
      body.appendChild(this._createRangeRow('High', -12, 12, 0.5, eq3Fx.options.high || 0, (val) => {
        this.toneOutput.setEffectParam('EQ3', 'high', val);
      }));
      body.appendChild(this._createRangeRow('Low Freq', 100, 1000, 10, eq3Fx.options.lowFrequency || 400, (val) => {
        this.toneOutput.setEffectParam('EQ3', 'lowFrequency', val);
      }));
      body.appendChild(this._createRangeRow('High Freq', 1000, 8000, 50, eq3Fx.options.highFrequency || 2500, (val) => {
        this.toneOutput.setEffectParam('EQ3', 'highFrequency', val);
      }));
    }

    section.appendChild(body);
    this.el = section;
    return section;
  }

  _updateEnvelope(key, value) {
    const config = this.toneOutput.getConfig();
    const synthOptions = { ...config.synthOptions };
    synthOptions.envelope = { ...synthOptions.envelope, [key]: value };
    this.toneOutput.setConfig({ synthOptions });
  }

  _createSelectRow(labelText, options, currentValue, onChange) {
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
      if (opt === currentValue) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', () => onChange(select.value));
    row.appendChild(select);
    return row;
  }

  _createRangeRow(labelText, min, max, step, currentValue, onChange) {
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
    input.value = currentValue;

    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'control-value';
    valueDisplay.textContent = Number.isInteger(currentValue) ? currentValue : currentValue.toFixed(3);

    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      valueDisplay.textContent = val.toFixed(3);
      onChange(val);
    });

    row.appendChild(input);
    row.appendChild(valueDisplay);
    return row;
  }

  _createDivider(text) {
    const div = document.createElement('div');
    div.className = 'divider';
    if (text) {
      div.style.marginTop = '12px';
      const label = document.createElement('div');
      label.style.cssText = 'font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #666688; margin-bottom: 6px;';
      label.textContent = text;
      const wrapper = document.createElement('div');
      wrapper.appendChild(label);
      wrapper.appendChild(div);
      return wrapper;
    }
    return div;
  }
}
