import { Engine } from './core/Engine.js';
import { OrbitalNodes } from './generators/OrbitalNodes.js';
import { ConfigPanel } from './ui/ConfigPanel.js';
import { toggleHelp, showHelpOnFirstVisit } from './ui/HelpOverlay.js';
import { hasSharedSetup, readSharedSetup, clearSharedSetupFromUrl } from './ui/ShareLink.js';
import { showToast } from './ui/toast.js';

// ── Loader state + helpers ──────────────────────────────────────────
// The HTML overlay starts in `.loading` state (ring + progress bar). After
// engine construction completes we switch to `.ready` (Start button shown).
// After the user clicks, we switch to `.starting` while audio + first orbit
// initialize, then fade the overlay out. Any failure switches to `.error`.

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

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Replace the loader with a readable message and a Reload button. */
function showFatal(message) {
  overlay.classList.remove('loading', 'ready', 'starting', 'fading');
  overlay.classList.add('error');
  overlay.style.display = '';
  if (statusEl) statusEl.textContent = message;
  if (!overlay.querySelector('.reload-button')) {
    const reload = document.createElement('button');
    reload.className = 'reload-button';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => location.reload());
    overlay.appendChild(reload);
  }
}

// ── Boot phase: construct Engine with progress reporting ───────────
// The Engine constructor does heavy synchronous work (renderer, PMREM env
// map, post-processing chain, ~1500-star field, diffraction stars). We
// yield a frame first so the pre-JS CSS loader is visible on screen, then
// update progress as we complete each phase.

let engine = null;
let configPanel = null;

async function bootEngine() {
  if (!hasWebGL()) {
    showFatal('soundSpace needs WebGL. Turn on hardware acceleration in your browser settings, or try a current Chrome, Firefox or Safari.');
    return;
  }

  setProgress(5, 'initializing scene');
  await yieldFrame();

  // Full Engine construction happens here. It's synchronous but the yield
  // above ensures the loading UI is painted before it starts.
  engine = new Engine(document.getElementById('canvas-container'));
  window._soundSpace = engine; // debug handle
  window.addEventListener('pagehide', () => engine.midiOutput.allNotesOff());

  setProgress(70, 'finalizing visuals');
  await yieldFrame();

  // Small second yield so the bar visibly jumps to 70% before going to 100%
  setProgress(100, 'ready');
  await yieldFrame();

  overlay.classList.remove('loading');
  overlay.classList.add('ready');
  if (statusEl) statusEl.textContent = 'sound on · headphones recommended';

  const btn = document.getElementById('start-button');
  btn.addEventListener('click', startApp);
  btn.focus();
}

// Start overlay — audio context requires user gesture
async function startApp() {
  if (!engine) return;
  if (overlay.dataset.started) return;
  overlay.dataset.started = 'true';

  // Start audio inside the click itself: Safari only unlocks audio when it is
  // resumed synchronously within the gesture. The engine retries on later
  // clicks or key presses if this attempt fails.
  const audioReady = engine.initAudio();

  // Switch overlay to post-click progress state
  overlay.classList.remove('ready');
  overlay.classList.add('starting');
  setProgress(10, 'initializing audio');
  await yieldFrame();

  try {
    await audioReady;
  } catch (e) {
    // Visuals still run; audio starts on the next click or key press
    console.warn('Audio init deferred:', e.message);
  }

  try {
    setProgress(55, 'spawning orbit');
    await yieldFrame();

    await engine.addOrbit(OrbitalNodes, { radius: 3.0 });

    setProgress(85, 'building interface');
    await yieldFrame();

    configPanel = new ConfigPanel(engine);
    configPanel.init();

    setProgress(100, 'ready');
    await yieldFrame();
  } catch (err) {
    console.error('soundSpace failed to start:', err);
    showFatal('Something went wrong while starting. Reload the page to try again.');
    return;
  }

  overlay.classList.add('fading');
  engine.start();
  wireSceneControls();

  // A shared link opens its setup; first-time visitors otherwise get the help
  if (hasSharedSetup()) {
    openSharedSetup();
  } else {
    showHelpOnFirstVisit();
  }

  setTimeout(() => {
    overlay.style.display = 'none';
  }, 600);
}

/** Load the setup from a share link (validated like any preset; MIDI/OSC settings are never taken from links). */
async function openSharedSetup() {
  try {
    const data = await readSharedSetup();
    delete data.io;
    const loaded = await configPanel.presets.apply(data, 'the shared setup');
    if (loaded) clearSharedSetupFromUrl();
  } catch (err) {
    showToast(err.message, { kind: 'error', duration: 8000 });
    clearSharedSetupFromUrl();
  }
}

/** True when a key press belongs to the focused control rather than to a shortcut. */
function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(target.type);
}

