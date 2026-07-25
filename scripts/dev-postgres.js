/**
 * Local development Postgres (no Docker needed).
 *
 * Starts a real PostgreSQL server on port 5433 using embedded-postgres.
 * Use it when you want to develop locally without touching Supabase:
 *
 *   node scripts/dev-postgres.js          # terminal 1 (leave running)
 *   npm run migrate && npm run seed       # terminal 2
 *   npm start
 *
 * with .env containing:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
 *   DATABASE_SSL=false
 */
const pkg = require('embedded-postgres');
const EmbeddedPostgres = pkg.default || pkg.EmbeddedPostgres || pkg;

const pg = new EmbeddedPostgres({
  databaseDir: './.pgdata',
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: true,
});

(async () => {
  await pg.initialise().catch(() => {}); // already initialised is fine
  await pg.start();
  console.log('✔ Local Postgres running at postgresql://postgres:postgres@localhost:5433/postgres');
  console.log('  Press Ctrl+C to stop.');

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((err) => {
  console.error('Failed to start local Postgres:', err.message);
  process.exit(1);
});
