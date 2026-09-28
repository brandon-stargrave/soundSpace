import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { sanitizePreset, PresetError } from '../src/core/presetSchema.js';
import { encodeOSCMessage } from '../server/osc.js';

const ctx = {
  motionIds: ['phaseDrift', 'harmonicRatios', 'goldenSpiral'],
  triggerIds: ['nodeCollision', 'staticPins', 'zoneTriggers'],
  mappingIds: ['angle', 'nodeIndex', 'velocity', 'phaseOffset', 'cumulativePhase', 'density', 'energy', 'relativePosition'],
  describe: () => [{ key: 'cooldownMs', type: 'range', min: 0, max: 500, step: 10 }],
};

test('every bundled preset passes validation without warnings', () => {
  const dir = new URL('../presets/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const data = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    const { preset, warnings } = sanitizePreset(data, ctx);
    assert.ok(preset.orbits.length >= 1, file);
    assert.deepEqual(warnings, [], file);
  }
});

test('things that are not presets are rejected before anything changes', () => {
  for (const bad of [null, 'text', 42, {}, { orbits: [] }, { orbits: [null, 5] }, { app: 'other', orbits: [{ generator: {} }] }]) {
    assert.throws(() => sanitizePreset(bad, ctx), PresetError);
  }
});

test('hostile values are clamped, unknown plugins fall back', () => {
  const { preset, warnings } = sanitizePreset({
    orbits: [{
      generator: { params: { nodeCount: 1e9, radius: -5, speedRatios: [1e9, 'x'] }, triggerMethod: { id: 'nope' } },
      scale: { octaveLow: 8, octaveHigh: 1, root: 'Bb', scaleType: 'custom' },
      synth: { synthType: 'Evil', effects: [{ type: 'Reverb', options: { decay: 1e6 } }, { type: 'FeedbackDelay', options: { feedback: 5 } }, { type: 'Script' }] },
    }],
    harmonic: { params: { sides: 1000, enabled: 'yes' } },
    io: { osc: { wsHost: 'evil.com/<script>', wsPort: 99999 } },
  }, ctx);
  const o = preset.orbits[0];
  assert.equal(o.generator.params.nodeCount, 16);
  assert.equal(o.generator.params.radius, 0.5);
  assert.equal(o.generator.params.speedRatios[0], 64);
  assert.equal(o.generator.params.triggerMethod, 'nodeCollision');
  assert.equal(o.scale.root, 'A#');
  assert.deepEqual([o.scale.octaveLow, o.scale.octaveHigh], [1, 8]);
  assert.equal(o.scale.scaleType, 'pentatonic_minor', 'custom without notes falls back');
  assert.equal(o.synth.synthType, 'Synth');
  assert.deepEqual(o.synth.effects.map(e => e.type), ['Reverb', 'FeedbackDelay']);
  assert.equal(o.synth.effects[0].options.decay, 12);
  assert.equal(o.synth.effects[1].options.feedback, 0.95);
  assert.equal(preset.harmonic.params.sides, 12);
  assert.equal('enabled' in preset.harmonic.params, false);
  assert.equal(preset.io.osc.wsHost, undefined);
  assert.equal(preset.io.osc.wsPort, 65535);
  assert.equal(warnings.length, 1);
});

test('the original single-orbit format still loads', () => {
  const { preset } = sanitizePreset({
    generators: [{ params: { nodeCount: 7 } }],
    scale: { root: 'D' },
    synth: { synthType: 'FMSynth' },
  }, ctx);
  assert.equal(preset.orbits.length, 1);
  assert.equal(preset.orbits[0].generator.params.nodeCount, 7);
});

test('OSC messages encode to the OSC 1.0 byte layout', () => {
  const packet = encodeOSCMessage({ address: '/a', args: [{ type: 'i', value: 1 }, { type: 'f', value: 0.5 }, { type: 's', value: 'hi' }] });
  const expected = Buffer.concat([
    Buffer.from('/a\0\0'),
    Buffer.from(',ifs\0\0\0\0'),
    Buffer.from([0, 0, 0, 1]),
    Buffer.from([0x3f, 0, 0, 0]),
    Buffer.from('hi\0\0'),
  ]);
  assert.deepEqual(packet, expected);
  assert.equal(encodeOSCMessage({ address: 'no-slash' }), null);
  assert.equal(encodeOSCMessage({ address: '/x', args: [{ type: 'i', value: NaN }] }), null);
  assert.equal(encodeOSCMessage({ address: '/x', args: [{ type: 'b', value: 1 }] }), null);
  assert.equal(encodeOSCMessage({ address: '/x', args: [{ type: 'i', value: 1e12 }] }).readInt32BE(8), 0x7fffffff);
});
