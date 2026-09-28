// Unit tests for the pure modules. Run with `npm test` (Node's built-in runner, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countPasses, circularMidpoint, euclideanPattern } from '../src/util/math.js';
import { parentScale, diatonicChord, voiceChord, voiceChordInRegister, nearestOffset, bassNote, hasFlatSeven } from '../src/core/harmony.js';
import { ProgressionWalker } from '../src/core/ProgressionWalker.js';
import { ScaleQuantizer } from '../src/core/ScaleQuantizer.js';
import { OutputRouter } from '../src/core/OutputRouter.js';
import { SCALES, NOTE_NAMES } from '../src/util/constants.js';
import { NodeCollision } from '../src/generators/triggers/NodeCollision.js';
import { HarmonicRatios } from '../src/generators/motion/HarmonicRatios.js';

const TWO_PI = Math.PI * 2;
const names = (midi) => midi.map(n => NOTE_NAMES[n % 12]).join(' ');

test('countPasses counts crossings exactly, including laps and wraparound', () => {
  assert.equal(countPasses(0.1, 0.2, 0.25), 1);
  assert.equal(countPasses(0.1, 0.1, 0.25), 0);
  assert.equal(countPasses(6.2, 0.2, 0), 1, 'forward across 2π');
  assert.equal(countPasses(0.1, -0.2, 0), 1, 'backward across 0');
  assert.equal(countPasses(0, 13, 1), 2, 'a long step laps the target twice');
  assert.equal(countPasses(0.25, 0.1, 0.25), 0, 'starting on the target was counted last step');
  assert.equal(countPasses(0.1, 0.15, 0.25), 1, 'landing exactly on the target counts');
});

test('circularMidpoint takes the short arc', () => {
  assert.ok(Math.abs(circularMidpoint(6.2, 0.1) - 0.0084) < 1e-3, 'crossing near 0 stays near 0');
  assert.ok(Math.abs(circularMidpoint(1, 2) - 1.5) < 1e-9);
});

test('euclideanPattern places exactly `pulses` onsets for every Pin Count', () => {
  for (let pins = 1; pins <= 24; pins++) {
    const steps = pins + Math.floor(pins * 0.6);
    const pattern = euclideanPattern(pins, steps);
    assert.equal(pattern.length, steps);
    assert.equal(pattern.filter(Boolean).length, pins, `pin count ${pins}`);
    assert.equal(pattern[0], true);
  }
  // Onsets are spread evenly: gaps differ by at most one step
  const onsets = euclideanPattern(5, 8).flatMap((on, i) => (on ? [i] : []));
  const gaps = onsets.map((o, i) => ((onsets[(i + 1) % onsets.length] - o + 8) % 8) || 8);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1);
});

test('parentScale maps every scale to a 7-note key', () => {
  assert.deepEqual(parentScale(SCALES.pentatonic_minor), SCALES.minor_natural);
  assert.deepEqual(parentScale(SCALES.pentatonic_major), SCALES.major);
  assert.deepEqual(parentScale(SCALES.blues), SCALES.minor_natural);
  assert.deepEqual(parentScale(SCALES.dorian), SCALES.dorian);
  for (const intervals of Object.values(SCALES)) assert.equal(parentScale(intervals).length, 7);
});

test('diatonic chords: I–V–vi–IV in C major is C, G, Am, F', () => {
  const major = SCALES.major;
  const chords = [0, 4, 5, 3].map(d => names(diatonicChord(major, d, 'triad').map(o => 60 + o)));
  assert.deepEqual(chords, ['C E G', 'G B D', 'A C E', 'F A C']);
});

test('diatonic chords on a pentatonic home use its parent key', () => {
  const parent = parentScale(SCALES.pentatonic_minor);
  const at = (degree, voicing) => names(diatonicChord(parent, degree, voicing).map(o => 60 + o));
  assert.equal(at(0, 'triad'), 'C D# G', 'i is C minor, not a stack of fourths');
  assert.equal(at(0, 'sus2'), 'C D G');
  assert.equal(at(0, 'sus4'), 'C F G');
  assert.equal(at(0, 'seventh'), 'C D# G A#');
  assert.equal(at(4, 'triad'), 'G A# D', 'v in C minor');
  assert.ok(hasFlatSeven(parent));
});

