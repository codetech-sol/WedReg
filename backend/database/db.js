/**
 * Database connection — PostgreSQL (Supabase) connection pool.
 *
 * DATABASE_URL must point at your Postgres instance. For Supabase on
 * serverless hosts (Vercel), use the *Transaction pooler* connection string
 * (port 6543) so thousands of short-lived function invocations don't
 * exhaust Postgres connections.
 *
 * The pool is created once per process; on serverless, each warm function
 * instance keeps a small pool (PG_POOL_MAX, default 3).
 */
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Point it at your Supabase/Postgres database.');
}

// Supabase requires TLS. Set DATABASE_SSL=false only for a local Postgres.
const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: Number(process.env.PG_POOL_MAX || 3),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => console.error('Unexpected Postgres pool error:', err.message));

module.exports = pool;
