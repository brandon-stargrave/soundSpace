/**
 * Routes TriggerEvents through the ScaleQuantizer
 * and fans them out to all registered outputs.
 *
 * Several nodes can meet at one point in the same frame, which triggers the
 * same pitch once per pair. Played as-is that stacks identical voices into a
 * spike on the synth and a run of zero-length notes on MIDI, so notes are
 * held until flush() at the end of the frame and each pitch plays once, at
 * the loudest velocity. Outputs with `everyEvent` (OSC, whose addresses name
 * the node) still receive every trigger as it happens.
 */
export class OutputRouter {
  constructor(scaleQuantizer) {
    this.scaleQuantizer = scaleQuantizer;
    this.outputs = [];
    // Optional check that silences this route entirely (per-orbit mute/solo)
    this.isAudible = null;
    this._pending = [];
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
    if (this.isAudible && !this.isAudible()) return quantized;

    this._send(triggerEvent, quantized, true);
    const same = this._pending.find(p => p.quantized.midiNote === quantized.midiNote);
    if (!same) {
      this._pending.push({ triggerEvent, quantized });
    } else if (triggerEvent.velocity > same.triggerEvent.velocity) {
      same.triggerEvent = triggerEvent;
      same.quantized = quantized;
    }
    return quantized;
  }

  /** Play this frame's notes: one per pitch, at the loudest velocity. */
  flush() {
    if (this._pending.length === 0) return;
    const pending = this._pending;
    this._pending = [];
    for (const { triggerEvent, quantized } of pending) this._send(triggerEvent, quantized, false);
  }

  _send(triggerEvent, quantized, everyEvent) {
    for (const output of this.outputs) {
      if (!output.enabled || !!output.everyEvent !== everyEvent) continue;
      try {
        output.send(triggerEvent, quantized);
      } catch (e) {
        console.warn('OutputRouter: output error', e);
      }
    }
  }
}
