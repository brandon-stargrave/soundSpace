/**
 * Abstract base class for all audiovisual generator modules.
 * Each generator owns its own Three.js objects, runs its own
 * physics/simulation, and emits TriggerEvents to the OutputRouter.
 */
export class Generator {
  /**
   * @param {string} name - Display name for this generator type
   * @param {import('../visual/SceneManager.js').SceneManager} sceneManager
   * @param {import('./OutputRouter.js').OutputRouter} outputRouter
   */
  constructor(name, sceneManager, outputRouter) {
    this.name = name;
    this.id = `${name}-${Date.now()}`;
    this.sceneManager = sceneManager;
    this.outputRouter = outputRouter;
    this.params = {};
  }

  /**
   * Initialize the generator: create Three.js objects, set up state.
   * Called once when the generator is added to the engine.
   */
  init() {
    throw new Error('Generator.init() must be implemented by subclass');
  }

  /**
   * Advance the simulation by deltaTime seconds.
   * Detect trigger conditions and emit TriggerEvents.
   * Update visual elements.
   * @param {number} deltaTime - Time elapsed since last frame (seconds)
   */
  update(deltaTime) {
    throw new Error('Generator.update() must be implemented by subclass');
  }

  /**
   * Remove all Three.js objects and clean up resources.
   */
  dispose() {
    throw new Error('Generator.dispose() must be implemented by subclass');
  }

  /**
   * Return parameter descriptors for auto-generating UI controls.
   * @returns {Array<{key: string, label: string, type: string, min?: number, max?: number, step?: number, value: any, options?: Array}>}
   */
  getParams() {
    return [];
  }

  /**
   * Update a runtime parameter by key.
   * @param {string} key
   * @param {any} value
   */
  setParam(key, value) {
    if (key in this.params) {
      this.params[key] = value;
    }
    // Always call onParamChange — subclasses route prefixed keys (algo.*, trig.*)
    this.onParamChange(key, value);
  }

  /**
   * Called when a parameter changes. Override to handle rebuilds.
   * @param {string} key
   * @param {any} value
   */
  onParamChange(key, value) {
    // Default: no-op. Subclasses override for params that need visual rebuild.
  }

  /**
   * Serialize generator state for save/load.
   * @returns {object}
   */
  serialize() {
    return {
      type: this.constructor.name,
      params: { ...this.params },
    };
  }

  /**
   * Restore generator state from saved data.
   * @param {object} data
   */
  deserialize(data) {
    if (data.params) {
      for (const [key, value] of Object.entries(data.params)) {
        this.setParam(key, value);
      }
    }
  }
}
