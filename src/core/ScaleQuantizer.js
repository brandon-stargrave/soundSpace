import { SCALES, NOTE_NAMES, NOTE_NAME_TO_SEMITONE, DEFAULT_SCALE_CONFIG } from '../util/constants.js';
import { clamp } from '../util/math.js';

/**
 * Maps a normalized rawValue (0–1) to a musical pitch
 * within a configured scale, root note, and octave range.
 */
export class ScaleQuantizer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_SCALE_CONFIG, ...config };
    // Runtime key change from the Harmonic Orbit, in semitones (-6..5). Not
    // part of the config, so presets keep the orbit's own key.
    this._transpose = 0;
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

  /** Shift every note by `semitones` (a Harmonic Orbit key change); 0 is the orbit's own key. */
  setTranspose(semitones) {
    if (semitones === this._transpose) return;
    this._transpose = semitones;
    this._buildNoteTable();
  }

  getTranspose() {
    return this._transpose;
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
    const { root, scaleType, customDegrees } = this.config;
    // An inverted range (low above high) is read the right way round
    const low = Math.min(this.config.octaveLow, this.config.octaveHigh);
    const high = Math.max(this.config.octaveLow, this.config.octaveHigh);
    const rootSemitone = (NOTE_NAME_TO_SEMITONE[root] ?? 0) + this._transpose;
    const degrees = scaleType === 'custom' && customDegrees?.length
      ? customDegrees
      : (SCALES[scaleType] || SCALES.pentatonic_minor);

    const notes = [];
    for (let oct = low; oct <= high; oct++) {
      for (const degree of degrees) notes.push((oct + 1) * 12 + rootSemitone + degree);
    }
    // End the range on the tonic, so the top of the ring resolves home
    notes.push((high + 2) * 12 + rootSemitone);
    this._noteTable = [...new Set(notes.filter(n => n >= 0 && n <= 127))].sort((a, b) => a - b);
  }

  _mapToIndex(rawValue, tableLength) {
    switch (this.config.mappingMode) {
      case 'wrap':
        // Two passes: each half of the input range climbs the whole scale
        return Math.min(tableLength - 1, Math.floor(((rawValue * 2) % 1) * tableLength));
      case 'nearest':
        return clamp(Math.round(rawValue * (tableLength - 1)), 0, tableLength - 1);
      case 'random_in_scale':
        return Math.floor(Math.random() * tableLength);
      case 'linear':
      default:
        return clamp(Math.floor(rawValue * tableLength), 0, tableLength - 1);
    }
  }
}
