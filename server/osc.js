// Minimal OSC 1.0 message encoder for the WebSocket → UDP relay.

const MAX_ARGS = 64;
const OSC_ADDRESS = /^\/[\x21-\x7e]*$/;

/** Encode `{ address, args: [{ type: 'i'|'f'|'s', value }] }`, or return null if malformed. */
export function encodeOSCMessage(msg) {
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

export function encodeOSCString(str) {
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
