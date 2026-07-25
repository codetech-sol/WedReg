/**
 * CSRF protection (double-submit token bound to the session).
 *
 * - A random token is generated per session and exposed via GET /api/csrf.
 * - Every state-changing request (POST/PUT/PATCH/DELETE) must send it back
 *   in the `X-CSRF-Token` header. Cross-origin pages cannot read the token,
 *   so they cannot forge valid requests.
 */
const crypto = require('crypto');

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const sent = req.get('X-CSRF-Token');
  const expected = req.session.csrfToken;

  if (!sent || !expected || !timingSafeEqual(sent, expected)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token. Please refresh the page.' });
  }
  next();
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { csrfProtection, ensureCsrfToken };
