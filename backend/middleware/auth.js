/**
 * Admin authentication middleware.
 * Admin credentials come from environment variables (see .env.example).
 */
const crypto = require('crypto');

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Authentication required.' });
}

/** Constant-time string comparison to avoid timing attacks on login. */
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare anyway so both branches take similar time.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { requireAdmin, safeCompare };
