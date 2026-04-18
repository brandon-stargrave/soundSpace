/**
 * Base class for note mapping strategies.
 * Maps trigger events to rawValue (0-1) for pitch quantization.
 */
export class NoteMapping {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.params = {};
  }

  init(nodes, generatorParams) {}

  /**
   * Map a trigger descriptor to a rawValue in [0, 1].
   * @param {object} trig - { nodeIndexA, nodeIndexB?, rawValue, velocity, position }
   * @param {Array} nodes - Current node state
   * @param {object} generatorParams
   * @returns {number} rawValue 0-1
   */
  mapValue(trig, nodes, generatorParams) {
    return trig.rawValue;
  }

  getParams() { return []; }

  setParam(key, value) {
    if (key in this.params) {
      this.params[key] = value;
      this.onParamChange(key, value);
    }
  }

  onParamChange(key, value) {}

  serialize() { return { id: this.id, params: { ...this.params } }; }

  deserialize(data) {
    if (data.params) {
      for (const [k, v] of Object.entries(data.params)) {
        this.setParam(k, v);
      }
    }
  }

  dispose() {}
}
