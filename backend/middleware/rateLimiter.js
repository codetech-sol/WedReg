/**
 * Rate limiters.
 *
 * The invitation-code verifier is the most attack-prone endpoint (codes can
 * be brute-forced), so it gets a strict per-IP limit. Login gets one too.
 */
const rateLimit = require('express-rate-limit');

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.VERIFY_RATE_LIMIT || 10), // attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a minute and try again.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // login attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // general API ceiling
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

module.exports = { verifyLimiter, loginLimiter, apiLimiter };
