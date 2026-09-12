import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dgram from 'dgram';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '3000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const OSC_TARGET_HOST = process.env.OSC_HOST || '127.0.0.1';
const OSC_TARGET_PORT = parseInt(process.env.OSC_PORT || '9000', 10);

// Browsers don't apply CORS to WebSockets: without an Origin check, any page
// the user happens to visit could send OSC through this relay.
const ALLOWED_ORIGINS = new Set([
  'https://brandon-stargrave.github.io',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
]);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const MAX_ARGS = 64;
const OSC_ADDRESS = /^\/[\x21-\x7e]*$/;

// ── Express: serve built client ──────────────────────────────────

const distDir = path.join(__dirname, 'dist');
const app = express();
app.use(express.static(distDir));
app.use((req, res) => res.sendFile(path.join(distDir, 'index.html')));

const httpServer = createServer(app);
httpServer.on('error', (err) => {
  console.error(`HTTP server failed on ${HOST}:${PORT}: ${err.message}`);
});
httpServer.listen(PORT, HOST, () => {
  if (existsSync(distDir)) {
    console.log(`soundSpace:  http://${HOST}:${PORT}`);
  } else {
    console.log('No build found in dist/ — run `npm run build` to serve the app from here,');
    console.log('or keep `npm run dev` running and use this process as the OSC relay only.');
  }
});

// ── WebSocket → UDP OSC relay ────────────────────────────────────

const udpSocket = dgram.createSocket('udp4');
udpSocket.on('error', (err) => console.error('UDP socket error:', err.message));

const wss = new WebSocketServer({
  host: HOST,
  port: WS_PORT,
  maxPayload: 64 * 1024,
  verifyClient: ({ origin }) => {
    // Non-browser clients send no Origin; they could reach the UDP port directly anyway.
    if (!origin || LOCAL_ORIGIN.test(origin) || ALLOWED_ORIGINS.has(origin)) return true;
    console.warn(`Rejected OSC relay connection from ${origin} (add it to ALLOWED_ORIGINS to permit)`);
    return false;
  },
});

wss.on('listening', () => {
  console.log(`OSC relay:   ws://${HOST}:${WS_PORT} → udp://${OSC_TARGET_HOST}:${OSC_TARGET_PORT}`);
});
wss.on('error', (err) => {
  console.error(`OSC relay failed on ${HOST}:${WS_PORT}: ${err.message}`);
});

wss.on('connection', (ws, req) => {
  console.log(`Browser connected for OSC relay (${req.headers.origin || 'no origin'})`);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const packet = encodeOSCMessage(msg);
    if (!packet) return;
    udpSocket.send(packet, OSC_TARGET_PORT, OSC_TARGET_HOST, (err) => {
      if (err) console.error('OSC send failed:', err.message);
    });
  });

  ws.on('close', () => {
    console.log('Browser disconnected');
  });
});

// ── Minimal OSC Encoder ──────────────────────────────────────────

/** Encode `{ address, args: [{ type: 'i'|'f'|'s', value }] }`, or return null if malformed. */
function encodeOSCMessage(msg) {
  if (!msg || typeof msg.address !== 'string' || !OSC_ADDRESS.test(msg.address)) return null;
  const args = Array.isArray(msg.args) ? msg.args : [];
  if (args.length > MAX_ARGS) return null;

  let typeTag = ',';
  const argBuffers = [];
  for (const arg of args) {
    switch (arg?.type) {
      case 'i':
      case 'f': {
        const value = Number(arg.value);
        if (!Number.isFinite(value)) return null;
        argBuffers.push(arg.type === 'i' ? encodeOSCInt32(value) : encodeOSCFloat32(value));
        break;
      }
      case 's':
        argBuffers.push(encodeOSCString(String(arg.value)));
        break;
      default:
        return null;
    }
    typeTag += arg.type;
  }

  return Buffer.concat([encodeOSCString(msg.address), encodeOSCString(typeTag), ...argBuffers]);
}

function encodeOSCString(str) {
  const bytes = Buffer.from(str, 'utf8');
  // Room for the null terminator, padded to a 4-byte boundary
  const buf = Buffer.alloc((bytes.length + 4) & ~3);
  bytes.copy(buf);
  return buf;
}

function encodeOSCInt32(value) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(Math.max(-0x80000000, Math.min(0x7fffffff, Math.round(value))), 0);
  return buf;
}

function encodeOSCFloat32(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return buf;
}
