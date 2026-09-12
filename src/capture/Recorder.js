/**
 * Recorder — captures the canvas (video) + Tone.js master output (audio)
 * as a MediaStream, runs them through MediaRecorder for live capture, then
 * transcodes the result via ffmpeg.wasm to the user's chosen format
 * (compressed MP4 or ProRes 4444 MOV).
 *
 * Capture happens at the canvas's CURRENT pixel-buffer size. Pair with
 * SceneManager.setViewportResolution() to record at custom resolutions
 * (1080p, 4K, etc.) independent of the on-screen window size.
 *
 * High-level flow:
 *   start()  → captureStream + audio MediaStreamDestination → MediaRecorder
 *   stop()   → finalize the recording, lazy-load ffmpeg, transcode, download.
 *              When the browser already recorded the requested container, or
 *              the transcode can't complete, the original recording is
 *              downloaded instead so a take is never lost.
 */

import * as Tone from 'tone';
import { fetchFile } from '@ffmpeg/util';
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

// WebM for Chrome/Firefox; MP4 for Safari, whose MediaRecorder has no WebM.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
];

/** Pick the best container/codec MediaRecorder supports in this browser. */
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

function containerFor(mimeType) {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** Intermediate bitrate scaled by frame area — 1080p ≈ 41 Mbps, capped at 100 Mbps. */
function pickVideoBitrate(w, h) {
  return Math.min(100_000_000, Math.max(8_000_000, Math.floor(w * h * 0.02)));
}

function ffmpegArgs(format, inName, outName) {
  if (format === 'mp4') {
    return [
      '-i', inName,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outName,
    ];
  }
  // ProRes 4444 — visually lossless mastering format
  return [
    '-i', inName,
    '-c:v', 'prores_ks',
    '-profile:v', '4',           // 4 = ProRes 4444
    '-pix_fmt', 'yuva444p10le',  // 10-bit 4:4:4:4
    '-c:a', 'pcm_s24le',         // uncompressed 24-bit PCM
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
    return pickMimeType() !== null &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  constructor(sceneManager, engine) {
    this.sceneManager = sceneManager;
    this.engine = engine;

    this.state = STATE.IDLE;
    this.elapsedSec = 0;
    this.lastFile = null; // {name, size, note}

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
    if (!Recorder.isSupported()) {
      throw new Error('Recording is not supported in this browser');
    }
    this._format = opts.format === 'mov' ? 'mov' : 'mp4';
    this._fps = opts.fps || 60;

    const canvas = this.sceneManager.renderer.domElement;
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

      // 3) MediaRecorder with a high-bitrate intermediate.
      this._mediaRecorder = new MediaRecorder(this._stream, {
        mimeType: pickMimeType(),
        videoBitsPerSecond: pickVideoBitrate(this._captureWidth, this._captureHeight),
        audioBitsPerSecond: 192_000,
      });
      this._chunks = [];
      this._mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this._chunks.push(e.data);
      };

      // 4) Start recording. Request a chunk every 500ms so we drain the
      //    encoder's internal buffer regularly (helps long recordings).
      this._mediaRecorder.start(500);
    } catch (e) {
      this._teardownCapture();
      throw e;
    }

    // Suppress mute-on-defocus while recording so tab-blur doesn't kill audio.
    if (this.engine && typeof this.engine.muteOnDefocus !== 'undefined') {
      this._priorMuteOnDefocus = this.engine.muteOnDefocus;
      this.engine.muteOnDefocus = false;
    }

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
   * Finalize the recording: stops MediaRecorder, converts it to the target
   * format via ffmpeg.wasm when needed, then triggers a download.
   * Resolves with the downloaded Blob.
   */
  async stop() {
    if (this.state !== STATE.RECORDING) return null;

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

    if (container === this._format) {
      return this._deliver(recording, `${baseName}.${container}`);
    }
    if (recording.size > MAX_TRANSCODE_BYTES) {
      return this._deliver(recording, `${baseName}.${container}`,
        'too large to convert in the browser, kept original');
    }

    this.state = STATE.ENCODING;
    this._emit('loading encoder…');
    try {
      const converted = await this._transcode(recording, container);
      return this._deliver(converted, `${baseName}.${this._format}`);
    } catch (e) {
      console.error('Recorder: conversion failed, saving the original recording instead', e);
      // An aborted wasm instance (e.g. out of memory) can't be reused
      resetFFmpeg();
      return this._deliver(recording, `${baseName}.${container}`, 'conversion failed, kept original');
    }
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

  _flush() {
    const recorder = this._mediaRecorder;
    return new Promise((resolve, reject) => {
      recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
      recorder.onstop = () => {
        resolve(new Blob(this._chunks, { type: recorder.mimeType || 'video/webm' }));
      };
      recorder.stop();
    });
  }

  async _transcode(recording, container) {
    const ffmpeg = await getFFmpeg(({ ratio }) => {
      if (this.state === STATE.ENCODING && typeof ratio === 'number' && ratio >= 0 && ratio <= 1) {
        this._emit(`encoding ${Math.round(ratio * 100)}%`);
      }
    });

    const inName = `in.${container}`;
    const outName = `out.${this._format}`;
    await ffmpeg.writeFile(inName, await fetchFile(recording));
    try {
      this._emit('encoding 0%');
      const exitCode = await ffmpeg.exec(ffmpegArgs(this._format, inName, outName));
      if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
      const data = await ffmpeg.readFile(outName);
      const outMime = this._format === 'mp4' ? 'video/mp4' : 'video/quicktime';
      return new Blob([data], { type: outMime });
    } finally {
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
