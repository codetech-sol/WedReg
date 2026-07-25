/**
 * Database migration script (PostgreSQL).
 *
 * Creates all tables and indexes. Idempotent — safe to run multiple times.
 * Run with: npm run migrate   (DATABASE_URL must be set)
 */
require('dotenv').config();
const pool = require('./db');

const migrations = `
CREATE TABLE IF NOT EXISTS invitations (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guest_name      TEXT        NOT NULL,
  invitation_code TEXT        NOT NULL UNIQUE,
  status          TEXT        NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS registrations (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invitation_id   BIGINT      NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE CASCADE,
  invitation_code TEXT        NOT NULL,
  guest_name      TEXT        NOT NULL,
  guest_email     TEXT        NOT NULL,
  guest_phone     TEXT,
  has_plus_one    BOOLEAN     NOT NULL DEFAULT FALSE,
  plus_one_name   TEXT,
  plus_one_phone  TEXT,
  plus_one_id     TEXT,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address      TEXT,
  browser         TEXT
);

-- Audit log: records invitation validation attempts, registrations,
-- check-ins, and admin/regulator logins.
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      TEXT        NOT NULL,
  invitation_code TEXT,
  ip_address      TEXT,
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for lookups, filtering and sorting used by the API and dashboard.
CREATE INDEX IF NOT EXISTS idx_invitations_status     ON invitations(status);
CREATE INDEX IF NOT EXISTS idx_invitations_created_at ON invitations(created_at);
CREATE INDEX IF NOT EXISTS idx_registrations_code     ON registrations(invitation_code);
CREATE INDEX IF NOT EXISTS idx_registrations_time     ON registrations(registered_at);
CREATE INDEX IF NOT EXISTS idx_registrations_email    ON registrations(guest_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at   ON audit_log(created_at);
`;

(async () => {
  await pool.query(migrations);
  console.log('✔ Migrations applied successfully.');
  await pool.end();
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
