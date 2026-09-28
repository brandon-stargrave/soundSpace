/**
 * Shareable links: the current setup, compressed into the URL's hash
 * (#p=…). Compression uses the browser's built-in CompressionStream; where
 * that's missing, the JSON is base64-encoded as-is (#j=…). Opened links go
 * through the same validation as preset files.
 */

// A shared setup is a few kilobytes; anything far bigger isn't one
const MAX_DECODED_BYTES = 512 * 1024;
const MAX_HASH_LENGTH = 200_000;

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A link that opens soundSpace with `data` (an engine.serialize() result). */
export async function makeShareLink(data) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  const base = `${location.origin}${location.pathname}`;
  if (typeof CompressionStream === 'function') {
    return `${base}#p=${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  }
  return `${base}#j=${toBase64Url(json)}`;
}

/** Whether the page was opened from a share link. */
export function hasSharedSetup(hash = location.hash) {
  return /^#[pj]=/.test(hash);
}

/**
 * Decode a share link's hash back to preset data (not yet validated).
 * @throws {Error} with a readable message when the link is damaged
 */
export async function readSharedSetup(hash = location.hash) {
  const damaged = new Error('This link is damaged or incomplete, so it could not be opened.');
  if (!hasSharedSetup(hash) || hash.length > MAX_HASH_LENGTH) throw damaged;
  try {
    let bytes = fromBase64Url(hash.slice(3));
    if (hash[1] === 'p') {
      if (typeof DecompressionStream !== 'function') {
        throw new Error('This browser can\'t open compressed links. Try a current Chrome, Firefox or Safari.');
      }
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    if (bytes.length > MAX_DECODED_BYTES) throw damaged;
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    if (e.message.startsWith('This browser')) throw e;
    throw damaged;
  }
}

/** Remove the setup from the address bar once it's loaded, so later edits aren't overwritten on reload. */
export function clearSharedSetupFromUrl() {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}
