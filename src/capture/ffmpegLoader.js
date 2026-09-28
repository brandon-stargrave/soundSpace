/**
 * Lazy loader for ffmpeg.wasm, used only when a recording has to be converted
 * (browsers without native MP4 recording, mainly Firefox). The core (~32 MB) is
 * fetched from unpkg on first use and cached by the browser afterwards.
 *
 * The @ffmpeg/ffmpeg wrapper always runs its worker as a module worker, and a
 * module worker can only load the ESM build of the core: the UMD build has no
 * ES export, so loading it fails every time.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let _instance = null;
let _loadPromise = null;

/** Fetch a file into a blob: URL, reporting progress as a 0..1 fraction when the size is known. */
async function fetchToBlobURL(url, mimeType, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Encoder download failed (HTTP ${response.status})`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (!response.body || !total || !onProgress) {
    return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mimeType }));
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  return URL.createObjectURL(new Blob(chunks, { type: mimeType }));
}

/**
 * Get a loaded FFmpeg instance. The first call downloads the wasm core and
 * resolves once the runtime is ready; later calls return the cached instance.
 *
 * @param {(fraction: number) => void} [onDownloadProgress] - encoder download progress
 * @returns {Promise<FFmpeg>}
 */
export async function getFFmpeg(onDownloadProgress) {
  if (_instance) return _instance;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const urls = [];
    try {
      const coreURL = await fetchToBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
      urls.push(coreURL);
      const wasmURL = await fetchToBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm', onDownloadProgress);
      urls.push(wasmURL);
      await ffmpeg.load({ coreURL, wasmURL });
    } catch (e) {
      try { ffmpeg.terminate(); } catch {}
      throw e;
    } finally {
      // The worker has its own copy once loaded; the blob URLs only hold memory
      for (const url of urls) URL.revokeObjectURL(url);
    }
    _instance = ffmpeg;
    _loadPromise = null;
    return ffmpeg;
  })();
  // A failed download must not be cached, or every later call would re-reject
  _loadPromise.catch(() => { _loadPromise = null; });

  return _loadPromise;
}

/** Returns true if the ffmpeg core has already been loaded (no fetch needed). */
export function isLoaded() {
  return _instance !== null;
}

/**
 * Discard the loaded instance: after an out-of-memory abort, or to cancel a
 * running conversion (terminating the worker rejects the pending exec).
 */
export function resetFFmpeg() {
  if (_instance) {
    try { _instance.terminate(); } catch {}
  }
  _instance = null;
}
