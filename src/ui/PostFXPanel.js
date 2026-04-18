/**
 * Post-processing effects controls — global, not per-orbit.
 * Controls bloom, afterimage, vignette, and chromatic aberration.
 */
export class PostFXPanel {
  constructor(sceneManager, engine) {
    this.sm = sceneManager;
    this.engine = engine;
    this.el = null;
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = false;

    const summary = document.createElement('summary');
    summary.textContent = 'Post FX';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    // Bloom
    body.appendChild(this._createDivider('Bloom'));
    body.appendChild(this._createRangeRow('Strength', 0, 2, 0.05,
      this.sm.bloomPass.strength,
      (val) => { this.sm.bloomPass.strength = val; }
    ));
    body.appendChild(this._createRangeRow('Radius', 0, 1, 0.05,
      this.sm.bloomPass.radius,
      (val) => { this.sm.bloomPass.radius = val; }
    ));
    body.appendChild(this._createRangeRow('Threshold', 0, 1, 0.05,
      this.sm.bloomPass.threshold,
      (val) => { this.sm.bloomPass.threshold = val; }
    ));

    // Afterimage
    if (this.sm.afterimagePass) {
      body.appendChild(this._createDivider('Motion Trails'));
      body.appendChild(this._createRangeRow('Trail Amount', 0, 0.95, 0.01,
        this.sm.afterimagePass.uniforms.damp.value,
        (val) => { this.sm.afterimagePass.uniforms.damp.value = val; }
      ));
    }

    // Vignette
    if (this.sm.vignettePass) {
      body.appendChild(this._createDivider('Vignette'));
      body.appendChild(this._createRangeRow('Darkness', 0, 1, 0.05,
        this.sm.vignettePass.uniforms['darkness'].value,
        (val) => { this.sm.vignettePass.uniforms['darkness'].value = val; }
      ));
      body.appendChild(this._createRangeRow('Offset', 0.5, 2, 0.05,
        this.sm.vignettePass.uniforms['offset'].value,
        (val) => { this.sm.vignettePass.uniforms['offset'].value = val; }
      ));
    }

    // Chromatic Aberration
    if (this.sm.rgbShiftPass) {
      body.appendChild(this._createDivider('Chromatic Aberration'));
      body.appendChild(this._createRangeRow('Trigger Intensity', 0, 1, 0.05,
        this.sm._rgbShiftMaxIntensity || 0.4,
        (val) => { this.sm._rgbShiftMaxIntensity = val; }
      ));
    }

    // Crossing Flash
    if (this.engine) {
      body.appendChild(this._createDivider('Crossing Flash'));
      body.appendChild(this._createToggleRow('Color Mix Flash', true, (val) => {
        for (const gen of this.engine.generators) {
          gen._crossingFlashEnabled = val;
        }
      }));
    }

    section.appendChild(body);
    this.el = section;
    return section;
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
    valueDisplay.textContent = typeof currentValue === 'number' ? currentValue.toFixed(2) : currentValue;

    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      valueDisplay.textContent = val.toFixed(2);
      onChange(val);
    });

    row.appendChild(input);
    row.appendChild(valueDisplay);
    return row;
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
