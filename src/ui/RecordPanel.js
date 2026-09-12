import { Recorder } from '../capture/Recorder.js';

/**
 * Global panel: viewport-resolution control + video/audio recording.
 *
 * The viewport resolution applies live to the renderer's pixel buffer; the
 * canvas's CSS dimensions stay window-sized so the on-screen display doesn't
 * change shape. Whatever resolution is currently set is what the recorder
 * captures, so users can dial in 4K for export then revert to "Match Window"
 * for normal viewing.
 */

// Resolution presets — values are stored landscape (wide×tall). The
// orientation toggle below swaps W/H when "Portrait" is selected. The
// "Match Window" and "Custom" entries are sentinels — orientation does
// not apply to them.
const RES_PRESETS = [
  { label: 'Match Window',  w: null, h: null  },
  { label: '1280×720',      w: 1280, h: 720   },
  { label: '1920×1080',     w: 1920, h: 1080  },
  { label: '2560×1440',     w: 2560, h: 1440  },
  { label: '3840×2160',     w: 3840, h: 2160  },
  { label: 'Custom',        w: 0,    h: 0     },
];

const ORIENTATIONS = ['Landscape', 'Portrait'];

export class RecordPanel {
  constructor(sceneManager, engine) {
    this.sceneManager = sceneManager;
    this.engine = engine;
    this.recorder = new Recorder(sceneManager, engine);
    this.recorder.setStatusCallback((s) => this._onStatus(s));

    this.el = null;
    this._statusLine = null;
    this._toggleBtn = null;
    this._customWidthInput = null;
    this._customHeightInput = null;
    this._customRow = null;
    this._resPresetSelect = null;
    this._orientationRow = null;
    this._orientation = 'Landscape';
  }

  render() {
    const section = document.createElement('details');
    section.className = 'config-section';
    section.open = false;

    const summary = document.createElement('summary');
    summary.textContent = 'Record';
    section.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';

    // ─── Viewport Resolution ──────────────────────────────────────
    body.appendChild(this._createDivider('Viewport Resolution'));

    this._resPresetSelect = this._createSelectRow(
      'Preset',
      RES_PRESETS.map(p => p.label),
      'Match Window',
      () => this._applyPresetSelection()
    );
    body.appendChild(this._resPresetSelect);

    // Orientation selector — only meaningful for fixed-resolution presets.
    // Hidden for "Match Window" and "Custom" (which has its own W/H inputs).
    this._orientationRow = this._createSelectRow(
      'Orientation',
      ORIENTATIONS,
      'Landscape',
      (val) => {
        this._orientation = val;
        this._applyPresetSelection();
      }
    );
    this._orientationRow.style.display = 'none';
    body.appendChild(this._orientationRow);

    // Custom W × H row — hidden unless preset is "Custom"
    this._customRow = document.createElement('div');
    this._customRow.className = 'control-row';
    this._customRow.style.display = 'none';
    const customLabel = document.createElement('label');
    customLabel.textContent = 'Custom W×H';
    this._customRow.appendChild(customLabel);
    const customInputWrap = document.createElement('span');
    customInputWrap.style.cssText = 'display: flex; gap: 4px; flex: 1;';
    this._customWidthInput = document.createElement('input');
    this._customWidthInput.type = 'number';
    this._customWidthInput.min = '256';
    this._customWidthInput.max = '7680';
    this._customWidthInput.step = '2';
    this._customWidthInput.value = '1920';
    this._customWidthInput.style.cssText = 'flex: 1; padding: 3px 6px; font-family: inherit; font-size: 11px; color: #ccccdd; background: rgba(255,255,255,0.06); border: 1px solid rgba(0,255,255,0.15); border-radius: 3px; outline: none;';
    this._customHeightInput = document.createElement('input');
    this._customHeightInput.type = 'number';
    this._customHeightInput.min = '256';
    this._customHeightInput.max = '4320';
    this._customHeightInput.step = '2';
    this._customHeightInput.value = '1080';
    this._customHeightInput.style.cssText = this._customWidthInput.style.cssText;
    customInputWrap.appendChild(this._customWidthInput);
    customInputWrap.appendChild(this._customHeightInput);
    this._customRow.appendChild(customInputWrap);
    body.appendChild(this._customRow);

    // Apply button — its own row directly below the W×H inputs, sized to
    // match the input row width (no awkward squeeze inside the flex row).
    this._customApplyRow = document.createElement('div');
    this._customApplyRow.className = 'control-row';
    this._customApplyRow.style.display = 'none';
    this._customApplyRow.style.justifyContent = 'flex-end';
    this._customApplyRow.style.marginTop = '4px';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn';
    applyBtn.textContent = 'Apply';
    applyBtn.style.cssText = 'padding: 3px 12px; font-size: 10px;';
    applyBtn.addEventListener('click', () => this._applyCustomResolution());
    this._customApplyRow.appendChild(applyBtn);
    body.appendChild(this._customApplyRow);

    // ─── Recording ────────────────────────────────────────────────
    body.appendChild(this._createDivider('Recording'));

    this._formatSelect = this._createSelectRow(
      'Format',
      ['Compressed MP4 (H.264)', 'ProRes 4444 MOV'],
      'Compressed MP4 (H.264)',
      () => this._updateIdleStatus()
    );
    body.appendChild(this._formatSelect);

    this._fpsSelect = this._createSelectRow(
      'Frame Rate',
      ['30', '60'],
      '60',
      () => {}
    );
    body.appendChild(this._fpsSelect);

    // Big toggle button
    this._toggleBtn = document.createElement('button');
    this._toggleBtn.className = 'btn record-btn';
    this._toggleBtn.textContent = '● Record';
    this._toggleBtn.style.cssText = 'margin-top: 8px; width: 100%; padding: 8px; font-size: 13px; letter-spacing: 1px;';
    this._toggleBtn.addEventListener('click', () => this._onToggle());
    body.appendChild(this._toggleBtn);

    // Status line
    this._statusLine = document.createElement('div');
    this._statusLine.style.cssText = 'font-size: 10px; color: #88aacc; margin-top: 8px; min-height: 14px;';
    body.appendChild(this._statusLine);

    // Performance-note + ffmpeg-load-note hint
    const note = document.createElement('div');
    note.style.cssText = 'font-size: 9px; color: #556; margin-top: 6px; line-height: 1.4;';
    note.innerHTML =
      'High resolutions (4K) may reduce live framerate while recording.<br>' +
      'First recording downloads the encoder (~30 MB, one time).';
    body.appendChild(note);

    section.appendChild(body);
    this.el = section;

    this._updateIdleStatus();
    return section;
  }

