/**
 * Publish HTML pages so they are reachable as /admin.html, /regulator.html, etc.
 * Used by vercel-build (→ public/) and postinstall (→ frontend/ for local dev).
 */
const fs = require('fs');
const path = require('path');

/**
 * @param {string} targetDir — e.g. public/ or frontend/
 * @param {string} pagesDir — frontend/pages/
 */
function publishPages(targetDir, pagesDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  const copy = (name, destName = name) => {
    const src = path.join(pagesDir, `${name}.html`);
    if (!fs.existsSync(src)) return;
    fs.copyFileSync(src, path.join(targetDir, `${destName}.html`));
  };

  copy('index');
  copy('admin');
  copy('regulator');

  // Directory indexes: /admin/ and /regulator/
  for (const name of ['admin', 'regulator']) {
    const dir = path.join(targetDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(pagesDir, `${name}.html`), path.join(dir, 'index.html'));
  }
}

module.exports = { publishPages };
