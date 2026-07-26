/**
 * Copy npm vendor bundles and publish HTML pages for local static serving.
 */
const fs = require('fs');
const path = require('path');
const { publishPages } = require('./publish-pages');

const root = path.join(__dirname, '..');
const pagesDir = path.join(root, 'frontend', 'pages');
const frontendDir = path.join(root, 'frontend');

publishPages(frontendDir, pagesDir);
console.log('✔ Published pages for local dev (/admin.html, /regulator.html)');
