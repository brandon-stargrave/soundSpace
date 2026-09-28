import { section, divider, rangeRow, selectRow, toggleRow, textRow, numberRow, note } from './controls.js';

const OSC_STATUS = {
  off: 'Off.',
  connecting: 'Connecting to the relay…',
  connected: 'Connected. Notes go to the relay, which forwards them as OSC over UDP.',
  retrying: 'The relay isn\'t answering. Start it with `npm run dev:osc` (see the README); retrying…',
  blocked: 'This page can\'t reach a ws:// relay (secure pages only allow wss://). Run soundSpace locally to use OSC.',
};

/**
 * MIDI and OSC output configuration panel — global, shared across orbits.
 * Each orbit auto-routes to its own MIDI channel and OSC address.
 */
export class MidiOscPanel {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
  }

  render() {
    const { el, body } = section('MIDI / OSC');
    this._renderMidi(body);
    this._renderOsc(body);
    this.el = el;
    return el;
  }

  _renderMidi(body) {
    const midi = this.engine.midiOutput;
    body.appendChild(divider('MIDI'));

    const status = note('', { live: true });
    const updateStatus = () => {
      const messages = {
        unsupported: 'This browser has no Web MIDI. Try Chrome, Edge or Firefox.',
        denied: 'MIDI access was blocked. Allow it in the site settings, then turn MIDI on again.',
      };
      if (messages[midi.status]) {
        status.textContent = messages[midi.status];
        return;
      }
      if (midi.status === 'ready' && midi.getOutputList().length === 0) {
        status.textContent = 'No MIDI outputs found. Connect a device or start a virtual MIDI port.';
        return;
      }
      const channels = this.engine.generators
        .map(g => `orbit ${g.params.orbitIndex + 1} → ch ${midi.channelForOrbit(g.params.orbitIndex)}`)
        .join(', ');
      const h = this.engine.harmonicOrbit?.params;
      const used = new Set(this.engine.generators.map(g => midi.channelForOrbit(g.params.orbitIndex)));
      const clash = h && (used.has(h.midiPadChannel) || used.has(h.midiBassChannel))
        ? ' An orbit shares a channel with the Harmonic Orbit\'s pad or bass; change Base Channel or the Harmonic Orbit\'s MIDI channels.'
        : '';
      status.textContent = `Each orbit plays on its own channel: ${channels}.${clash}`;
    };

    const device = selectRow({
      label: 'Device',
      options: [{ value: '', label: 'None' }],
      value: '',
      onChange: (val) => midi.selectOutput(val),
    });
    const populateDevices = () => {
      const select = device.input;
      select.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = midi.access ? 'None' : 'Turn MIDI on to list devices';
      select.appendChild(none);
      for (const d of midi.getOutputList()) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        select.appendChild(opt);
      }
      select.value = midi.selectedOutput?.id ?? '';
      select.disabled = !midi.access;
    };

    // Turning MIDI on is what asks the browser for access
    const toggle = toggleRow({
      label: 'MIDI Enabled',
      value: midi.enabled,
      onChange: async (val) => {
        if (!val) {
          midi.allNotesOff();
          midi.enabled = false;
          updateStatus();
          return;
        }
        const ok = await midi.init();
        midi.enabled = ok;
        if (!ok) toggle.input.checked = false;
        populateDevices();
        updateStatus();
      },
    });
    body.appendChild(toggle);
    body.appendChild(device);
    populateDevices();
    midi.onDevicesChanged = () => { populateDevices(); updateStatus(); };

    body.appendChild(rangeRow({
      label: 'Base Channel', min: 1, max: 16, step: 1, value: midi.config.channel,
      help: 'Orbit 1\'s MIDI channel. Each further orbit uses the next channel, wrapping after 16.',
      onInput: (val) => { midi.setConfig({ channel: val }); updateStatus(); },
    }));
    body.appendChild(rangeRow({
      label: 'Note Length', min: 10, max: 2000, step: 10, unit: 'ms', value: midi.config.noteDurationMs,
      onInput: (val) => midi.setConfig({ noteDurationMs: val }),
    }));
    body.appendChild(selectRow({
      label: 'Velocity Curve', options: ['linear', 'exponential', 'logarithmic'],
      labels: { linear: 'Linear', exponential: 'Exponential', logarithmic: 'Logarithmic' },
      value: midi.config.velocityCurve,
      onChange: (val) => midi.setConfig({ velocityCurve: val }),
    }));
    updateStatus();
    body.appendChild(status);
  }

  _renderOsc(body) {
    const osc = this.engine.oscOutput;
    body.appendChild(divider('OSC'));

    const status = note('', { live: true });
    const showStatus = (s) => {
      status.textContent = OSC_STATUS[s] ?? '';
      status.dataset.state = s;
    };
    osc.onStatus = showStatus;
    showStatus(osc.status);

    const reconnect = () => { if (osc.enabled) osc.connect(); };
    body.appendChild(toggleRow({
      label: 'OSC Enabled',
      value: osc.enabled,
      onChange: (val) => {
        osc.enabled = val;
        if (val) osc.connect();
        else osc.disconnect();
      },
    }));
    body.appendChild(textRow({
      label: 'Relay Host', value: osc.config.wsHost, placeholder: '127.0.0.1',
      help: 'The computer running the relay (server.js).',
      onChange: (val) => { osc.setConfig({ wsHost: val || '127.0.0.1' }); reconnect(); },
    }));
    body.appendChild(numberRow({
      label: 'Relay Port', value: osc.config.wsPort, min: 1, max: 65535, step: 1,
      help: 'The relay\'s WebSocket port (WS_PORT, 8080 by default).',
      onChange: (val) => { osc.setConfig({ wsPort: val }); reconnect(); },
    }));
    body.appendChild(status);
    body.appendChild(note('Addresses: /soundspace/orbit{n}/node{n}/note, and /soundspace/harmonic/{pad|bass|transpose}.'));
  }
}
