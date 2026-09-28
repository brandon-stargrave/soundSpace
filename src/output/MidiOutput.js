import { clamp } from '../util/math.js';

const CC_ALL_NOTES_OFF = 123;

/**
 * MIDI output via the Web MIDI API.
 * Sends note-on/off messages and optional CC to connected MIDI devices.
 */
export class MidiOutput {
  constructor() {
    this.enabled = false;
    this.muted = false;
    this.status = 'idle';     // 'idle' | 'ready' | 'unsupported' | 'denied'
    this.access = null;
    this.selectedOutput = null;
    this.availableOutputs = [];
    this.onDevicesChanged = null;
    this.config = {
      channel: 1,
      velocityCurve: 'linear',   // 'linear' | 'exponential' | 'logarithmic'
      noteDurationMs: 100,
      sendCC: false,
      ccNumber: 1,
      ccSource: 'velocity',      // 'velocity' | 'rawValue'
    };
    this._harmonicHeld = new Map();          // voiceId → held note numbers
    this._harmonicHeldChannels = new Map();  // voiceId → 0-based channel those notes were sent on
    this._usedChannels = new Set();          // 0-based channels this session has sent notes on
    this._pendingOffs = new Map();           // channel*128+note → note-off timer
  }

  /** MIDI channel (1–16) for an orbit: Base Channel for orbit 1, then counting up and wrapping. */
  channelForOrbit(orbitIndex) {
    return ((this.config.channel - 1 + orbitIndex) % 16) + 1;
  }

  /**
   * Request Web MIDI access. Browsers show a permission prompt for this, so
   * it's only called when the user turns MIDI on. Sets `status` to 'ready',
   * 'unsupported' or 'denied', and can be called again after a denial.
   */
  async init() {
    if (this.access) return true;
    if (!navigator.requestMIDIAccess) {
      this.status = 'unsupported';
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess();
      this.status = 'ready';
      this._refreshOutputs();

      this.access.onstatechange = () => {
        this._refreshOutputs();
        if (this.selectedOutput && this.selectedOutput.state === 'disconnected') {
          this.selectedOutput = null;
          this._harmonicHeld.clear();
        }
        if (this.onDevicesChanged) this.onDevicesChanged();
      };
      return true;
    } catch (e) {
      console.warn('MidiOutput: MIDI access denied', e);
      this.status = 'denied';
      return false;
    }
  }

  /** Send a note from a trigger event */
  send(triggerEvent, quantized) {
    if (!this.enabled || this.muted || !this.selectedOutput) return;
    if (!Number.isFinite(quantized.midiNote)) return;

    const channel = this.channelForOrbit(triggerEvent.orbitIndex || 0) - 1;
    const velocity = Math.round(
      this._applyVelocityCurve(triggerEvent.velocity) * 127
    );
    const note = clamp(quantized.midiNote, 0, 127);
    const output = this.selectedOutput;

    // A repeat of a note that's still sounding ends the earlier one first, so
    // the earlier note's scheduled note-off can't cut the new one short
    const key = channel * 128 + note;
    const pending = this._pendingOffs.get(key);
    if (pending) {
      clearTimeout(pending);
      output.send([0x80 | channel, note, 0]);
    }

    // Note On
    output.send([0x90 | channel, note, velocity]);

    // Note Off. A cancellable timer rather than a timestamped send, which
    // can't be withdrawn once queued.
    this._pendingOffs.set(key, setTimeout(() => {
      this._pendingOffs.delete(key);
      try { output.send([0x80 | channel, note, 0]); } catch {}
    }, this.config.noteDurationMs));
    this._usedChannels.add(channel);

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
    if (!this.enabled || this.muted || !this.selectedOutput) return;

    const ch = clamp((channel - 1) | 0, 0, 15);
    const vel = Math.round(this._applyVelocityCurve(velocity) * 127);

    // Notes held on a different channel must be released on that channel
    if (this._harmonicHeldChannels.has(voiceId) && this._harmonicHeldChannels.get(voiceId) !== ch) {
      this.releaseHarmonic(voiceId);
    }

    const prev = new Set(this._harmonicHeld.get(voiceId) || []);
    const next = new Set(midiNotes.map(n => clamp(n | 0, 0, 127)));

    try {
      // Release notes no longer held
      for (const n of prev) {
        if (!next.has(n)) this.selectedOutput.send([0x80 | ch, n, 0]);
      }
      // Attack new notes
      for (const n of next) {
        if (!prev.has(n)) this.selectedOutput.send([0x90 | ch, n, vel]);
      }
    } catch (e) {
      console.warn('MidiOutput: harmonic send failed', e.message);
    }

    this._harmonicHeld.set(voiceId, [...next]);
    this._harmonicHeldChannels.set(voiceId, ch);
    this._usedChannels.add(ch);
  }

  /** Release all held notes for a harmonic voice. Never gated on enabled/muted. */
  releaseHarmonic(voiceId) {
    const heldNotes = this._harmonicHeld.get(voiceId);
    if (!heldNotes || heldNotes.length === 0) return;
    const ch = this._harmonicHeldChannels.get(voiceId) ?? 0;
    if (this.selectedOutput) {
      for (const n of heldNotes) {
        try { this.selectedOutput.send([0x80 | ch, n, 0]); } catch {}
      }
    }
    this._harmonicHeld.set(voiceId, []);
  }

  /**
   * Silence everything this output may have left sounding: held harmonic
   * notes, plus an All Notes Off on every channel used — scheduled note-offs
   * are discarded if the page closes before they fire.
   */
  allNotesOff() {
    for (const voiceId of this._harmonicHeld.keys()) this.releaseHarmonic(voiceId);
    // End short notes now rather than when their timers fire
    for (const [key, timer] of this._pendingOffs) {
      clearTimeout(timer);
      try { this.selectedOutput?.send([0x80 | Math.floor(key / 128), key % 128, 0]); } catch {}
    }
    this._pendingOffs.clear();
    if (!this.selectedOutput) return;
    for (const ch of this._usedChannels) {
      try { this.selectedOutput.send([0xB0 | ch, CC_ALL_NOTES_OFF, 0]); } catch {}
    }
  }

  /** Select an output device by ID */
  selectOutput(outputId) {
    if (!this.access) return;
    this.allNotesOff();
    this._usedChannels.clear();
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
    this.allNotesOff();
    if (this.access) this.access.onstatechange = null;
    this.selectedOutput = null;
    this.access = null;
  }
}
