/**
 * Invitation verification API.
 *
 * POST /api/invitations/verify
 *   Body: { code }
 *   Validates the code server-side against the master invitation table.
 *   On success, stores the verified invitation in the session so the
 *   registration endpoint can trust it (never the frontend).
 */
const express = require('express');
const pool = require('../database/db');
const { validateInvitationCode } = require('../utils/validators');
const { verifyLimiter } = require('../middleware/rateLimiter');
const { logEvent } = require('../utils/audit');

const router = express.Router();

router.post('/verify', verifyLimiter, async (req, res, next) => {
  try {
    const check = validateInvitationCode(req.body.code);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    // Codes are stored uppercase; the validator uppercases the input.
    const { rows } = await pool.query(
      `SELECT id, invitation_code, guest_name, status FROM invitations
       WHERE invitation_code = $1`,
      [check.value]
    );
    const invitation = rows[0];

    if (!invitation) {
      logEvent('verify_failed', { code: check.value, ip: req.ip, detail: 'code not found' });
      return res.status(404).json({
        error: 'Invalid invitation code.',
        hint: 'Please check your code and try again.',
      });
    }

    if (invitation.status === 'used') {
      logEvent('verify_used', { code: invitation.invitation_code, ip: req.ip });
      return res.status(409).json({
        error: 'This invitation code has already been used.',
        hint: 'If you believe this is an error, please contact the wedding organizers.',
      });
    }

    // Store the verified invitation server-side (signed session cookie);
    // the registration endpoint reads it from the session and never trusts
    // a code sent by the client.
    req.session.verifiedInvitation = {
      id: Number(invitation.id),
      code: invitation.invitation_code,
      guestName: invitation.guest_name,
      verifiedAt: Date.now(),
    };

    logEvent('verify_success', { code: invitation.invitation_code, ip: req.ip });

    return res.json({
      valid: true,
      guestName: invitation.guest_name,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
