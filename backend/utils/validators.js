/**
 * Server-side validation helpers.
 *
 * Frontend validation is a courtesy; these functions are the source of truth.
 * Every value is trimmed before validation.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Digits, spaces, dashes, parentheses, optional leading +. 7–20 significant chars.
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;
const CODE_RE = /^[A-Za-z0-9\-]{4,40}$/;

const trim = (v) => (typeof v === 'string' ? v.trim() : '');

function validateInvitationCode(raw) {
  const code = trim(raw).toUpperCase();
  if (!code) return { ok: false, error: 'Please enter your invitation code.' };
  if (!CODE_RE.test(code)) return { ok: false, error: 'Invitation code format is not valid.' };
  return { ok: true, value: code };
}

/**
 * Validate the full registration payload.
 * Returns { ok, errors, value } where value contains cleaned data.
 */
function validateRegistration(body) {
  const errors = {};
  const guestName = trim(body.guestName);
  const guestEmail = trim(body.guestEmail).toLowerCase();
  const guestPhone = trim(body.guestPhone);
  const hasPlusOne = body.hasPlusOne === true || body.hasPlusOne === 'true';
  const plusOneName = trim(body.plusOneName);
  const plusOnePhone = trim(body.plusOnePhone);
  const plusOneId = trim(body.plusOneId);

  if (!guestName) errors.guestName = 'Full name is required.';
  else if (guestName.length > 120) errors.guestName = 'Name is too long (max 120 characters).';

  if (!guestEmail) errors.guestEmail = 'Email address is required.';
  else if (!EMAIL_RE.test(guestEmail)) errors.guestEmail = 'Please enter a valid email address.';

  if (guestPhone && !PHONE_RE.test(guestPhone))
    errors.guestPhone = 'Please enter a valid phone number.';

  if (hasPlusOne) {
    if (!plusOneName) errors.plusOneName = "Please enter your plus one's full name.";
    else if (plusOneName.length > 120) errors.plusOneName = 'Name is too long (max 120 characters).';

    if (plusOnePhone && !PHONE_RE.test(plusOnePhone))
      errors.plusOnePhone = 'Please enter a valid phone number.';

    if (!plusOneId) errors.plusOneId = 'National ID / passport number is required for your plus one.';
    else if (plusOneId.length > 40) errors.plusOneId = 'ID number is too long (max 40 characters).';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      guestName,
      guestEmail,
      guestPhone: guestPhone || null,
      hasPlusOne,
      plusOneName: hasPlusOne ? plusOneName : null,
      plusOnePhone: hasPlusOne && plusOnePhone ? plusOnePhone : null,
      plusOneId: hasPlusOne ? plusOneId : null,
    },
  };
}

module.exports = { validateInvitationCode, validateRegistration, trim };
