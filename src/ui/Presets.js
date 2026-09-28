import { showToast } from './toast.js';
import { makeShareLink } from './ShareLink.js';

// Presets are small; anything this large isn't one
const MAX_PRESET_BYTES = 1024 * 1024;

// Bundled examples, each loaded on demand as its own small chunk
const PRESET_LOADERS = import.meta.glob('../../presets/*.json', { import: 'default' });
const BUNDLED_PRESETS = [
  { file: 'music-box', name: 'Music Box', about: 'Six nodes pluck a Euclidean ring of pins.' },
  { file: 'harmonic-drift', name: 'Harmonic Drift', about: 'Phasing pins over a I–V–vi–IV pad and bass.' },
  { file: 'polyrhythm', name: 'Polyrhythm', about: 'Four rings: drum, keys, bells and a slow pad.' },
  { file: 'zones', name: 'Zones', about: 'A golden-spiral swarm through five zones, with drones.' },
  { file: 'night-garden', name: 'Night Garden', about: 'Slow, wide and ambient.' },
];

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

    // Examples
    const examples = document.createElement('div');
    examples.className = 'control-row preset-examples';
    const label = document.createElement('label');
    label.textContent = 'Examples';
    label.htmlFor = 'preset-examples';
    const select = document.createElement('select');
    select.id = 'preset-examples';
    for (const p of BUNDLED_PRESETS) {
      const option = document.createElement('option');
      option.value = p.file;
      option.textContent = p.name;
      select.appendChild(option);
    }
    const about = document.createElement('div');
    about.className = 'panel-note';
    const showAbout = () => { about.textContent = BUNDLED_PRESETS.find(p => p.file === select.value)?.about ?? ''; };
    select.addEventListener('change', showAbout);
    showAbout();
    const openBtn = document.createElement('button');
    openBtn.className = 'btn';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => this.loadExample(select.value));
    examples.appendChild(label);
    examples.appendChild(select);
    examples.appendChild(openBtn);
    body.appendChild(examples);
    body.appendChild(about);

    this._buttons = [saveBtn, loadBtn, openBtn];
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(loadBtn);
    body.appendChild(btnRow);

    const shareRow = document.createElement('div');
    shareRow.className = 'btn-row';
    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn';
    shareBtn.textContent = 'Copy link';
    shareBtn.title = 'Copy a link that opens this setup (MIDI and OSC settings stay private)';
    shareBtn.addEventListener('click', () => this._copyLink());
    shareRow.appendChild(shareBtn);
    body.appendChild(shareRow);

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

  /** Copy a link to this setup. MIDI/OSC settings are left out: they're about the sharer's own gear. */
  async _copyLink() {
    let url;
    try {
      url = await makeShareLink(this.engine.serialize({ includeIO: false }));
    } catch (err) {
      console.error('Could not make a share link:', err);
      showToast('Could not make a link for this setup.', { kind: 'error' });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied. Anyone who opens it gets this setup.', { duration: 4000 });
    } catch {
      // Clipboard access can be refused; show the link so it can be copied by hand
      window.prompt('Copy this link:', url);
    }
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

  /** Load one of the bundled example presets by file name. */
  async loadExample(file) {
    const entry = BUNDLED_PRESETS.find(p => p.file === file);
    const loader = PRESET_LOADERS[`../../presets/${file}.json`];
    if (!entry || !loader || this._busy) return;
    this._setBusy(true);
    let data;
    try {
      data = await loader();
    } catch (err) {
      console.error('Failed to fetch the example preset:', err);
      showToast('That example could not be downloaded. Check your connection and try again.', { kind: 'error' });
      this._setBusy(false);
      return;
    }
    this._setBusy(false);
    await this.apply(structuredClone(data), entry.name);
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
