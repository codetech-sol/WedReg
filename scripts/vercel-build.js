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

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function publishPage(publicDir, pagesDir, name) {
  const src = path.join(pagesDir, `${name}.html`);
  if (name === 'index') {
    fs.copyFileSync(src, path.join(publicDir, 'index.html'));
    return;
  }
  // /admin.html and /regulator.html
  fs.copyFileSync(src, path.join(publicDir, `${name}.html`));
  // /admin/ and /regulator/ via index.html inside a folder
  const dir = path.join(publicDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, 'index.html'));
}

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const frontendDir = path.join(root, 'frontend');
const pagesDir = path.join(frontendDir, 'pages');

fs.rmSync(publicDir, { recursive: true, force: true });
copyDir(frontendDir, publicDir);

publishPage(publicDir, pagesDir, 'index');
publishPage(publicDir, pagesDir, 'admin');
publishPage(publicDir, pagesDir, 'regulator');

console.log('✔ Built public/ for Vercel');
console.log('  Pages: /  /admin.html  /admin/  /regulator.html  /regulator/');
