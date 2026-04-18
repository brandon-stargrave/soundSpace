import { clamp } from '../util/math.js';

/**
 * MIDI output via the Web MIDI API.
 * Sends note-on/off messages and optional CC to connected MIDI devices.
 */
export class MidiOutput {
  constructor() {
    this.enabled = false;
    this.access = null;
    this.selectedOutput = null;
    this.availableOutputs = [];
    this.config = {
      channel: 1,
      velocityCurve: 'linear',   // 'linear' | 'exponential' | 'logarithmic'
      noteDurationMs: 100,
      sendCC: false,
      ccNumber: 1,
      ccSource: 'velocity',      // 'velocity' | 'rawValue'
    };
  }

  /** Initialize Web MIDI access */
  async init() {
    if (!navigator.requestMIDIAccess) {
      console.warn('MidiOutput: Web MIDI API not available');
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess();
      this._refreshOutputs();

      // Listen for device changes
      this.access.onstatechange = () => this._refreshOutputs();
      return true;
    } catch (e) {
      console.warn('MidiOutput: MIDI access denied', e);
      return false;
    }
  }

  /** Send a note from a trigger event */
  send(triggerEvent, quantized) {
    if (!this.enabled || !this.selectedOutput) return;

    // Per-orbit channel: orbit 0 → config.channel, orbit 1 → config.channel+1, etc.
    const orbitOffset = triggerEvent.orbitIndex || 0;
    const channel = clamp(this.config.channel - 1 + orbitOffset, 0, 15);
    const velocity = Math.round(
      this._applyVelocityCurve(triggerEvent.velocity) * 127
    );
    const note = clamp(quantized.midiNote, 0, 127);

    // Note On
    this.selectedOutput.send([0x90 | channel, note, velocity]);

    // Note Off (scheduled)
    this.selectedOutput.send(
      [0x80 | channel, note, 0],
      performance.now() + this.config.noteDurationMs
    );

    // Optional CC
    if (this.config.sendCC) {
      const ccValue = Math.round(this._getCCValue(triggerEvent) * 127);
      this.selectedOutput.send([0xB0 | channel, this.config.ccNumber, clamp(ccValue, 0, 127)]);
    }
  }

  /**
   * Send a harmonic-orbit voice event — a set of MIDI notes (chord or single)
   * on a dedicated channel, separate from the per-orbit channel offset.
   * Releases previously-held notes on the same voice first for clean crossfades.
   * @param {string} voiceId - 'pad' or 'bass' — keyed for release tracking
   * @param {number} channel - 1..16 absolute MIDI channel
   * @param {number[]} midiNotes - array of note numbers to hold
   * @param {number} [velocity=0.7] - 0..1 velocity
   */
  sendHarmonicHold(voiceId, channel, midiNotes, velocity = 0.7) {
    if (!this.enabled || !this.selectedOutput) return;

    if (!this._harmonicHeld) this._harmonicHeld = new Map();
    const ch = clamp((channel - 1) | 0, 0, 15);
    const vel = Math.round(this._applyVelocityCurve(velocity) * 127);

    const prevNotes = this._harmonicHeld.get(voiceId) || [];
    const next = new Set(midiNotes.map(n => clamp(n | 0, 0, 127)));
    const prev = new Set(prevNotes);

    // Release notes no longer held
    for (const n of prev) {
      if (!next.has(n)) {
        this.selectedOutput.send([0x80 | ch, n, 0]);
      }
    }
    // Attack new notes
    for (const n of next) {
      if (!prev.has(n)) {
        this.selectedOutput.send([0x90 | ch, n, vel]);
      }
    }

    this._harmonicHeld.set(voiceId, [...next]);
    this._harmonicHeldChannels = this._harmonicHeldChannels || new Map();
    this._harmonicHeldChannels.set(voiceId, ch);
  }

  /** Release all held notes for a harmonic voice. */
  releaseHarmonic(voiceId) {
    if (!this.enabled || !this.selectedOutput) return;
    if (!this._harmonicHeld) return;
    const heldNotes = this._harmonicHeld.get(voiceId) || [];
    const ch = (this._harmonicHeldChannels && this._harmonicHeldChannels.get(voiceId)) ?? 0;
    for (const n of heldNotes) {
      try { this.selectedOutput.send([0x80 | ch, n, 0]); } catch {}
    }
    this._harmonicHeld.set(voiceId, []);
  }

  /** Select an output device by ID */
  selectOutput(outputId) {
    if (!this.access) return;
    this.selectedOutput = this.access.outputs.get(outputId) || null;
  }

  /** Get list of available output devices */
  getOutputList() {
    return this.availableOutputs.map(o => ({
      id: o.id,
      name: o.name,
      manufacturer: o.manufacturer,
    }));
  }

  setConfig(updates) {
    Object.assign(this.config, updates);
  }

  getConfig() {
    return { ...this.config };
  }

  _refreshOutputs() {
    if (!this.access) return;
    this.availableOutputs = [...this.access.outputs.values()];
  }

  _applyVelocityCurve(value) {
    const v = clamp(value, 0, 1);
    switch (this.config.velocityCurve) {
      case 'exponential': return v * v;
      case 'logarithmic': return Math.sqrt(v);
      case 'linear':
      default: return v;
    }
  }

  _getCCValue(triggerEvent) {
    switch (this.config.ccSource) {
      case 'rawValue': return triggerEvent.rawValue;
      case 'velocity':
      default: return triggerEvent.velocity;
    }
  }

  dispose() {
    this.selectedOutput = null;
    this.access = null;
  }
}
