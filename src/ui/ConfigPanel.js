import { GeneratorPanel } from './GeneratorPanel.js';
import { ScalePanel } from './ScalePanel.js';
import { OutputPanel } from './OutputPanel.js';
import { PostFXPanel } from './PostFXPanel.js';
import { MidiOscPanel } from './MidiOscPanel.js';
import { HarmonicOrbitPanel } from './HarmonicOrbitPanel.js';
import { RecordPanel } from './RecordPanel.js';
import { Presets } from './Presets.js';
import { showToast } from './toast.js';
import { openHelp } from './HelpOverlay.js';
import { rangeRow, toggleRow } from './controls.js';
import { MAX_ORBITS } from '../core/presetSchema.js';

/**
 * Main configuration panel manager.
 * Supports multiple orbits with per-orbit generator, scale, and synth settings.
 */
export class ConfigPanel {
  constructor(engine) {
    this.engine = engine;
    this.container = document.getElementById('panel-content');
    this.panel = document.getElementById('config-panel');
    this._collapsed = false;
    this._selectedOrbit = 0;          // position in engine.generators
    this._genSection = null;          // per-orbit Generator panel container (top)
    this._sectionContainer = null;    // per-orbit Scale + Synth container (below Harmonic)
    this._orbitBar = null;
    this._orbitClipboard = null;      // stored orbit config for copy/paste
    this.onCollapsedChange = null;
  }

  init() {
    // Record and Presets keep their state (a take in progress, a load in
    // progress) across panel rebuilds, so they're created once and re-attached
    this._record = new RecordPanel(this.engine.sceneManager, this.engine);
    this._recordEl = this._record.render();
    this._recordEl.dataset.section = 'record';
    this.presets = new Presets(this.engine);
    this._presetsEl = this.presets.render();
    this._presetsEl.dataset.section = 'presets';
    this.presets._onLoad = () => {
      this._selectedOrbit = 0;
      this.refresh();
    };

    this._build();

    // Toggle button
    const toggle = document.getElementById('panel-toggle');
    toggle.addEventListener('click', () => this.setCollapsed(!this._collapsed));
    // On a phone the open panel would cover most of the scene
    if (window.matchMedia?.('(max-width: 700px)').matches) this.setCollapsed(true);
  }

  /** Rebuild every section so it shows the engine's current state (e.g. after a preset load). */
  refresh() {
    const open = this._openSections();
    const scroll = this.container.scrollTop;
    this._build(open);
    this.container.scrollTop = scroll;
  }

  _build(open = null) {
    this.container.innerHTML = '';

    // Panel title, with the help button
    const title = document.createElement('div');
    title.className = 'panel-title';
    const name = document.createElement('span');
    name.textContent = 'soundSpace';
    const help = document.createElement('button');
    help.className = 'help-button';
    help.textContent = '?';
    help.title = 'Help and shortcuts (?)';
    help.setAttribute('aria-label', 'Help and shortcuts');
    help.addEventListener('click', () => openHelp());
    title.appendChild(name);
    title.appendChild(help);
    this.container.appendChild(title);

    // Transport controls
    this.container.appendChild(this._createTransportControls());

    // Orbit selector bar
    this._orbitBar = document.createElement('div');
    this.container.appendChild(this._orbitBar);
    this._refreshOrbitBar();

    // Per-orbit Generator panel container (sits above Harmonic Orbit so
    // Harmonic is the 2nd section in the list). Rebuilt when orbit changes.
    this._genSection = document.createElement('div');
    this.container.appendChild(this._genSection);

    // Harmonic Orbit (global — polygon root transposer + pad/bass drones).
    this._harmonicPanel = new HarmonicOrbitPanel(this.engine);
    this.container.appendChild(this._tag(this._harmonicPanel.render(), 'harmonic'));

    // Remaining per-orbit sections (Scale + Synth) — rebuilt on orbit change.
    this._sectionContainer = document.createElement('div');
    this.container.appendChild(this._sectionContainer);
    this._buildSections();

    // Global sections
    this.container.appendChild(this._tag(new PostFXPanel(this.engine.sceneManager, this.engine).render(), 'postfx'));
    this.container.appendChild(this._tag(new MidiOscPanel(this.engine).render(), 'midiosc'));
    this.container.appendChild(this._recordEl);
    this.container.appendChild(this._presetsEl);

    if (open) this._restoreOpen(open);
  }

