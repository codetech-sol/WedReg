/**
 * Vercel build — publish frontend as static files in /public.
 *
 * Creates THREE URL patterns for admin/regulator so routing always works:
 *   /admin.html          (direct file)
 *   /admin/index.html    (directory index → /admin/)
 *   cleanUrls + redirects in vercel.json map /admin → admin.html
 */
const fs = require('fs');
const path = require('path');
const { publishPages } = require('./publish-pages');

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
publishPages(publicDir, pagesDir);

console.log('✔ Built public/ for Vercel');
console.log('  Pages: /  /admin.html  /admin/  /regulator.html  /regulator/');
