/**
 * Recorder — captures the canvas (video) + Tone.js master output (audio)
 * as a MediaStream and records it with MediaRecorder.
 *
 * MP4 is recorded natively where the browser supports it (Chrome, Edge,
 * Safari). Elsewhere (Firefox) the browser records WebM and ffmpeg.wasm
 * converts it to MP4 after the take. WebM can also be kept as-is.
 *
 * Capture happens at the canvas's CURRENT pixel-buffer size. Pair with
 * SceneManager.setViewportResolution() to record at custom resolutions
 * (1080p, 4K, etc.) independent of the on-screen window size.
 *
 * A take is never lost: if conversion can't run, is cancelled, or fails,
 * the original recording is downloaded instead.
 */

import * as Tone from 'tone';
import { getFFmpeg, resetFFmpeg } from './ffmpegLoader.js';

const STATE = Object.freeze({
  IDLE: 'idle',
  RECORDING: 'recording',
  ENCODING: 'encoding',
  DONE: 'done',
  ERROR: 'error',
});

// ffmpeg.wasm holds both the input and the output file in memory inside a
// ~2 GB wasm heap; larger captures would abort mid-encode.
const MAX_TRANSCODE_BYTES = 700 * 1024 * 1024;

const MP4_TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4'];
const WEBM_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

function firstSupported(types) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  return types.find(t => MediaRecorder.isTypeSupported(t)) || null;
}

/** The recording type for a requested format: native first, the other container as a fallback. */
function pickMimeType(format) {
  return format === 'webm'
    ? firstSupported(WEBM_TYPES) || firstSupported(MP4_TYPES)
    : firstSupported(MP4_TYPES) || firstSupported(WEBM_TYPES);
}

