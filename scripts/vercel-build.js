/**
 * Vercel build step — copy the frontend into /public so Vercel's CDN
 * can serve HTML/CSS/JS. (express.static is ignored on Vercel.)
 *
 * Also copies key pages to the public root so /, /admin, and /regulator
 * resolve without fragile rewrites.
 */
const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const frontendDir = path.join(root, 'frontend');
const pagesDir = path.join(frontendDir, 'pages');

fs.rmSync(publicDir, { recursive: true, force: true });
copyDir(frontendDir, publicDir);

// Root-level HTML so Vercel serves /, /admin, /regulator directly.
const rootPages = [
  ['index.html', 'index.html'],
  ['admin.html', 'admin.html'],
  ['regulator.html', 'regulator.html'],
];
for (const [src, dest] of rootPages) {
  fs.copyFileSync(path.join(pagesDir, src), path.join(publicDir, dest));
}

console.log('✔ Built public/ for Vercel (frontend + root HTML pages)');
