import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dgram from 'dgram';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3000');
const WS_PORT = parseInt(process.env.WS_PORT || '8080');
const OSC_TARGET_HOST = process.env.OSC_HOST || '127.0.0.1';
const OSC_TARGET_PORT = parseInt(process.env.OSC_PORT || '9000');

// ── Express: serve built client ──────────────────────────────────

const app = express();
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

const httpServer = createServer(app);
httpServer.listen(PORT, () => {
  console.log(`soundSpace server: http://localhost:${PORT}`);
  console.log(`OSC relay target: ${OSC_TARGET_HOST}:${OSC_TARGET_PORT}`);
});

// ── WebSocket server for OSC relay ───────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });
const udpSocket = dgram.createSocket('udp4');

console.log(`WebSocket relay listening on ws://localhost:${WS_PORT}`);

wss.on('connection', (ws) => {
  console.log('Browser connected for OSC relay');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const oscBuffer = encodeOSCMessage(msg.address, msg.args || []);
      udpSocket.send(oscBuffer, 0, oscBuffer.length, OSC_TARGET_PORT, OSC_TARGET_HOST);
    } catch (e) {
      console.error('OSC relay error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('Browser disconnected');
  });
});

// ── Minimal OSC Encoder ──────────────────────────────────────────

function encodeOSCMessage(address, args) {
  const buffers = [];

  // Address
  buffers.push(encodeOSCString(address));

  // Type tag string
  let typeTag = ',';
  for (const arg of args) {
    typeTag += arg.type;
  }
  buffers.push(encodeOSCString(typeTag));

  // Arguments
  for (const arg of args) {
    switch (arg.type) {
      case 'i':
        buffers.push(encodeOSCInt32(arg.value));
        break;
      case 'f':
        buffers.push(encodeOSCFloat32(arg.value));
        break;
      case 's':
        buffers.push(encodeOSCString(String(arg.value)));
        break;
    }
  }

  return Buffer.concat(buffers);
}

function encodeOSCString(str) {
  const nullTerminated = str + '\0';
  const padded = nullTerminated.length + (4 - (nullTerminated.length % 4)) % 4;
  const buf = Buffer.alloc(padded, 0);
  buf.write(str, 'ascii');
  return buf;
}

function encodeOSCInt32(value) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

function encodeOSCFloat32(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return buf;
}
