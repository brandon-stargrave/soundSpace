/**
 * Base class for trigger methods that detect when notes should fire.
 * Each method returns an array of trigger descriptors per frame.
 */
export class TriggerMethod {
  /**
   * @param {string} name - Display name for UI dropdown
   * @param {string} id   - Machine identifier
   */
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.params = {};
  }

  /**
   * Called when the trigger method is activated or nodes are rebuilt.
   * @param {Array} nodes - The node array from OrbitalNodes
   * @param {object} generatorParams - OrbitalNodes params
   * @param {THREE.Group} [sceneGroup] - For adding visual elements (pins, zones)
   */
  init(nodes, generatorParams, sceneGroup) {}

  /**
   * Detect triggers this frame.
   * Returns an array of trigger descriptors, each containing:
   *   { nodeIndexA, nodeIndexB?, rawValue, velocity, position: {x,y} }
   *
   * nodeIndexB is optional (only for pairwise triggers like collision).
   * Single-node triggers (pin, zone) use only nodeIndexA.
   *
   * @param {number} deltaTime
   * @param {Array} nodes
   * @param {object} generatorParams
   * @returns {Array<object>} triggers
   */
  detectTriggers(deltaTime, nodes, generatorParams) {
    return [];
  }

  /**
   * Called each frame for visual updates (e.g., rotating pins).
   * @param {number} deltaTime
   * @param {object} generatorParams
   */
  update(deltaTime, generatorParams) {}

  /** Return parameter descriptors for this trigger's UI controls */
  getParams() {
    return [];
  }

  setParam(key, value) {
    if (key in this.params) {
      this.params[key] = value;
      this.onParamChange(key, value);
    }
  }

  onParamChange(key, value) {}

  serialize() {
    return { id: this.id, params: { ...this.params } };
  }

  deserialize(data) {
    if (data.params) {
      for (const [k, v] of Object.entries(data.params)) {
        this.setParam(k, v);
      }
    }
  }

  /** Clean up visual elements when switching away */
  dispose() {}
}
