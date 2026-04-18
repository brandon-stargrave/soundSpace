import { Engine } from './core/Engine.js';
import { OrbitalNodes } from './generators/OrbitalNodes.js';
import { ConfigPanel } from './ui/ConfigPanel.js';

// ── Loader state + helpers ──────────────────────────────────────────
// The HTML overlay starts in `.loading` state (ring + progress bar). After
// engine construction completes we switch to `.ready` (Start button shown).
// After the user clicks, we switch to `.starting` while audio + first orbit
// initialize, then fade the overlay out.

const overlay = document.getElementById('start-overlay');
const statusEl = document.getElementById('start-status');
const barEl = document.getElementById('loader-bar');

function setProgress(pct, label) {
  if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (label && statusEl) statusEl.textContent = label;
}

/** Yield once to the browser so it can paint the loader/progress update. */
function yieldFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

// ── Boot phase: construct Engine with progress reporting ───────────
// The Engine constructor does heavy synchronous work (renderer, PMREM env
// map, post-processing chain, ~1500-star field, diffraction stars). We
// yield a frame first so the pre-JS CSS loader is visible on screen, then
// update progress as we complete each phase.

let engine = null;
let configPanel = null;

async function bootEngine() {
  setProgress(5, 'initializing scene');
  await yieldFrame();

  // Full Engine construction happens here. It's synchronous but the yield
  // above ensures the loading UI is painted before it starts.
  engine = new Engine(document.getElementById('canvas-container'));
  window._soundSpace = engine; // debug handle

  setProgress(70, 'finalizing visuals');
  await yieldFrame();

  // Small second yield so the bar visibly jumps to 70% before going to 100%
  setProgress(100, 'ready');
  await yieldFrame();

  overlay.classList.remove('loading');
  overlay.classList.add('ready');
  if (statusEl) statusEl.textContent = 'click to begin';

  // Wire click-to-start once the Start button is visible
  const btn = document.getElementById('start-button');
  btn.addEventListener('click', startApp);
}

// Start overlay — audio context requires user gesture
async function startApp() {
  if (!engine) return;
  if (overlay.dataset.started) return;
  overlay.dataset.started = 'true';

  // Switch overlay to post-click progress state
  overlay.classList.remove('ready');
  overlay.classList.add('starting');
  setProgress(10, 'initializing audio');
  await yieldFrame();

  try {
    await engine.initAudio();
  } catch (e) {
    // Audio may fail without real user gesture — visuals still run
    console.warn('Audio init deferred:', e.message);
  }

  setProgress(55, 'spawning orbit');
  await yieldFrame();

  await engine.addOrbit(OrbitalNodes, { radius: 3.0 });

  setProgress(85, 'building interface');
  await yieldFrame();

  configPanel = new ConfigPanel(engine);
  configPanel.init();

  setProgress(100, 'ready');
  await yieldFrame();

  overlay.classList.add('fading');
  engine.start();

  // Camera control buttons
  const homeBtn = document.getElementById('home-button');
  const orbitBtn = document.getElementById('orbit-button');
  const fsBtn = document.getElementById('fullscreen-button');
  homeBtn.classList.add('visible');
  orbitBtn.classList.add('visible');
  fsBtn.classList.add('visible');

  // Fullscreen
  fsBtn.addEventListener('click', () => toggleFullscreen());
  document.addEventListener('fullscreenchange', () => {
    fsBtn.classList.toggle('active', !!document.fullscreenElement);
  });

  homeBtn.addEventListener('click', () => {
    engine.sceneManager.resetCamera();
    orbitBtn.classList.remove('active');
  });

  orbitBtn.addEventListener('click', () => {
    const active = engine.sceneManager.toggleOrbitMode();
    orbitBtn.classList.toggle('active', active);
  });

  // Deactivate orbit button style when orbit mode is interrupted
  const checkOrbitState = () => {
    if (!engine.sceneManager._orbitMode) {
      orbitBtn.classList.remove('active');
    }
  };
  engine.sceneManager.renderer.domElement.addEventListener('pointerdown', checkOrbitState);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'h' || e.key === 'H') {
      engine.sceneManager.resetCamera();
      orbitBtn.classList.remove('active');
    }
    if (e.key === 'o' || e.key === 'O') {
      const active = engine.sceneManager.toggleOrbitMode();
      orbitBtn.classList.toggle('active', active);
    }
    if ((e.key === 's' || e.key === 'S') && configPanel._collapsed) {
      configPanel.presets.save();
    }
    if (e.key === 'u' || e.key === 'U') {
      configPanel._collapsed = !configPanel._collapsed;
      configPanel.panel.classList.toggle('collapsed', configPanel._collapsed);
    }
    if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    }
    if (e.key === '*') { // Shift+8
      engine.sceneManager.spawnShootingStar();
    }
    if (e.key === ' ') {
      e.preventDefault();
      const paused = engine.togglePause();
      // Sync transport button state
      const playBtn = document.querySelector('.transport-btn');
      if (playBtn) {
        playBtn.innerHTML = paused
          ? '<span class="transport-icon">&#9654;</span><span class="transport-label">Play</span>'
          : '<span class="transport-icon">&#9646;&#9646;</span><span class="transport-label">Pause</span>';
        playBtn.title = paused ? 'Play' : 'Pause';
        playBtn.classList.toggle('inactive', paused);
      }
    }
    if (e.key === 'm' || e.key === 'M') {
      const muted = engine.toggleMute();
      // Sync transport button state
      const muteBtn = document.querySelectorAll('.transport-btn')[1];
      if (muteBtn) {
        muteBtn.classList.toggle('muted', muted);
        muteBtn.innerHTML = muted
          ? '<span class="transport-icon">&#9835;</span><span class="transport-label">Unmute</span>'
          : '<span class="transport-icon">&#9835;</span><span class="transport-label">Mute</span>';
        muteBtn.title = muted ? 'Unmute' : 'Mute';
      }
    }
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // Auto-hide UI + cursor in fullscreen when sidebar collapsed + idle
  let _hideTimer = null;
  const _hideDelay = 3000;
  const _hideTargets = [homeBtn, orbitBtn, fsBtn];

  function showUI() {
    document.body.classList.remove('ui-hidden');
    for (const el of _hideTargets) el.style.opacity = '';
    clearTimeout(_hideTimer);
    if (document.fullscreenElement && configPanel._collapsed) {
      _hideTimer = setTimeout(hideUI, _hideDelay);
    }
  }

  function hideUI() {
    if (!document.fullscreenElement || !configPanel._collapsed) return;
    document.body.classList.add('ui-hidden');
    for (const el of _hideTargets) el.style.opacity = '0';
  }

  document.addEventListener('mousemove', showUI);
  document.addEventListener('mousedown', showUI);
  document.addEventListener('keydown', showUI);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      showUI();
    } else if (configPanel._collapsed) {
      _hideTimer = setTimeout(hideUI, _hideDelay);
    }
  });

  setTimeout(() => {
    overlay.style.display = 'none';
  }, 600);
}

// Expose startApp so devs can trigger it manually from the console
window._startSoundSpace = startApp;

// Kick off engine construction now that the pre-JS loading UI is visible
bootEngine().catch(err => {
  console.error('Engine boot failed:', err);
  if (statusEl) statusEl.textContent = 'load failed — see console';
});
