import { Engine } from './core/Engine.js';
import { OrbitalNodes } from './generators/OrbitalNodes.js';
import { ConfigPanel } from './ui/ConfigPanel.js';

const engine = new Engine(document.getElementById('canvas-container'));
let configPanel = null;

// Start overlay — audio context requires user gesture
async function startApp() {
  const overlay = document.getElementById('start-overlay');
  if (overlay.dataset.started) return;
  overlay.dataset.started = 'true';
  overlay.classList.add('fading');

  try {
    await engine.initAudio();
  } catch (e) {
    // Audio may fail without real user gesture — visuals still run
    console.warn('Audio init deferred:', e.message);
  }

  await engine.addOrbit(OrbitalNodes, { radius: 3.0 });
  configPanel = new ConfigPanel(engine);
  configPanel.init();
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

document.getElementById('start-button').addEventListener('click', startApp);
window._startSoundSpace = startApp;

// Expose engine for debugging
if (typeof window !== 'undefined') {
  window._soundSpace = engine;
}
