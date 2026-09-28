const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

/**
 * OSC output via WebSocket to the companion Node.js server.
 * The server relays messages as UDP/OSC packets.
 */
export class OscOutput {
  constructor() {
    this.enabled = false;
    this.muted = false;
    this.ws = null;
    this.status = 'off';
    this.onStatus = null;
    this._reconnectTimer = null;
    this._retryDelay = MIN_RETRY_MS;
    this.config = {
      wsHost: '127.0.0.1',
      wsPort: 8080,
      sendArgs: ['midiNote', 'velocity', 'rawValue', 'generatorId'],
    };
  }

  /**
   * Connect to the WebSocket relay (server.js). While OSC is enabled, a lost
   * or refused connection is retried with backoff (1 s, doubling to 30 s).
   * `status` is 'off' | 'connecting' | 'connected' | 'retrying' | 'blocked',
   * reported through `onStatus`.
   */
  connect() {
    this._closeSocket();
    this._clearReconnect();

    const url = `ws://${this.config.wsHost}:${this.config.wsPort}`;
    this._setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      // e.g. a ws:// URL from an https:// page, which browsers refuse outright
      this._setStatus('blocked');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this._retryDelay = MIN_RETRY_MS;
      this._setStatus('connected');
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.enabled) this._scheduleReconnect();
      else this._setStatus('off');
    };
    // Errors are followed by close, which handles the retry
    ws.onerror = () => {};
  }

  /** Close the connection and stop retrying. */
  disconnect() {
    this._clearReconnect();
    this._closeSocket();
    this._retryDelay = MIN_RETRY_MS;
    this._setStatus('off');
  }

  _closeSocket() {
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect
      this.ws.onerror = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  _setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  /** Send a trigger event as an OSC message */
  send(triggerEvent, quantized) {
    if (!this._canSend()) return;

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
    if (!this._canSend()) return;

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
    if (!this._canSend()) return;
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
      // A stable name, so receivers can tell orbits apart across reloads
      generatorId: { type: 's', value: `orbit${(triggerEvent.orbitIndex || 0) + 1}` },
      noteName: { type: 's', value: quantized.noteName },
    };

    return this.config.sendArgs
      .map(key => argMap[key])
      .filter(Boolean);
  }

  _canSend() {
    return this.enabled && !this.muted && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  _scheduleReconnect() {
    this._clearReconnect();
    this._setStatus('retrying');
    const delay = this._retryDelay;
    this._retryDelay = Math.min(MAX_RETRY_MS, this._retryDelay * 2);
    this._reconnectTimer = setTimeout(() => {
      if (this.enabled) this.connect();
    }, delay);
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
