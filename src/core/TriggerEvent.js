/**
 * Data class representing a trigger event from a generator.
 * These flow through the OutputRouter to produce sound.
 */
export class TriggerEvent {
  /**
   * @param {object} opts
   * @param {string} opts.generatorId - Which generator produced this event
   * @param {number} opts.triggerId - Index of the triggering element (node, particle, etc.)
   * @param {number} opts.rawValue - Normalized 0.0–1.0 value for pitch mapping
   * @param {number} opts.velocity - Normalized 0.0–1.0 intensity (maps to volume/MIDI velocity)
   * @param {{x: number, y: number, z?: number}} opts.position - World-space position for visual feedback
   * @param {number} [opts.timestamp] - performance.now() at trigger time
   */
  constructor({ generatorId, triggerId, rawValue, velocity, position, timestamp, orbitIndex, nodeIndex }) {
    this.generatorId = generatorId;
    this.triggerId = triggerId;
    this.rawValue = rawValue;
    this.velocity = velocity;
    this.position = position;
    this.timestamp = timestamp ?? performance.now();
    this.orbitIndex = orbitIndex ?? 0;
    this.nodeIndex = nodeIndex ?? 0;
  }
}
