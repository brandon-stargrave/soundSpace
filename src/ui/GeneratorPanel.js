/**
 * Renders controls for the active generator's parameters.
 * Auto-generates UI from the generator's getParams() descriptors.
 */
export class GeneratorPanel {
  constructor(engine, orbitIndex = 0) {
    this.engine = engine;
    this._orbitIndex = orbitIndex;
    this.el = null;
    this.controlsContainer = null;
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = true;

    const summary = document.createElement('summary');
    summary.textContent = 'Generator';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    this.controlsContainer = document.createElement('div');
    body.appendChild(this.controlsContainer);

    section.appendChild(body);
    this.el = section;

    this._buildControls();
    return section;
  }

  _buildControls() {
    this.controlsContainer.innerHTML = '';
    const gen = this.engine.generators[this._orbitIndex];
    if (!gen) return;

    const params = gen.getParams();
    for (const param of params) {
      const row = this._createControl(param, gen);
      if (row) this.controlsContainer.appendChild(row);
    }
  }

  _createControl(param, generator) {
    const row = document.createElement('div');
    row.className = 'control-row';

    const label = document.createElement('label');
    label.textContent = param.label;
    row.appendChild(label);

    switch (param.type) {
      case 'range':
        return this._createRange(row, param, generator);
      case 'select':
        return this._createSelect(row, param, generator);
      case 'toggle':
        return this._createToggle(row, param, generator);
      case 'number':
        return this._createNumber(row, param, generator);
      default:
        return null;
    }
  }

  _createRange(row, param, generator) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = param.min;
    input.max = param.max;
    input.step = param.step;
    input.value = param.value;

    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'control-value';
    valueDisplay.textContent = param.value;

    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      valueDisplay.textContent = Number.isInteger(val) ? val : val.toFixed(2);
      generator.setParam(param.key, val);
    });

    row.appendChild(input);
    row.appendChild(valueDisplay);
    return row;
  }

  _createSelect(row, param, generator) {
    const select = document.createElement('select');
    for (const opt of param.options) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === param.value) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      generator.setParam(param.key, select.value);
      // Rebuild controls when algorithm or trigger changes (shows/hides dynamic params)
      if (param.key === 'motionAlgorithm' || param.key === 'triggerMethod' || param.key === 'noteMapping') {
        requestAnimationFrame(() => this._buildControls());
      }
    });

    row.appendChild(select);
    return row;
  }

  _createToggle(row, param, generator) {
    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = param.value;

    const slider = document.createElement('span');
    slider.className = 'toggle-slider';

    input.addEventListener('change', () => {
      generator.setParam(param.key, input.checked);
    });

    toggle.appendChild(input);
    toggle.appendChild(slider);
    row.appendChild(toggle);
    return row;
  }

  _createNumber(row, param, generator) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = param.min;
    input.max = param.max;
    input.step = param.step || 1;
    input.value = param.value;

    input.addEventListener('change', () => {
      generator.setParam(param.key, parseFloat(input.value));
    });

    row.appendChild(input);
    return row;
  }

  refresh() {
    this._buildControls();
  }
}