test('voiceChord keeps chords near the previous one', () => {
  const major = SCALES.major;
  let center = 67;
  let prevMean = null;
  for (const degree of [0, 4, 5, 3, 0]) {
    const notes = voiceChord(diatonicChord(major, degree, 'triad'), 60, center);
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    if (prevMean !== null) assert.ok(Math.abs(mean - prevMean) <= 4, `smooth move to degree ${degree}`);
    prevMean = mean;
    center = mean;
  }
});

test('a circle-of-fifths walk keeps the pad near its octave', () => {
  const parent = parentScale(SCALES.major);
  let center = null, key = 0, lowest = Infinity, highest = -Infinity, biggestMove = 0;
  for (let step = 0; step < 48; step++) {
    const padTonic = 60 + nearestOffset(key);
    const notes = voiceChordInRegister(diatonicChord(parent, 0, 'triad'), padTonic, center);
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    if (center !== null) biggestMove = Math.max(biggestMove, Math.abs(mean - center));
    center = mean;
    lowest = Math.min(lowest, notes[0]);
    highest = Math.max(highest, notes[notes.length - 1]);
    key = (key + 7) % 12;
  }
  // Voiced without the register limit, this walk ends up an octave lower (bottom note ~48)
  assert.ok(lowest >= 57 && highest <= 79, `pad stayed in ${lowest}-${highest}`);
  assert.ok(biggestMove <= 4, 'chords still move smoothly');
});

test('OutputRouter plays one note per pitch per frame, at the loudest velocity', () => {
  const quantizer = { quantize: (raw) => ({ midiNote: Math.round(raw * 100), frequency: 440 }) };
  const router = new OutputRouter(quantizer);
  const synth = { enabled: true, got: [], send(ev, q) { this.got.push([q.midiNote, ev.velocity]); } };
  const osc = { enabled: true, everyEvent: true, got: [], send(ev, q) { this.got.push([q.midiNote, ev.velocity]); } };
  router.addOutput(synth);
  router.addOutput(osc);
  for (const [raw, velocity] of [[0.7, 0.2], [0.7, 0.9], [0.5, 0.4], [0.7, 0.5]]) {
    router.route({ rawValue: raw, velocity });
  }
  assert.equal(synth.got.length, 0, 'held until the end of the frame');
  assert.equal(osc.got.length, 4, 'OSC hears every trigger right away');
  router.flush();
  assert.deepEqual(synth.got, [[70, 0.9], [50, 0.4]]);
  router.flush();
  assert.equal(synth.got.length, 2, 'a frame is only played once');
  router.isAudible = () => false;
  router.route({ rawValue: 0.3, velocity: 1 });
  router.flush();
  assert.equal(synth.got.length, 2, 'a muted orbit sends nothing');
  assert.equal(osc.got.length, 4);
});

test('key changes take the nearest direction', () => {
  for (let s = -24; s <= 24; s++) {
    const o = nearestOffset(s);
    assert.ok(o >= -6 && o <= 5);
    assert.equal(((o - s) % 12 + 12) % 12, 0);
  }
  assert.equal(bassNote(36, 7), 31, 'V is the G below, not the G above');
});

test('progressions return diatonic degrees, and fifths walks change key', () => {
  const pop = new ProgressionWalker('romanPopAxis');
  assert.deepEqual([1, 2, 3, 4, 5].map(() => pop.next().degreeIndex), [0, 4, 5, 3, 0]);
  const jazz = new ProgressionWalker('romanJazzii_v_I');
  assert.deepEqual([1, 2, 3].map(() => jazz.next().degreeIndex), [1, 4, 0]);
  assert.equal(new ProgressionWalker('fifthsUp').next().semitones, 7);
  const walk = new ProgressionWalker('randomWalk');
  for (let i = 0; i < 200; i++) {
    const d = walk.next().degreeIndex;
    assert.ok(d >= 0 && d <= 6);
  }
});

