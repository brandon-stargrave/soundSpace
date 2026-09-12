/**
 * Recorder — captures the canvas (video) + Tone.js master output (audio)
 * as a MediaStream, runs them through MediaRecorder for live capture into
 * a high-bitrate WebM blob, then transcodes the result via ffmpeg.wasm to
 * the user's chosen format (compressed MP4 or ProRes 4444 MOV).
 *
 * Capture happens at the canvas's CURRENT pixel-buffer size. Pair with
 * SceneManager.setViewportResolution() to record at custom resolutions
 * (1080p, 4K, etc.) independent of the on-screen window size.
 *
 * High-level flow:
 *   start()  → captureStream + audio MediaStreamDestination → MediaRecorder
 *   stop()   → finalize WebM blob, lazy-load ffmpeg, transcode, download
 */

import * as Tone from 'tone';
import { fetchFile } from '@ffmpeg/util';
import { getFFmpeg } from './ffmpegLoader.js';

const STATE = Object.freeze({
  IDLE: 'idle',
  RECORDING: 'recording',
  ENCODING: 'encoding',
  DONE: 'done',
  ERROR: 'error',
});

/** Pick the best WebM mimeType MediaRecorder supports in this browser. */
function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' &&
        MediaRecorder.isTypeSupported &&
        MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return 'video/webm';
}

