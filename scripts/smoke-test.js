/**
 * End-to-end API smoke test. Requires a freshly seeded database.
 * Run while the server is up:
 *   node scripts/smoke-test.js
 *
 * NOTE: the final section exercises the delete-all endpoints, so the
 * database is EMPTY after a successful run. Re-run `npm run seed` after.
 */
require('dotenv').config();
const { buildPayload } = require('../backend/utils/qr');

const BASE = 'http://localhost:3000';
let cookies = {};
let csrf = null;
let passed = 0;
let failed = 0;

function cookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function req(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    // Split on the FIRST '=' only — base64 cookie values contain '=' padding.
    const idx = pair.indexOf('=');
    cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  const type = res.headers.get('content-type') || '';
  let data;
  if (type.includes('json')) data = await res.json();
  else if (type.includes('pdf') || path.endsWith('.pdf')) data = await res.arrayBuffer();
  else data = await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${detail}`); }
}

(async () => {
  console.log('— Session & CSRF —');
  let r = await req('/api/session');
  csrf = r.data.csrfToken;
  check('session returns CSRF token', r.status === 200 && !!csrf);

  console.log('— CSRF enforcement —');
  const noCsrf = await fetch(BASE + '/api/invitations/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ code: 'WED-TEST-0002' }),
  });
  check('POST without CSRF token rejected (403)', noCsrf.status === 403);

  console.log('— Invitation verification —');
  r = await req('/api/invitations/verify', { method: 'POST', body: { code: 'NOPE-0000' } });
  check('unknown code rejected (404)', r.status === 404 && /invalid/i.test(r.data.error));

  r = await req('/api/invitations/verify', { method: 'POST', body: { code: 'wed-demo-0001' } });
  check('valid code accepted (case-insensitive)', r.status === 200 && r.data.guestName === 'Demo Guest');

  console.log('— Registration —');
  r = await req('/api/registrations', { method: 'POST', body: { guestName: '', guestEmail: 'bad' } });
  check('invalid payload rejected (400) with field errors', r.status === 400 && r.data.fields?.guestName);

  r = await req('/api/registrations', {
    method: 'POST',
    body: {
      guestName: '  Demo Guest  ',
      guestEmail: 'demo@example.com',
      guestPhone: '0712 345 678',
      hasPlusOne: true,
      plusOneName: 'Plus Person',
      plusOnePhone: '0700111222',
    },
  });
  check('registration saved (201)', r.status === 201 && r.data.success);
  check('QR ticket returned as PNG data URL', typeof r.data.qr === 'string' && r.data.qr.startsWith('data:image/png'));
  check('invitation PDF URL returned', typeof r.data.invitationPdfUrl === 'string' && r.data.invitationPdfUrl.includes('/invitation.pdf'));
  const registrationId = Number(r.data.registrationId);

  r = await req(r.data.invitationPdfUrl || `/api/registrations/${registrationId}/invitation.pdf`);
  if (r.status === 200 && r.data instanceof ArrayBuffer) {
    const pdfBytes = new Uint8Array(r.data.slice(0, 4));
    check('invitation PDF downloadable (%PDF)', pdfBytes[0] === 0x25 && pdfBytes[1] === 0x50);
  } else {
    check('invitation PDF downloadable (%PDF)', false, `status ${r.status}`);
  }

  r = await req('/api/invitations/verify', { method: 'POST', body: { code: 'WED-DEMO-0001' } });
  check('used code blocked (409)', r.status === 409 && /already been used/i.test(r.data.error));

  r = await req('/api/registrations', {
    method: 'POST',
    body: { guestName: 'X', guestEmail: 'x@y.com' },
  });
  check('re-submission without verified session rejected (401)', r.status === 401);

  console.log('— Plus-one registration without ID —');
  await req('/api/invitations/verify', { method: 'POST', body: { code: 'WED-TEST-0002' } });
  r = await req('/api/registrations', {
    method: 'POST',
    body: { guestName: 'Test Guest', guestEmail: 't@t.com', hasPlusOne: true, plusOneName: 'Plus Person' },
  });
  check('plus-one registration without ID saved (201)', r.status === 201 && r.data.success);
  check('invitation marked used after plus-one save', (await req('/api/invitations/verify', { method: 'POST', body: { code: 'WED-TEST-0002' } })).status === 409);

  console.log('— Admin auth —');
  r = await req('/api/admin/stats');
  check('stats blocked without login (401)', r.status === 401);

  r = await req('/api/admin/login', { method: 'POST', body: { username: process.env.ADMIN_USERNAME || 'admin', password: 'wrong' } });
  check('wrong password rejected (401)', r.status === 401);

  r = await req('/api/admin/login', { method: 'POST', body: { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD } });
  check('admin login works', r.status === 200);
  // Session regenerated on login — get the fresh CSRF token.
  r = await req('/api/session');
  csrf = r.data.csrfToken;

  console.log('— Admin data —');
  r = await req('/api/admin/stats');
  check('stats correct', r.data.totalRegistrations === 2 && r.data.usedInvitations === 2 && r.data.withPlusOne === 2, JSON.stringify(r.data));

  r = await req('/api/admin/invitations?search=DEMO&status=used');
  check('invitation search + filter', r.data.total === 1 && r.data.rows[0].invitation_code === 'WED-DEMO-0001');

  r = await req('/api/admin/registrations?sort=guest_name&dir=asc');
  check('registrations list + sort', r.data.rows.length === 2 && r.data.rows[0].guest_name === 'Demo Guest');
  check('whitespace trimmed on save', r.data.rows[0].guest_name === 'Demo Guest');

  r = await req('/api/admin/invitations/generate', { method: 'POST', body: { count: 3, guestName: 'Bulk Test' } });
  check('bulk code generation (3 codes)', r.status === 201 && r.data.created.length === 3);

  console.log('— Excel export —');
  r = await req('/api/admin/export');
  const bytes = new Uint8Array(r.data.slice(0, 2));
  check('export returns .xlsx (ZIP magic bytes PK)', r.status === 200 && bytes[0] === 0x50 && bytes[1] === 0x4b);
  check('export content-type is xlsx', (r.headers.get('content-type') || '').includes('spreadsheetml'));

  console.log('— Regulator check-in —');
  // Fresh, unauthenticated session for the regulator tests.
  cookies = {};
  r = await req('/api/session');
  csrf = r.data.csrfToken;

  const validPayload = buildPayload({
    registrationId,
    invitationCode: 'WED-DEMO-0001',
    guestName: 'Demo Guest',
  });

  r = await req('/api/regulator/verify', { method: 'POST', body: { payload: validPayload } });
  check('verify blocked without regulator login (401)', r.status === 401);

  r = await req('/api/regulator/login', { method: 'POST', body: { password: 'wrong' } });
  check('wrong regulator password rejected (401)', r.status === 401);

  r = await req('/api/regulator/login', { method: 'POST', body: { password: process.env.REGULATOR_PASSWORD } });
  check('regulator login works', r.status === 200);
  r = await req('/api/session');
  csrf = r.data.csrfToken;

  r = await req('/api/regulator/verify', { method: 'POST', body: { payload: validPayload } });
  check('valid QR verified GREEN', r.data.match === true && r.data.guest.guestName === 'Demo Guest');

  const forged = JSON.parse(validPayload);
  forged.n = 'Impostor';
  r = await req('/api/regulator/verify', { method: 'POST', body: { payload: JSON.stringify(forged) } });
  check('tampered QR rejected RED (bad signature)', r.data.match === false);

  r = await req('/api/regulator/verify', { method: 'POST', body: { payload: 'not-a-qr' } });
  check('garbage payload rejected RED', r.data.match === false);

  r = await req('/api/regulator/verify', { method: 'POST', body: { code: 'wed-demo-0001' } });
  check('manual code lookup verified GREEN', r.data.match === true);

  r = await req('/api/regulator/verify', { method: 'POST', body: { code: 'WED-NEVER-USED' } });
  check('unregistered code rejected RED', r.data.match === false);

  console.log('— Delete all (post-event cleanup) —');
  // Back to the admin session for destructive endpoints.
  cookies = {};
  r = await req('/api/session');
  csrf = r.data.csrfToken;
  await req('/api/admin/login', { method: 'POST', body: { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD } });
  r = await req('/api/session');
  csrf = r.data.csrfToken;

  r = await req('/api/admin/registrations', { method: 'DELETE' });
  check('delete all registrations', r.status === 200 && r.data.deleted === 2);

  r = await req('/api/admin/invitations', { method: 'DELETE' });
  check('delete all invitations (cascades)', r.status === 200 && r.data.deleted > 0);

  r = await req('/api/admin/stats');
  check('stats zeroed after cleanup', r.data.totalInvitations === 0 && r.data.totalRegistrations === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
