import { section, divider, rangeRow, toggleRow } from './controls.js';

const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * Scene-wide visual controls (not per-orbit): bloom, motion trails,
 * vignette, chromatic aberration, nebula spin and calm visuals. Everything
 * here except Calm is saved with presets.
 */
export class PostFXPanel {
  constructor(sceneManager, engine) {
    this.sm = sceneManager;
    this.engine = engine;
    this.el = null;
  }

  render() {
    const { el, body } = section('Visuals');
    const v = this.engine.getVisualSettings();
    const set = (key) => (val) => this.engine.setVisualSettings({ [key]: val });

    body.appendChild(toggleRow({
      label: 'Calm visuals',
      value: this.engine.calmVisuals,
      help: 'Turns off chromatic aberration and shooting stars and softens light pulses. On by default when your system asks for reduced motion.',
      onChange: (val) => this.engine.setCalmVisuals(val),
    }));

    body.appendChild(divider('Bloom'));
    body.appendChild(rangeRow({ label: 'Strength', min: 0, max: 2, step: 0.05, value: v.bloomStrength, onInput: set('bloomStrength') }));
    body.appendChild(rangeRow({ label: 'Radius', min: 0, max: 1, step: 0.05, value: v.bloomRadius, onInput: set('bloomRadius') }));
    body.appendChild(rangeRow({
      label: 'Threshold', min: 0, max: 1, step: 0.05, value: v.bloomThreshold, onInput: set('bloomThreshold'),
      help: 'How bright something must be to glow. Lower it for more glow everywhere.',
    }));

    body.appendChild(divider('Scene'));
    body.appendChild(rangeRow({ label: 'Motion Trails', min: 0, max: 0.95, step: 0.01, format: pct, value: v.trails, onInput: set('trails') }));
    body.appendChild(rangeRow({
      label: 'Nebula Spin', min: 0, max: 0.15, step: 0.005, value: v.spinSpeed, onInput: set('spinSpeed'),
      help: 'Rotation of the central nebula and the orbit rings, shared by every orbit.',
    }));
    body.appendChild(rangeRow({ label: 'Vignette', min: 0, max: 1.5, step: 0.05, value: v.vignetteDarkness, onInput: set('vignetteDarkness') }));
    body.appendChild(rangeRow({ label: 'Vignette Size', min: 0.5, max: 2, step: 0.05, value: v.vignetteOffset, onInput: set('vignetteOffset') }));

    body.appendChild(divider('On each note'));
    body.appendChild(rangeRow({
      label: 'Color Split', min: 0, max: 1, step: 0.05, format: pct, value: v.chromaticIntensity, onInput: set('chromaticIntensity'),
      help: 'Chromatic aberration flash when a note plays.',
    }));
    body.appendChild(toggleRow({
      label: 'Crossing Flash', value: v.crossingFlash, onChange: set('crossingFlash'),
      help: 'A soft flash in the two nodes\' mixed color where they cross.',
    }));

    this.el = el;
    return el;
  }
}
