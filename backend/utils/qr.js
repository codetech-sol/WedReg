/**
 * QR ticket helpers.
 *
 * Each registration gets a QR code containing a compact JSON payload:
 *   { r: registrationId, c: invitationCode, n: guestName, s: signature }
 *
 * The signature is an HMAC over the other fields, so a QR code cannot be
 * forged or tampered with — the regulator endpoint re-computes the HMAC
 * and then cross-checks every field against the database.
 */
const crypto = require('crypto');
const QRCode = require('qrcode');

function secret() {
  const key = process.env.QR_SECRET || process.env.SESSION_SECRET;
  if (!key) throw new Error('QR_SECRET or SESSION_SECRET must be set to issue QR tickets.');
  return key;
}

function sign({ r, c, n }) {
  return crypto
    .createHmac('sha256', secret())
    .update(`${r}|${c}|${n}`)
    .digest('hex')
    .slice(0, 32); // 128 bits is ample and keeps the QR compact
}

/** Build the signed payload string that gets encoded into the QR image. */
function buildPayload({ registrationId, invitationCode, guestName }) {
  const body = { r: registrationId, c: invitationCode, n: guestName };
  return JSON.stringify({ ...body, s: sign(body) });
}

/**
 * Parse and authenticate a scanned payload.
 * Returns { ok: true, data } or { ok: false, reason }.
 */
function verifyPayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'Not a valid registration QR code.' };
  }
  const { r, c, n, s } = parsed || {};
  if (!Number.isInteger(r) || typeof c !== 'string' || typeof n !== 'string' || typeof s !== 'string') {
    return { ok: false, reason: 'QR code is missing required fields.' };
  }
  const expected = sign({ r, c, n });
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'QR code signature is invalid (possible forgery).' };
  }
  return { ok: true, data: { registrationId: r, invitationCode: c, guestName: n } };
}

/** Render the payload as a PNG data URL for embedding in the success card. */
async function generateQrDataUrl(ticket) {
  return QRCode.toDataURL(buildPayload(ticket), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 260,
    color: { dark: '#3d3230', light: '#ffffff' },
  });
}

module.exports = { buildPayload, verifyPayload, generateQrDataUrl };
