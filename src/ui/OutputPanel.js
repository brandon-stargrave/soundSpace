import { SYNTH_TYPES, NOTE_DURATIONS } from '../util/constants.js';
import { section, divider, rangeRow, selectRow } from './controls.js';

// Note lengths are musical divisions at Tone's default 120 BPM
const DURATION_LABELS = {
  '32n': '1/32 · 63 ms',
  '16n': '1/16 · 125 ms',
  '8n': '1/8 · 250 ms',
  '4n': '1/4 · 500 ms',
  '2n': '1/2 · 1 s',
  '1n': 'Whole · 2 s',
};

const SYNTH_LABELS = {
  Synth: 'Basic',
  FMSynth: 'FM',
  AMSynth: 'AM',
  MonoSynth: 'Mono (filtered)',
  MembraneSynth: 'Membrane (drum)',
  MetalSynth: 'Metal (bell)',
  PluckSynth: 'Pluck (string)',
};

const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`);
const pct = (v) => `${Math.round(v * 100)}%`;
const db = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
const sec = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);

/**
 * Per-orbit synth controls: voice type, note length, level, envelope, and
 * the effects chain.
 */
export class OutputPanel {
  constructor(toneOutput) {
    this.toneOutput = toneOutput;
    this.el = null;
  }

  render() {
    const { el, body } = section('Synth', { open: true });
    const out = this.toneOutput;
    const cfg = out.getConfig();

    body.appendChild(selectRow({
      label: 'Voice',
      options: SYNTH_TYPES,
      labels: SYNTH_LABELS,
      value: cfg.synthType,
      onChange: (val) => out.setConfig({ synthType: val }),
    }));
    body.appendChild(selectRow({
      label: 'Note Length',
      options: NOTE_DURATIONS,
      labels: DURATION_LABELS,
      value: cfg.noteDuration,
      onChange: (val) => out.setConfig({ noteDuration: val }),
    }));
    body.appendChild(rangeRow({
      label: 'Level', min: 0.1, max: 1.5, step: 0.05, value: cfg.velocityScale, format: pct,
      onInput: (val) => out.setConfig({ velocityScale: val }),
    }));

    // Envelope
    const env = cfg.synthOptions?.envelope || {};
    body.appendChild(divider('Envelope'));
    const envRow = (label, key, min, max, step, fallback, format = sec) => rangeRow({
      label, min, max, step, value: env[key] ?? fallback, format,
      onInput: (val) => out.setConfig({ synthOptions: { envelope: { [key]: val } } }),
    });
    body.appendChild(envRow('Attack', 'attack', 0.001, 1, 0.001, 0.005));
    body.appendChild(envRow('Decay', 'decay', 0.01, 2, 0.01, 0.3));
    body.appendChild(envRow('Sustain', 'sustain', 0, 1, 0.01, 0.1, pct));
    body.appendChild(envRow('Release', 'release', 0.01, 4, 0.01, 0.8));

    const fx = (type) => cfg.effects.find(f => f.type === type);
    const set = (type, key) => (val) => out.setEffectParam(type, key, val);

    const filter = fx('Filter');
    if (filter) {
      body.appendChild(divider('Filter'));
      body.appendChild(rangeRow({
        label: 'Cutoff', min: 20, max: 20000, step: 1, scale: 'log', format: hz,
        value: filter.options.frequency ?? 2000, onInput: set('Filter', 'frequency'),
      }));
      body.appendChild(selectRow({
        label: 'Type', options: ['lowpass', 'highpass', 'bandpass', 'notch'],
        labels: { lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', notch: 'Notch' },
        value: filter.options.type || 'lowpass', onChange: set('Filter', 'type'),
      }));
      body.appendChild(rangeRow({
        label: 'Resonance', min: 0.1, max: 12, step: 0.1, format: (v) => `${v.toFixed(1)} dB`,
        help: 'Peak at the cutoff. Capped so steep slopes can\'t produce a blast of volume.',
        value: Math.min(filter.options.Q ?? 1, 12), onInput: set('Filter', 'Q'),
      }));
      body.appendChild(selectRow({
        label: 'Slope', options: ['-12', '-24', '-48', '-96'],
        labels: { '-12': '12 dB/oct', '-24': '24 dB/oct', '-48': '48 dB/oct', '-96': '96 dB/oct' },
        value: String(filter.options.rolloff || -12), onChange: (val) => out.setEffectParam('Filter', 'rolloff', parseInt(val, 10)),
      }));
    }

    const chorus = fx('Chorus');
    if (chorus) {
      body.appendChild(divider('Chorus'));
      body.appendChild(rangeRow({ label: 'Mix', min: 0, max: 1, step: 0.01, format: pct, value: chorus.wet ?? 0.3, onInput: set('Chorus', 'wet') }));
      body.appendChild(rangeRow({ label: 'Rate', min: 0.1, max: 10, step: 0.1, unit: 'Hz', value: chorus.options.frequency ?? 1.5, onInput: set('Chorus', 'frequency') }));
      body.appendChild(rangeRow({ label: 'Delay', min: 0.5, max: 20, step: 0.5, unit: 'ms', value: chorus.options.delayTime ?? 3.5, onInput: set('Chorus', 'delayTime') }));
      body.appendChild(rangeRow({ label: 'Depth', min: 0, max: 1, step: 0.05, format: pct, value: chorus.options.depth ?? 0.7, onInput: set('Chorus', 'depth') }));
    }

    const reverb = fx('Reverb');
    if (reverb) {
      body.appendChild(divider('Reverb'));
      body.appendChild(rangeRow({ label: 'Mix', min: 0, max: 1, step: 0.01, format: pct, value: reverb.wet ?? 0.4, onInput: set('Reverb', 'wet') }));
      body.appendChild(rangeRow({ label: 'Decay', min: 0.1, max: 10, step: 0.1, format: sec, value: reverb.options.decay ?? 2.5, onInput: set('Reverb', 'decay') }));
      body.appendChild(rangeRow({ label: 'Pre-Delay', min: 0, max: 0.1, step: 0.001, format: sec, value: reverb.options.preDelay ?? 0.01, onInput: set('Reverb', 'preDelay') }));
    }

    const delay = cfg.effects.find(f => f.type === 'FeedbackDelay' || f.type === 'PingPongDelay');
    if (delay) {
      body.appendChild(divider('Delay'));
      const dlyType = delay.type;
      body.appendChild(selectRow({
        label: 'Type', options: ['FeedbackDelay', 'PingPongDelay'],
        labels: { FeedbackDelay: 'Straight', PingPongDelay: 'Ping-pong' },
        value: dlyType, onChange: (val) => out.swapDelayType(val),
      }));
      body.appendChild(rangeRow({ label: 'Mix', min: 0, max: 1, step: 0.01, format: pct, value: delay.wet ?? 0.2, onInput: set(dlyType, 'wet') }));
      body.appendChild(rangeRow({ label: 'Feedback', min: 0, max: 0.9, step: 0.01, format: pct, value: delay.options.feedback ?? 0.3, onInput: set(dlyType, 'feedback') }));

      const currentTime = delay.options.delayTime ?? '8n';
      const synced = NOTE_DURATIONS.includes(currentTime);
      const freeRow = rangeRow({
        label: 'Time', min: 0.01, max: 2, step: 0.01, format: sec,
        value: typeof currentTime === 'number' ? currentTime : 0.25,
        onInput: set(dlyType, 'delayTime'),
      });
      freeRow.hidden = synced;
      body.appendChild(selectRow({
        label: 'Sync', options: ['free', ...NOTE_DURATIONS],
        labels: { free: 'Free time', ...DURATION_LABELS },
        value: synced ? currentTime : 'free',
        onChange: (val) => {
          freeRow.hidden = val !== 'free';
          out.setEffectParam(dlyType, 'delayTime', val === 'free' ? parseFloat(freeRow.input.value) : val);
        },
      }));
      body.appendChild(freeRow);
    }

    const eq = fx('EQ3');
    if (eq) {
      body.appendChild(divider('EQ'));
      body.appendChild(rangeRow({ label: 'Low', min: -12, max: 12, step: 0.5, format: db, value: eq.options.low ?? 0, onInput: set('EQ3', 'low') }));
      body.appendChild(rangeRow({ label: 'Mid', min: -12, max: 12, step: 0.5, format: db, value: eq.options.mid ?? 0, onInput: set('EQ3', 'mid') }));
      body.appendChild(rangeRow({ label: 'High', min: -12, max: 12, step: 0.5, format: db, value: eq.options.high ?? 0, onInput: set('EQ3', 'high') }));
      body.appendChild(rangeRow({ label: 'Low/Mid', min: 60, max: 1000, step: 1, scale: 'log', format: hz, value: eq.options.lowFrequency ?? 400, onInput: set('EQ3', 'lowFrequency') }));
      body.appendChild(rangeRow({ label: 'Mid/High', min: 1000, max: 12000, step: 10, scale: 'log', format: hz, value: eq.options.highFrequency ?? 2500, onInput: set('EQ3', 'highFrequency') }));
    }

    this.el = el;
    return el;
  }
}