function containerFor(mimeType) {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Video bitrate from pixel rate: ~0.12 bits per pixel per frame, 8–80 Mbps. */
function pickVideoBitrate(w, h, fps) {
  return Math.round(Math.min(80_000_000, Math.max(8_000_000, w * h * fps * 0.12)));
}

/** WebM → MP4. The crop keeps dimensions even (libx264 rejects odd sizes for 4:2:0), -r makes the frame rate constant. */
function mp4Args(inName, outName, fps) {
  return [
    '-i', inName,
    '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2',
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outName,
  ];
}

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export class Recorder {
  /** Whether this browser can capture the canvas at all. */
  static isSupported() {
    return (firstSupported(MP4_TYPES) || firstSupported(WEBM_TYPES)) !== null &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  /** Export formats this browser can offer: MP4 always (native or converted), WebM when it records WebM. */
  static formats() {
    const formats = [{ id: 'mp4', label: 'MP4 (H.264)', native: !!firstSupported(MP4_TYPES) }];
    if (firstSupported(WEBM_TYPES)) formats.push({ id: 'webm', label: 'WebM (no conversion)', native: true });
    return formats;
  }

  constructor(sceneManager, engine) {
    this.sceneManager = sceneManager;
    this.engine = engine;

    this.state = STATE.IDLE;
    this.elapsedSec = 0;
    this.bytesRecorded = 0;
    this.lastFile = null; // {name, size, note}

    this._statusCb = null;
    this._mediaRecorder = null;
    this._mimeType = null;
    this._chunks = [];
    this._audioDest = null;       // MediaStreamAudioDestinationNode
    this._stream = null;          // combined MediaStream
    this._tickInterval = null;
    this._format = 'mp4';
    this._fps = 60;
    this._captureWidth = 0;
    this._captureHeight = 0;
    this._activeSec = 0;          // recorded time before the current segment (pauses excluded)
    this._segmentStart = 0;
    this._cancelRequested = false;

    this._onVisibility = () => this._handleVisibility();
    this._onBeforeUnload = (e) => {
      if (this.isRecording || this.isEncoding) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
  }

  /** Whether a recording is currently in progress (capture phase). */
  get isRecording() { return this.state === STATE.RECORDING; }
  /** Whether the post-capture encoding phase is currently running. */
  get isEncoding() { return this.state === STATE.ENCODING; }

  /** Subscribe to status updates. Callback receives `{state, elapsedSec, bytes, message?}`. */
  setStatusCallback(fn) { this._statusCb = fn; }

  _emit(message) {
    if (this._statusCb) {
      this._statusCb({
        state: this.state,
        elapsedSec: this.elapsedSec,
        bytes: this.bytesRecorded,
        paused: this._mediaRecorder?.state === 'paused',
        message,
      });
    }
  }

  /**
   * Begin capturing. Resolves immediately once recording is live; the actual
   * stop+encode happens in stop().
   * @param {{ format: 'mp4'|'webm', fps: number }} opts
   */
  async start(opts = {}) {
    if (this.state === STATE.RECORDING || this.state === STATE.ENCODING) {
      throw new Error('Recorder is already busy');
    }
    if (!Recorder.isSupported()) {
      throw new Error('Recording is not supported in this browser');
    }
    this._format = opts.format === 'webm' ? 'webm' : 'mp4';
    this._fps = opts.fps || 60;
    this._mimeType = pickMimeType(this._format);

    const canvas = this.sceneManager.renderer.domElement;
    // A take keeps one size: window resizes and fullscreen don't change it
    this.sceneManager.setCaptureLock(true);
    this._captureWidth = canvas.width;
    this._captureHeight = canvas.height;

    try {
      // 1) Video stream from canvas at chosen fps. Captures at the canvas's
      //    current pixel-buffer size, which honors any setViewportResolution.
      this._stream = new MediaStream();
      this._stream.addTrack(canvas.captureStream(this._fps).getVideoTracks()[0]);

      // 2) Audio stream — tap Tone.js master into a MediaStreamDestination.
      //    Connecting to this destination doesn't unhook the regular speaker
      //    output; it's a parallel tap, so the user keeps hearing the audio.
      const audioCtx = Tone.getContext().rawContext;
      this._audioDest = audioCtx.createMediaStreamDestination();
      Tone.getDestination().connect(this._audioDest);
      const audioTrack = this._audioDest.stream.getAudioTracks()[0];
      if (audioTrack) this._stream.addTrack(audioTrack);

      // 3) MediaRecorder
      this._mediaRecorder = new MediaRecorder(this._stream, {
        mimeType: this._mimeType,
        videoBitsPerSecond: pickVideoBitrate(this._captureWidth, this._captureHeight, this._fps),
        audioBitsPerSecond: 192_000,
      });
      this._chunks = [];
      this.bytesRecorded = 0;
      this._mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this._chunks.push(e.data);
          this.bytesRecorded += e.data.size;
        }
      };
      // The browser can end a recording on its own (e.g. the stream fails);
      // finish the take so the user gets what was recorded
      this._mediaRecorder.onerror = () => {
        if (this.isRecording) this.stop().catch(err => console.error('Recorder: stop after error failed', err));
      };

      // 4) Start recording. Request a chunk every 500ms so we drain the
      //    encoder's internal buffer regularly (helps long recordings).
      this._mediaRecorder.start(500);
    } catch (e) {
      this._teardownCapture();
      throw e;
    }

    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('beforeunload', this._onBeforeUnload);

    this.state = STATE.RECORDING;
    this._cancelRequested = false;
    this.elapsedSec = 0;
    this._activeSec = 0;
    this._segmentStart = performance.now();
    this._tickInterval = setInterval(() => {
      if (this._mediaRecorder?.state === 'recording') {
        this.elapsedSec = this._activeSec + (performance.now() - this._segmentStart) / 1000;
      }
      this._emit();
    }, 250);
    this._emit('recording');
  }

  /**
   * The render loop stops while the tab is hidden, so the take would record
   * a frozen frame. Pause instead, and pick up again when the tab returns.
   */
  _handleVisibility() {
    const rec = this._mediaRecorder;
    if (!rec || !this.isRecording) return;
    if (document.hidden && rec.state === 'recording') {
      rec.pause();
      this._activeSec += (performance.now() - this._segmentStart) / 1000;
      this._emit();
    } else if (!document.hidden && rec.state === 'paused') {
      rec.resume();
      this._segmentStart = performance.now();
      this._emit();
    }
  }

  /**
   * Finalize the recording: stops MediaRecorder, converts it to MP4 via
   * ffmpeg.wasm when the browser couldn't record MP4 itself, then triggers a
   * download. Resolves with the downloaded Blob.
   */
  async stop() {
    if (this.state !== STATE.RECORDING) return null;
    const durationSec = this.elapsedSec;

    let recording;
    try {
      recording = await this._flush();
    } catch (e) {
      this.state = STATE.IDLE;
      throw e;
    } finally {
      this._teardownCapture();
      this._chunks = [];
    }

    const container = containerFor(recording.type);
    const baseName = `soundspace_${timestampForFilename()}`;

    if (this._format === 'webm' || container === 'mp4') {
      return this._finish(this._deliver(recording, `${baseName}.${container}`));
    }
    if (recording.size > MAX_TRANSCODE_BYTES) {
      return this._finish(this._deliver(recording, `${baseName}.${container}`,
        'too large to convert in the browser, kept the original'));
    }

    this.state = STATE.ENCODING;
    this._emit('loading encoder…');
    try {
      const converted = await this._transcode(recording, container, durationSec);
      return this._finish(this._deliver(converted, `${baseName}.mp4`));
    } catch (e) {
      const note = this._cancelRequested ? 'conversion cancelled, kept the original' : 'conversion failed, kept the original';
      if (!this._cancelRequested) console.error('Recorder: conversion failed, saving the original recording instead', e);
      // An aborted wasm instance (e.g. out of memory) can't be reused
      resetFFmpeg();
      return this._finish(this._deliver(recording, `${baseName}.${container}`, note));
    }
  }

  /** Stop a running conversion; the original recording is saved instead. */
  cancelEncoding() {
    if (!this.isEncoding) return;
    this._cancelRequested = true;
    // Terminating the worker rejects the pending load or exec
    resetFFmpeg();
  }

  _finish(blob) {
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    return blob;
  }

  /** Cancel the current recording without saving anything. */
  abort() {
    if (this.state !== STATE.RECORDING) return;
    try { this._mediaRecorder.stop(); } catch {}
    this._teardownCapture();
    this._chunks = [];
    this.state = STATE.IDLE;
    this.elapsedSec = 0;
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    this._emit('aborted');
  }

  _flush() {
    const recorder = this._mediaRecorder;
    const makeBlob = () => new Blob(this._chunks, { type: recorder.mimeType || this._mimeType });
    // Already stopped by the browser: everything it recorded is in the chunks
    if (recorder.state === 'inactive') return Promise.resolve(makeBlob());
    return new Promise((resolve, reject) => {
      recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
      recorder.onstop = () => resolve(makeBlob());
      recorder.stop();
    });
  }

  async _transcode(recording, container, durationSec) {
    const ffmpeg = await getFFmpeg((fraction) => {
      if (this.isEncoding) this._emit(`downloading encoder ${Math.round(fraction * 100)}%`);
    });
    if (this._cancelRequested) throw new Error('cancelled');

    const inName = `in.${container}`;
    const outName = 'out.mp4';
    // ffmpeg reports how far into the input it has encoded; the recording's
    // own container often has no duration, so measure against the take length
    const onProgress = ({ time }) => {
      if (!this.isEncoding || !(durationSec > 0)) return;
      const pct = Math.max(0, Math.min(99, Math.round((time / 1e6 / durationSec) * 100)));
      this._emit(`converting to MP4 ${pct}%`);
    };
    ffmpeg.on('progress', onProgress);
    try {
      await ffmpeg.writeFile(inName, new Uint8Array(await recording.arrayBuffer()));
      this._emit('converting to MP4 0%');
      const exitCode = await ffmpeg.exec(mp4Args(inName, outName, this._fps));
      if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
      const data = await ffmpeg.readFile(outName);
      return new Blob([data], { type: 'video/mp4' });
    } finally {
      ffmpeg.off('progress', onProgress);
      try { await ffmpeg.deleteFile(inName); } catch {}
      try { await ffmpeg.deleteFile(outName); } catch {}
    }
  }

  _deliver(blob, filename, note = null) {
    triggerDownload(blob, filename);
    this.lastFile = { name: filename, size: blob.size, note };
    this.state = STATE.DONE;
    this._emit(note || 'done');
    return blob;
  }

  _teardownCapture() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._audioDest) {
      try { Tone.getDestination().disconnect(this._audioDest); } catch {}
      this._audioDest = null;
    }
    if (this._stream) {
      try { this._stream.getTracks().forEach(t => t.stop()); } catch {}
      this._stream = null;
    }
    this.sceneManager.setCaptureLock(false);
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
