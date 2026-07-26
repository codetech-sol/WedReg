# API Documentation

Base URL: `http://localhost:3000/api`

All requests and responses use JSON unless noted. Errors always have the shape:

```json
{ "error": "Human-readable message", "hint": "optional extra guidance", "fields": { "fieldName": "per-field error" } }
```

## Authentication & CSRF

- Sessions are cookie-based (`wedding.sid`, httpOnly, sameSite=lax).
- Every **mutating** request (POST/PUT/PATCH/DELETE) must include the header
  `X-CSRF-Token` with the token obtained from `GET /api/session`.
  Requests without it are rejected with `403`.
- Admin endpoints additionally require an authenticated admin session
  (see `POST /api/admin/login`); otherwise they return `401`.

---

## Session

### `GET /api/session`

Returns the CSRF token and current guest verification state.

**200**
```json
{ "csrfToken": "64-hex-chars", "invitation": { "guestName": "Demo Guest" } }
```
`invitation` is `null` when no code has been verified in this session.

---

## Invitations

### `POST /api/invitations/verify`

Validates an invitation code against the master database. Rate-limited
(default 10/min/IP → `429`).

**Body** `{ "code": "WED-DEMO-0001" }` (case-insensitive, trimmed)

| Status | Meaning | Response |
|---|---|---|
| 200 | Valid & unused. Code stored in session. | `{ "valid": true, "guestName": "Demo Guest" }` |
| 400 | Missing/malformed code | `{ "error": "..." }` |
| 404 | Code does not exist | `{ "error": "Invalid invitation code.", "hint": "Please check your code and try again." }` |
| 409 | Code already used | `{ "error": "This invitation code has already been used.", "hint": "If you believe this is an error, please contact the wedding organizers." }` |
| 429 | Rate limit exceeded | `{ "error": "Too many attempts. ..." }` |

---

## Registrations

### `POST /api/registrations`

Saves a registration for the invitation verified in the current session.
The insert and the `status = 'used'` update run in **one transaction** —
on any failure nothing is saved and the code remains unused.

**Body**
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
`guestPhone` is optional. Plus-one fields are required only when
`hasPlusOne` is `true` (`plusOnePhone` stays optional). All values are trimmed.

| Status | Meaning | Response |
|---|---|---|
| 201 | Saved | `{ "success": true, "registrationId": 1, "invitationCode": "WED-DEMO-0001", "qr": "data:image/png;base64,...", "invitationPdfUrl": "/api/registrations/invitation.pdf", "invitationFilename": "Wedding Invitation - Demo Guest.pdf", "message": "..." }` |

### `GET /api/registrations/:registrationId/invitation.pdf`

Returns the personalised invitation PDF for the registration just completed in this session (`lastRegistrationId` must match).

**200** — `application/pdf` inline (master template + guest name, QR, invitation code)

**403** — Session does not match the requested registration

**404** — Registration not found
| 400 | Validation failed | `{ "error": "...", "fields": { "guestEmail": "Please enter a valid email address." } }` |
| 401 | No verified code in session | `{ "error": "Please verify your invitation code first." }` |
| 409 | Invitation already registered | `{ "error": "This invitation has already been registered." }` |
| 500 | Save failed — fully rolled back | `{ "error": "..." }` |

---

## Admin

### `POST /api/admin/login`
Rate-limited (10 / 15 min / IP). **Body** `{ "username": "...", "password": "..." }`
→ `200 { "success": true }` or `401`. The session is regenerated on success.

### `POST /api/admin/logout`
Destroys the session. → `200 { "success": true }`

### `GET /api/admin/session`
→ `200 { "authenticated": true|false }`

### `GET /api/admin/stats` 🔒
```json
{
  "totalInvitations": 15, "unusedInvitations": 13, "usedInvitations": 2,
  "totalRegistrations": 2, "withPlusOne": 2, "withoutPlusOne": 0,
  "todayRegistrations": 2
}
```

### `GET /api/admin/invitations` 🔒

Query parameters:

| Param | Values | Default |
|---|---|---|
| `search` | matches code or guest name | — |
| `status` | `used` \| `unused` | all |
| `sort` | `created_at`, `guest_name`, `invitation_code`, `status`, `used_at` | `created_at` |
| `dir` | `asc` \| `desc` | `desc` |
| `page` | ≥ 1 | 1 |
| `pageSize` | 1–100 | 10 |

**200** `{ "rows": [...], "total": 15, "page": 1, "pageSize": 10, "totalPages": 2 }`

### `GET /api/admin/registrations` 🔒

Same shape. `search` matches name, email, code, or plus-one name.
Filter `plusOne=1|0`. Sort: `registered_at`, `guest_name`, `guest_email`,
`invitation_code`.

### `POST /api/admin/invitations/generate` 🔒

**Body** `{ "count": 10, "guestName": "Family Table 4" }` (count 1–500)

**201** `{ "success": true, "created": ["WED-K4TP-9XQ2", "..."] }`

### `DELETE /api/admin/registrations` 🔒

Deletes **every** registration (invitations keep their status).

**200** `{ "success": true, "deleted": 42 }`

### `DELETE /api/admin/invitations` 🔒

Deletes **every** invitation AND every registration (single transaction).

**200** `{ "success": true, "deleted": 120, "registrationsDeleted": 42 }`

## Regulator (door check-in)

### `POST /api/regulator/login`
Rate-limited. **Body** `{ "password": "..." }` → `200 { "success": true }` or `401`.

### `GET /api/regulator/session`
→ `200 { "authenticated": true|false }` (admins also count as authenticated).

### `POST /api/regulator/verify` 🔒 (regulator or admin)

**Body** — one of:
```json
{ "payload": "<raw string decoded from the scanned QR>" }
{ "code": "WED-XXXX-XXXX" }
```
Always returns `200`; the outcome is in `match`:

```json
{ "match": true, "guest": { "guestName": "...", "invitationCode": "...", "hasPlusOne": true, "plusOneName": "...", "registeredAt": "..." } }
{ "match": false, "reason": "QR code signature is invalid (possible forgery)." }
```
The QR payload is HMAC-signed at issue time; verification checks the
signature and then cross-checks every field against the stored registration.
All attempts are audit-logged.

### `GET /api/admin/export` 🔒

Downloads `wedding-registrations-YYYY-MM-DD.xlsx` — worksheet
"Wedding Guest Registrations" with bold frozen header, auto-filter,
auto-sized columns, readable dates, and text-formatted phone/ID columns
(leading zeros preserved).

Columns: Invitation Code · Guest Name · Email · Phone · Plus One ·
Plus One Phone · Plus One ID · Registered At