  _tag(el, key) {
    el.dataset.section = key;
    return el;
  }

  /** Which sections are open, keyed by data-section. */
  _openSections() {
    const open = new Map();
    for (const d of this.container.querySelectorAll('details[data-section]')) open.set(d.dataset.section, d.open);
    return open;
  }

  _restoreOpen(open) {
    for (const d of this.container.querySelectorAll('details[data-section]')) {
      if (open.has(d.dataset.section)) d.open = open.get(d.dataset.section);
    }
  }

  isCollapsed() {
    return this._collapsed;
  }

  setCollapsed(collapsed) {
    this._collapsed = !!collapsed;
    this.panel.classList.toggle('collapsed', this._collapsed);
    const toggle = document.getElementById('panel-toggle');
    toggle.setAttribute('aria-expanded', String(!this._collapsed));
    toggle.setAttribute('aria-label', this._collapsed ? 'Show panel' : 'Hide panel');
    // Keep the hidden panel's controls out of the Tab order
    this.container.inert = this._collapsed;
    // The letterboxed viewport (Record panel) centers within the visible
    // (non-panel) region — re-fit when the panel slides in/out so the
    // framing preview tracks the change. Wait for the slide transition
    // (300ms) so getBoundingClientRect reads the panel's settled position.
    const sm = this.engine && this.engine.sceneManager;
    if (sm && sm._manualResolution) {
      setTimeout(() => sm._applyCanvasDisplaySize(), 320);
    }
    if (this.onCollapsedChange) this.onCollapsedChange(this._collapsed);
  }

  togglePause() {
    this.engine.togglePause();
    this._syncTransport();
  }

  toggleMute() {
    this.engine.toggleMute();
    this._syncTransport();
  }

  /** Reflect the engine's pause and mute state in the transport buttons. */
  _syncTransport() {
    if (!this._playBtn) return;
    const paused = this.engine.paused;
    const muted = this.engine.muted;
    this._playBtn.innerHTML = paused
      ? '<span class="transport-icon" aria-hidden="true">&#9654;</span><span class="transport-label">Play</span>'
      : '<span class="transport-icon" aria-hidden="true">&#9646;&#9646;</span><span class="transport-label">Pause</span>';
    this._playBtn.title = paused ? 'Play (Space)' : 'Pause (Space)';
    this._playBtn.classList.toggle('inactive', paused);
    this._muteBtn.innerHTML = `<span class="transport-icon" aria-hidden="true">&#9835;</span><span class="transport-label">${muted ? 'Unmute' : 'Mute'}</span>`;
    this._muteBtn.title = muted ? 'Unmute (M)' : 'Mute (M)';
    this._muteBtn.classList.toggle('muted', muted);
    this._muteBtn.setAttribute('aria-pressed', String(muted));
  }

  /** Get the currently selected orbit generator */
  _getSelectedOrbit() {
    return this.engine.generators[this._selectedOrbit] || this.engine.generators[0];
  }

  /** Rebuild the per-orbit sections (generator, scale, synth) */
  _buildSections() {
    const open = this._openSections();
    this._genSection.innerHTML = '';
    this._sectionContainer.innerHTML = '';
    this._selectedOrbit = Math.min(this._selectedOrbit, Math.max(0, this.engine.generators.length - 1));
    const orbit = this._getSelectedOrbit();
    if (!orbit) return;

    this._genSection.appendChild(this._tag(new GeneratorPanel(this.engine, this._selectedOrbit).render(), 'generator'));
    this._sectionContainer.appendChild(this._tag(new ScalePanel(orbit._scaleQuantizer, this.engine).render(), 'scale'));
    this._sectionContainer.appendChild(this._tag(new OutputPanel(orbit._toneOutput).render(), 'synth'));
    // Switching orbits keeps the same sections open
    this._restoreOpen(open);
  }

