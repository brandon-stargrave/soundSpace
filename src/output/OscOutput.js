/**
 * OSC output via WebSocket to the companion Node.js server.
 * The server relays messages as UDP/OSC packets.
 */
export class OscOutput {
  constructor() {
    this.enabled = false;
    this.ws = null;
    this._reconnectTimer = null;
    this.config = {
      wsHost: 'localhost',
      wsPort: 8080,
      addressPattern: '/soundspace/note',
      sendArgs: ['midiNote', 'velocity', 'rawValue', 'generatorId'],
    };
  }

  /** Connect to the WebSocket relay server */
  connect() {
    this.disconnect();

    const url = `ws://${this.config.wsHost}:${this.config.wsPort}`;
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('OscOutput: WebSocket connected');
        this._clearReconnect();
      };

      this.ws.onclose = () => {
        console.log('OscOutput: WebSocket closed');
        if (this.enabled) this._scheduleReconnect();
      };

      this.ws.onerror = (e) => {
        console.warn('OscOutput: WebSocket error');
      };
    } catch (e) {
      console.warn('OscOutput: failed to connect', e);
      if (this.enabled) this._scheduleReconnect();
    }
  }

  /** Disconnect from the WebSocket server */
  disconnect() {
    this._clearReconnect();
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send a trigger event as an OSC message */
  send(triggerEvent, quantized) {
    if (!this.enabled || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Per-orbit/node address: /soundspace/orbit1/node3/note
    const orbitNum = (triggerEvent.orbitIndex || 0) + 1;
    const nodeNum = (triggerEvent.nodeIndex || 0) + 1;
    const address = `/soundspace/orbit${orbitNum}/node${nodeNum}/note`;

    const msg = {
      address,
      args: this._buildArgs(triggerEvent, quantized),
    };

    try {
      this.ws.send(JSON.stringify(msg));
    } catch (e) {
      console.warn('OscOutput: send failed', e);
    }
  }

  /**
   * Emit a harmonic-orbit transpose event over OSC.
   * Sends to /soundspace/harmonic/<voiceId> with the current held notes.
   * @param {string} voiceId - 'pad' | 'bass'
   * @param {string} rootName - e.g. 'C', 'F#'
   * @param {number[]} midiNotes - held note numbers
   * @param {number[]} frequencies - held frequencies (Hz)
   */
  sendHarmonicHold(voiceId, rootName, midiNotes, frequencies) {
    if (!this.enabled || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const address = `/soundspace/harmonic/${voiceId}`;
    const args = [
      { type: 's', value: rootName },
      { type: 'i', value: midiNotes.length },
    ];
    for (const n of midiNotes) args.push({ type: 'i', value: n });
    for (const f of frequencies) args.push({ type: 'f', value: f });

    try {
      this.ws.send(JSON.stringify({ address, args }));
    } catch (e) {
      console.warn('OscOutput: harmonic send failed', e);
    }
  }

  /** Emit a /soundspace/harmonic/transpose event with the new root note. */
  sendHarmonicTranspose(rootName, rootMidi) {
    if (!this.enabled || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({
        address: '/soundspace/harmonic/transpose',
        args: [
          { type: 's', value: rootName },
          { type: 'i', value: rootMidi },
        ],
      }));
    } catch {}
  }

  _buildArgs(triggerEvent, quantized) {
    const argMap = {
      midiNote: { type: 'i', value: quantized.midiNote },
      frequency: { type: 'f', value: quantized.frequency },
      velocity: { type: 'f', value: triggerEvent.velocity },
      rawValue: { type: 'f', value: triggerEvent.rawValue },
      generatorId: { type: 's', value: triggerEvent.generatorId },
      noteName: { type: 's', value: quantized.noteName },
    };

    return this.config.sendArgs
      .map(key => argMap[key])
      .filter(Boolean);
  }

  _scheduleReconnect() {
    this._clearReconnect();
    this._reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  setConfig(updates) {
    Object.assign(this.config, updates);
  }

  getConfig() {
    return { ...this.config };
  }

  dispose() {
    this.disconnect();
  }
}
