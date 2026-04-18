/**
 * Base class for motion algorithms that drive node speeds over time.
 * Each algorithm computes per-node absolute speeds each frame,
 * replacing the static speed calculation in OrbitalNodes.
 */
export class MotionAlgorithm {
  /**
   * @param {string} name - Display name for UI dropdown
   * @param {string} id   - Machine identifier
   */
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.params = {};
    this._elapsedTime = 0;
    this._speedBuffer = null;
  }

  /**
   * Called when the algorithm is activated or nodes are rebuilt.
   * @param {Array} nodes - The node array from OrbitalNodes
   * @param {object} generatorParams - OrbitalNodes params
   */
  init(nodes, generatorParams) {
    this._elapsedTime = 0;
    this._speedBuffer = new Float64Array(nodes.length);
  }

  /**
   * Compute per-node speeds for this frame.
   * Returns an array of absolute angular velocities (rad/s).
   * @param {number} deltaTime - Seconds since last frame
   * @param {Array} nodes - Current node state
   * @param {object} generatorParams
   * @returns {Float64Array} One speed value per node
   */
  computeSpeeds(deltaTime, nodes, generatorParams) {
    this._elapsedTime += deltaTime;
    throw new Error('computeSpeeds must be implemented');
  }

  /**
   * Return parameter descriptors for this algorithm's UI controls.
   * @returns {Array<{key, label, type, min?, max?, step?, value, options?}>}
   */
  getParams() {
    return [];
  }

  /** Update a parameter value */
  setParam(key, value) {
    if (key in this.params) {
      this.params[key] = value;
      this.onParamChange(key, value);
    }
  }

  /** Override for reactive behavior on param changes */
  onParamChange(key, value) {}

  /** Serialize for presets */
  serialize() {
    return { id: this.id, params: { ...this.params } };
  }

  /** Restore from saved state */
  deserialize(data) {
    if (data.params) {
      for (const [k, v] of Object.entries(data.params)) {
        this.setParam(k, v);
      }
    }
  }

  /** Cleanup when switching away */
  dispose() {}
}
