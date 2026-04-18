/**
 * JSON export/import for saving and loading compositions.
 */
export class Presets {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = false;

    const summary = document.createElement('summary');
    summary.textContent = 'Presets';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    // Save / Load buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => this._save());

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => this._load());

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(loadBtn);
    body.appendChild(btnRow);

    // Hidden file input for loading
    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = '.json';
    this._fileInput.style.display = 'none';
    this._fileInput.addEventListener('change', (e) => this._handleFileLoad(e));
    body.appendChild(this._fileInput);

    section.appendChild(body);
    this.el = section;
    return section;
  }

  save() { return this._save(); }

  _save() {
    const data = this.engine.serialize();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `soundspace-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  _load() {
    this._fileInput.click();
  }

  _handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        await this.engine.deserialize(data);
        // Notify ConfigPanel to rebuild UI if callback is set
        if (this._onLoad) this._onLoad();
        console.log('Preset loaded:', file.name);
      } catch (err) {
        console.error('Failed to load preset:', err);
      }
    };
    reader.readAsText(file);

    this._fileInput.value = '';
  }
}
