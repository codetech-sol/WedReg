# Wedding Guest Registration System

An elegant, secure, production-ready guest registration system for weddings.
Guests unlock a registration form with a one-time **invitation code**; organizers
manage everything from a protected **admin dashboard** with statistics, search,
filtering, bulk code generation, and formatted **Excel export**.

![Stack](https://img.shields.io/badge/stack-Node.js%20·%20Express%20·%20PostgreSQL%20(Supabase)%20·%20Vercel-9d5c63)

## Features

**Guest flow**
- Landing page asks for an invitation code — the form is never shown first.
- Real-time, server-side code validation (the invitation list never reaches the client).
- Distinct, friendly errors for unknown codes and already-used codes.
- Registration form with optional Plus One section (revealed by checkbox).
- Client + server validation, duplicate-submission protection, loading states,
  toast notifications, animated success screen, printable confirmation.
- Signed **QR entry ticket** on the success card — encodes the invitation code
  and guest details, HMAC-signed so it cannot be forged.
- Dark mode with system-preference detection.

**Regulator dashboard** (`/regulator`)
- Password-protected door check-in station for ushers/security.
- Live camera **QR scanner** (native BarcodeDetector with jsQR fallback).
- Scans verify against the server: the screen turns **GREEN** with the guest's
  details when everything matches, **RED** when the code is forged, unknown,
  or doesn't match the system.
- Manual invitation-code lookup for QR codes that won't scan.
- Every check-in attempt is written to the audit log.

**Admin dashboard** (`/admin`)
- Session-based login (credentials from environment variables).
- Seven summary cards: total/unused/used invitations, total registrations,
  with/without plus ones, today's registrations.
- Invitation and registration tables with search, filtering, column sorting,
  and pagination — all executed server-side.
- Bulk invitation code generation (1–500 codes at a time).
- Post-event cleanup: **Delete All Registrations** and **Delete All
  Invitations** buttons (double-confirmed; invitation deletion cascades to
  registrations inside a transaction).
- One-click **Excel (.xlsx)** export: bold frozen header, auto-filter on every
  column, auto-sized columns, readable dates, and phone/ID columns stored as
  text so leading zeros are preserved.

**Security**
- All validation happens server-side; the frontend is never trusted.
- Prepared statements everywhere (no string-built SQL) — SQL injection safe.
- All rendering uses `textContent` (no `innerHTML` with user data) — XSS safe.
- CSRF protection via a per-session token required on every mutating request.
- Rate limiting on code verification (10/min/IP) and admin login (10/15 min/IP).
- Registration + invitation status update run inside a **database transaction**
  with row locking (`SELECT ... FOR UPDATE`): if saving fails, the invitation
  is never marked used.
- Session replacement on login (prevents fixation), signed `httpOnly` +
  `sameSite` cookies, `secure` cookies and `trust proxy` in production,
  Helmet security headers with a strict Content Security Policy.
- Audit log of every validation attempt, registration, and admin login.

## Project Structure

```
├── api/
│   └── index.js               # Vercel serverless entry (exports the Express app)
├── backend/
│   ├── server.js              # Express app (listens locally, exported for Vercel)
│   ├── api/                   # Route handlers
│   │   ├── invitations.js     #   POST /api/invitations/verify
│   │   ├── registrations.js   #   POST /api/registrations (transactional)
│   │   ├── regulator.js       #   Door check-in: login + QR verification
│   │   └── admin.js           #   Auth, stats, tables, generate, delete, export
│   ├── middleware/
│   │   ├── auth.js            # Admin session guard
│   │   ├── csrf.js            # CSRF token issue + verification
│   │   └── rateLimiter.js     # Per-endpoint rate limits
│   ├── utils/
│   │   ├── validators.js      # Server-side validation rules
│   │   ├── codes.js           # Secure invitation code generator
│   │   ├── qr.js              # Signed QR ticket issue + verification
│   │   └── audit.js           # Audit log writer
│   └── database/
│       ├── db.js              # PostgreSQL (Supabase) connection pool
│       ├── migrate.js         # Schema + indexes (idempotent)
│       └── seed.js            # Sample invitation codes
├── frontend/
│   ├── pages/                 # index.html (guest), admin.html, regulator.html
│   ├── components/            # Reusable JS modules (api, toast, theme)
│   ├── vendor/                # jsQR decoder (camera scanner fallback)
│   └── assets/
│       ├── css/               # theme.css (shared), guest.css, admin.css, regulator.css
│       └── js/                # guest.js, admin.js, regulator.js controllers
├── scripts/
│   ├── smoke-test.js          # End-to-end API test suite (33 checks)
│   └── dev-postgres.js        # Local Postgres for development (no Docker needed)
├── docs/
│   └── API.md                 # Full API documentation
├── vercel.json                # Vercel routing + function config
└── .env.example               # Environment variable template
```

## Quick Start (local development)

Requirements: **Node.js 18+** and a PostgreSQL database. Two options:

- **Option A — local throwaway Postgres** (no install, no Docker):
  `node scripts/dev-postgres.js` starts a real Postgres on port 5433 and the
  default `.env.example` values point at it.
- **Option B — your Supabase database directly**: set `DATABASE_URL` to your
  Supabase *Transaction pooler* connection string.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env          # then edit .env (see below)

# 3. (Option A only) start the local database — leave this running
node scripts/dev-postgres.js

# 4. Create the database schema and seed sample invitation codes
npm run setup                 # = npm run migrate && npm run seed

# 5. Start the server
npm start                     # or: npm run dev (auto-restart on changes)
```

- Guest page: <http://localhost:3000/> — try code `WED-DEMO-0001`
- Admin dashboard: <http://localhost:3000/admin>
- Regulator check-in: <http://localhost:3000/regulator>

> The regulator camera scanner requires a secure context: it works on
> `localhost` and on HTTPS, but browsers block camera access on plain HTTP.

The seed script prints every generated invitation code to the console.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Postgres connection string. For Supabase + Vercel use the **Transaction pooler** URI (port 6543) |
| `DATABASE_SSL` | no | TLS on | Set `false` only for a local Postgres without TLS |
| `SESSION_SECRET` | **yes (prod)** | random (dev only) | Session cookie signing key. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USERNAME` | no | `admin` | Admin dashboard username |
| `ADMIN_PASSWORD` | **yes** | — | Admin dashboard password (login is disabled if unset) |
| `REGULATOR_PASSWORD` | **yes** | — | Regulator (door check-in) access password (login disabled if unset) |
| `QR_SECRET` | no | falls back to `SESSION_SECRET` | Separate HMAC key for QR tickets; set it to allow rotating the session secret without invalidating issued QR codes |
| `PORT` | no | `3000` | HTTP port (local development only) |
| `NODE_ENV` | no | `development` | Set `production` when deploying outside Vercel |
| `PG_POOL_MAX` | no | `3` | Max DB connections per process / function instance |
| `VERIFY_RATE_LIMIT` | no | `10` | Code verification attempts per minute per IP |

## Database

Two core tables plus an audit log (see `backend/database/migrate.js`):

- **invitations** — `id`, `guest_name`, `invitation_code` (unique,
  case-insensitive), `status` (`unused`/`used`), `created_at`, `used_at`
- **registrations** — `id`, `invitation_id` (unique FK), `invitation_code`,
  `guest_name`, `guest_email`, `guest_phone`, `has_plus_one`, `plus_one_name`,
  `plus_one_phone`, `plus_one_id`, `registered_at`, `ip_address`, `browser`
- **audit_log** — `event_type`, `invitation_code`, `ip_address`, `detail`, `created_at`

Indexes cover code lookups, status filtering, and date sorting. The
`registrations.invitation_id` UNIQUE constraint is a hard database-level
guarantee that an invitation can only ever be registered once.

### Adding real invitation codes

Either use the **Generate Invitation Codes** panel in the admin dashboard, or
edit `backend/database/seed.js` with your guest list and run `npm run seed`.

## Testing

The tests consume the `WED-DEMO-0001` / `WED-TEST-0002` seed codes and end by
exercising the delete-all endpoints (which empties the database), so use a
fresh local database — never production:

```bash
node scripts/dev-postgres.js       # terminal 1: local Postgres
npm run setup && npm start         # terminal 2: schema + seed + server
npm test                           # terminal 3: run the suite
npm run seed                       # afterwards: restore demo codes
```

Covers the full flow: CSRF enforcement, invalid/valid/used code verification,
validation errors, transactional registration, rollback safety, duplicate
prevention, admin auth, search/filter/sort, bulk generation, xlsx export,
QR tickets, regulator check-in (green/red), and bulk deletion (33 assertions).

## Deployment — Vercel + Supabase

The app is pre-configured for Vercel serverless hosting with a Supabase
Postgres database. Sessions are stateless signed cookies, so no session
store is needed.

### 1. Create the Supabase database

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. In the dashboard, click **Connect** and copy the **Transaction pooler**
   connection string (port **6543**) — this is your `DATABASE_URL`.
   Replace `[YOUR-PASSWORD]` with the database password you chose.
3. Create the tables — either run locally:

```bash
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres" npm run migrate
```

   or paste the SQL from `backend/database/migrate.js` into the Supabase
   **SQL Editor** and run it.

### 2. Deploy to Vercel

1. Push the project to a GitHub repository.
2. In [vercel.com](https://vercel.com): **Add New → Project → Import** the repo.
   On every deploy, `npm run build` copies `frontend/` into `public/` (required
   because Vercel ignores `express.static`). Only `/api/*` hits the serverless
   function; pages and assets are served from the CDN.
3. Under **Environment Variables**, add:
   - `DATABASE_URL` — the Supabase transaction-pooler string
   - `SESSION_SECRET` — long random string
   - `QR_SECRET` — a different long random string
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`
   - `REGULATOR_PASSWORD`
4. Click **Deploy**. Your pages will be live at
   `https://<project>.vercel.app/`, `/admin`, and `/regulator` (HTTPS by
   default, so the camera scanner works).

### Serverless notes

- Rate limits are tracked per warm function instance, so they are a softer
  guarantee than on a single server — acceptable for this workload, since
  invitation codes have ~10^12 combinations.
- Supabase's free tier pauses databases after a week of inactivity; open the
  dashboard before the event to make sure it's awake.

## API

See [docs/API.md](docs/API.md) for full endpoint documentation.
