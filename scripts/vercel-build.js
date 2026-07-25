/**
 * Vercel build step — copy the frontend into /public so Vercel's CDN
 * can serve HTML/CSS/JS. (express.static is ignored on Vercel.)
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

fs.rmSync(publicDir, { recursive: true, force: true });
copyDir(frontendDir, publicDir);

console.log('✔ Copied frontend/ → public/ for Vercel static hosting');