  _refreshOrbitBar() {
    const bar = this._orbitBar;
    if (!bar) return;
    bar.innerHTML = '';
    bar.className = 'orbit-bar-wrap';

    const orbits = this.engine.generators;
    const row = document.createElement('div');
    row.className = 'orbit-bar';
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'Orbits');

    orbits.forEach((gen, i) => {
      const num = gen.params.orbitIndex + 1;
      const btn = document.createElement('button');
      btn.className = 'orbit-select-btn';
      btn.classList.toggle('active', i === this._selectedOrbit);
      btn.classList.toggle('is-muted', !!gen.outputMuted);
      btn.classList.toggle('is-solo', !!gen.outputSolo);
      btn.textContent = num;
      btn.title = `Orbit ${num}${gen.outputMuted ? ' (muted)' : ''}${gen.outputSolo ? ' (solo)' : ''}`;
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', String(i === this._selectedOrbit));
      btn.addEventListener('click', () => {
        this._selectedOrbit = i;
        this._refreshOrbitBar();
        this._buildSections();
      });
      row.appendChild(btn);
    });

    if (orbits.length < MAX_ORBITS) {
      row.appendChild(this._barButton('+', 'Add orbit', 'orbit-add-btn', () => this._addOrbit()));
    }

    const spacer = document.createElement('span');
    spacer.className = 'orbit-bar-spacer';
    row.appendChild(spacer);

    row.appendChild(this._barButton('⧉', 'Copy orbit settings', 'orbit-copy-btn', () => this._copyOrbit()));
    const paste = this._barButton('⧫', 'Paste orbit settings', 'orbit-paste-btn', () => this._pasteOrbit());
    paste.disabled = !this._orbitClipboard;
    row.appendChild(paste);
    if (orbits.length > 1) {
      row.appendChild(this._barButton('×', 'Remove selected orbit', 'orbit-remove-btn', () => this._removeOrbit()));
    }
    bar.appendChild(row);

