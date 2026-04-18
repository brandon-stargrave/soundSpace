import { GeneratorPanel } from './GeneratorPanel.js';
import { ScalePanel } from './ScalePanel.js';
import { OutputPanel } from './OutputPanel.js';
import { PostFXPanel } from './PostFXPanel.js';
import { MidiOscPanel } from './MidiOscPanel.js';
import { HarmonicOrbitPanel } from './HarmonicOrbitPanel.js';
import { Presets } from './Presets.js';

const MAX_ORBITS = 5;

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
    this._selectedOrbit = 0;
    this._genSection = null;          // per-orbit Generator panel container (top)
    this._sectionContainer = null;    // per-orbit Scale + Synth container (below Harmonic)
    this._orbitBar = null;
    this._orbitClipboard = null; // stored orbit config for copy/paste
  }

  init() {
    // Panel title
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'soundSpace';
    this.container.appendChild(title);

    // Transport controls
    this.container.appendChild(this._createTransportControls());

    // Orbit selector bar
    this._orbitBar = this._createOrbitBar();
    this.container.appendChild(this._orbitBar);

    // Per-orbit Generator panel container (sits above Harmonic Orbit so
    // Harmonic is the 2nd section in the list). Rebuilt when orbit changes.
    this._genSection = document.createElement('div');
    this.container.appendChild(this._genSection);

    // Harmonic Orbit (global — polygon root transposer + pad/bass drones).
    // Placed right after the Generator section so it reads as the 2nd panel.
    const harmonic = new HarmonicOrbitPanel(this.engine);
    this.container.appendChild(harmonic.render());

    // Remaining per-orbit sections (Scale + Synth) — rebuilt on orbit change.
    this._sectionContainer = document.createElement('div');
    this.container.appendChild(this._sectionContainer);

    // Build sections for initial orbit (fills both containers above)
    this._buildSections();

    // Post FX (global, not per-orbit)
    const postFX = new PostFXPanel(this.engine.sceneManager, this.engine);
    this.container.appendChild(postFX.render());

    // MIDI / OSC (global, shared across orbits)
    const midiOsc = new MidiOscPanel(this.engine);
    this.container.appendChild(midiOsc.render());

    // Presets (global, not per-orbit)
    this.presets = new Presets(this.engine);
    this.presets._onLoad = () => {
      this._selectedOrbit = 0;
      this._refreshOrbitBar();
      this._buildSections();
    };
    this.container.appendChild(this.presets.render());

    // Toggle button
    const toggle = document.getElementById('panel-toggle');
    toggle.addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      this.panel.classList.toggle('collapsed', this._collapsed);
    });
  }

  /** Get the currently selected orbit generator */
  _getSelectedOrbit() {
    return this.engine.generators[this._selectedOrbit] || this.engine.generators[0];
  }

  /** Rebuild the per-orbit sections (generator, scale, synth) */
  _buildSections() {
    // Clear both containers (Generator lives in _genSection above the Harmonic
    // Orbit panel; Scale + Synth live in _sectionContainer below it).
    if (this._genSection) this._genSection.innerHTML = '';
    if (this._sectionContainer) this._sectionContainer.innerHTML = '';
    const orbit = this._getSelectedOrbit();
    if (!orbit) return;

    // Generator params (top slot — above Harmonic Orbit)
    const genPanel = new GeneratorPanel(this.engine, this._selectedOrbit);
    this._genSection.appendChild(genPanel.render());

    // Scale (per-orbit, below Harmonic Orbit)
    const quantizer = orbit._scaleQuantizer || this.engine.scaleQuantizer;
    const scalePanel = new ScalePanel(quantizer);
    this._sectionContainer.appendChild(scalePanel.render());

    // Synth (per-orbit, below Harmonic Orbit)
    const outputPanel = new OutputPanel(orbit._toneOutput || this.engine.toneOutput);
    this._sectionContainer.appendChild(outputPanel.render());
  }

  /** Create the orbit selector bar */
  _createOrbitBar() {
    const bar = document.createElement('div');
    bar.className = 'orbit-bar';
    this._refreshOrbitBar(bar);
    return bar;
  }

  _refreshOrbitBar(bar) {
    if (!bar) bar = this._orbitBar;
    if (!bar) return;
    bar.innerHTML = '';

    const orbits = this.engine.generators;

    for (let i = 0; i < orbits.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'orbit-select-btn';
      if (i === this._selectedOrbit) btn.classList.add('active');
      btn.textContent = i + 1;
      btn.title = `Orbit ${i + 1}`;

      btn.addEventListener('click', () => {
        this._selectedOrbit = i;
        this._refreshOrbitBar();
        this._buildSections();
      });

      bar.appendChild(btn);
    }

    // Add orbit button
    if (orbits.length < MAX_ORBITS) {
      const addBtn = document.createElement('button');
      addBtn.className = 'orbit-select-btn orbit-add-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Add orbit';
      addBtn.addEventListener('click', () => this._addOrbit());
      bar.appendChild(addBtn);
    }

    // Remove orbit button (only if more than 1 orbit)
    if (orbits.length > 1) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'orbit-select-btn orbit-remove-btn';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove selected orbit';
      removeBtn.addEventListener('click', () => this._removeOrbit());
      bar.appendChild(removeBtn);
    }

    // Copy/Paste buttons
    const copyBtn = document.createElement('button');
    copyBtn.className = 'orbit-select-btn orbit-copy-btn';
    copyBtn.textContent = '⧉';
    copyBtn.title = 'Copy orbit settings';
    copyBtn.addEventListener('click', () => this._copyOrbit());
    bar.appendChild(copyBtn);

    const pasteBtn = document.createElement('button');
    pasteBtn.className = 'orbit-select-btn orbit-paste-btn';
    pasteBtn.textContent = '⧫';
    pasteBtn.title = 'Paste orbit settings';
    if (!this._orbitClipboard) pasteBtn.style.opacity = '0.3';
    pasteBtn.addEventListener('click', () => this._pasteOrbit());
    bar.appendChild(pasteBtn);
  }

  async _addOrbit() {
    const { OrbitalNodes } = await import('../generators/OrbitalNodes.js');
    await this.engine.addOrbit(OrbitalNodes);
    this._selectedOrbit = this.engine.generators.length - 1;
    this._refreshOrbitBar();
    this._buildSections();
  }

  _copyOrbit() {
    const orbit = this._getSelectedOrbit();
    if (!orbit) return;
    this._orbitClipboard = {
      generator: orbit.serialize(),
      scale: orbit._scaleQuantizer ? orbit._scaleQuantizer.getConfig() : null,
      synth: orbit._toneOutput ? orbit._toneOutput.getConfig() : null,
    };
    this._refreshOrbitBar(); // update paste button opacity
  }

  _pasteOrbit() {
    if (!this._orbitClipboard) return;
    const orbit = this._getSelectedOrbit();
    if (!orbit) return;

    const clip = this._orbitClipboard;

    // Apply generator params (preserving radius and orbitIndex)
    if (clip.generator?.params) {
      const keepRadius = orbit.params.radius;
      const keepIndex = orbit.params.orbitIndex;
      for (const [key, value] of Object.entries(clip.generator.params)) {
        if (key === 'radius' || key === 'orbitIndex') continue;
        orbit.setParam(key, value);
      }
    }

    // Apply motion algorithm
    if (clip.generator?.motionAlgorithm) {
      orbit._switchAlgorithm(clip.generator.motionAlgorithm.id);
      if (orbit._motionAlgo) orbit._motionAlgo.deserialize(clip.generator.motionAlgorithm);
    } else {
      orbit._switchAlgorithm('none');
    }

    // Apply trigger method
    if (clip.generator?.triggerMethod) {
      orbit._switchTrigger(clip.generator.triggerMethod.id);
      if (orbit._triggerMethod) orbit._triggerMethod.deserialize(clip.generator.triggerMethod);
    }

    // Apply note mapping
    if (clip.generator?.noteMapping) {
      orbit._switchMapping(clip.generator.noteMapping.id);
      if (orbit._noteMapping) orbit._noteMapping.deserialize(clip.generator.noteMapping);
    }

    // Apply scale
    if (clip.scale && orbit._scaleQuantizer) {
      orbit._scaleQuantizer.setConfig(clip.scale);
    }

    // Apply synth
    if (clip.synth && orbit._toneOutput) {
      orbit._toneOutput.setConfig(clip.synth);
    }

    this._buildSections(); // refresh UI
  }

  _removeOrbit() {
    if (this.engine.generators.length <= 1) return;
    this.engine.removeGenerator(this._selectedOrbit);
    this._selectedOrbit = Math.min(this._selectedOrbit, this.engine.generators.length - 1);
    this._refreshOrbitBar();
    this._buildSections();
  }

  _createTransportControls() {
    const bar = document.createElement('div');
    bar.className = 'transport-bar';

    const playBtn = document.createElement('button');
    playBtn.className = 'transport-btn';
    playBtn.innerHTML = '<span class="transport-icon">&#9646;&#9646;</span><span class="transport-label">Pause</span>';
    playBtn.title = 'Pause';
    playBtn.addEventListener('click', () => {
      const paused = this.engine.togglePause();
      playBtn.innerHTML = paused
        ? '<span class="transport-icon">&#9654;</span><span class="transport-label">Play</span>'
        : '<span class="transport-icon">&#9646;&#9646;</span><span class="transport-label">Pause</span>';
      playBtn.title = paused ? 'Play' : 'Pause';
      playBtn.classList.toggle('inactive', paused);
    });

    const muteBtn = document.createElement('button');
    muteBtn.className = 'transport-btn';
    muteBtn.innerHTML = '<span class="transport-icon">&#9835;</span><span class="transport-label">Mute</span>';
    muteBtn.title = 'Mute';
    muteBtn.addEventListener('click', () => {
      const muted = this.engine.toggleMute();
      muteBtn.classList.toggle('muted', muted);
      muteBtn.innerHTML = muted
        ? '<span class="transport-icon">&#9835;</span><span class="transport-label">Unmute</span>'
        : '<span class="transport-icon">&#9835;</span><span class="transport-label">Mute</span>';
      muteBtn.title = muted ? 'Unmute' : 'Mute';
    });

    bar.appendChild(playBtn);
    bar.appendChild(muteBtn);

    // Defocus mute toggle
    const defocusRow = document.createElement('div');
    defocusRow.className = 'control-row';
    defocusRow.style.marginTop = '6px';

    const defocusLabel = document.createElement('label');
    defocusLabel.textContent = 'Mute on defocus';
    defocusLabel.style.fontSize = '10px';
    defocusRow.appendChild(defocusLabel);

    const defocusToggle = document.createElement('label');
    defocusToggle.className = 'toggle-switch';
    const defocusInput = document.createElement('input');
    defocusInput.type = 'checkbox';
    defocusInput.checked = this.engine.muteOnDefocus;
    const defocusSlider = document.createElement('span');
    defocusSlider.className = 'toggle-slider';
    defocusInput.addEventListener('change', () => {
      this.engine.muteOnDefocus = defocusInput.checked;
    });
    defocusToggle.appendChild(defocusInput);
    defocusToggle.appendChild(defocusSlider);
    defocusRow.appendChild(defocusToggle);

    bar.appendChild(defocusRow);
    return bar;
  }
}
