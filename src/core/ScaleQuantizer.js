import { SCALES, NOTE_NAMES, NOTE_NAME_TO_SEMITONE, DEFAULT_SCALE_CONFIG } from '../util/constants.js';
import { clamp } from '../util/math.js';

/**
 * Maps a normalized rawValue (0–1) to a musical pitch
 * within a configured scale, root note, and octave range.
 */
export class ScaleQuantizer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_SCALE_CONFIG, ...config };
    this._noteTable = [];
    this._buildNoteTable();
  }

  /**
   * Quantize a raw 0–1 value to a musical pitch.
   * @param {number} rawValue - Normalized 0.0–1.0
   * @returns {{ midiNote: number, frequency: number, noteName: string, octave: number, degree: number }}
   */
  quantize(rawValue) {
    const table = this._noteTable;
    if (table.length === 0) {
      return { midiNote: 60, frequency: 261.63, noteName: 'C4', octave: 4, degree: 0 };
    }

    const clamped = clamp(rawValue, 0, 1);
    const index = this._mapToIndex(clamped, table.length);
    const midiNote = table[index];
    const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);
    const noteNameBase = NOTE_NAMES[midiNote % 12];
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = `${noteNameBase}${octave}`;

    return { midiNote, frequency, noteName, octave, degree: index };
  }

  /** Update configuration and rebuild the note table */
  setConfig(updates) {
    Object.assign(this.config, updates);
    this._buildNoteTable();
  }

  /** Convenience: change only the root note name (e.g. 'C', 'F#'). */
  setRoot(newRoot) {
    this.setConfig({ root: newRoot });
  }

  /** Get current config (for serialization) */
  getConfig() {
    return { ...this.config };
  }

  /** Get the current note table (for UI display) */
  getNoteTable() {
    return [...this._noteTable];
  }

  _buildNoteTable() {
    const { root, scaleType, octaveLow, octaveHigh, customDegrees } = this.config;
    const rootSemitone = NOTE_NAME_TO_SEMITONE[root] ?? 0;
    const degrees = scaleType === 'custom' && customDegrees
      ? customDegrees
      : (SCALES[scaleType] || SCALES.pentatonic_minor);

    this._noteTable = [];
    for (let oct = octaveLow; oct <= octaveHigh; oct++) {
      for (const degree of degrees) {
        const midiNote = (oct + 1) * 12 + rootSemitone + degree;
        if (midiNote >= 0 && midiNote <= 127) {
          this._noteTable.push(midiNote);
        }
      }
    }
    this._noteTable.sort((a, b) => a - b);
    // Remove duplicates
    this._noteTable = [...new Set(this._noteTable)];
  }

  _mapToIndex(rawValue, tableLength) {
    switch (this.config.mappingMode) {
      case 'linear':
        return clamp(Math.floor(rawValue * tableLength), 0, tableLength - 1);
      case 'wrap':
        return Math.floor(rawValue * tableLength) % tableLength;
      case 'nearest':
        return clamp(Math.round(rawValue * (tableLength - 1)), 0, tableLength - 1);
      case 'random_in_scale':
        return Math.floor(Math.random() * tableLength);
      default:
        return clamp(Math.floor(rawValue * tableLength), 0, tableLength - 1);
    }
  }
}