    // Mute and solo for the selected orbit
    const gen = this._getSelectedOrbit();
    if (!gen) return;
    const num = gen.params.orbitIndex + 1;
    const ms = document.createElement('div');
    ms.className = 'orbit-ms-row';
    const label = document.createElement('span');
    label.textContent = `Orbit ${num}`;
    ms.appendChild(label);
    const muteBtn = this._barButton('Mute', `Mute orbit ${num}`, 'orbit-ms-btn', () => {
      this.engine.setOrbitMuted(gen, !gen.outputMuted);
      this._refreshOrbitBar();
    });
    muteBtn.setAttribute('aria-pressed', String(!!gen.outputMuted));
    const soloBtn = this._barButton('Solo', `Solo orbit ${num}`, 'orbit-ms-btn', () => {
      this.engine.setOrbitSolo(gen, !gen.outputSolo);
      this._refreshOrbitBar();
    });
    soloBtn.setAttribute('aria-pressed', String(!!gen.outputSolo));
    ms.appendChild(muteBtn);
    ms.appendChild(soloBtn);
    bar.appendChild(ms);
  }

  _barButton(text, label, extraClass, onClick) {
    const btn = document.createElement('button');
    btn.className = `orbit-select-btn ${extraClass}`;
    btn.textContent = text;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', onClick);
    return btn;
  }

  async _addOrbit() {
    const gen = await this.engine.addOrbit();
    if (!gen) return;
    this._selectedOrbit = this.engine.generators.indexOf(gen);
    this._refreshOrbitBar();
    this._buildSections();
    this._harmonicPanel.refreshSyncSources();
  }

  _copyOrbit() {
    const orbit = this._getSelectedOrbit();
    if (!orbit) return;
    this._orbitClipboard = {
      generator: orbit.serialize(),
      scale: orbit._scaleQuantizer ? orbit._scaleQuantizer.getConfig() : null,
      synth: orbit._toneOutput ? orbit._toneOutput.getConfig() : null,
    };
    this._refreshOrbitBar(); // enable the paste button
    showToast(`Copied orbit ${orbit.params.orbitIndex + 1}'s settings.`, { duration: 3000 });
  }

  _pasteOrbit() {
    if (!this._orbitClipboard) return;
    const orbit = this._getSelectedOrbit();
    if (!orbit) return;

    const clip = this._orbitClipboard;

    // Apply generator params in one rebuild (keeping this orbit's radius and number)
    if (clip.generator?.params) {
      const { radius, orbitIndex, motionAlgorithm, triggerMethod, noteMapping, ...rest } = clip.generator.params;
      Object.assign(orbit.params, structuredClone(rest));
      orbit._rebuild();
    }

    orbit.params.motionAlgorithm = clip.generator?.motionAlgorithm?.id ?? 'none';
    orbit._switchAlgorithm(orbit.params.motionAlgorithm);
    if (orbit._motionAlgo && clip.generator?.motionAlgorithm) orbit._motionAlgo.deserialize(clip.generator.motionAlgorithm);

    if (clip.generator?.triggerMethod) {
      orbit.params.triggerMethod = clip.generator.triggerMethod.id;
      orbit._switchTrigger(clip.generator.triggerMethod.id);
      orbit._triggerMethod.deserialize(clip.generator.triggerMethod);
    }

    if (clip.generator?.noteMapping) {
      orbit.params.noteMapping = clip.generator.noteMapping.id;
      orbit._switchMapping(clip.generator.noteMapping.id);
      orbit._noteMapping.deserialize(clip.generator.noteMapping);
    }

    if (clip.scale && orbit._scaleQuantizer) orbit._scaleQuantizer.setConfig(clip.scale);
    if (clip.synth && orbit._toneOutput) orbit._toneOutput.setConfig(clip.synth);

    this._buildSections(); // refresh UI
  }

  async _removeOrbit() {
    if (this.engine.generators.length <= 1) return;
    const gen = this._getSelectedOrbit();
    const num = gen.params.orbitIndex + 1;
    const snapshot = this.engine.serialize();
    await this.engine.removeOrbit(gen);
    this._selectedOrbit = Math.min(this._selectedOrbit, this.engine.generators.length - 1);
    this._refreshOrbitBar();
    this._buildSections();
    this._harmonicPanel.refreshSyncSources();
    showToast(`Removed orbit ${num}.`, {
      actionLabel: 'Undo',
      onAction: async () => {
        await this.engine.loadPreset(snapshot);
        this.refresh();
      },
    });
  }

  _createTransportControls() {
    const wrap = document.createElement('div');
    wrap.className = 'transport-wrap';

    const bar = document.createElement('div');
    bar.className = 'transport-bar';

    this._playBtn = document.createElement('button');
    this._playBtn.className = 'transport-btn';
    this._playBtn.addEventListener('click', () => this.togglePause());

    this._muteBtn = document.createElement('button');
    this._muteBtn.className = 'transport-btn';
    this._muteBtn.addEventListener('click', () => this.toggleMute());

    bar.appendChild(this._playBtn);
    bar.appendChild(this._muteBtn);
    wrap.appendChild(bar);
    this._syncTransport();

    wrap.appendChild(rangeRow({
      label: 'Volume',
      min: 0, max: 1, step: 0.01,
      value: this.engine.masterVolume,
      format: v => `${Math.round(v * 100)}%`,
      onInput: v => this.engine.setMasterVolume(v),
    }));

    const vertical = toggleRow({
      label: 'Phone upright',
      value: this.engine.spatialAxis === 'vertical',
      help: 'For a phone held upright with speakers at the top and bottom: the scene\'s top and bottom drive left and right.',
      onChange: v => this.engine.setSpatialAxis(v ? 'vertical' : 'horizontal'),
    });
    vertical.hidden = !this.engine.spatialEnabled;
    wrap.appendChild(toggleRow({
      label: '3D Panning',
      value: this.engine.spatialEnabled,
      help: 'Places each note where it happens in the scene. Best on headphones.',
      onChange: v => {
        this.engine.setSpatialEnabled(v);
        vertical.hidden = !v;
      },
    }));
    wrap.appendChild(vertical);

    wrap.appendChild(toggleRow({
      label: 'Silence when tab is hidden',
      value: this.engine.muteOnDefocus,
      help: 'Browsers pause the animation, and with it new notes, while the tab is hidden. This also silences the Harmonic Orbit drones.',
      onChange: v => { this.engine.muteOnDefocus = v; },
    }));
    return wrap;
  }
}
