/**
 * Dark mode toggle — persisted in localStorage, respects system preference.
 */
const KEY = 'wedding-theme';

export function initTheme(toggleButton) {
  const saved = localStorage.getItem(KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  apply(saved || (prefersDark ? 'dark' : 'light'));

  toggleButton?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
  });

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    if (toggleButton) {
      toggleButton.textContent = theme === 'dark' ? '☀' : '☾';
      toggleButton.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
    }
  }
}
