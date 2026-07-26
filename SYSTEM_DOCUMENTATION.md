# Wedding Guest Registration System — System Documentation

> **Audience:** Software engineers onboarding to this codebase.  
> **Source of truth:** Generated from the actual implementation in this repository (Node.js/Express, PostgreSQL/Supabase, vanilla JS frontend, Vercel deployment).  
> **Last reviewed against commit:** `a36c455` (invitation code on printable confirmation).

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Folder Structure](#2-folder-structure)
3. [Technology Stack](#3-technology-stack)
4. [Database Design](#4-database-design)
5. [Invitation Verification Flow](#5-invitation-verification-flow)
6. [Guest Registration Flow](#6-guest-registration-flow)
7. [Admin Dashboard](#7-admin-dashboard)
8. [API Documentation](#8-api-documentation)
9. [Security](#9-security)
10. [Environment Variables](#10-environment-variables)
11. [Business Rules](#11-business-rules)
12. [Code Flow](#12-code-flow)
13. [Component Documentation](#13-component-documentation)
14. [Backend Services](#14-backend-services)
15. [Deployment](#15-deployment)
16. [Current Features](#16-current-features)
17. [Known Limitations](#17-known-limitations)
18. [Future Enhancements](#18-future-enhancements)
19. [Developer Notes](#19-developer-notes)
20. [Executive Summary](#20-executive-summary)
21. [Invitation PDF Generation](#21-invitation-pdf-generation)

---

## 1. Project Overview

### Purpose

The **Wedding Guest Registration System** is a web application that lets wedding guests register online using a **one-time invitation code**, while organizers manage invitations, view registrations, export data, and verify guests at the door.

### Problem It Solves

| Problem | How the system addresses it |
|---|---|
| Uncontrolled guest lists | Only guests with valid, unused invitation codes can register |
| Duplicate registrations | Database uniqueness + transactional row locking |
| Forged or copied entry passes | HMAC-signed QR tickets verified server-side at check-in |
| Organizer visibility | Admin dashboard with stats, search, filters, Excel export |
| Door check-in | Regulator dashboard with camera QR scanner + manual fallback |

### Target Users

| Role | Interface | Access |
|---|---|---|
| **Guest** | `/` (guest landing page) | Public; requires valid invitation code |
| **Wedding organizer / admin** | `/admin.html` | Username + password (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) |
| **Door usher / regulator** | `/regulator.html` | Shared password (`REGULATOR_PASSWORD`); admins may also scan |

### Overall Workflow

```mermaid
flowchart LR
    A[Guest receives invitation code] --> B[Enter code on landing page]
    B --> C{Server validates code}
    C -->|Invalid / used| D[Error message]
    C -->|Valid| E[Registration form unlocked]
    E --> F[Guest submits details]
    F --> G[Transaction: insert registration + mark invitation used]
    G --> H[Success card with QR + printable confirmation]
    H --> I[Regulator scans QR at venue]
    I --> J{Server verifies signature + DB match}
    J -->|Match| K[GREEN — admit guest]
    J -->|No match| L[RED — deny / investigate]
```

**Parallel organizer workflows:**

- Admin generates invitation codes → distributes codes to guests → monitors registrations → exports Excel → optionally deletes all data post-event.
- Regulator logs in at the venue → scans guest QR codes or enters codes manually.

### Main Technologies

- **Runtime:** Node.js 18+
- **Backend:** Express 5 (API-only on Vercel; full stack locally)
- **Database:** PostgreSQL (Supabase in production; embedded Postgres optional locally)
- **Frontend:** Vanilla HTML/CSS/ES modules (no React/Vue build step)
- **Hosting:** Vercel (serverless API + static CDN for pages)
- **Session:** `cookie-session` (signed, stateless cookies — no Redis/session store)

### Project Architecture

The application uses a **split deployment architecture** on Vercel:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Vercel CDN                              │
│  /  /admin.html  /regulator.html  /assets/*  /components/*      │
│  (static files in /public — built from /frontend)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                    /api/* only │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Serverless Function: api/index.js                  │
│              → backend/apiApp.js (Express API only)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│           PostgreSQL (Supabase Transaction Pooler)              │
│           invitations · registrations · audit_log               │
└─────────────────────────────────────────────────────────────────┘
```

**Local development** uses `backend/server.js`, which mounts the same API (`apiApp.js`) **plus** Express static file serving from `frontend/` — a single process on port 3000.

**Key architectural decisions:**

1. **Server-side invitation trust** — The frontend never receives the master invitation list. After verification, only a session-bound `{ id, code, guestName }` is stored server-side.
2. **Transactional registration** — Registration insert and invitation status update are atomic with `SELECT ... FOR UPDATE`.
3. **Stateless sessions** — Required for Vercel serverless; session data lives in signed cookies, not server memory.
4. **Static frontend on Vercel** — `express.static()` is ignored in serverless; `scripts/vercel-build.js` copies `frontend/` → `public/`.

---

## 2. Folder Structure

Complete source tree (excluding `node_modules/`, `.git/`, `.pgdata/`, and generated `public/`):

```
WeddingForm/
├── api/
│   └── index.js                    # Vercel serverless entry point
├── backend/
│   ├── apiApp.js                   # Express app: middleware + API routes
│   ├── server.js                   # Local dev: apiApp + static frontend
│   ├── api/
│   │   ├── admin.js                # Admin auth, stats, CRUD, export
│   │   ├── invitations.js          # Invitation code verification
│   │   ├── registrations.js        # Guest registration (transactional)
│   │   └── regulator.js            # Door check-in verification
│   ├── database/
│   │   ├── db.js                   # PostgreSQL connection pool
│   │   ├── migrate.js              # Schema creation (idempotent)
│   │   └── seed.js                 # Demo/sample invitation codes
│   ├── middleware/
│   │   ├── auth.js                 # Admin guard + timing-safe compare
│   │   ├── csrf.js                 # CSRF token issue + validation
│   │   └── rateLimiter.js          # express-rate-limit configs
│   └── utils/
│       ├── audit.js                # Fire-and-forget audit log writes
│       ├── codes.js                # Invitation code generator
│       ├── qr.js                   # HMAC-signed QR ticket helpers
│       └── validators.js           # Server-side input validation
├── frontend/
│   ├── pages/
│   │   ├── index.html              # Guest: verify → register → success
│   │   ├── admin.html              # Admin dashboard
│   │   └── regulator.html          # QR scanner check-in
│   ├── components/
│   │   ├── api.js                  # Fetch wrapper + CSRF handling
│   │   ├── toast.js                # Toast notification UI
│   │   └── theme.js                # Dark/light mode toggle
│   ├── assets/
│   │   ├── css/
│   │   │   ├── theme.css           # Shared design tokens + components
│   │   │   ├── guest.css           # Guest page styles + print styles
│   │   │   ├── admin.css           # Admin dashboard styles
│   │   │   └── regulator.css       # Scanner + verdict styles
│   │   └── js/
│   │       ├── guest.js            # Guest flow controller
│   │       ├── admin.js            # Admin dashboard controller
│   │       └── regulator.js        # Camera scanner controller
│   └── vendor/
│       └── jsQR.js                 # QR decode fallback (vendored)
├── scripts/
│   ├── vercel-build.js             # Copies frontend → public for Vercel
│   ├── smoke-test.js               # 33-check end-to-end API test suite
│   └── dev-postgres.js             # Local embedded Postgres (port 5433)
├── docs/
│   └── API.md                      # API reference (companion doc)
├── .env.example                    # Environment variable template
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
├── vercel.json                     # Vercel build + API rewrite config
└── SYSTEM_DOCUMENTATION.md         # This document
```

**Generated at build time (gitignored):**

```
public/                             # Vercel static output (npm run build)
├── index.html
├── admin.html, admin/index.html
├── regulator.html, regulator/index.html
├── pages/, assets/, components/, vendor/
```

### Folder Responsibilities

| Folder | Why it exists | Key files | Responsibilities |
|---|---|---|---|
| `api/` | Vercel requires serverless functions under `/api` | `index.js` | Re-exports `backend/apiApp.js` as the serverless handler |
| `backend/` | All server-side logic | `apiApp.js`, `server.js` | HTTP API, middleware, DB access, business rules |
| `backend/api/` | Route handlers grouped by domain | `invitations.js`, `registrations.js`, `admin.js`, `regulator.js` | REST endpoints; thin controllers delegating to utils/DB |
| `backend/database/` | Data persistence layer | `db.js`, `migrate.js`, `seed.js` | Connection pool, schema migrations, dev seed data |
| `backend/middleware/` | Cross-cutting HTTP concerns | `auth.js`, `csrf.js`, `rateLimiter.js` | Authentication guards, CSRF, rate limiting |
| `backend/utils/` | Reusable server helpers | `validators.js`, `qr.js`, `codes.js`, `audit.js` | Validation, crypto, code generation, audit logging |
| `frontend/pages/` | HTML shells for each app surface | `index.html`, `admin.html`, `regulator.html` | Semantic markup, form structure, panel layout |
| `frontend/components/` | Shared client modules | `api.js`, `toast.js`, `theme.js` | API client, notifications, theme persistence |
| `frontend/assets/js/` | Page-specific controllers | `guest.js`, `admin.js`, `regulator.js` | UI state, event handlers, API orchestration |
| `frontend/assets/css/` | Styling | `theme.css` + page CSS | Responsive layout, dark mode, print styles |
| `frontend/vendor/` | Third-party JS without bundler | `jsQR.js` | QR decoding when native `BarcodeDetector` unavailable |
| `scripts/` | CLI tooling | `vercel-build.js`, `smoke-test.js`, `dev-postgres.js` | Build, test, local DB bootstrap |
| `docs/` | Human-readable references | `API.md` | Endpoint documentation |
| `public/` | Vercel static deploy artifact | *(generated)* | CDN-served HTML/CSS/JS |

---

## 3. Technology Stack

Every dependency detected in `package.json` and the frontend:

### Runtime & Framework

| Technology | Version | Why it is used |
|---|---|---|
| **Node.js** | ≥ 18 (engines) | Server runtime; native `fetch` in smoke tests; ES module support in frontend |
| **Express** | ^5.2.1 | HTTP routing, middleware pipeline, JSON body parsing, error handler |
| **CommonJS** | `"type": "commonjs"` | Backend modules use `require()`; frontend uses native ES `import` in browser |

### Database

| Technology | Version | Why it is used |
|---|---|---|
| **PostgreSQL** | (via Supabase or embedded) | Relational storage with transactions, row locking, constraints |
| **pg** | ^8.22.0 | Node PostgreSQL client with connection pooling — essential for serverless |
| **Supabase** | (hosted) | Managed Postgres + transaction pooler (port 6543) for Vercel |

No ORM (Prisma/Drizzle) — raw parameterized SQL via `pg`.

### Session & Security

| Technology | Version | Why it is used |
|---|---|---|
| **cookie-session** | ^2.1.1 | Stateless signed cookies for serverless (no session store) |
| **helmet** | ^8.3.0 | Security headers + Content Security Policy |
| **express-rate-limit** | ^8.6.0 | Brute-force protection on verify/login endpoints |
| **dotenv** | ^17.4.2 | Load `.env` in local dev and migration scripts |
| **crypto** (Node built-in) | — | CSRF tokens, HMAC QR signatures, timing-safe comparisons |

### Data Export & QR

| Technology | Version | Why it is used |
|---|---|---|
| **ExcelJS** | ^4.4.0 | Generate formatted `.xlsx` exports with styling |
| **qrcode** | ^1.5.4 | Server-side PNG QR generation as data URLs |
| **jsQR** | ^1.4.0 (vendored) | Client-side QR decode fallback for regulator scanner |

### Frontend (no build toolchain)

| Technology | Why it is used |
|---|---|
| **Vanilla HTML/CSS/JS** | No bundler; ES modules loaded directly by browser |
| **Google Fonts** | Cormorant Garamond + Jost typography (loaded via CSP-allowed CDN) |
| **localStorage** | Persist dark/light theme preference |
| **MediaDevices API** | Camera access for QR scanning |
| **BarcodeDetector** (optional) | Native QR detection when browser supports it |

### Development & Testing

| Technology | Version | Why it is used |
|---|---|---|
| **embedded-postgres** | ^18.4.0-beta.17 | Local Postgres without Docker install |

### Explicitly NOT used

React, Next.js, TypeScript, Tailwind, Prisma, Redis, WebSockets, JWT auth libraries.

---

## 4. Database Design

Schema defined in `backend/database/migrate.js`. All migrations are **idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

### Table: `invitations`

Master list of issued invitation codes.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGINT` | **PK**, `GENERATED ALWAYS AS IDENTITY` | Surrogate key |
| `guest_name` | `TEXT` | `NOT NULL` | Label/name associated with the invitation (may be a couple name or table label) |
| `invitation_code` | `TEXT` | `NOT NULL`, **UNIQUE** | Code string, stored uppercase (e.g. `WED-DEMO-0001`) |
| `status` | `TEXT` | `NOT NULL`, `DEFAULT 'unused'`, `CHECK (status IN ('unused', 'used'))` | Consumption state |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | When code was created |
| `used_at` | `TIMESTAMPTZ` | nullable | When code was consumed by registration |

**Indexes:**

- `idx_invitations_status` on `(status)` — filter unused/used in admin
- `idx_invitations_created_at` on `(created_at)` — default sort

### Table: `registrations`

One row per successfully registered invitation.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGINT` | **PK**, `GENERATED ALWAYS AS IDENTITY` | Registration ID (embedded in QR as `r`) |
| `invitation_id` | `BIGINT` | `NOT NULL`, **UNIQUE**, **FK → invitations(id) ON DELETE CASCADE** | Links to invitation; enforces one registration per invitation |
| `invitation_code` | `TEXT` | `NOT NULL` | Denormalized code for search/export |
| `guest_name` | `TEXT` | `NOT NULL` | Registered guest full name |
| `guest_email` | `TEXT` | `NOT NULL` | Email (stored lowercase after validation) |
| `guest_phone` | `TEXT` | nullable | Optional phone |
| `has_plus_one` | `BOOLEAN` | `NOT NULL`, `DEFAULT FALSE` | Whether guest brings a plus-one |
| `plus_one_name` | `TEXT` | nullable | Plus-one name (required if `has_plus_one`) |
| `plus_one_phone` | `TEXT` | nullable | Optional plus-one phone |
| `plus_one_id` | `TEXT` | nullable | National ID / passport (required if `has_plus_one`) |
| `registered_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Registration timestamp |
| `ip_address` | `TEXT` | nullable | Client IP at registration |
| `browser` | `TEXT` | nullable | Truncated User-Agent (max 400 chars) |

**Indexes:**

- `idx_registrations_code` on `(invitation_code)` — regulator manual lookup
- `idx_registrations_time` on `(registered_at)` — default sort
- `idx_registrations_email` on `(guest_email)` — search

**Critical constraint:** `invitation_id UNIQUE` is the database-level guarantee against duplicate registration even if application logic fails.

### Table: `audit_log`

Append-only event log for security and operations review.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGINT` | **PK**, `GENERATED ALWAYS AS IDENTITY` | Log entry ID |
| `event_type` | `TEXT` | `NOT NULL` | Event identifier (see [Business Rules](#11-business-rules)) |
| `invitation_code` | `TEXT` | nullable | Related code, if applicable |
| `ip_address` | `TEXT` | nullable | Client IP |
| `detail` | `TEXT` | nullable | Free-form context |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT now()` | Event timestamp |

**Index:** `idx_audit_log_created_at` on `(created_at)`

**Note:** There is no admin UI to browse audit logs — data is written but not exposed via API.

### Entity-Relationship Diagram

```mermaid
erDiagram
    invitations ||--o| registrations : "has zero or one"
    invitations {
        bigint id PK
        text guest_name
        text invitation_code UK
        text status
        timestamptz created_at
        timestamptz used_at
    }
    registrations {
        bigint id PK
        bigint invitation_id FK_UK
        text invitation_code
        text guest_name
        text guest_email
        text guest_phone
        boolean has_plus_one
        text plus_one_name
        text plus_one_phone
        text plus_one_id
        timestamptz registered_at
        text ip_address
        text browser
    }
    audit_log {
        bigint id PK
        text event_type
        text invitation_code
        text ip_address
        text detail
        timestamptz created_at
    }
```

**Relationships:**

- `registrations.invitation_id` → `invitations.id` (many-to-one logically, enforced as **one-to-one** via UNIQUE)
- `ON DELETE CASCADE`: deleting an invitation deletes its registration
- `audit_log` has **no foreign keys** — loosely coupled event stream

---

## 5. Invitation Verification Flow

When a guest enters an invitation code on the landing page, the following occurs.

### Step-by-Step Implementation

1. **Frontend (`guest.js`)** — User submits `#verify-form`. Client trims the code; shows inline error if empty.
2. **API client (`api.js`)** — `POST /api/invitations/verify` with JSON body `{ code }`, session cookie, and `X-CSRF-Token` header.
3. **Rate limiter (`rateLimiter.js`)** — `verifyLimiter`: max 10 requests/minute/IP (configurable via `VERIFY_RATE_LIMIT`).
4. **Validation (`validators.js`)** — `validateInvitationCode()`:
   - Trims and uppercases input
   - Rejects empty → 400
   - Validates format `/^[A-Za-z0-9\-]{4,40}$/` → 400
5. **Database lookup (`invitations.js`)** — Parameterized query:
   ```sql
   SELECT id, invitation_code, guest_name, status FROM invitations
   WHERE invitation_code = $1
   ```
6. **Not found** → 404 + audit `verify_failed` + user-friendly hint
7. **Status = 'used'** → 409 + audit `verify_used`
8. **Valid & unused** → Store in session:
   ```javascript
   req.session.verifiedInvitation = {
     id: Number(invitation.id),
     code: invitation.invitation_code,
     guestName: invitation.guest_name,
     verifiedAt: Date.now(),
   };
   ```
9. **Success** → 200 `{ valid: true, guestName }` + audit `verify_success`
10. **Frontend** — Shows registration panel, pre-fills guest name from `guestName`, displays welcome toast.

### Session Handling

- Verification state lives in the **signed session cookie** (`wedding.sid`), not in client storage.
- `GET /api/session` exposes `{ csrfToken, invitation: { guestName } | null }` so page reload can skip step 1 if still verified.
- The invitation **code itself is never returned** to the client during verification — only the guest name.

### Security Checks

| Check | Implementation |
|---|---|
| CSRF | Required on POST |
| Rate limiting | 10/min/IP on verify endpoint |
| Server-side validation | Format + existence + status |
| No client trust | Registration endpoint reads code from session, not request body |
| Audit trail | All outcomes logged |

### Sequence Diagram

```mermaid
sequenceDiagram
    participant G as Guest Browser
    participant API as Express API
    participant V as validators.js
    participant DB as PostgreSQL
    participant S as Session Cookie

    G->>API: GET /api/session
    API->>S: ensureCsrfToken()
    API-->>G: { csrfToken, invitation: null }

    G->>API: POST /api/invitations/verify<br/>{ code } + X-CSRF-Token
    API->>API: verifyLimiter check
    API->>V: validateInvitationCode(code)
    alt invalid format
        V-->>API: { ok: false }
        API-->>G: 400 { error }
    else valid format
        API->>DB: SELECT ... WHERE invitation_code = $1
        alt not found
            API-->>G: 404 { error, hint }
        else status = used
            API-->>G: 409 { error, hint }
        else unused
            API->>S: verifiedInvitation = { id, code, guestName }
            API-->>G: 200 { valid: true, guestName }
        end
    end
```

### Flowchart

```mermaid
flowchart TD
    A[Guest enters code] --> B{Code empty?}
    B -->|Yes| C[400: Please enter code]
    B -->|No| D{Format valid?<br/>4-40 alphanumeric + dash}
    D -->|No| E[400: Invalid format]
    D -->|Yes| F[Query invitations table]
    F --> G{Row exists?}
    G -->|No| H[404: Invalid invitation code]
    G -->|Yes| I{status = unused?}
    I -->|No| J[409: Already used]
    I -->|Yes| K[Store verifiedInvitation in session]
    K --> L[200: valid + guestName]
    L --> M[Show registration form]
```

---

## 6. Guest Registration Flow

After successful invitation verification, the guest completes the registration form.

### Form Loading

1. Panel `#panel-form` becomes visible (`guest.js` → `showPanel('form')`).
2. Greeting text: `"Welcome, {guestName}! Please complete your registration below."`
3. `#guestName` pre-filled with invitation's `guest_name` if empty.
4. Plus-one fields hidden until `#hasPlusOne` checkbox checked.

### Client Validation (mirrors server)

| Field | Rules |
|---|---|
| `guestName` | Required, max 120 |
| `guestEmail` | Required, email regex |
| `guestPhone` | Optional, phone regex |
| `plusOneName` | Required if plus-one checked |
| `plusOnePhone` | Optional if plus-one |
| `plusOneId` | Required if plus-one, max 40 |

### API Call

`POST /api/registrations` with body:

```json
{
  "guestName": "Demo Guest",
  "guestEmail": "demo@example.com",
  "guestPhone": "0712 345 678",
  "hasPlusOne": true,
  "plusOneName": "Jamie Companion",
  "plusOnePhone": "0700 111 222",
  "plusOneId": "0012345678"
}
```

### Backend Processing (`registrations.js`)

1. **Session check** — `req.session.verifiedInvitation` must exist → else 401
2. **Server validation** — `validateRegistration(req.body)` → 400 with `fields` map
3. **Transaction** — `registerTransaction()`:
   ```javascript
   BEGIN
   SELECT id, status FROM invitations WHERE id = $1 FOR UPDATE
   // if missing or status !== 'unused' → throw ALREADY_REGISTERED
   INSERT INTO registrations (...) RETURNING id
   UPDATE invitations SET status = 'used', used_at = now()
     WHERE id = $1 AND status = 'unused'
   // if rowCount !== 1 → throw ALREADY_REGISTERED
   COMMIT
   ```
4. **On success:**
   - `delete req.session.verifiedInvitation` — prevents re-submission
   - Audit `registration_success`
   - Generate QR via `generateQrDataUrl()` (best-effort; failure does not fail registration)
   - Return 201 with `{ success, registrationId, invitationCode, qr, message }`
5. **On duplicate:** Catch `ALREADY_REGISTERED` or Postgres `23505` (unique violation) → 409, clear session
6. **On other error:** ROLLBACK (invitation stays unused), 500

### Rollback Behaviour

| Failure point | Invitation status | Registration row |
|---|---|---|
| Validation error (400) | Unchanged (`unused`) | Not inserted |
| Transaction failure before COMMIT | Rolled back (`unused`) | Not inserted |
| Unique violation (409) | May already be `used` if race lost | Winner's row exists |
| QR generation failure | `used` | Inserted — QR omitted from response |

Smoke test confirms: failed registration with missing plus-one ID does **not** mark invitation used.

### Success Response & UI

1. `renderConfirmation(values, invitationCode)` — displays invitation code prominently (printable)
2. `renderQrTicket(qr)` — shows PNG data URL if present
3. Panel `#panel-success` shown; print button calls `window.print()`

### Sequence Diagram

```mermaid
sequenceDiagram
    participant G as Guest Browser
    participant API as registrations.js
    participant V as validators.js
    participant DB as PostgreSQL
    participant QR as qr.js

    G->>API: POST /api/registrations { form data }
    API->>API: Check session.verifiedInvitation
    alt no session
        API-->>G: 401
    end
    API->>V: validateRegistration(body)
    alt validation fail
        API-->>G: 400 { fields }
    end
    API->>DB: BEGIN
    API->>DB: SELECT ... FOR UPDATE (invitation)
    API->>DB: INSERT registrations
    API->>DB: UPDATE invitations SET status=used
    API->>DB: COMMIT
    API->>API: delete session.verifiedInvitation
    API->>QR: generateQrDataUrl(ticket)
    QR-->>API: data:image/png;base64,...
    API-->>G: 201 { registrationId, invitationCode, qr }
    G->>G: Show success panel + print
```

### Flowchart

```mermaid
flowchart TD
    A[Submit registration form] --> B{Session has verifiedInvitation?}
    B -->|No| C[401: Verify code first]
    B -->|Yes| D{Server validation OK?}
    D -->|No| E[400: Field errors<br/>Invitation stays unused]
    D -->|Yes| F[BEGIN TRANSACTION]
    F --> G[LOCK invitation row FOR UPDATE]
    G --> H{status = unused?}
    H -->|No| I[ROLLBACK → 409 Already registered]
    H -->|Yes| J[INSERT registration]
    J --> K[UPDATE invitation → used]
    K --> L{UPDATE affected 1 row?}
    L -->|No| I
    L -->|Yes| M[COMMIT]
    M --> N[Clear session verifiedInvitation]
    N --> O[Generate QR ticket]
    O --> P[201 Success + confirmation UI]
```

---

## 7. Admin Dashboard

**URL:** `/admin.html` (local: `/admin` also works)  
**Controller:** `frontend/assets/js/admin.js`  
**API:** `backend/api/admin.js`

### Authentication

| Aspect | Implementation |
|---|---|
| Login form | `#login-form` → `POST /api/admin/login` |
| Credentials | `ADMIN_USERNAME` (default `admin`) + `ADMIN_PASSWORD` (required) |
| Comparison | `safeCompare()` — timing-safe via `crypto.timingSafeEqual` |
| Session | `req.session = { isAdmin: true }` — **full session replacement** on login |
| CSRF refresh | `initSession()` called after login to get new token |
| Logout | `POST /api/admin/logout` → `req.session = null` → page reload |
| Guard | `router.use(requireAdmin)` on all routes after `/login`, `/logout`, `/session` |
| Rate limit | 10 login attempts / 15 min / IP |

### Authorization

All data endpoints return **401** without `req.session.isAdmin === true`.

### Statistics

**Endpoint:** `GET /api/admin/stats`

Seven stat cards rendered in `#stats-grid`:

| Key | Label | SQL source |
|---|---|---|
| `totalInvitations` | Total Invitations | `COUNT(*)` from invitations |
| `unusedInvitations` | Unused Invitations | `WHERE status = 'unused'` |
| `usedInvitations` | Used Invitations | `WHERE status = 'used'` |
| `totalRegistrations` | Total Registrations | `COUNT(*)` from registrations |
| `withPlusOne` | With Plus Ones | `WHERE has_plus_one` |
| `withoutPlusOne` | Without Plus Ones | `WHERE NOT has_plus_one` |
| `todayRegistrations` | Today's Registrations | `registered_at::date = CURRENT_DATE` |

Stats reload after code generation and delete-all operations.

### Invitation Management

**List endpoint:** `GET /api/admin/invitations`

| Feature | Implementation |
|---|---|
| **Search** | Query param `search` — `ILIKE` on `invitation_code`, `guest_name` |
| **Filter** | `status=used\|unused` |
| **Sort** | Whitelist: `created_at`, `guest_name`, `invitation_code`, `status`, `used_at` |
| **Direction** | `dir=asc\|desc` (default `desc`) |
| **Pagination** | `page` (≥1), `pageSize` (1–100, default 10) |

**Table columns displayed:** Invitation Code, Status (badge), Date Created, Date Used  
*(Guest Name column intentionally removed from UI)*

**Bulk generation:** `POST /api/admin/invitations/generate`

- Body: `{ count: 1–500, guestName: string }`
- Generates codes via `generateInvitationCode()` with collision retry (up to 5 attempts per code)
- If `count > 1`, guest names become `"{guestName} 1"`, `"{guestName} 2"`, etc.
- Created codes displayed in `#generated-codes`

**Delete all invitations:** `DELETE /api/admin/invitations`

- Transaction: deletes all registrations, then all invitations
- Double browser `confirm()` in UI
- Cascading FK also removes registrations if invitations deleted first

### Registration Management

**List endpoint:** `GET /api/admin/registrations`

| Feature | Implementation |
|---|---|
| **Search** | `guest_name`, `guest_email`, `invitation_code`, `plus_one_name` |
| **Filter** | `plusOne=1\|0` → `has_plus_one` boolean |
| **Sort** | `registered_at`, `guest_name`, `guest_email`, `invitation_code` |
| **Pagination** | Same as invitations |

**Table columns:** Guest Name, Email, Phone, Invitation Code, Plus One, Plus One Phone, Plus One ID, Registered At

**Delete all registrations:** `DELETE /api/admin/registrations`

- Deletes registration rows only
- Invitations **retain** `status = 'used'` (codes cannot be re-used without manual DB intervention)

### Excel Export

**Endpoint:** `GET /api/admin/export`  
**Trigger:** Direct link `<a href="/api/admin/export">` (GET — no CSRF; session cookie sent automatically)

**Workbook details (ExcelJS):**

- Sheet: "Wedding Guest Registrations"
- Frozen header row, auto-filter, auto-sized columns (max width 45)
- Header styling: bold white on rose (`#9D5C63`)
- Phone/ID columns: text format (`numFmt: '@'`) to preserve leading zeros
- Plus-one columns show `—` when `has_plus_one = false`
- Filename: `wedding-registrations-YYYY-MM-DD.xlsx`

### Search, Pagination, Sorting (Frontend)

Implemented via reusable `createTable()` factory in `admin.js`:

- **Debounced search** (300ms) resets to page 1
- **Column header click** toggles sort asc/desc on whitelisted columns
- **Pagination UI** shows record count + up to 5 page buttons + prev/next
- **XSS-safe rendering:** all cell content via `textContent`, never `innerHTML` with user data

### Tabs

Two tab panels: Invitations (default) and Registrations — toggled via `.tab` buttons with `aria-selected` updates.

---

## 8. API Documentation

**Base URL:** `/api` (e.g. `http://localhost:3000/api` or `https://<vercel-app>.vercel.app/api`)

**Common error shape:**

```json
{
  "error": "Human-readable message",
  "hint": "optional guidance",
  "fields": { "fieldName": "per-field validation error" }
}
```

**Authentication legend:**

- 🔒 = requires authenticated session (admin or regulator as noted)
- CSRF = all mutating requests need `X-CSRF-Token` from `GET /api/session`

---

### `GET /api/session`

| | |
|---|---|
| **Purpose** | Issue CSRF token; expose guest verification state |
| **Auth** | None (creates/reads session cookie) |
| **Body** | — |

**Response 200:**

```json
{
  "csrfToken": "a1b2c3...",
  "invitation": { "guestName": "Demo Guest" }
}
```

`invitation` is `null` when no code verified in this session.

---

### `POST /api/invitations/verify`

| | |
|---|---|
| **Purpose** | Validate invitation code; store in session |
| **Auth** | CSRF |
| **Rate limit** | 10/min/IP |

**Request:**

```json
{ "code": "WED-DEMO-0001" }
```

**Responses:**

| Status | Body |
|---|---|
| 200 | `{ "valid": true, "guestName": "Demo Guest" }` |
| 400 | `{ "error": "Please enter your invitation code." }` |
| 404 | `{ "error": "Invalid invitation code.", "hint": "..." }` |
| 409 | `{ "error": "This invitation code has already been used.", "hint": "..." }` |
| 429 | `{ "error": "Too many attempts..." }` |

---

### `POST /api/registrations`

| | |
|---|---|
| **Purpose** | Save guest registration; mark invitation used |
| **Auth** | CSRF + verified session |

**Request:**

```json
{
  "guestName": "Demo Guest",
  "guestEmail": "demo@example.com",
  "guestPhone": "0712 345 678",
  "hasPlusOne": false
}
```

**Responses:**

| Status | Body |
|---|---|
| 201 | `{ "success": true, "registrationId": 1, "invitationCode": "WED-DEMO-0001", "qr": "data:image/png;base64,...", "message": "..." }` |
| 400 | `{ "error": "...", "fields": { "guestEmail": "..." } }` |
| 401 | `{ "error": "Please verify your invitation code first." }` |
| 409 | `{ "error": "This invitation has already been registered." }` |
| 500 | `{ "error": "We could not save your registration..." }` |

---

### `POST /api/admin/login`

| | |
|---|---|
| **Purpose** | Admin authentication |
| **Rate limit** | 10 / 15 min / IP |

**Request:** `{ "username": "admin", "password": "..." }`  
**Response:** `200 { "success": true }` or `401 { "error": "..." }`

---

### `POST /api/admin/logout`

**Response:** `200 { "success": true }`

---

### `GET /api/admin/session`

**Response:** `200 { "authenticated": true|false }`

---

### `GET /api/admin/stats` 🔒

**Response 200:**

```json
{
  "totalInvitations": 15,
  "unusedInvitations": 13,
  "usedInvitations": 2,
  "totalRegistrations": 2,
  "withPlusOne": 1,
  "withoutPlusOne": 1,
  "todayRegistrations": 2
}
```

---

### `GET /api/admin/invitations` 🔒

**Query params:** `search`, `status`, `sort`, `dir`, `page`, `pageSize`

**Response 200:**

```json
{
  "rows": [
    {
      "id": "1",
      "guest_name": "Demo Guest",
      "invitation_code": "WED-DEMO-0001",
      "status": "used",
      "created_at": "2026-07-24T10:00:00.000Z",
      "used_at": "2026-07-24T12:00:00.000Z"
    }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 10,
  "totalPages": 2
}
```

---

### `GET /api/admin/registrations` 🔒

**Query params:** `search`, `plusOne`, `sort`, `dir`, `page`, `pageSize`

**Response:** Same pagination shape as invitations.

---

### `POST /api/admin/invitations/generate` 🔒

**Request:** `{ "count": 10, "guestName": "Family Table 4" }`

**Response 201:** `{ "success": true, "created": ["WED-K4TP-9XQ2", "..."] }`

---

### `DELETE /api/admin/registrations` 🔒

**Response:** `200 { "success": true, "deleted": 42 }`

---

### `DELETE /api/admin/invitations` 🔒

**Response:** `200 { "success": true, "deleted": 120, "registrationsDeleted": 42 }`

---

### `GET /api/admin/export` 🔒

**Response:** Binary `.xlsx` file (not JSON)

**Headers:**

- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="wedding-registrations-2026-07-25.xlsx"`

---

### `POST /api/regulator/login`

**Request:** `{ "password": "..." }`  
**Response:** `200 { "success": true }` or `401`

---

### `GET /api/regulator/session`

**Response:** `200 { "authenticated": true|false }`  
*(true if regulator OR admin session)*

---

### `POST /api/regulator/verify` 🔒 (regulator or admin)

**Request (QR scan):**

```json
{ "payload": "{\"r\":1,\"c\":\"WED-DEMO-0001\",\"n\":\"Demo Guest\",\"s\":\"abc...\"}" }
```

**Request (manual):**

```json
{ "code": "WED-DEMO-0001" }
```

**Response (always 200):**

```json
{ "match": true, "guest": { "registrationId": 1, "invitationCode": "...", "guestName": "...", "hasPlusOne": true, "plusOneName": "...", "registeredAt": "..." } }
```

```json
{ "match": false, "reason": "QR code signature is invalid (possible forgery)." }
```

---

## 9. Security

### Password Protection

| Surface | Mechanism |
|---|---|
| Admin | `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars |
| Regulator | `REGULATOR_PASSWORD` env var |
| Comparison | `crypto.timingSafeEqual` via `safeCompare()` — mitigates timing attacks |
| Disabled login | If password env var unset, login always fails |

### Session Management

```javascript
cookieSession({
  name: 'wedding.sid',
  keys: [SESSION_SECRET],
  httpOnly: true,
  sameSite: 'lax',
  secure: IS_PROD,      // true on Vercel / NODE_ENV=production
  maxAge: 2 hours,
})
```

- **Session fixation defense:** Login replaces entire session object (`req.session = { isAdmin: true }`)
- **Production requirement:** `SESSION_SECRET` must be set or app throws at startup
- **Trust proxy:** `app.set('trust proxy', 1)` in production for correct `req.ip` behind Vercel

### SQL Injection Prevention

- **100% parameterized queries** — all user input passed as `$1`, `$2`, etc.
- **Sort column whitelist** in `listQuery()` — user `sort` param cannot inject SQL identifiers
- Table names in `listQuery` are hardcoded by callers, not user-supplied

### Input Sanitization & Validation

- Server validators trim all strings (`validators.js`)
- Email lowercased before storage
- Invitation codes uppercased before lookup
- JSON body limit: 32 KB
- String length caps enforced (names 120, IDs 40, browser UA 400)

### XSS Protection

- Frontend renders user data exclusively via `textContent` / `createElement`
- Helmet CSP restricts script sources to `'self'`
- No `eval`, no `innerHTML` with dynamic user content

### CSRF Protection

Double-submit cookie pattern (`middleware/csrf.js`):

1. Token generated per session: `crypto.randomBytes(32).toString('hex')`
2. Exposed via `GET /api/session`
3. Required in `X-CSRF-Token` header on POST/PUT/PATCH/DELETE
4. Compared with `timingSafeEqual`

### Rate Limiting

| Limiter | Scope | Default |
|---|---|---|
| `verifyLimiter` | `POST /api/invitations/verify`, `POST /api/regulator/verify` | 10/min/IP |
| `loginLimiter` | Admin + regulator login | 10/15min/IP |
| `apiLimiter` | All `/api/*` | 300/min/IP |

**Serverless caveat:** Limits are per warm function instance, not globally distributed.

### Authentication & Authorization Matrix

| Endpoint | Guest session | Admin | Regulator |
|---|---|---|---|
| `/api/invitations/verify` | ✓ | ✓ | ✓ |
| `/api/registrations` | verified invitation | — | — |
| `/api/admin/*` (except login) | — | ✓ | — |
| `/api/regulator/verify` | — | ✓ | ✓ |
| `/api/regulator/login` | — | — | ✓ |

### QR Ticket Security

- HMAC-SHA256 signature over `{ registrationId, invitationCode, guestName }`
- Secret: `QR_SECRET` or fallback `SESSION_SECRET`
- Regulator verifies signature **then** cross-checks DB record
- Tampered payload → RED verdict

### Environment Variables & Secrets

| Secret | Purpose |
|---|---|
| `SESSION_SECRET` | Signs session cookies + CSRF |
| `QR_SECRET` | Signs QR tickets (optional separate rotation) |
| `ADMIN_PASSWORD` | Admin login |
| `REGULATOR_PASSWORD` | Regulator login |
| `DATABASE_URL` | Full DB connection string including password |

**Never commit `.env`** — listed in `.gitignore`.

### Audit Logging

Security-relevant events written to `audit_log` (fire-and-forget — failures logged to console only).

---

## 10. Environment Variables

Source: `.env.example`

| Variable | Required | Default | Purpose | Where used | Example | Security notes |
|---|---|---|---|---|---|---|
| `PORT` | No | `3000` | Local HTTP port | `backend/server.js` | `3000` | Local dev only; Vercel ignores |
| `NODE_ENV` | No | `development` | Environment mode | `apiApp.js` (IS_PROD) | `production` | Enables secure cookies, trust proxy |
| `DATABASE_URL` | **Yes** | — | Postgres connection string | `backend/database/db.js` | `postgresql://postgres.xxx:PASSWORD@...pooler.supabase.com:6543/postgres` | Contains DB password; use transaction pooler on Vercel |
| `DATABASE_SSL` | No | TLS enabled | Disable TLS for local Postgres | `db.js` | `false` | Only set `false` for local embedded Postgres |
| `PG_POOL_MAX` | No | `3` | Max connections per process | `db.js` | `3` | Keep low on serverless |
| `SESSION_SECRET` | **Yes (prod)** | random hex (dev) | Cookie signing key | `apiApp.js`, `qr.js` fallback | 64-char hex | Generate with `crypto.randomBytes(32)` |
| `ADMIN_USERNAME` | No | `admin` | Admin login username | `admin.js` login | `admin` | Not secret; still use strong password |
| `ADMIN_PASSWORD` | **Yes** | — | Admin login password | `admin.js` login | strong password | Login disabled if empty |
| `REGULATOR_PASSWORD` | **Yes** | — | Regulator login | `regulator.js` login | strong password | Login disabled if empty |
| `QR_SECRET` | No | `SESSION_SECRET` | HMAC key for QR tickets | `qr.js` | separate 64-char hex | Allows rotating session secret without invalidating QRs |
| `VERIFY_RATE_LIMIT` | No | `10` | Max verify attempts/min/IP | `rateLimiter.js` | `10` | Tune for event size |

**Vercel-specific:** Set all required variables in Project → Settings → Environment Variables. `VERCEL` env is auto-set by platform.

---

## 11. Business Rules

### Invitation Codes

| Rule | Enforcement |
|---|---|
| One code → one registration | `registrations.invitation_id UNIQUE` + transaction |
| Code usable only while `status = 'unused'` | Checked at verify AND at registration (FOR UPDATE) |
| Code format | 4–40 chars, alphanumeric + hyphen; stored uppercase |
| Generated format | `WED-XXXX-XXXX` using unambiguous alphabet (no 0/O/1/I/L) |
| Case insensitive entry | Uppercased before lookup |
| Used codes cannot re-verify | 409 at verify endpoint |

### Registration

| Rule | Detail |
|---|---|
| Must verify first | Session `verifiedInvitation` required |
| Guest name required | Max 120 chars; pre-filled from invitation but editable |
| Email required | Validated by regex; stored lowercase |
| Phone optional | Validated if provided |
| Plus-one opt-in | Checkbox reveals additional fields |
| Plus-one name required | When `hasPlusOne = true` |
| Plus-one ID required | National ID / passport when plus-one |
| Plus-one phone optional | Validated if provided |
| Session cleared on success | Cannot submit again without new verification |
| IP + browser recorded | For audit purposes |

### Duplicate Prevention

1. Session cleared after successful registration
2. Invitation marked `used` in same transaction as insert
3. `SELECT ... FOR UPDATE` prevents concurrent double-submit
4. Unique constraint on `invitation_id` catches race losers (409)
5. Re-verification of used code blocked at verify step

### Admin Rules

| Rule | Detail |
|---|---|
| Bulk generate max | 500 codes per request |
| Guest name for bulk | Appends ` 1`, ` 2`, ... when count > 1 |
| Delete registrations | Keeps invitations with `used` status |
| Delete invitations | Also deletes all registrations (transaction) |
| Export | All registrations, newest first |

### Regulator Rules

| Rule | Detail |
|---|---|
| QR must match DB | Signature valid AND `registrationId`, `code`, `name` match row |
| Manual lookup | Registration must exist for code (invitation alone insufficient) |
| Admin override | Admin session can use regulator endpoints |
| Always HTTP 200 | Verdict in `match` boolean — UI shows green/red |

### Audit Event Types

| Event | Trigger |
|---|---|
| `verify_failed` | Unknown code |
| `verify_used` | Attempt on used code |
| `verify_success` | Valid verification |
| `registration_success` | Saved registration |
| `registration_duplicate` | Duplicate attempt |
| `registration_error` | Server error during save |
| `admin_login_failed` / `admin_login_success` | Admin auth |
| `regulator_login_failed` / `regulator_login_success` | Regulator auth |
| `codes_generated` | Bulk code creation |
| `registrations_deleted_all` | Admin delete registrations |
| `invitations_deleted_all` | Admin delete invitations |
| `checkin_success` / `checkin_failed` | Regulator verify |

### Edge Cases

| Scenario | Behaviour |
|---|---|
| Page reload after verify, before register | Session restores; form shown (`GET /api/session`) |
| Double-click submit | `submitting` flag prevents duplicate client requests |
| QR generation fails | Registration still succeeds; no QR shown |
| Registration fails validation | Invitation stays unused (transaction not committed) |
| Two tabs register same code | One wins; other gets 409 |
| Delete registrations only | Codes remain `used` — cannot re-register |
| Smoke test run | Empties database via delete-all endpoints |

---

## 12. Code Flow

### Application Startup

#### Local (`npm start` → `backend/server.js`)

```
1. require('./apiApp')     → loads dotenv, creates Express app
2. apiApp configures:
   - helmet, json parser, cookie-session
   - rate limiter + CSRF on /api
   - mounts route handlers
3. server.js adds:
   - express.static(frontend/)
   - HTML routes for /, /admin, /regulator
4. app.listen(PORT) unless VERCEL env set
```

#### Vercel (`api/index.js`)

```
1. Build step: npm run build → scripts/vercel-build.js → public/
2. CDN serves static files from public/
3. /api/* rewritten to api/index.js serverless function
4. api/index.js exports apiApp (no static routes, no listen())
```

### Database Initialization

```
npm run migrate  → backend/database/migrate.js
  → pool.query(CREATE TABLE IF NOT EXISTS ...)
  → pool.end()

npm run seed     → backend/database/seed.js
  → INSERT ... ON CONFLICT DO NOTHING
  → pool.end()
```

Pool is created lazily on first `require('./db')` during API requests.

### Route Registration Order (`apiApp.js`)

```
1. helmet
2. express.json
3. cookie-session
4. /api → apiLimiter
5. /api → csrfProtection
6. GET /api/session
7. /api/invitations → invitationsRouter
8. /api/registrations → registrationsRouter
9. /api/admin → adminRouter
10. /api/regulator → regulatorRouter
11. /api 404 handler
12. Global error handler (500 JSON)
```

### Request Lifecycle (mutating API call)

```mermaid
flowchart TD
    A[HTTP Request] --> B[helmet]
    B --> C[express.json]
    C --> D[cookie-session parse]
    D --> E[apiLimiter]
    E --> F{Method GET/HEAD/OPTIONS?}
    F -->|Yes| H[Route handler]
    F -->|No| G[csrfProtection]
    G -->|Invalid token| I[403]
    G -->|Valid| H
    H --> J{Auth middleware?}
    J -->|Fail| K[401]
    J -->|Pass| L[Business logic + DB]
    L --> M[JSON response]
    L -->|Uncaught error| N[500 error handler]
```

### Frontend Rendering

1. Browser loads HTML shell from CDN/local static server
2. ES module controller loads (`type="module"`)
3. `initSession()` → GET `/api/session` → stores CSRF token
4. `initTheme()` → applies dark/light from localStorage
5. Controller-specific boot logic (check auth, restore guest session)
6. User interactions → `api()` wrapper → update DOM via safe DOM APIs

### Export Handling

Admin export bypasses `api.js` — browser navigates to `GET /api/admin/export` with session cookie. Server streams Excel via `workbook.xlsx.write(res)`.

---

## 13. Component Documentation

This project uses **vanilla JS modules**, not a component framework. Below, "components" means major frontend modules and page controllers.

### Shared Modules

#### `frontend/components/api.js`

| | |
|---|---|
| **Purpose** | Centralized fetch wrapper with CSRF and error normalization |
| **Exports** | `initSession()`, `api(path, options)` |
| **State** | Module-level `csrfToken` |
| **Events** | None (called by controllers) |
| **Dependencies** | Browser `fetch` |
| **Relationships** | Used by all three page controllers |

`api()` throws Error with `.status`, `.hint`, `.fields` on non-OK responses.

#### `frontend/components/toast.js`

| | |
|---|---|
| **Purpose** | Non-blocking notification toasts |
| **Exports** | `toast(message, type, duration)` |
| **State** | Creates `#toast-container` on first use |
| **Events** | Auto-dismiss via `setTimeout` + CSS animation |
| **Dependencies** | `theme.css` toast styles |
| **Relationships** | Used by guest, admin, regulator controllers |

Types: `info`, `success`, `error`.

#### `frontend/components/theme.js`

| | |
|---|---|
| **Purpose** | Dark/light mode with persistence |
| **Exports** | `initTheme(toggleButton)` |
| **State** | `localStorage['wedding-theme']`, `document.documentElement.dataset.theme` |
| **Events** | Toggle button click |
| **Dependencies** | CSS `[data-theme="dark"]` variables in `theme.css` |
| **Relationships** | Initialized by all three pages |

---

### Page Controllers

#### `frontend/assets/js/guest.js` — Guest Flow

| | |
|---|---|
| **Purpose** | Three-step guest UX: verify → register → success |
| **HTML** | `frontend/pages/index.html` |
| **State** | `submitting` flag; panel visibility via `showPanel()` |
| **Key functions** | `greet()`, `validateClientSide()`, `renderConfirmation()`, `renderQrTicket()` |
| **Events** | `#verify-form` submit, `#registration-form` submit, `#hasPlusOne` change, `#print-btn` click |
| **API calls** | `POST /api/invitations/verify`, `POST /api/registrations`, `GET /api/session` |
| **Dependencies** | `api.js`, `toast.js`, `theme.js` |

Panels: `#panel-verify`, `#panel-form`, `#panel-success`.

#### `frontend/assets/js/admin.js` — Admin Dashboard

| | |
|---|---|
| **Purpose** | Login, stats, tables, code generation, bulk delete |
| **HTML** | `frontend/pages/admin.html` |
| **State** | `createTable()` state objects: `{ page, search, sort, dir }` per table |
| **Key functions** | `loadStats()`, `createTable()`, `deleteAll()`, `enterDashboard()` |
| **Events** | Login/logout, tab switch, search input (debounced), sort headers, generate form, delete buttons |
| **API calls** | All `/api/admin/*` endpoints |
| **Dependencies** | `api.js`, `toast.js`, `theme.js` |

Views: `#login-view`, `#dashboard-view`.

#### `frontend/assets/js/regulator.js` — QR Scanner

| | |
|---|---|
| **Purpose** | Camera QR scanning + manual code verification |
| **HTML** | `frontend/pages/regulator.html` |
| **State** | `scanning`, `lastPayload`, `lastPayloadAt`, `detector` (BarcodeDetector) |
| **Key functions** | `startCamera()`, `scanLoop()`, `decodeFrame()`, `handleScan()`, `showVerdict()`, `resumeScanning()` |
| **Events** | Login form, `#next-btn`, `#manual-form` submit |
| **API calls** | `/api/regulator/login`, `/api/regulator/verify`, `/api/regulator/session` |
| **Dependencies** | `api.js`, `toast.js`, `theme.js`, `vendor/jsQR.js` |

Camera requires secure context (HTTPS or localhost).

---

### HTML Page Shells

| File | Sections | Linked assets |
|---|---|---|
| `index.html` | Top bar (admin/regulator links), 3 panels, footer | `theme.css`, `guest.css`, `guest.js` |
| `admin.html` | Login card, dashboard (stats, generate, tabs, tables) | `theme.css`, `admin.css`, `admin.js` |
| `regulator.html` | Login, camera frame, result card, manual lookup | `theme.css`, `regulator.css`, `jsQR.js`, `regulator.js` |

---

## 14. Backend Services

There are no formal service classes — logic is organized into modules. Below documents each module's responsibilities.

### `backend/database/db.js` — Connection Pool

| | |
|---|---|
| **Responsibility** | Singleton PostgreSQL pool |
| **Dependencies** | `pg`, `DATABASE_URL` |
| **Methods** | Exported `pool` with `.query()`, `.connect()` |
| **Config** | SSL (default on), max connections, idle/connection timeouts |
| **Error handling** | Throws at load if `DATABASE_URL` missing; logs pool errors |

### `backend/database/migrate.js` — Schema Migration

| | |
|---|---|
| **Responsibility** | Create tables and indexes |
| **Dependencies** | `db.js` |
| **Methods** | Self-executing async IIFE |
| **Idempotent** | Yes — safe to re-run |

### `backend/database/seed.js` — Seed Data

| | |
|---|---|
| **Responsibility** | Insert demo + sample invitation codes |
| **Dependencies** | `db.js`, `codes.js` |
| **Fixed codes** | `WED-DEMO-0001`, `WED-TEST-0002` |
| **Idempotent** | `ON CONFLICT DO NOTHING` |

### `backend/utils/validators.js`

| Function | Purpose |
|---|---|
| `validateInvitationCode(raw)` | Format + trim + uppercase |
| `validateRegistration(body)` | Full registration payload validation |
| `trim(v)` | String trim helper |

Returns structured `{ ok, error }` or `{ ok, errors, value }`.

### `backend/utils/codes.js`

| Function | Purpose |
|---|---|
| `generateInvitationCode(prefix)` | Crypto-random `WED-XXXX-XXXX` codes |

Uses `crypto.randomInt` and unambiguous alphabet.

### `backend/utils/qr.js`

| Function | Purpose |
|---|---|
| `buildPayload(ticket)` | JSON string with HMAC signature |
| `verifyPayload(raw)` | Parse + verify scanned QR |
| `generateQrDataUrl(ticket)` | PNG data URL via `qrcode` library |
| `sign({ r, c, n })` | HMAC-SHA256 (32 hex chars) |

QR payload schema: `{ r: registrationId, c: invitationCode, n: guestName, s: signature }`.

### `backend/utils/audit.js`

| Function | Purpose |
|---|---|
| `logEvent(eventType, { code, ip, detail })` | Async INSERT into audit_log |

Fire-and-forget — `.catch()` logs to console only.

### `backend/middleware/auth.js`

| Export | Purpose |
|---|---|
| `requireAdmin` | Express middleware — 401 if not admin |
| `safeCompare(a, b)` | Timing-safe string equality |

### `backend/middleware/csrf.js`

| Export | Purpose |
|---|---|
| `ensureCsrfToken(req)` | Create/read session CSRF token |
| `csrfProtection` | Middleware for mutating methods |

### `backend/middleware/rateLimiter.js`

| Export | Applied to |
|---|---|
| `verifyLimiter` | Invitation verify, regulator verify |
| `loginLimiter` | Admin + regulator login |
| `apiLimiter` | All `/api` routes |

### Route Handlers (API Layer)

| Module | Endpoints | DB interactions |
|---|---|---|
| `invitations.js` | `POST /verify` | SELECT invitation by code |
| `registrations.js` | `POST /` | Transaction: SELECT FOR UPDATE, INSERT, UPDATE |
| `admin.js` | login, stats, list, generate, delete, export | Various SELECT/INSERT/DELETE + ExcelJS stream |
| `regulator.js` | login, verify | SELECT registration; uses `qr.verifyPayload` |

---

## 15. Deployment

### Run Locally

**Option A — Embedded Postgres (no Docker):**

```bash
# Terminal 1
node scripts/dev-postgres.js

# Terminal 2
cp .env.example .env
# Set: DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
#      DATABASE_SSL=false
#      ADMIN_PASSWORD=admin123
#      REGULATOR_PASSWORD=regulator123
npm install
npm run setup    # migrate + seed
npm start        # http://localhost:3000
```

**Option B — Supabase directly:**

Set `DATABASE_URL` to Supabase transaction pooler URI, then `npm run setup && npm start`.

**Dev with auto-reload:** `npm run dev` (uses `node --watch`).

### Configure Supabase

1. Create project at [supabase.com](https://supabase.com)
2. Copy **Transaction pooler** connection string (port **6543**)
3. Run migrations:
   ```bash
   DATABASE_URL="postgresql://..." npm run migrate
   ```
   Or paste SQL from `migrate.js` into Supabase SQL Editor
4. **Do not run `npm run seed` on production** unless intentional

### How Migrations Work

- Plain SQL in `migrate.js` — no migration framework (Knex/Flyway)
- Uses `CREATE IF NOT EXISTS` — idempotent
- Run manually via `npm run migrate` — **not** auto-run on Vercel deploy
- Schema changes require editing `migrate.js` and re-running against each environment

### Environment Variables on Vercel

Project → Settings → Environment Variables:

```
DATABASE_URL          (Supabase pooler, port 6543)
SESSION_SECRET        (64+ char random hex)
QR_SECRET             (recommended separate random hex)
ADMIN_USERNAME
ADMIN_PASSWORD
REGULATOR_PASSWORD
```

### Build Process

```bash
npm run build   # → scripts/vercel-build.js
```

Build steps:

1. Delete `public/`
2. Copy entire `frontend/` → `public/`
3. Publish pages:
   - `index.html` → `public/index.html`
   - `admin.html` → `public/admin.html` + `public/admin/index.html`
   - `regulator.html` → `public/regulator.html` + `public/regulator/index.html`

`vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }],
  "functions": { "api/index.js": { "maxDuration": 15 } }
}
```

### Deploy to Vercel

1. Push to GitHub (repo: `codetech-sol/WedReg`)
2. Import project in Vercel
3. Set environment variables
4. Deploy — Vercel runs build, serves `public/` from CDN, routes API to serverless

**Live URLs (example deployment):**

- Guest: `https://wedregitry-form.vercel.app/`
- Admin: `https://wedregitry-form.vercel.app/admin.html`
- Regulator: `https://wedregitry-form.vercel.app/regulator.html`

### Production Considerations

| Topic | Recommendation |
|---|---|
| Database pooler | Always use Supabase transaction pooler (6543) on Vercel |
| Secrets | Unique `SESSION_SECRET` and `QR_SECRET` per environment |
| Supabase free tier | Database pauses after inactivity — wake before event |
| Rate limits | Per-instance on serverless — acceptable for invitation code entropy |
| Camera scanner | Requires HTTPS (Vercel provides automatically) |
| Backups | Use Supabase backup/PITR for production guest data |
| Migrations | Run explicitly after schema changes — not automated in CI |
| `public/` folder | Gitignored — always built on deploy |

### Testing Before Production

```bash
npm test   # scripts/smoke-test.js — 33 assertions
```

**Warning:** Smoke test deletes all data at the end. Re-seed after: `npm run seed`.

---

## 16. Current Features

| Feature | Status | Notes |
|---|---|---|
| Invitation code validation | ✅ Implemented | Server-side, rate-limited |
| Session-based form unlock | ✅ Implemented | `verifiedInvitation` in cookie session |
| Guest registration | ✅ Implemented | Transactional with row locking |
| Plus-one support | ✅ Implemented | Optional; ID required when enabled |
| Client + server validation | ✅ Implemented | Mirrors rules |
| Duplicate submission protection | ✅ Implemented | Client flag + DB unique + transaction |
| Success confirmation screen | ✅ Implemented | Animated checkmark |
| Printable confirmation | ✅ Implemented | Includes invitation code |
| Personalised wedding invitation PDF | ✅ Implemented | pdf-lib + master template; preview/print/download |
| QR entry ticket | ✅ Implemented | HMAC-signed PNG embedded on invitation page 2 |
| Dark mode | ✅ Implemented | localStorage + system preference |
| Toast notifications | ✅ Implemented | All pages |
| Admin authentication | ✅ Implemented | Env-based credentials |
| Admin statistics (7 cards) | ✅ Implemented | Real-time from DB |
| Invitation table | ✅ Implemented | Search, filter, sort, paginate |
| Registration table | ✅ Implemented | Search, filter, sort, paginate |
| Bulk invitation generation | ✅ Implemented | 1–500 codes |
| Delete all invitations | ✅ Implemented | Double confirm + transaction |
| Delete all registrations | ✅ Implemented | Double confirm |
| Excel export | ✅ Implemented | Formatted .xlsx with ExcelJS |
| Regulator authentication | ✅ Implemented | Password-based |
| QR camera scanner | ✅ Implemented | BarcodeDetector + jsQR fallback |
| Manual code lookup | ✅ Implemented | Regulator fallback |
| Green/red verification UI | ✅ Implemented | Match/mismatch verdict |
| Audit logging | ✅ Implemented | Write-only (no UI) |
| CSRF protection | ✅ Implemented | All mutating API calls |
| Rate limiting | ✅ Implemented | Verify, login, general API |
| Responsive UI | ✅ Implemented | CSS media queries in theme/page CSS |
| Vercel deployment | ✅ Implemented | Static + serverless split |
| Supabase PostgreSQL | ✅ Implemented | Transaction pooler |
| Local dev Postgres | ✅ Implemented | embedded-postgres script |
| Smoke test suite | ✅ Implemented | 33 checks |
| Email confirmations | ❌ Not implemented | — |
| SMS confirmations | ❌ Not implemented | — |
| Bulk CSV import | ❌ Not implemented | Generate only |
| Audit log UI | ❌ Not implemented | Data written only |
| Role-based permissions | ❌ Not implemented | Admin vs regulator only |
| Multi-event support | ❌ Not implemented | Single wedding implicit |
| RSVP deadlines | ❌ Not implemented | — |
| Waiting list | ❌ Not implemented | — |
| Offline mode | ❌ Not implemented | Requires network |
| Individual row delete | ❌ Not implemented | Delete-all only |

---

## 17. Known Limitations

### Performance

- **Server-side pagination** helps, but very large datasets (10k+ rows) may slow Excel export (loads all registrations into memory).
- **No caching** — every stat/table query hits Postgres.
- **Rate limits** are per serverless instance, not globally coordinated.

### Scalability

- Single-database design — no sharding or read replicas configured.
- Connection pool max 3 per function instance — adequate for wedding scale, not high-traffic public apps.
- No queue for bulk operations (500-code generate is synchronous loop).

### Security

- **Single admin account** — no multi-user RBAC.
- **Regulator shared password** — no per-usher accounts.
- **Audit log not exposed** — security events stored but not reviewable in UI.
- **No 2FA** on admin/regulator login.
- **Manual code lookup** at door verifies registration exists but does not re-verify HMAC (QR path is stronger).

### User Experience

- **No email confirmation** — guests must save/print their own confirmation.
- **No password reset flow** — admin/regulator passwords are env vars only.
- **No individual invitation edit/delete** — bulk delete only.
- **Guest name on invitation** may differ from registered name (pre-fill is convenience, not enforced).
- **Used invitation after registration delete** — deleting registrations leaves invitations `used`; codes cannot be reused without DB admin intervention.

### Maintainability

- **No ORM/migration framework** — schema changes are manual SQL edits.
- **No frontend build step** — no TypeScript, linting, or bundler in CI.
- **Duplicated validation** — client mirrors server rules (must stay in sync manually).

### Reliability

- **QR generation best-effort** — rare failures leave guest without QR but registered.
- **Audit log fire-and-forget** — silent failure possible.
- **Supabase free tier pause** — cold start / unavailable if database sleeping.
- **No health check endpoint** — no `/api/health` for monitoring.

---

## 18. Future Enhancements

Based on current architecture, recommended improvements in priority order:

### High Value

| Enhancement | Rationale | Fit with codebase |
|---|---|---|
| **Email confirmation** | Guest receipt + reduce support burden | Add after `registration_success`; needs email provider (SendGrid/Resend) |
| **Audit log admin view** | Security review post-event | Data already in `audit_log`; add paginated `/api/admin/audit` |
| **Individual invitation CRUD** | Edit guest name, revoke code, delete single row | Extend `admin.js` with PATCH/DELETE by id |
| **Bulk CSV import** | Import guest list from spreadsheet | Parse CSV → batch INSERT invitations |
| **Health check endpoint** | Vercel/monitoring uptime | `GET /api/health` with DB ping |

### Medium Value

| Enhancement | Rationale |
|---|---|
| **Separate QR_SECRET rotation docs** | Already supported — document operational procedure |
| **Multiple admin users** | Replace env vars with `admin_users` table + bcrypt hashes |
| **Check-in counter** | Track `checked_in_at` on registrations |
| **Dashboard analytics charts** | Visualize registrations over time |
| **Webhook on registration** | Integrate with seating/CRM tools |
| **i18n** | Multi-language guest form |

### Lower Priority / Larger Scope

| Enhancement | Notes |
|---|---|
| **Multi-event support** | Add `events` table; scope all FKs |
| **RSVP deadlines** | Time-bound verification/registration |
| **Waiting list** | Queue when capacity reached |
| **Offline regulator mode** | Local cache + sync — significant architecture change |
| **SMS confirmations** | Twilio integration |
| **Native mobile app** | PWA may suffice for scanner |
| **TypeScript migration** | Frontend + backend type safety |
| **Redis rate limiting** | Global limits across serverless instances |

---

## 19. Developer Notes

### Critical Assumptions

1. **One wedding per deployment** — no `event_id` column; all data is global.
2. **Invitation codes are the access control** — physical/digital distribution is out of band.
3. **Frontend is untrusted** — all authorization and validation on server.
4. **Vercel serves static files from `public/`** — never rely on `express.static()` in production.
5. **Sessions are cookie-based** — no Authorization headers; CORS not configured (same-origin only).

### Hidden Logic & Non-Obvious Behaviours

| Behaviour | Location | Detail |
|---|---|---|
| Session regeneration on login | `admin.js`, `regulator.js` | `req.session = { isAdmin: true }` invalidates old CSRF — client must call `initSession()` |
| Export uses direct link | `admin.html` | GET download works because session cookie sent; no CSRF needed |
| Admin can scan | `regulator.js` | `requireRegulator` accepts `isAdmin` |
| Delete registrations preserves `used` | `admin.js` | Invitations not reset to `unused` |
| QR dedupe on scanner | `regulator.js` | Same payload ignored for 4 seconds |
| `bigint` IDs as strings | API responses | Postgres `BIGINT` may serialize as string in JSON — frontend uses `Number()` where needed |
| Smoke test empties DB | `smoke-test.js` | Always re-seed after `npm test` |
| Demo passwords in smoke test | `smoke-test.js` | Expects `ADMIN_PASSWORD=admin123` in `.env` |

### Configuration Details

- **Do not enable `cleanUrls` + redirects** for admin/regulator on Vercel — caused infinite redirect loops in past deployment (removed from `vercel.json`).
- Use **`/admin.html` and `/regulator.html`** links in production (also `/admin/` works via index.html).
- **Camera API** requires secure context — works on localhost and HTTPS only.
- **Google Fonts** allowed in CSP — offline/air-gapped deploy would need font self-hosting.

### Modifying the Schema

1. Edit SQL in `backend/database/migrate.js`
2. Run `npm run migrate` against each environment
3. Update validators, API handlers, admin tables, export columns as needed
4. Update smoke tests

### Adding a New API Endpoint

1. Create handler in `backend/api/` or extend existing router
2. Mount in `apiApp.js`
3. Consider: CSRF (automatic on mutating), rate limit, auth middleware
4. Add frontend call via `api.js`
5. Document in `docs/API.md` and this file

### Code Style Conventions

- CommonJS in backend (`require`/`module.exports`)
- ES modules in frontend (`import`/`export`)
- Async route handlers with `try/catch` + `next(err)` or inline JSON errors
- Comments explain *why*, especially security decisions
- No `innerHTML` with user data in frontend

### Gitignored Paths

- `node_modules/`, `.env`, `.pgdata/`, `public/`, `.vercel`

---

## 21. Invitation PDF Generation

After successful registration, the system generates a **personalised PDF** by loading the official master template and drawing guest-specific data on top. The template artwork is never modified on disk — each guest receives a newly rendered PDF buffer.

### Master template

| Item | Location |
|---|---|
| Template file | `templates/invitation-template.pdf` (copy of `wedding-invite.pdf`) |
| Override path | `INVITATION_TEMPLATE_PATH` environment variable |

The template is a **2-page portrait PDF** (419.5 × 595.3 pt per page). Page 1 is the event details; page 2 contains the guest honourific area and is where personalisation is drawn.

### Libraries

| Library | Purpose |
|---|---|
| **pdf-lib** (^1.17.1) | Load existing PDF, embed PNG QR, draw text, save new bytes |
| **qrcode** (existing) | Generates PNG data URL — unchanged; embedded into PDF |

### Configuration (`backend/config/invitationLayout.js`)

All drawing regions and typography settings live in a single config object — **never hard-coded in the renderer**. Adjust rectangles, fonts, and sizes when swapping templates:

```javascript
{
  guestArea:   { page: 2, x: 78, y: 158, width: 264, height: 22 },
  plusOneArea: { page: 2, x: 78, y: 136, width: 264, height: 22 },
  typography: {
    font: 'TimesRoman',
    maxFontSize: 14,
    minFontSize: 7,
    paddingX: 8,
    paddingY: 2,
    uppercase: true,
  },
  qr:             { page: 2, x: 34, y: 52, width: 76, height: 76 },
  invitationCode: { enabled: true, page: 2, centerUnderQr: true, y: 38, fontSize: 6 },
  registrationNumber: { enabled: false },
}
```

pdf-lib uses a **bottom-left origin** (y increases upward). Writing areas are axis-aligned rectangles; the renderer computes centred text positions inside each rectangle at runtime from measured text width and font height — never from fixed name coordinates.

#### Writing area configuration

| Area | Purpose | Page |
|---|---|---|
| `guestArea` | Guest full name in the first dotted writing line below “Dr./Ms./Mr. & Mrs.” | 2 |
| `plusOneArea` | Plus-one name in the second dotted line (left completely blank when no plus-one) | 2 |

Coordinates for the current template were calibrated against `templates/SAMPLE.pdf` page 2 (y ≈ 140–180 on the PDF grid — **below** the host names and honorific line, not on the “Rapheal Phiri & Veronica Chimasha” line). Each area defines `x`, `y`, `width`, and `height` in points. The template artwork is never modified — only text is drawn inside these regions.

#### Bounding rectangle rendering

The renderer treats `guestArea` and `plusOneArea` as **bounding rectangles**, not decorative overlays:

1. Read rectangle `{ x, y, width, height }` from config.
2. Measure the name string with `font.widthOfTextAtSize()` and `font.heightAtSize()`.
3. Scale the font down until the measured line fits inside the rectangle minus padding (no wrap, clip, or overflow).
4. Compute horizontal centre: `centerX - textWidth / 2`.
5. Compute vertical centre from font metrics: baseline at `centerY - fontHeight / 2` where `centerY = y + height / 2`.
6. Draw once — no hard-coded guest-name `(x, y)` anywhere in the service.

#### Dynamic text centring algorithm

For each non-empty name, the service:

1. Measures the writing area rectangle from config.
2. Chooses a font size with `fitFontSize()` (see below).
3. Computes `textWidth = font.widthOfTextAtSize(text, size)`.
4. Computes `fontHeight = font.heightAtSize(size)`.
5. Sets `x = area.x + (area.width - textWidth) / 2`.
6. Sets baseline `y = area.y + area.height / 2 - fontHeight / 2` so the line is visually centred in the box.

No absolute text `(x, y)` positions are stored per guest — only the rectangles in config.

#### Automatic font scaling

`fitFontSize()` starts at `typography.maxFontSize` and steps down by `typography.sizeStep` until the rendered line fits within the area minus padding:

- **Width constraint:** `font.widthOfTextAtSize(text, size) <= area.width - 2 × paddingX`
- **Height constraint:** `font.heightAtSize(size) <= area.height - 2 × paddingY`
- **Floor:** `typography.minFontSize`

Rules enforced by the algorithm:

- Single line only — no wrapping.
- No clipping or overflow outside the writing area.
- Short names render larger; long names scale down automatically.
- Text remains horizontally and vertically centred after scaling.

#### Plus-one rendering logic

| Registration | Guest area | Plus-one area |
|---|---|---|
| No plus-one | Guest name drawn | **Left completely blank** — no placeholder, “N/A”, or dashes |
| Has plus-one | Guest name only (not combined with plus-one) | Plus-one name drawn when `plusOneName` is non-empty |

Previously the guest line used `NAME & PLUSONE` on one line; that combined format has been removed.

#### Typography

- **Font:** `TimesRoman` (elegant serif; first supported choice from the preferred list in the spec).
- **Weight:** Regular only — bold has been removed from guest/plus-one lines.
- **Case:** Uppercase by default (`typography.uppercase: true`) for formal invitation styling.

#### QR rendering

The existing signed QR PNG from `generateQrDataUrl()` is embedded unchanged in **size and quality**:

- **Position:** bottom-**left** corner of page 2 (`qr.x`, `qr.y`) — moved from the previous bottom-right placement.
- **Size:** `qr.width` × `qr.height` (76 × 76 pt).
- Same generation and HMAC signing pipeline — regulator verification is unaffected.

#### Registration number

`registrationNumber.enabled` is **`false`**. Registration IDs remain in the database and API responses but are **not drawn** on the invitation PDF.

#### Invitation code on PDF

When `invitationCode.enabled` is `true`, the code appears in a **very small** Times Roman line centred beneath the QR block. Set `enabled: false` to omit it entirely (the QR already encodes verification data).

### Service (`backend/services/invitationPdfGenerator.js`)

| Function | Responsibility |
|---|---|
| `loadTemplateBytes()` | Read and cache master PDF from disk |
| `formatGuestName(data)` | Normalise guest name for writing area 1 |
| `formatPlusOneName(data)` | Normalise plus-one name for writing area 2 (empty when not applicable) |
| `fitFontSize(text, font, area, typography)` | Binary search by step — largest size that fits |
| `centeredTextPosition(...)` | Compute centred baseline inside a rectangle |
| `drawTextInArea(...)` | Scale + centre + draw one name line |
| `generateInvitationPdf(data)` | Load template → draw names → embed QR → return `Buffer` |
| `invitationFilename(guestName)` | Safe download filename |

**Rendering pipeline:**

```
Load invitation-template.pdf
  → read guest registration fields
  → measure + auto-scale guest name → draw in guestArea
  → if hasPlusOne && plusOneName → measure + auto-scale → draw in plusOneArea
  → embed existing QR PNG at qr (bottom-left)
  → optionally draw tiny invitation code under QR
  → save PDF buffer
```

**Input data** (from registration record + existing QR module):

- `registrationId`, `invitationCode`, `guestName`, `hasPlusOne`, `plusOneName`, `qr` (PNG data URL)

**QR signing and regulator verification are unchanged** — the same `generateQrDataUrl()` output is embedded as a PNG on page 2.

### Future customization process

1. Replace `templates/invitation-template.pdf` with the new blank master PDF (writing areas must be empty).
2. Use `templates/SAMPLE.pdf` or a printed proof to judge name placement.
3. Update `guestArea` and `plusOneArea` rectangles in `backend/config/invitationLayout.js`.
4. Tune `typography.maxFontSize`, `minFontSize`, and padding if needed.
5. Adjust `qr` only if the template QR target moves (currently bottom-left, 76 × 76 pt).
6. Call `clearTemplateCache()` or restart the server.
7. **No changes** required to registration, QR, admin, or regulator code.

### API workflow

```
POST /api/registrations
  → transaction save + mark invitation used
  → generate QR (existing)
  → set session.lastRegistrationId
  → 201 { invitationPdfUrl, invitationFilename, qr, ... }

GET /api/registrations/invitation.pdf
  → read lastRegistrationId from session
  → load registration from DB
  → regenerate QR + generateInvitationPdf()
  → return application/pdf inline
```

PDF generation on **GET** keeps the POST response lightweight (the template PDF is ~25 MB with embedded artwork).

### Frontend (`frontend/assets/js/invitationPdf.js`)

| Function | Purpose |
|---|---|
| `showInvitationPreview(iframe, url, filename)` | Fetch PDF blob, display in iframe |
| `printInvitationPdf()` | Hidden iframe + `window.print()` |
| `downloadInvitationPdf()` | Blob download with `invitationFilename` |

Success screen (`index.html` + `guest.js`): preview iframe, Print Invitation, Download Invitation PDF, Return Home.

### Swapping templates in the future

1. Replace `templates/invitation-template.pdf` with the new design PDF (blank writing areas).
2. Update `guestArea`, `plusOneArea`, and typography in `backend/config/invitationLayout.js` (page sizes may differ — log with pdf-lib `page.getSize()`).
3. Call `clearTemplateCache()` in dev or restart the server.
4. **No changes** to registration, QR, admin, or regulator code.

### Reuse (planned)

`generateInvitationPdf()` accepts any registration-shaped object and can be called from:

- Admin reprint endpoint (future)
- Email attachment worker (future)
- WhatsApp share handler (future)

---

## 20. Executive Summary

The **Wedding Guest Registration System** is a production-oriented, full-stack Node.js application designed for a single wedding event. Guests authenticate with **one-time invitation codes** verified entirely on the server; organizers manage the event through a **password-protected admin dashboard**; ushers verify attendees at the door via a **QR scanner dashboard**.

**Architecture strengths:**

- Clean separation between static frontend (CDN) and API (serverless) on Vercel
- **Transactional integrity** ensures invitations are never incorrectly consumed
- **Defense in depth:** CSRF, rate limiting, Helmet CSP, parameterized SQL, timing-safe auth, HMAC-signed QR tickets, audit logging
- **No heavy frontend framework** — fast loads, simple deployment, easy to reason about
- **Comprehensive smoke tests** (33 checks) covering the full guest → admin → regulator lifecycle

**Current capabilities:**

Complete guest registration flow with plus-one support, personalised invitation PDF (master template + guest data + signed QR), admin statistics and searchable/sortable/paginated tables, bulk code generation, Excel export, bulk post-event cleanup, and live QR check-in with green/red verdict.

**Recommended next steps:**

1. Add **email confirmation** on successful registration
2. Build an **audit log viewer** in the admin dashboard (data already captured)
3. Support **individual invitation management** (edit/delete single rows)
4. Add **`GET /api/health`** for production monitoring
5. Document operational procedures for **Supabase wake-up**, secret rotation, and pre-event seeding of real guest codes

This document, together with [`docs/API.md`](docs/API.md), [`docs/INVITATION.md`](docs/INVITATION.md), and [`README.md`](README.md), should provide sufficient context for a new engineer to operate, maintain, and extend the system without reading every source file.

---

*Document generated from codebase inspection. For endpoint quick-reference, see [docs/API.md](docs/API.md).*
