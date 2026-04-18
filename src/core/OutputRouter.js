/**
 * Routes TriggerEvents through the ScaleQuantizer
 * and fans them out to all registered outputs.
 */
export class OutputRouter {
  constructor(scaleQuantizer) {
    this.scaleQuantizer = scaleQuantizer;
    this.outputs = [];
  }

  /** Register an output (ToneOutput, MidiOutput, OscOutput) */
  addOutput(output) {
    if (!this.outputs.includes(output)) {
      this.outputs.push(output);
    }
  }

  /** Remove a registered output */
  removeOutput(output) {
    const idx = this.outputs.indexOf(output);
    if (idx !== -1) this.outputs.splice(idx, 1);
  }

  /**
   * Route a trigger event: quantize and send to all outputs.
   * @param {TriggerEvent} triggerEvent
   */
  route(triggerEvent) {
    const quantized = this.scaleQuantizer.quantize(triggerEvent.rawValue);

    for (const output of this.outputs) {
      if (output.enabled) {
        try {
          output.send(triggerEvent, quantized);
        } catch (e) {
          console.warn('OutputRouter: output error', e);
        }
      }
    }

    return quantized;
  }
}
