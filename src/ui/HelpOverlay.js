/**
 * Help and About: what soundSpace is, first steps, keyboard shortcuts, and
 * links to the source and licenses. A native <dialog>, so it traps focus,
 * closes with Esc and returns focus to whatever opened it.
 */

const SEEN_KEY = 'soundspace.helpSeen';
const REPO_URL = 'https://github.com/brandon-stargrave/soundSpace';

const SHORTCUTS = [
  ['Space', 'Pause or play'],
  ['M', 'Mute or unmute'],
  ['H', 'Reset the camera'],
  ['O', 'Slow cinematic orbit (hover the orbit button for its speed)'],
  ['F', 'Fullscreen'],
  ['U', 'Show or hide the panel'],
  ['S', 'Save a preset (while the panel is hidden)'],
  ['*', 'Launch a shooting star'],
  ['?', 'This help'],
];

let dialog = null;

function build() {
  const base = import.meta.env.BASE_URL;
  dialog = document.createElement('dialog');
  dialog.className = 'help-dialog';
  dialog.setAttribute('aria-labelledby', 'help-title');
  dialog.innerHTML = `
    <div class="help-body">
      <h2 id="help-title" tabindex="-1" autofocus>soundSpace</h2>
      <p class="help-lead">Nodes orbit a glowing nebula. When two cross, a note plays, snapped to a musical scale. Everything is adjustable, and it can drive your own synths over MIDI or OSC.</p>
      <h3>Try this</h3>
      <ol>
        <li>Listen and watch: each crossing flashes and plays a note. Headphones help.</li>
        <li>In <b>Orbit 1 · Generator</b>, change <b>Nodes</b>, <b>Node Speed</b> and <b>Trigger</b>.</li>
        <li>Add orbits with <b>+</b>, or turn on the <b>Harmonic Orbit</b> for chords under the melody.</li>
        <li>Open <b>Presets</b> to load an example, save your setup, or copy a link to share it.</li>
      </ol>
      <h3>Keyboard</h3>
      <table class="help-keys">
        <tbody>${SHORTCUTS.map(([key, action]) => `<tr><td><kbd>${key}</kbd></td><td>${action}</td></tr>`).join('')}</tbody>
      </table>
      <h3>About</h3>
      <p>Made by Brandon Stargrave. Free and open source under the MIT license.</p>
      <p class="help-links">
        <a href="${REPO_URL}" target="_blank" rel="noopener">Source and guide on GitHub</a>
        <a href="${base}LICENSE.txt" target="_blank" rel="noopener">License</a>
        <a href="${base}THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener">Third-party licenses</a>
      </p>
      <form method="dialog"><button class="btn help-close">Close</button></form>
    </div>`;
  // Clicking the backdrop closes it too
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.appendChild(dialog);
}

export function openHelp() {
  if (!dialog) build();
  if (dialog.open) return;
  dialog.showModal();
  try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
}

export function toggleHelp() {
  if (dialog?.open) dialog.close();
  else openHelp();
}

/** Show the help once, on a visitor's first session. */
export function showHelpOnFirstVisit() {
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch {}
  if (!seen) openHelp();
}
