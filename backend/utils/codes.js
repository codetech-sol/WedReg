/**
 * Invitation code generation helpers.
 */
const crypto = require('crypto');

// Unambiguous alphabet (no 0/O, 1/I/L) so codes are easy to read from print.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generate a random invitation code like "WED-K4TP-9XQ2".
 * Uses crypto.randomInt for unpredictable codes.
 */
function generateInvitationCode(prefix = 'WED') {
  const block = (len) =>
    Array.from({ length: len }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  return `${prefix}-${block(4)}-${block(4)}`;
}

module.exports = { generateInvitationCode };
