import { NoteMapping } from './NoteMapping.js';

/**
 * Pitch from the trigger's angular position on the orbit ring.
 * The natural default — different positions produce different notes.
 */
export class AngleMapping extends NoteMapping {
  constructor() {
    super('Angle', 'angle');
  }

  mapValue(trig, nodes, generatorParams) {
    // Use the trigger's natural rawValue (already angle-based)
    return trig.rawValue;
  }
}
