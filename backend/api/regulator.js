/**
 * Regulator (door check-in) API.
 *
 * Regulators scan the QR code on a guest's confirmation card. The scanned
 * payload is authenticated (HMAC) and cross-checked against the database:
 *   green  → signature valid AND record matches the system
 *   red    → anything else (forged, unknown, or mismatched data)
 *
 * A manual code lookup is also supported for guests whose QR won't scan.
 */
const express = require('express');
const pool = require('../database/db');
const { loginLimiter, verifyLimiter } = require('../middleware/rateLimiter');
const { safeCompare } = require('../middleware/auth');
const { verifyPayload } = require('../utils/qr');
const { logEvent } = require('../utils/audit');

const router = express.Router();

/* ---------------- Auth ---------------- */

router.post('/login', loginLimiter, (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!process.env.REGULATOR_PASSWORD || !safeCompare(password, process.env.REGULATOR_PASSWORD)) {
    logEvent('regulator_login_failed', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid access password.' });
  }
  // Replace the whole session on privilege change (fixation defence).
  req.session = { isRegulator: true };
  logEvent('regulator_login_success', { ip: req.ip });
  res.json({ success: true });
});

router.get('/session', (req, res) => {
  res.json({ authenticated: Boolean(req.session && (req.session.isRegulator || req.session.isAdmin)) });
});

function requireRegulator(req, res, next) {
  // Admins may also operate the scanner.
  if (req.session && (req.session.isRegulator || req.session.isAdmin)) return next();
  return res.status(401).json({ error: 'Authentication required.' });
}

/* ---------------- Verification ---------------- */

const GUEST_COLUMNS = `id, invitation_code, guest_name, guest_email, guest_phone,
                       has_plus_one, plus_one_name, registered_at`;

function guestSummary(reg) {
  return {
    registrationId: Number(reg.id),
    invitationCode: reg.invitation_code,
    guestName: reg.guest_name,
    guestEmail: reg.guest_email,
    guestPhone: reg.guest_phone,
    hasPlusOne: Boolean(reg.has_plus_one),
    plusOneName: reg.has_plus_one ? reg.plus_one_name : null,
    registeredAt: reg.registered_at,
  };
}

/**
 * POST /api/regulator/verify
 * Body: { payload: "<scanned QR string>" }  OR  { code: "WED-XXXX-XXXX" }
 * Always answers 200 with { match: true|false } so the scanner UI can
 * simply flip green/red; HTTP errors are reserved for auth/transport.
 */
router.post('/verify', requireRegulator, verifyLimiter, async (req, res, next) => {
  try {
    const { payload, code } = req.body || {};

    // Manual fallback: look up by invitation code alone.
    if (!payload && code) {
      const normalized = String(code).trim().toUpperCase();
      const { rows } = await pool.query(
        `SELECT ${GUEST_COLUMNS} FROM registrations WHERE invitation_code = $1`,
        [normalized]
      );
      if (!rows[0]) {
        logEvent('checkin_failed', { code: normalized, ip: req.ip, detail: 'no registration for code' });
        return res.json({ match: false, reason: 'No registration found for this invitation code.' });
      }
      logEvent('checkin_success', { code: rows[0].invitation_code, ip: req.ip, detail: 'manual lookup' });
      return res.json({ match: true, guest: guestSummary(rows[0]) });
    }

    if (typeof payload !== 'string' || !payload) {
      return res.json({ match: false, reason: 'Nothing was scanned.' });
    }

    // 1. Authenticate the QR payload itself (signature check).
    const check = verifyPayload(payload);
    if (!check.ok) {
      logEvent('checkin_failed', { ip: req.ip, detail: check.reason });
      return res.json({ match: false, reason: check.reason });
    }

    // 2. Cross-check every field against what the system has on record.
    const { registrationId, invitationCode, guestName } = check.data;
    const { rows } = await pool.query(
      `SELECT ${GUEST_COLUMNS} FROM registrations WHERE id = $1`,
      [registrationId]
    );
    const reg = rows[0];
    if (!reg) {
      logEvent('checkin_failed', { code: invitationCode, ip: req.ip, detail: 'registration not found' });
      return res.json({ match: false, reason: 'This registration does not exist in the system.' });
    }
    if (reg.invitation_code !== invitationCode || reg.guest_name !== guestName) {
      logEvent('checkin_failed', { code: invitationCode, ip: req.ip, detail: 'details mismatch' });
      return res.json({
        match: false,
        reason: 'QR details do not match the registration on record.',
      });
    }

    logEvent('checkin_success', { code: reg.invitation_code, ip: req.ip, detail: `registration #${reg.id}` });
    return res.json({ match: true, guest: guestSummary(reg) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
