/**
 * MIDI and OSC output configuration panel — global, shared across orbits.
 * Each orbit auto-routes to its own MIDI channel and OSC address.
 */
export class MidiOscPanel {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = false;

    const summary = document.createElement('summary');
    summary.textContent = 'MIDI / OSC';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    // ── Spatial Audio ──
    body.appendChild(this._createDivider('Spatial Audio'));
    body.appendChild(this._createToggleRow('Enable Spatial Panning', this.engine.spatialEnabled, (val) => {
      this.engine.setSpatialEnabled(val);
    }));
    const spatialInfo = document.createElement('div');
    spatialInfo.style.cssText = 'font-size: 9px; color: #556; margin-top: 6px;';
    spatialInfo.textContent = 'Each note panned at its collision point. Best on headphones.';
    body.appendChild(spatialInfo);

    // ── MIDI ──
    body.appendChild(this._createDivider('MIDI'));

    const midi = this.engine.midiOutput;

    // Enable toggle
    body.appendChild(this._createToggleRow('MIDI Enabled', midi.enabled, (val) => {
      midi.enabled = val;
    }));

    // Device selector
    const deviceRow = document.createElement('div');
    deviceRow.className = 'control-row';
    const deviceLabel = document.createElement('label');
    deviceLabel.textContent = 'Device';
    deviceRow.appendChild(deviceLabel);

    const deviceSelect = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None';
    deviceSelect.appendChild(noneOpt);

    const devices = midi.getOutputList();
    for (const d of devices) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      if (midi.selectedOutput && midi.selectedOutput.id === d.id) opt.selected = true;
      deviceSelect.appendChild(opt);
    }
    deviceSelect.addEventListener('change', () => {
      midi.selectOutput(deviceSelect.value);
    });
    deviceRow.appendChild(deviceSelect);
    body.appendChild(deviceRow);

    // Base channel
    body.appendChild(this._createRangeRow('Base Channel', 1, 16, 1, midi.config.channel, (val) => {
      midi.setConfig({ channel: val });
    }));

    // Note duration
    body.appendChild(this._createRangeRow('Note Duration (ms)', 10, 2000, 10, midi.config.noteDurationMs, (val) => {
      midi.setConfig({ noteDurationMs: val });
    }));

    // Velocity curve
    body.appendChild(this._createSelectRow('Velocity Curve', ['linear', 'exponential', 'logarithmic'], midi.config.velocityCurve, (val) => {
      midi.setConfig({ velocityCurve: val });
    }));

    // Info
    const midiInfo = document.createElement('div');
    midiInfo.style.cssText = 'font-size: 9px; color: #556; margin-top: 6px;';
    midiInfo.textContent = 'Orbit 1 → Ch 1, Orbit 2 → Ch 2, etc.';
    body.appendChild(midiInfo);

    // ── OSC ──
    body.appendChild(this._createDivider('OSC'));

    const osc = this.engine.oscOutput;

    body.appendChild(this._createToggleRow('OSC Enabled', osc.enabled, (val) => {
      osc.enabled = val;
      if (val && !osc.ws) osc.connect();
    }));

    body.appendChild(this._createTextRow('WS Host', osc.config.wsHost, (val) => {
      osc.setConfig({ wsHost: val });
    }));

    body.appendChild(this._createRangeRow('WS Port', 1024, 65535, 1, osc.config.wsPort, (val) => {
      osc.setConfig({ wsPort: val });
    }));

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn';
    connectBtn.textContent = 'Connect';
    connectBtn.addEventListener('click', () => osc.connect());
    body.appendChild(connectBtn);

    const oscInfo = document.createElement('div');
    oscInfo.style.cssText = 'font-size: 9px; color: #556; margin-top: 6px;';
    oscInfo.textContent = 'Address: /soundspace/orbit{n}/node{n}/note';
    body.appendChild(oscInfo);

    section.appendChild(body);
    this.el = section;
    return section;
  }

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
    display.textContent = value;

    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      display.textContent = Number.isInteger(val) ? val : val.toFixed(1);
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

  _createTextRow(labelText, value, onChange) {
    const row = document.createElement('div');
    row.className = 'control-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.style.cssText = 'flex: 1; padding: 3px 6px; font-family: inherit; font-size: 11px; color: #ccccdd; background: rgba(255,255,255,0.06); border: 1px solid rgba(0,255,255,0.15); border-radius: 3px; outline: none;';
    input.addEventListener('change', () => onChange(input.value));
    row.appendChild(input);
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
