/**
 * Toast notifications — lightweight, accessible (aria-live), auto-dismissing.
 */
function container() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}

export function toast(message, type = 'info', duration = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  container().appendChild(el);

  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}
