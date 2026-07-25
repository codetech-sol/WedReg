/**
 * Seed script — inserts sample invitation codes for development/testing.
 *
 * Run with: npm run seed
 * Existing codes are left untouched (ON CONFLICT DO NOTHING), so it is
 * idempotent. Do NOT run this against your production database.
 */
require('dotenv').config();
const pool = require('./db');
const { generateInvitationCode } = require('../utils/codes');

const SAMPLE_GUESTS = [
  'Amelia & Noah Thompson',
  'Olivia Bennett',
  'Liam Carter',
  'Sophia Reyes',
  'Ethan & Grace Muller',
  'Isabella Nguyen',
  'Mason Alvarez',
  'Charlotte Okafor',
  'James Whitfield',
  'Harper Lindqvist',
];

(async () => {
  const insert = (name, code) =>
    pool.query(
      `INSERT INTO invitations (guest_name, invitation_code) VALUES ($1, $2)
       ON CONFLICT (invitation_code) DO NOTHING`,
      [name, code]
    );

  // A couple of fixed codes so the README examples always work.
  await insert('Demo Guest', 'WED-DEMO-0001');
  await insert('Test Guest', 'WED-TEST-0002');
  for (const guest of SAMPLE_GUESTS) {
    await insert(guest, generateInvitationCode());
  }

  const { rows } = await pool.query(
    `SELECT invitation_code, guest_name, status FROM invitations ORDER BY id`
  );
  console.log('✔ Seed complete. Current invitation codes:\n');
  for (const row of rows) {
    console.log(`  ${row.invitation_code.padEnd(18)} ${row.status.padEnd(8)} ${row.guest_name}`);
  }
  await pool.end();
})().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
