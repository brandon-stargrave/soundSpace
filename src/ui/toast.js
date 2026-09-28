/**
 * Small transient messages at the bottom of the screen: "Preset loaded",
 * errors, and Undo for destructive actions. Announced to screen readers.
 */

let host = null;

function getHost() {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

/**
 * @param {string} message
 * @param {{ kind?: 'info'|'error', actionLabel?: string, onAction?: () => void, duration?: number }} [opts]
 */
export function showToast(message, { kind = 'info', actionLabel, onAction, duration = 6000 } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  let timer = null;
  const close = () => {
    clearTimeout(timer);
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 200);
  };

  if (actionLabel && onAction) {
    const action = document.createElement('button');
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      close();
      onAction();
    });
    toast.appendChild(action);
  }

  const dismiss = document.createElement('button');
  dismiss.className = 'toast-close';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', close);
  toast.appendChild(dismiss);

  getHost().appendChild(toast);
  // Keep the newest few on screen
  while (host.children.length > 3) host.firstChild.remove();
  timer = setTimeout(close, duration);
  return close;
}
