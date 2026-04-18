import * as Tone from 'tone';

/**
 * AuxVoice — sustained-drone synth for the Harmonic Orbit pad + bass voices.
 *
 * Uses an explicit voice pool of individual synth instances (same pattern as
 * the main orbit `ToneOutput`) rather than wrapping `Tone.PolySynth`. Each
 * voice is a direct synth instance with its own envelope; on any rebuild
 * every voice is freshly constructed with the current config, so envelope
 * param changes are guaranteed to take effect deterministically on every
 * voice. Tone.PolySynth's lazy internal voice allocation was propagating
 * options inconsistently across voices — avoiding it fixes that entirely.
 *
 *   mode: 'mono' → pool of 1 synth (e.g. MonoSynth for bass drone)
 *   mode: 'poly' → pool of N synths (e.g. AMSynth×6 for pad chord)
 *
 * Signal: voice[i].synth → sharedFxChain → gain → destination.
 * `hold(frequencies)` diffs currently-held against requested freqs, releases
 * voices that are no longer needed, and allocates idle voices for new freqs.
 */

// Pool sizes. Each transpose round-robins to the next voice, so the
// previously-used voice gets at least (poolSize - 1) transposes of idle time
// — enough for its envelope to fully release to 0 before it's reused. This
// is required for a full-duration attack on every note (Tone.js Envelope
// scales attack time by remaining distance from the current value).
const POLY_POOL_SIZE = 12;  // chord sizes up to ~5 notes × ~2 cycles headroom
const MONO_POOL_SIZE = 4;   // bass drone rotation headroom

export class AuxVoice {
  constructor(config = {}) {
    this.config = {
      mode: 'mono',
      synthType: 'Synth',
      synthOptions: {},
      effects: [],
      ...config,
    };
    this.enabled = true;
    this._voices = [];            // Array<{synth, freq}>
    this._voiceCursor = 0;        // round-robin allocation pointer
    this._synth = null;           // compat reference
    this._gain = null;
    this._fxHead = null;          // first node of fx chain (where voices connect)
    this._effects = [];
    this._held = new Set();
    this._volume = 0.5;
    this._initialized = false;
    this._chainDirty = false;
  }

  async init() {
    await Tone.start();
    this._buildChain();
    this._initialized = true;
  }

  /**
   * Hold a new set of frequencies. Notes already held are preserved;
   * newly-added ones are attacked; removed ones are released.
   *
   * If synth params have been changed since the last build (via setSynthParam
   * or a synth-type change), rebuild first so the new notes fire with the
   * fresh envelope/oscillator. Already-held notes re-attack as part of the
   * rebuild — this matches the behavior of the main orbit synths on any
   * config change and ensures the new envelope takes effect on EVERY voice.
   */
  hold(frequencies) {
    if (!this._initialized || this._voices.length === 0) return;

    if (this._chainDirty) this._rebuildChainKeepingHeld();

    const next = Array.isArray(frequencies) ? frequencies : [frequencies];
    const nextSet = new Set(next.map(f => Number(f)));
    const now = Tone.now();

    // Step 1: release voices whose freq is no longer in the next set.
    // The voice keeps releasing its envelope naturally — we don't reuse it
    // immediately, so it can fully decay to 0 before it's allocated again.
    for (const voice of this._voices) {
      if (voice.freq !== null && !nextSet.has(voice.freq)) {
        try { voice.synth.triggerRelease(now); } catch {}
        voice.freq = null;
      }
    }

    // Step 2: allocate voices for new freqs using round-robin.
    // This ensures each attack lands on a voice whose envelope has been at
    // rest for at least `pool_size - 1` transpose cycles, which is required
    // for Tone.js Envelope to produce a full-duration attack (since it
    // scales attack time based on remaining distance from current value).
    const alreadyHeld = new Set(
      this._voices.filter(v => v.freq !== null).map(v => v.freq)
    );
    for (const f of nextSet) {
      if (alreadyHeld.has(f)) continue;
      const voice = this._acquireIdleVoice();
      if (!voice) break; // pool exhausted (rare)
      try { voice.synth.triggerAttack(f, now, 0.8); } catch {}
      voice.freq = f;
    }

    this._held = nextSet;
  }

