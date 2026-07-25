/**
 * Wedding Guest Registration System — Express application.
 *
 * Serves the API under /api and the static frontend from /frontend.
 *
 * Deployment modes:
 *  - Local / VPS:  `node backend/server.js` starts an HTTP listener.
 *  - Vercel:       api/index.js exports this app; Vercel invokes it as a
 *                  serverless function (no .listen call). Sessions live in
 *                  a signed cookie, so no server-side session store is
 *                  needed across function instances.
 */
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const helmet = require('helmet');

const { csrfProtection, ensureCsrfToken } = require('./middleware/csrf');
const { apiLimiter } = require('./middleware/rateLimiter');

const invitationsRouter = require('./api/invitations');
const registrationsRouter = require('./api/registrations');
const adminRouter = require('./api/admin');
const regulatorRouter = require('./api/regulator');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

// Behind a proxy (Vercel, nginx, etc.) trust X-Forwarded-* for req.ip.
if (IS_PROD) app.set('trust proxy', 1);

/* ---------------- Security headers ---------------- */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
      },
    },
  })
);

/* ---------------- Body parsing & sessions ---------------- */
app.use(express.json({ limit: '32kb' }));

if (!process.env.SESSION_SECRET && IS_PROD) {
  throw new Error('FATAL: SESSION_SECRET must be set in production.');
}

// Stateless signed-cookie sessions: work on serverless (Vercel) where
// in-memory stores don't survive between invocations. The cookie only
// holds small flags (csrf token, verified invitation, admin/regulator).
app.use(
  cookieSession({
    name: 'wedding.sid',
    keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')],
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD, // HTTPS-only cookies in production
    maxAge: 1000 * 60 * 60 * 2, // 2 hours
  })
);

/* ---------------- API ---------------- */
app.use('/api', apiLimiter);
app.use('/api', csrfProtection);

// Hands the client its CSRF token and current session state.
app.get('/api/session', (req, res) => {
  res.json({
    csrfToken: ensureCsrfToken(req),
    invitation: req.session.verifiedInvitation
      ? { guestName: req.session.verifiedInvitation.guestName }
      : null,
  });
});

app.use('/api/invitations', invitationsRouter);
app.use('/api/registrations', registrationsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/regulator', regulatorRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------------- Static frontend ---------------- */
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'admin.html')));
app.get('/regulator', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'pages', 'regulator.html')));

/* ---------------- Error handling ---------------- */
// Centralized handler: never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// On Vercel the platform invokes the exported app; locally we listen.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✔ Wedding Registration System running at http://localhost:${PORT}`);
    console.log(`  Guest page:  http://localhost:${PORT}/`);
    console.log(`  Admin panel: http://localhost:${PORT}/admin`);
    console.log(`  Regulator:   http://localhost:${PORT}/regulator`);
  });
}

module.exports = app;