test('ScaleQuantizer: inverted octave range, top tonic, Two passes, transpose', () => {
  const q = new ScaleQuantizer({ octaveLow: 5, octaveHigh: 3 });
  const table = q.getNoteTable();
  assert.equal(table[0], 48, 'inverted range still starts at C3');
  assert.equal(table.at(-1), 84, 'range ends on the tonic above');

  const wrap = new ScaleQuantizer({ mappingMode: 'wrap' });
  assert.equal(wrap.quantize(0).midiNote, wrap.quantize(0.5).midiNote, 'each half starts at the bottom');
  assert.ok(wrap.quantize(0.49).midiNote > wrap.quantize(0.26).midiNote);

  const t = new ScaleQuantizer({});
  const before = t.quantize(0.3).midiNote;
  t.setTranspose(-5);
  assert.equal(t.quantize(0.3).midiNote, before - 5);
  assert.equal(t.getConfig().root, 'C', 'the saved key is unchanged');
});

test('NodeCollision catches every crossing at 10–60 fps', () => {
  // Two nodes at the fastest UI speeds, moving in opposite directions
  const speeds = [5 * 8.5, 5 * 8];
  const dirs = [1, -1];
  const MAX_STEP = 1 / 120;
  const MAX_SUBSTEPS = 8;

  for (const fps of [10, 20, 30, 60]) {
    const trigger = new NodeCollision();
    trigger.params.cooldownMs = 0;
    const nodes = speeds.map((speed, i) => ({
      angle: i * 2, prevAngle: i * 2, step: 0, speed, dir: dirs[i],
      mesh: { position: { x: 0, y: 0 } },
    }));
    let unwrapped = [nodes[0].angle, nodes[1].angle];
    let detected = 0;
    const dt = Math.min(1 / fps, 0.1);
    const frames = Math.round(4 / dt);
    for (let f = 0; f < frames; f++) {
      const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_STEP)));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        nodes.forEach((n, i) => {
          n.prevAngle = n.angle;
          n.step = n.dir * n.speed * h;
          n.angle = ((n.angle + n.step) % TWO_PI + TWO_PI) % TWO_PI;
          unwrapped[i] += n.step;
        });
        detected += trigger.detectTriggers(h, nodes, {}).length;
      }
    }
    // Exact count: how many whole laps the separation made
    const start = 0 - 2;
    const end = unwrapped[0] - unwrapped[1];
    const truth = Math.floor((end - start + (start % TWO_PI + TWO_PI) % TWO_PI) / TWO_PI);
    assert.ok(Math.abs(detected - truth) <= 1, `${fps} fps: detected ${detected}, expected ${truth}`);
  }
});

test('Harmonic Ratios stays bounded and Shuffled uses every ratio', () => {
  const algo = new HarmonicRatios();
  const nodes = Array.from({ length: 16 }, () => ({ angle: 0, speed: 0 }));
  algo.init(nodes, {});
  algo.params.morphRate = 0;
  const base = TWO_PI / algo.params.basePeriod;
  const speeds = [...algo.computeSpeeds(1 / 60, nodes, {})];
  assert.ok(Math.max(...speeds) <= base * 8 + 1e-9, 'fastest node is at most 8x the base');
  assert.ok(Math.abs(speeds[0] - base) < 1e-9, 'first node keeps the base speed');

  for (const n of [7, 14]) {
    const a = new HarmonicRatios();
    const ns = Array.from({ length: n }, () => ({ angle: 0, speed: 0 }));
    a.init(ns, {});
    a.params.spreadMode = 'random';
    a.params.morphRate = 0;
    const distinct = new Set([...a.computeSpeeds(1 / 60, ns, {})].map(v => v.toFixed(9)));
    assert.equal(distinct.size, n, `${n} nodes get ${n} different speeds`);
  }
});
