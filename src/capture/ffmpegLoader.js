/**
 * Lazy loader for ffmpeg.wasm.
 *
 * The @ffmpeg/ffmpeg package only includes the API wrapper — the actual ~30MB
 * wasm core lives in @ffmpeg/core and is fetched at runtime. We load it from
 * unpkg the first time getFFmpeg() is called and cache the loaded instance
 * for any subsequent calls.
 *
 * Single-threaded core is used (rather than -mt) so we avoid the
 * SharedArrayBuffer / COOP-COEP cross-origin-isolation headers requirement.
 * Single-threaded is meaningfully slower for big jobs but simplifies dev/host
 * setup; we can revisit if encoding-time becomes a real complaint.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.6';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let _instance = null;
let _loadPromise = null;

/**
 * Get a loaded FFmpeg instance. The first call kicks off the wasm core
 * download (~30MB) and resolves once the runtime is ready. Subsequent
 * calls return the cached instance.
 *
 * @param {(progress: {ratio: number, time?: number}) => void} [onProgress]
 *        Optional progress callback for both load + encode phases. Receives
 *        ratios in [0, 1] from ffmpeg's internal progress events.
 * @param {(message: string) => void} [onLog]
 *        Optional log callback for ffmpeg stderr/stdout — useful for debugging.
 * @returns {Promise<FFmpeg>}
 */
export async function getFFmpeg(onProgress, onLog) {
  if (_instance) return _instance;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
    if (onProgress) ffmpeg.on('progress', onProgress);

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });

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

/** Discard the loaded instance (e.g. after an out-of-memory abort) so the next call loads a fresh core. */
export function resetFFmpeg() {
  if (_instance) {
    try { _instance.terminate(); } catch {}
  }
  _instance = null;
}