/** Compute video bitrate based on resolution — higher res deserves more data. */
function pickVideoBitrate(w, h) {
  // 0.04 bits per pixel × frame area is a high-quality intermediate
  // bitrate (8K → 1.3 Gbps, 4K → 332 Mbps, 1080p → 83 Mbps).
  const bpp = 0.04;
  return Math.max(50_000_000, Math.floor(w * h * bpp));
}

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export class Recorder {
  constructor(sceneManager, engine) {
    this.sceneManager = sceneManager;
    this.engine = engine;

    this.state = STATE.IDLE;
    this.elapsedSec = 0;
    this.lastFile = null; // {name, size}

    this._statusCb = null;
    this._mediaRecorder = null;
    this._chunks = [];
    this._audioDest = null;       // MediaStreamAudioDestinationNode
    this._stream = null;          // combined MediaStream
    this._tickInterval = null;
    this._startTime = 0;
    this._priorMuteOnDefocus = null;
    this._format = null;
    this._fps = 60;
    this._captureWidth = 0;
    this._captureHeight = 0;
  }

  /** Whether a recording is currently in progress (capture phase). */
  get isRecording() { return this.state === STATE.RECORDING; }
  /** Whether the post-capture encoding phase is currently running. */
  get isEncoding() { return this.state === STATE.ENCODING; }

  /** Subscribe to status updates. Callback receives `{state, elapsedSec, message?}`. */
  setStatusCallback(fn) { this._statusCb = fn; }

  _emit(message) {
    if (this._statusCb) {
      this._statusCb({
        state: this.state,
        elapsedSec: this.elapsedSec,
        message,
      });
    }
  }

  /**
   * Begin capturing. Resolves immediately once recording is live; the actual
   * stop+encode happens in stop().
   * @param {{ format: 'mp4'|'mov', fps: number }} opts
   */
  async start(opts = {}) {
    if (this.state === STATE.RECORDING || this.state === STATE.ENCODING) {
      throw new Error('Recorder is already busy');
    }
    this._format = opts.format === 'mov' ? 'mov' : 'mp4';
    this._fps = opts.fps || 60;

    const canvas = this.sceneManager.renderer.domElement;
    this._captureWidth = canvas.width;
    this._captureHeight = canvas.height;

    // 1) Video stream from canvas at chosen fps. Captures at the canvas's
    //    current pixel-buffer size, which honors any setViewportResolution.
    const videoStream = canvas.captureStream(this._fps);
    const videoTrack = videoStream.getVideoTracks()[0];

    // 2) Audio stream — tap Tone.js master into a MediaStreamDestination.
    //    Connecting to this destination doesn't unhook the regular speaker
    //    output; it's a parallel tap, so the user keeps hearing the audio.
    const audioCtx = Tone.getContext().rawContext;
    this._audioDest = audioCtx.createMediaStreamDestination();
    Tone.getDestination().connect(this._audioDest);
    const audioTrack = this._audioDest.stream.getAudioTracks()[0];

    // 3) Combine into one MediaStream.
    this._stream = new MediaStream();
    this._stream.addTrack(videoTrack);
    if (audioTrack) this._stream.addTrack(audioTrack);

    // 4) MediaRecorder with high-bitrate WebM intermediate.
    const mimeType = pickMimeType();
    const videoBitsPerSecond = pickVideoBitrate(this._captureWidth, this._captureHeight);
    const audioBitsPerSecond = 192_000;
    this._mediaRecorder = new MediaRecorder(this._stream, {
      mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond,
    });
    this._chunks = [];
    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };

    // 5) Suppress mute-on-defocus while recording so tab-blur doesn't kill audio.
    if (this.engine && typeof this.engine.muteOnDefocus !== 'undefined') {
      this._priorMuteOnDefocus = this.engine.muteOnDefocus;
      this.engine.muteOnDefocus = false;
    }

    // 6) Start recording. Request a chunk every 500ms so we drain the
    //    encoder's internal buffer regularly (helps long recordings).
    this._mediaRecorder.start(500);
    this.state = STATE.RECORDING;
    this.elapsedSec = 0;
    this._startTime = performance.now();
    this._tickInterval = setInterval(() => {
      this.elapsedSec = (performance.now() - this._startTime) / 1000;
      this._emit();
    }, 250);
    this._emit('recording');
  }

  /**
   * Finalize the recording: stops MediaRecorder, transcodes the WebM blob
   * via ffmpeg.wasm to the target format, then triggers a download.
   * Resolves with the final Blob.
   */
  async stop() {
    if (this.state !== STATE.RECORDING) return null;

    // 1) Wait for MediaRecorder to fully flush.
    const flushedBlob = await new Promise((resolve, reject) => {
      this._mediaRecorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
      this._mediaRecorder.onstop = () => {
        const mime = this._mediaRecorder.mimeType || 'video/webm';
        resolve(new Blob(this._chunks, { type: mime }));
      };
      this._mediaRecorder.stop();
    });

    // 2) Tear down capture pipeline + restore engine mute behavior.
    this._teardownCapture();

    // 3) Transcode via ffmpeg.wasm.
    this.state = STATE.ENCODING;
    this._emit('loading encoder…');

    const ffmpeg = await getFFmpeg(
      ({ ratio }) => {
        if (typeof ratio === 'number' && ratio >= 0 && ratio <= 1) {
          this._emit(`encoding ${Math.round(ratio * 100)}%`);
        }
      },
      // optional log callback — silent by default
      undefined
    );

    const inName = 'in.webm';
    const outExt = this._format; // 'mp4' | 'mov'
    const outName = `out.${outExt}`;

    await ffmpeg.writeFile(inName, await fetchFile(flushedBlob));

    const args = (this._format === 'mp4')
      ? [
          '-i', inName,
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '18',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-movflags', '+faststart',
          outName,
        ]
      : [
          // ProRes 4444 — visually lossless mastering format
          '-i', inName,
          '-c:v', 'prores_ks',
          '-profile:v', '4',           // 4 = ProRes 4444
          '-pix_fmt', 'yuva444p10le',  // 10-bit 4:4:4:4
          '-c:a', 'pcm_s24le',         // uncompressed 24-bit PCM
          outName,
        ];

    this._emit('encoding 0%');
    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile(outName);
    const outMime = this._format === 'mp4' ? 'video/mp4' : 'video/quicktime';
    const outBlob = new Blob([data.buffer], { type: outMime });

    // Clean up scratch files inside the ffmpeg FS.
    try { await ffmpeg.deleteFile(inName); } catch {}
    try { await ffmpeg.deleteFile(outName); } catch {}

    // 4) Trigger browser download.
    const filename = `soundspace_${timestampForFilename()}.${outExt}`;
    triggerDownload(outBlob, filename);

    this.lastFile = { name: filename, size: outBlob.size };
    this.state = STATE.DONE;
    this._emit('done');

    return outBlob;
  }

  /** Cancel the current recording without saving anything. */
  abort() {
    if (this.state !== STATE.RECORDING) return;
    try { this._mediaRecorder.stop(); } catch {}
    this._teardownCapture();
    this._chunks = [];
    this.state = STATE.IDLE;
    this.elapsedSec = 0;
    this._emit('aborted');
  }

  _teardownCapture() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
    if (this._audioDest) {
      try { Tone.getDestination().disconnect(this._audioDest); } catch {}
      this._audioDest = null;
    }
    if (this._stream) {
      try { this._stream.getTracks().forEach(t => t.stop()); } catch {}
      this._stream = null;
    }
    if (this._priorMuteOnDefocus !== null && this.engine) {
      this.engine.muteOnDefocus = this._priorMuteOnDefocus;
      this._priorMuteOnDefocus = null;
    }
    this._mediaRecorder = null;
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer URL revoke so browser can finish the download
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
