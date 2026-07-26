/**
 * API-only Express app (used by Vercel serverless via api/index.js).
 *
 * Page routes (/admin, /regulator, /) are NEVER handled here on Vercel —
 * they are served as static HTML from /public by the CDN (see vercel-build.js).
 */
require('dotenv').config();
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
const IS_VERCEL = Boolean(process.env.VERCEL);
const IS_PROD = process.env.NODE_ENV === 'production' || IS_VERCEL;
// Secure cookies only on HTTPS (Vercel) or when explicitly enabled.
// With NODE_ENV=production on http://localhost, Secure cookies are dropped by browsers.
const SECURE_COOKIES =
  IS_VERCEL || String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';

if (IS_PROD) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        frameSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
      },
    },
  })
);

app.use(express.json({ limit: '32kb' }));

if (!process.env.SESSION_SECRET && IS_PROD) {
  throw new Error('FATAL: SESSION_SECRET must be set in production.');
}

app.use(
  cookieSession({
    name: 'wedding.sid',
    keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')],
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIES,
    maxAge: 1000 * 60 * 60 * 2,
  })
);

app.use('/api', apiLimiter);
app.use('/api', csrfProtection);

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

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
