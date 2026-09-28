import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dgram from 'dgram';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encodeOSCMessage } from './server/osc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Read a port number from the environment, or exit with a clear message. */
function portFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`${name} must be a port number between 1 and 65535 (got "${raw}")`);
    process.exit(1);
  }
  return port;
}

// A namespaced variable: some shells export a generic HOST set to the machine's
// network name, which would silently expose the relay to the LAN
const HOST = process.env.SOUNDSPACE_HOST || '127.0.0.1';
const PORT = portFromEnv('PORT', 3000);
const WS_PORT = portFromEnv('WS_PORT', 8080);
const OSC_TARGET_HOST = process.env.OSC_HOST || '127.0.0.1';
const OSC_TARGET_PORT = portFromEnv('OSC_PORT', 9000);

// Browsers don't apply CORS to WebSockets: without an Origin check, any page
// the user happens to visit could send OSC through this relay.
const ALLOWED_ORIGINS = new Set([
  'https://brandon-stargrave.github.io',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
]);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// ── Express: serve built client ──────────────────────────────────

const distDir = path.join(__dirname, 'dist');
const indexFile = path.join(distDir, 'index.html');
const app = express();
app.use(express.static(distDir));
app.use((req, res) => {
  // Missing files are real 404s; only page navigations fall back to the app
  if (req.method !== 'GET' || path.extname(req.path)) {
    res.status(404).type('text').send('Not found');
  } else if (!existsSync(indexFile)) {
    res.status(503).type('text').send('No build found. Run `npm run build`, then restart.');
  } else {
    res.sendFile(indexFile);
  }
});

const httpServer = createServer(app);
httpServer.on('error', (err) => {
  console.error(`HTTP server failed on ${HOST}:${PORT}: ${err.message}`);
});
httpServer.listen(PORT, HOST, () => {
  if (existsSync(indexFile)) {
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

  // Without a listener, a client protocol error (e.g. an oversized frame) would crash the relay
  ws.on('error', (err) => console.warn('OSC relay client error:', err.message));

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