function wireSceneControls() {
  const homeBtn = document.getElementById('home-button');
  const orbitBtn = document.getElementById('orbit-button');
  const orbitControl = document.getElementById('orbit-control');
  const fsBtn = document.getElementById('fullscreen-button');
  // iPhone Safari has no element fullscreen
  const canFullscreen = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  homeBtn.classList.add('visible');
  orbitControl.classList.add('visible');
  if (canFullscreen) fsBtn.classList.add('visible');

  function toggleFullscreen() {
    if (!canFullscreen) return;
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    request?.catch?.(() => {});
  }

  function setOrbitActive(active) {
    orbitBtn.classList.toggle('active', active);
    orbitBtn.setAttribute('aria-pressed', String(active));
  }

  function resetCamera() {
    engine.sceneManager.resetCamera();
    setOrbitActive(false);
  }

  function toggleOrbit() {
    setOrbitActive(engine.sceneManager.toggleOrbitMode());
  }

  fsBtn.addEventListener('click', () => toggleFullscreen());
  document.addEventListener('fullscreenchange', () => {
    fsBtn.classList.toggle('active', !!document.fullscreenElement);
    fsBtn.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  });
  homeBtn.addEventListener('click', resetCamera);
  orbitBtn.addEventListener('click', toggleOrbit);

  // Orbit speed popover: a sibling of the orbit button in a shared wrapper,
  // shown while either is hovered or focused
  const orbitSpeedPopover = document.createElement('div');
  orbitSpeedPopover.className = 'orbit-speed-popover';
  orbitSpeedPopover.innerHTML =
    '<label class="orbit-speed-label" for="orbit-speed">Speed</label>' +
    '<input id="orbit-speed" type="range" min="0.02" max="0.6" step="0.01" />';
  const orbitSpeedSlider = orbitSpeedPopover.querySelector('input');
  orbitSpeedSlider.value = String(engine.sceneManager._orbitSpeed ?? 0.12);
  orbitSpeedSlider.addEventListener('input', () => {
    engine.sceneManager.setOrbitSpeed(parseFloat(orbitSpeedSlider.value));
  });
  orbitControl.appendChild(orbitSpeedPopover);

  // Deactivate orbit button style when orbit mode is interrupted
  engine.sceneManager.renderer.domElement.addEventListener('pointerdown', () => {
    if (!engine.sceneManager._orbitMode) setOrbitActive(false);
  });

  // Keyboard shortcuts. Modified keys belong to the browser (Cmd+F, Ctrl+S…),
  // and held keys would toggle state dozens of times a second.
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.isComposing) return;
    const target = e.target;
    if (isTextEntry(target)) return;

    switch (e.key) {
      case 'h': case 'H':
        resetCamera();
        break;
      case 'o': case 'O':
        toggleOrbit();
        break;
      case 's': case 'S':
        if (configPanel.isCollapsed()) configPanel.presets.save();
        break;
      case 'u': case 'U':
        configPanel.setCollapsed(!configPanel.isCollapsed());
        break;
      case 'f': case 'F':
        toggleFullscreen();
        break;
      case '*': // Shift+8
        engine.sceneManager.spawnShootingStar();
        break;
      case ' ':
        // Space activates a focused button, summary or checkbox; leave that alone
        if (target.tagName === 'BUTTON' || target.tagName === 'SUMMARY' || target.type === 'checkbox') return;
        e.preventDefault();
        configPanel.togglePause();
        break;
      case 'm': case 'M':
        configPanel.toggleMute();
        break;
      case '?':
        toggleHelp();
        break;
    }
  });

  // Auto-hide UI + cursor in fullscreen when sidebar collapsed + idle
  let _hideTimer = null;
  const _hideDelay = 3000;
  const _hideTargets = [homeBtn, orbitControl, fsBtn];

  function showUI() {
    document.body.classList.remove('ui-hidden');
    for (const el of _hideTargets) el.style.opacity = '';
    clearTimeout(_hideTimer);
    if (document.fullscreenElement && configPanel.isCollapsed()) {
      _hideTimer = setTimeout(hideUI, _hideDelay);
    }
  }

  function hideUI() {
    if (!document.fullscreenElement || !configPanel.isCollapsed()) return;
    document.body.classList.add('ui-hidden');
    for (const el of _hideTargets) el.style.opacity = '0';
  }

  document.addEventListener('mousemove', showUI);
  document.addEventListener('mousedown', showUI);
  document.addEventListener('keydown', showUI);
  // Collapsing the panel (button or U key) is what arms the fullscreen auto-hide
  configPanel.onCollapsedChange = showUI;
  document.addEventListener('fullscreenchange', showUI);
}

// Kick off engine construction now that the pre-JS loading UI is visible
bootEngine().catch(err => {
  console.error('Engine boot failed:', err);
  showFatal(hasWebGL()
    ? 'soundSpace failed to load. Reload the page to try again.'
    : 'soundSpace needs WebGL. Turn on hardware acceleration in your browser settings, or try a current Chrome, Firefox or Safari.');
});
