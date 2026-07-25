/**
 * Audit logging — records invitation validation attempts, registrations,
 * check-ins, and logins. Fire-and-forget: failures here must never break
 * the main request flow.
 */
const pool = require('../database/db');

function logEvent(eventType, { code = null, ip = null, detail = null } = {}) {
  pool
    .query(
      `INSERT INTO audit_log (event_type, invitation_code, ip_address, detail)
       VALUES ($1, $2, $3, $4)`,
      [eventType, code, ip, detail]
    )
    .catch((err) => console.error('Audit log write failed:', err.message));
}

module.exports = { logEvent };
