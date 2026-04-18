import { SCALES, NOTE_NAMES } from '../util/constants.js';

/**
 * Scale and key configuration panel.
 * Controls root note, scale type, octave range, and mapping mode.
 */
export class ScalePanel {
  constructor(scaleQuantizer) {
    this.quantizer = scaleQuantizer;
    this.el = null;
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = true;

    const summary = document.createElement('summary');
    summary.textContent = 'Scale';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    const config = this.quantizer.getConfig();

    // Root note
    body.appendChild(this._createSelectRow('Root', NOTE_NAMES, config.root, (val) => {
      this.quantizer.setConfig({ root: val });
    }));

    // Scale type
    const scaleNames = Object.keys(SCALES);
    body.appendChild(this._createSelectRow('Scale', scaleNames, config.scaleType, (val) => {
      this.quantizer.setConfig({ scaleType: val });
      this._updateCustomEditor(val);
    }));

    // Octave range
    const octRow = document.createElement('div');
    octRow.className = 'control-row';
    const octLabel = document.createElement('label');
    octLabel.textContent = 'Octaves';
    octRow.appendChild(octLabel);

    const octLow = document.createElement('input');
    octLow.type = 'number';
    octLow.min = 0;
    octLow.max = 8;
    octLow.value = config.octaveLow;
    octLow.style.width = '44px';

    const octDash = document.createElement('span');
    octDash.textContent = '–';
    octDash.style.color = '#666';
    octDash.style.margin = '0 4px';

    const octHigh = document.createElement('input');
    octHigh.type = 'number';
    octHigh.min = 0;
    octHigh.max = 8;
    octHigh.value = config.octaveHigh;
    octHigh.style.width = '44px';

    octLow.addEventListener('change', () => {
      this.quantizer.setConfig({ octaveLow: parseInt(octLow.value) });
    });
    octHigh.addEventListener('change', () => {
      this.quantizer.setConfig({ octaveHigh: parseInt(octHigh.value) });
    });

    octRow.appendChild(octLow);
    octRow.appendChild(octDash);
    octRow.appendChild(octHigh);
    body.appendChild(octRow);

    // Mapping mode
    const mappingModes = ['linear', 'wrap', 'nearest', 'random_in_scale'];
    body.appendChild(this._createSelectRow('Mapping', mappingModes, config.mappingMode, (val) => {
      this.quantizer.setConfig({ mappingMode: val });
    }));

    // Custom scale editor
    this._customEditorContainer = document.createElement('div');
    body.appendChild(this._customEditorContainer);
    this._updateCustomEditor(config.scaleType);

    section.appendChild(body);
    this.el = section;
    return section;
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
      option.textContent = opt.replace(/_/g, ' ');
      if (opt === currentValue) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', () => onChange(select.value));
    row.appendChild(select);
    return row;
  }

  _updateCustomEditor(scaleType) {
    this._customEditorContainer.innerHTML = '';
    // Always show the scale note buttons as a visual reference
    const editor = document.createElement('div');
    editor.className = 'scale-editor';

    const blackKeys = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#
    const degrees = scaleType === 'custom'
      ? (this.quantizer.getConfig().customDegrees || [0])
      : (SCALES[scaleType] || []);

    for (let i = 0; i < 12; i++) {
      const btn = document.createElement('button');
      btn.className = 'scale-note-btn';
      if (blackKeys.includes(i)) btn.classList.add('black-key');
      if (degrees.includes(i)) btn.classList.add('active');
      btn.textContent = NOTE_NAMES[i];

      if (scaleType === 'custom') {
        btn.addEventListener('click', () => {
          btn.classList.toggle('active');
          const customDegrees = [];
          editor.querySelectorAll('.scale-note-btn.active').forEach((b, idx) => {
            // Find which note index this button corresponds to
            const noteIdx = Array.from(editor.children).indexOf(b);
            customDegrees.push(noteIdx);
          });
          // Always include root
          if (!customDegrees.includes(0)) customDegrees.unshift(0);
          this.quantizer.setConfig({ customDegrees });
        });
      }

      editor.appendChild(btn);
    }

    this._customEditorContainer.appendChild(editor);
  }
}
