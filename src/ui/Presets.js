import { showToast } from './toast.js';

// Presets are small; anything this large isn't one
const MAX_PRESET_BYTES = 1024 * 1024;

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * JSON export/import for saving and loading compositions.
 */
export class Presets {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
    this._busy = false;
    this._onLoad = null;  // set by ConfigPanel to rebuild the panels after a load
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

    // Save / Load / Demo buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.title = 'Download this setup as a .json file (S while the panel is hidden)';
    saveBtn.addEventListener('click', () => this._save());

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn';
    loadBtn.textContent = 'Load';
    loadBtn.title = 'Open a saved .json preset';
    loadBtn.addEventListener('click', () => this._load());

    const demoBtn = document.createElement('button');
    demoBtn.className = 'btn';
    demoBtn.textContent = 'Demo';
    demoBtn.title = 'Load the bundled niceStart preset';
    demoBtn.addEventListener('click', () => this._loadDemo());

    this._buttons = [saveBtn, loadBtn, demoBtn];
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(loadBtn);
    btnRow.appendChild(demoBtn);
    body.appendChild(btnRow);

    // Hidden file input for loading
    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = '.json,application/json';
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
    a.download = `soundspace_${timestampForFilename()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking right away can cancel the download in some browsers
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  _load() {
    this._fileInput.click();
  }

  async _handleFileLoad(event) {
    const file = event.target.files[0];
    this._fileInput.value = '';
    if (!file) return;
    if (file.size > MAX_PRESET_BYTES) {
      showToast(`${file.name} is too large to be a soundSpace preset.`, { kind: 'error' });
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      showToast(`${file.name} isn't a soundSpace preset (it isn't valid JSON).`, { kind: 'error' });
      return;
    }
    await this.apply(data, file.name);
  }

  async _loadDemo() {
    if (this._busy) return;
    this._setBusy(true);
    let data;
    try {
      // Fetched on demand so the preset stays out of the main bundle
      ({ default: data } = await import('../../presets/niceStart.json'));
    } catch (err) {
      console.error('Failed to fetch the demo preset:', err);
      showToast('The demo preset could not be downloaded. Check your connection and try again.', { kind: 'error' });
      this._setBusy(false);
      return;
    }
    this._setBusy(false);
    await this.apply(structuredClone(data), 'Demo');
  }

  /**
   * Load preset data, with a toast for the result and an Undo that restores
   * the setup from before the load.
   */
  async apply(data, name) {
    if (this._busy) return false;
    this._setBusy(true);
    const previous = this.engine.serialize();
    try {
      const { warnings } = await this.engine.loadPreset(data);
      if (this._onLoad) this._onLoad();
      const note = warnings.length ? ` ${warnings.join(' ')}` : '';
      showToast(`Loaded ${name}.${note}`, {
        actionLabel: 'Undo',
        onAction: () => this._restore(previous),
        duration: warnings.length ? 10000 : 6000,
      });
      return true;
    } catch (err) {
      console.error('Failed to load preset:', err);
      showToast(err.name === 'PresetError' ? err.message : `${name} could not be loaded.`, { kind: 'error' });
      return false;
    } finally {
      this._setBusy(false);
    }
  }

  async _restore(snapshot) {
    try {
      await this.engine.loadPreset(snapshot);
      if (this._onLoad) this._onLoad();
    } catch (err) {
      console.error('Undo failed:', err);
      showToast('Undo failed.', { kind: 'error' });
    }
  }

  _setBusy(busy) {
    this._busy = busy;
    for (const btn of this._buttons || []) btn.disabled = busy;
  }
}
