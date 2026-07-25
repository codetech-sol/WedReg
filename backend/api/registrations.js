/**
 * Registration API.
 *
 * POST /api/registrations
 *   Requires a previously verified invitation stored in the session.
 *   Inserts the registration AND marks the invitation as used inside a
 *   single database transaction — if anything fails, everything rolls back
 *   and the invitation stays unused.
 */
const express = require('express');
const pool = require('../database/db');
const { validateRegistration } = require('../utils/validators');
const { logEvent } = require('../utils/audit');
const { generateQrDataUrl } = require('../utils/qr');

const router = express.Router();

/**
 * Atomic register-and-mark-used inside a Postgres transaction.
 * SELECT ... FOR UPDATE locks the invitation row, closing any race window
 * between verification and submission (double-submit, two tabs, etc.).
 */
async function registerTransaction(data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inv = await client.query(
      `SELECT id, status FROM invitations WHERE id = $1 FOR UPDATE`,
      [data.invitationId]
    );
    if (!inv.rows[0] || inv.rows[0].status !== 'unused') {
      const err = new Error('ALREADY_REGISTERED');
      err.code = 'ALREADY_REGISTERED';
      throw err;
    }

    const inserted = await client.query(
      `INSERT INTO registrations
         (invitation_id, invitation_code, guest_name, guest_email, guest_phone,
          has_plus_one, plus_one_name, plus_one_phone, plus_one_id, ip_address, browser)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        data.invitationId, data.invitationCode, data.guestName, data.guestEmail,
        data.guestPhone, data.hasPlusOne, data.plusOneName, data.plusOnePhone,
        data.plusOneId, data.ipAddress, data.browser,
      ]
    );

    const updated = await client.query(
      `UPDATE invitations SET status = 'used', used_at = now()
       WHERE id = $1 AND status = 'unused'`,
      [data.invitationId]
    );
    if (updated.rowCount !== 1) {
      const err = new Error('ALREADY_REGISTERED');
      err.code = 'ALREADY_REGISTERED';
      throw err;
    }

    await client.query('COMMIT');
    return Number(inserted.rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.post('/', async (req, res) => {
  const verified = req.session.verifiedInvitation;
  if (!verified) {
    return res.status(401).json({
      error: 'Please verify your invitation code first.',
    });
  }

  const { ok, errors, value } = validateRegistration(req.body);
  if (!ok) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }

  try {
    const registrationId = await registerTransaction({
      invitationId: verified.id,
      invitationCode: verified.code,
      guestName: value.guestName,
      guestEmail: value.guestEmail,
      guestPhone: value.guestPhone,
      hasPlusOne: value.hasPlusOne,
      plusOneName: value.plusOneName,
      plusOnePhone: value.plusOnePhone,
      plusOneId: value.plusOneId,
      ipAddress: req.ip,
      browser: (req.get('User-Agent') || '').slice(0, 400),
    });

    // Invitation is consumed — clear it so the form can never reopen.
    delete req.session.verifiedInvitation;

    logEvent('registration_success', {
      code: verified.code,
      ip: req.ip,
      detail: `registration #${registrationId}`,
    });

    // Signed entry-ticket QR for the success card. If rendering ever fails,
    // the registration itself must still succeed — QR is best-effort.
    let qr = null;
    try {
      qr = await generateQrDataUrl({
        registrationId,
        invitationCode: verified.code,
        guestName: value.guestName,
      });
    } catch (qrErr) {
      console.error('QR generation failed:', qrErr.message);
    }

    return res.status(201).json({
      success: true,
      registrationId,
      qr,
      message: 'Your registration has been received successfully.',
    });
  } catch (err) {
    // 23505 = Postgres unique_violation (registrations.invitation_id UNIQUE)
    if (err.code === 'ALREADY_REGISTERED' || err.code === '23505') {
      delete req.session.verifiedInvitation;
      logEvent('registration_duplicate', { code: verified.code, ip: req.ip });
      return res.status(409).json({ error: 'This invitation has already been registered.' });
    }
    console.error('Registration failed:', err);
    logEvent('registration_error', { code: verified.code, ip: req.ip, detail: err.message });
    return res.status(500).json({
      error: 'We could not save your registration. Nothing was recorded — please try again.',
    });
  }
});

module.exports = router;