  /** Pick the next available idle voice using a round-robin cursor. */
  _acquireIdleVoice() {
    if (this._voices.length === 0) return null;
    for (let i = 0; i < this._voices.length; i++) {
      const idx = (this._voiceCursor + i) % this._voices.length;
      if (this._voices[idx].freq === null) {
        this._voiceCursor = (idx + 1) % this._voices.length;
        return this._voices[idx];
      }
    }
    return null;
  }

  /** Release every currently-held note across all voices. */
  release() {
    if (!this._initialized) return;
    const now = Tone.now();
    for (const voice of this._voices) {
      if (voice.freq !== null) {
        try { voice.synth.triggerRelease(now); } catch {}
        voice.freq = null;
      }
    }
    this._held.clear();
  }

  /** Set volume as 0..1 linear; ramps on the output gain. */
  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._gain) {
      this._gain.gain.rampTo(this.enabled ? this._volume : 0, 0.05);
    }
  }

  setEnabled(b) {
    this.enabled = !!b;
    if (!this.enabled) {
      this.release();
    }
    if (this._gain) {
      this._gain.gain.rampTo(this.enabled ? this._volume : 0, 0.05);
    }
  }

  /** Update config and rebuild the full chain (e.g. synth-type change). */
  setConfig(updates) {
    Object.assign(this.config, updates);
    if (this._initialized) {
      const heldSnapshot = [...this._held];
      this._buildChain();
      this._held.clear();
      if (heldSnapshot.length) this.hold(heldSnapshot);
    }
  }

  getConfig() {
    return { ...this.config };
  }

  /** Update a single effect param live without rebuilding the chain. */
  setEffectParam(effectType, paramName, value) {
    const fxCfg = this.config.effects.find(f => f.type === effectType);
    if (fxCfg) {
      if (paramName === 'wet') fxCfg.wet = value;
      else fxCfg.options[paramName] = value;
    }
    const effect = this._effects.find(e => e && e._fxType === effectType);
    if (!effect) return;
    try {
      if (paramName === 'wet') {
        if (effect.wet) effect.wet.value = value;
      } else if (paramName === 'decay' && effectType === 'Reverb') {
        effect.decay = value;
        effect.generate && effect.generate();
      } else if (paramName === 'preDelay' && effectType === 'Reverb') {
        effect.preDelay = value;
        effect.generate && effect.generate();
      } else if (paramName === 'frequency' && effectType === 'Filter') {
        effect.frequency.value = value;
      } else if (paramName === 'Q' && effectType === 'Filter') {
        effect.Q.value = value;
      } else if (paramName === 'type' && effectType === 'Filter') {
        effect.type = value;
      } else if (paramName === 'rolloff' && effectType === 'Filter') {
        effect.rolloff = value;
      } else if (effectType === 'EQ3' && (paramName === 'low' || paramName === 'mid' || paramName === 'high')) {
        effect[paramName].value = value;
      } else if (effectType === 'EQ3' && paramName === 'lowFrequency') {
        effect.lowFrequency.value = value;
      } else if (effectType === 'EQ3' && paramName === 'highFrequency') {
        effect.highFrequency.value = value;
      } else if (paramName === 'feedback') {
        if (effect.feedback?.value !== undefined) effect.feedback.value = value;
        else effect.feedback = value;
      } else if (paramName === 'delayTime') {
        if (effect.delayTime?.value !== undefined) effect.delayTime.value = value;
        else effect.delayTime = value;
      } else if (effect[paramName] !== undefined) {
        if (effect[paramName] && effect[paramName].value !== undefined) {
          effect[paramName].value = value;
        } else {
          effect[paramName] = value;
        }
      }
    } catch (e) {
      console.warn(`AuxVoice.setEffectParam: ${effectType}.${paramName}`, e.message);
    }
  }

  /**
   * Update a synth-level parameter such as "envelope.attack", "oscillator.type",
   * etc. Two-step operation:
   *   1) Persist in config.synthOptions.
   *   2) Mark the chain dirty — the next hold() call will gracefully retire
   *      the current voice pool and build a fresh one from this config, so
   *      the upcoming transpose's new notes are constructed from scratch
   *      with the updated options. (Matches the main orbit synth pattern.)
   * Deliberately does NOT attempt in-place set() on live voices — in practice
   * that either doesn't propagate (PolySynth) or corrupts voice state.
   */
  setSynthParam(path, value) {
    const parts = path.split('.');
    const lastKey = parts[parts.length - 1];

    let tgt = this.config.synthOptions;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!tgt[parts[i]]) tgt[parts[i]] = {};
      tgt = tgt[parts[i]];
    }
    tgt[lastKey] = value;

    this._chainDirty = true;
  }

  /**
   * Rebuild only the voice pool, preserving the FX chain + gain. Voices
   * currently holding a note are triggered into release (envelopes decay
   * gracefully) and scheduled for disposal after their release completes —
   * no abrupt dispose = no click. A fresh pool of voices is built with the
   * current config, and any previously-held notes are re-attacked on fresh
   * voices so the drone continues seamlessly.
   */
  _rebuildChainKeepingHeld() {
    if (!this._initialized) return;
    const held = [...this._held];
    const now = Tone.now();

    // 1) Release all currently-playing voices gracefully. Move them into a
    //    "retiring" bucket so their envelopes can finish and we can dispose
    //    them later without cutting audio.
    const retiring = this._voices.slice();
    for (const voice of retiring) {
      if (voice.freq !== null) {
        try { voice.synth.triggerRelease(now); } catch {}
        voice.freq = null;
      }
    }
    // Schedule disposal after the release envelope finishes (+ small pad).
    const releaseSec = Number(this.config.synthOptions?.envelope?.release ?? 0.8);
    setTimeout(() => {
      for (const v of retiring) {
        try { v.synth.disconnect(); } catch {}
        try { v.synth.dispose(); } catch {}
      }
    }, (releaseSec + 0.2) * 1000);

    // 2) Build a fresh voice pool (doesn't touch fx/gain — they stay wired)
    this._buildVoicePool();

    // 3) Re-attack previously held notes on the fresh voices
    this._held.clear();
    for (const f of held) {
      const voice = this._acquireIdleVoice();
      if (!voice) break;
      try {
        voice.synth.triggerAttack(f, now, 0.8);
        voice.freq = f;
        this._held.add(f);
      } catch {}
    }

    this._chainDirty = false;
  }

  /**
   * Full chain build — fx + gain + _fxHead + voices. Used by init() and
   * setConfig() when the entire audio graph needs to be recreated (e.g. when
   * the fx list changes). For ordinary synth-param changes use the lighter
   * _buildVoicePool() path via _rebuildChainKeepingHeld().
   */
  _buildChain() {
    this._disposeChain();

    // 1) Effects chain
    this._effects = (this.config.effects || [])
      .map(fx => this._createEffect(fx))
      .filter(Boolean);

    // 2) Volume gain node at the tail
    this._gain = new Tone.Gain(this.enabled ? this._volume : 0);

    // 3) Connect effects: fx[0] → fx[1] → ... → fx[last] → gain → destination
    for (let i = 0; i < this._effects.length - 1; i++) {
      this._effects[i].connect(this._effects[i + 1]);
    }
    if (this._effects.length > 0) {
      this._effects[this._effects.length - 1].connect(this._gain);
    }
    this._gain.connect(Tone.getDestination());

    // 4) Persistent fx entry point — where voices connect. Stored so
    //    _buildVoicePool() can wire up fresh voices without re-creating fx.
    this._fxHead = this._effects.length > 0 ? this._effects[0] : this._gain;

    // 5) Voice pool
    this._buildVoicePool();
  }

  /**
   * Build a fresh voice pool using the current config, connected to the
   * persistent _fxHead. Does NOT touch fx or gain nodes — they stay wired,
   * so reverb/delay tails continue smoothly across a voice-pool rebuild.
   * Any existing voices are discarded by this function (the caller is
   * expected to retire/dispose them separately via the graceful path).
   */
  _buildVoicePool() {
    if (!this._fxHead) {
      console.warn('AuxVoice: _buildVoicePool called before fx chain exists');
      return;
    }
    const SynthClass = this._getSynthClass(this.config.synthType);
    const poolSize = this.config.mode === 'poly' ? POLY_POOL_SIZE : MONO_POOL_SIZE;

    this._voices = [];
    for (let i = 0; i < poolSize; i++) {
      let synth;
      try {
        synth = new SynthClass(this.config.synthOptions || {});
      } catch (e) {
        console.warn(`AuxVoice: voice ${i} synth options rejected, using defaults`, e.message);
        synth = new SynthClass();
      }
      synth.connect(this._fxHead);
      this._voices.push({ synth, freq: null });
    }
    this._voiceCursor = 0;
    // Back-compat reference for any external code that looked at `_synth`.
    this._synth = this._voices[0]?.synth ?? null;
  }

  _disposeChain() {
    for (const voice of this._voices) {
      try { voice.synth.triggerRelease && voice.synth.triggerRelease(Tone.now()); } catch {}
      try { voice.synth.disconnect(); } catch {}
      try { voice.synth.dispose(); } catch {}
    }
    this._voices = [];
    this._synth = null;
    this._fxHead = null;

    for (const fx of this._effects) {
      try { fx.disconnect(); } catch {}
      try { fx.dispose(); } catch {}
    }
    this._effects = [];

    if (this._gain) {
      try { this._gain.disconnect(); } catch {}
      try { this._gain.dispose(); } catch {}
      this._gain = null;
    }
  }

  _getSynthClass(type) {
    const map = {
      'Synth': Tone.Synth,
      'FMSynth': Tone.FMSynth,
      'AMSynth': Tone.AMSynth,
      'MonoSynth': Tone.MonoSynth,
      'MembraneSynth': Tone.MembraneSynth,
      'MetalSynth': Tone.MetalSynth,
      'PluckSynth': Tone.PluckSynth,
    };
    return map[type] || Tone.Synth;
  }

  _createEffect(fx) {
    const { type, wet, options } = fx;
    let effect;
    try {
      switch (type) {
        case 'Filter': effect = new Tone.Filter(options.frequency, options.type, options.rolloff); if (options.Q !== undefined) effect.Q.value = options.Q; break;
        case 'EQ3': effect = new Tone.EQ3(options.low, options.mid, options.high); effect.lowFrequency.value = options.lowFrequency || 400; effect.highFrequency.value = options.highFrequency || 2500; break;
        case 'Reverb': effect = new Tone.Reverb(options); break;
        case 'FeedbackDelay': effect = new Tone.FeedbackDelay(options.delayTime, options.feedback); break;
        case 'Chorus': effect = new Tone.Chorus(options).start(); break;
        case 'Distortion': effect = new Tone.Distortion(options); break;
        case 'Phaser': effect = new Tone.Phaser(options); break;
        case 'PingPongDelay': effect = new Tone.PingPongDelay(options); break;
        case 'Tremolo': effect = new Tone.Tremolo(options).start(); break;
        case 'AutoFilter': effect = new Tone.AutoFilter(options).start(); break;
        case 'BitCrusher': effect = new Tone.BitCrusher(options); break;
        case 'Freeverb': effect = new Tone.Freeverb(options); break;
        default: return null;
      }
      if (wet !== undefined && effect.wet) effect.wet.value = wet;
      effect._fxType = type;
    } catch (e) {
      console.warn(`AuxVoice: failed to create effect ${type}`, e);
      return null;
    }
    return effect;
  }

  dispose() {
    this.release();
    this._disposeChain();
    this._initialized = false;
  }
}
