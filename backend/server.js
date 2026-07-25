/**
 * Local development server — API + static frontend.
 * On Vercel, only api/index.js (apiApp.js) is used; pages come from /public.
 */
const path = require('path');
const express = require('express');
const app = require('./apiApp');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const PORT = Number(process.env.PORT || 3000);

app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'admin.html')));
app.get('/regulator', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'regulator.html')));
app.get('/regulator.html', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'regulator.html')));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✔ Wedding Registration System running at http://localhost:${PORT}`);
    console.log(`  Guest page:  http://localhost:${PORT}/`);
    console.log(`  Admin panel: http://localhost:${PORT}/admin`);
    console.log(`  Regulator:   http://localhost:${PORT}/regulator`);
  });
}

module.exports = app;