  // ── Actions ────────────────────────────────────────────────────

  /**
   * Apply the currently-selected preset + orientation. Centralizes the
   * preset/orientation handling so both selectors trigger the same path.
   */
  _applyPresetSelection() {
    const label = this._getSelectValue(this._resPresetSelect);
    const preset = RES_PRESETS.find(p => p.label === label);
    if (!preset) return;

    if (preset.label === 'Match Window') {
      this._customRow.style.display = 'none';
      this._customApplyRow.style.display = 'none';
      this._orientationRow.style.display = 'none';
      this.sceneManager.setViewportResolution(null, null);
      this._updateIdleStatus();
      return;
    }

    if (preset.label === 'Custom') {
      this._customRow.style.display = '';
      this._customApplyRow.style.display = '';
      this._orientationRow.style.display = 'none';
      // Apply current custom values immediately if both present
      this._applyCustomResolution();
      return;
    }

    // Fixed preset — orientation applies (swap W/H if portrait).
    this._customRow.style.display = 'none';
    this._customApplyRow.style.display = 'none';
    this._orientationRow.style.display = '';
    const w = this._orientation === 'Portrait' ? preset.h : preset.w;
    const h = this._orientation === 'Portrait' ? preset.w : preset.h;
    this.sceneManager.setViewportResolution(w, h);
    this._updateIdleStatus();
  }

  _applyCustomResolution() {
    const w = parseInt(this._customWidthInput.value, 10);
    const h = parseInt(this._customHeightInput.value, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64) return;
    this.sceneManager.setViewportResolution(w, h);
    this._updateIdleStatus();
  }

  async _onToggle() {
    if (this.recorder.isEncoding) return; // can't act while encoding
    if (this.recorder.isRecording) {
      this._toggleBtn.disabled = true;
      try {
        await this.recorder.stop();
      } catch (e) {
        console.error('Recorder.stop failed:', e);
        this._statusLine.textContent = 'Error: ' + (e.message || e);
      } finally {
        this._toggleBtn.disabled = false;
        this._toggleBtn.textContent = '● Record';
        this._toggleBtn.classList.remove('recording');
      }
    } else {
      const formatLabel = this._getSelectValue(this._formatSelect);
      const format = formatLabel.startsWith('ProRes') ? 'mov' : 'mp4';
      const fps = parseInt(this._getSelectValue(this._fpsSelect), 10) || 60;
      try {
        await this.recorder.start({ format, fps });
        this._toggleBtn.textContent = '■ Stop';
        this._toggleBtn.classList.add('recording');
      } catch (e) {
        console.error('Recorder.start failed:', e);
        this._statusLine.textContent = 'Error: ' + (e.message || e);
      }
    }
  }

  _onStatus({ state, elapsedSec, message }) {
    if (state === 'recording') {
      const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const ss = String(Math.floor(elapsedSec % 60)).padStart(2, '0');
      this._statusLine.textContent = `Recording ${mm}:${ss}`;
    } else if (state === 'encoding') {
      this._statusLine.textContent = message || 'Encoding…';
    } else if (state === 'done') {
      const f = this.recorder.lastFile;
      if (f) {
        const mb = (f.size / (1024 * 1024)).toFixed(1);
        this._statusLine.textContent = `Saved ${f.name} (${mb} MB)` + (f.note ? ` — ${f.note}` : '');
      } else {
        this._statusLine.textContent = 'Done';
      }
    } else if (state === 'idle') {
      this._updateIdleStatus();
    } else if (message) {
      this._statusLine.textContent = message;
    }
  }

  _updateIdleStatus() {
    if (!this._statusLine) return;
    if (!Recorder.isSupported()) {
      this._toggleBtn.disabled = true;
      this._statusLine.textContent = 'Recording is not supported in this browser';
      return;
    }
    if (this.recorder.isRecording || this.recorder.isEncoding) return;
    const canvas = this.sceneManager.renderer.domElement;
    const w = canvas.width;
    const h = canvas.height;
    this._statusLine.textContent = `Idle — capture at ${w}×${h}`;
  }

  // ── Tiny DOM helpers (mirrors MidiOscPanel style) ──────────────

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

  _getSelectValue(row) {
    return row.querySelector('select').value;
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
