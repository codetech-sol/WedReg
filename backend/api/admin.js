/**
 * Admin API — login, statistics, invitation & registration management,
 * bulk code generation, bulk deletion, and Excel export.
 *
 * All routes except /login and /session require an authenticated admin session.
 */
const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../database/db');
const { requireAdmin, safeCompare } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
const { generateInvitationCode } = require('../utils/codes');
const { logEvent } = require('../utils/audit');

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const validUser = safeCompare(username || '', process.env.ADMIN_USERNAME || 'admin');
  const validPass = safeCompare(password || '', process.env.ADMIN_PASSWORD || '');

  if (!validUser || !validPass || !process.env.ADMIN_PASSWORD) {
    logEvent('admin_login_failed', { ip: req.ip, detail: username });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Replace the whole session on privilege change (fixation defence).
  // A fresh CSRF token is minted on the next GET /api/session.
  req.session = { isAdmin: true };
  logEvent('admin_login_success', { ip: req.ip, detail: username });
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

router.get('/session', (req, res) => {
  res.json({ authenticated: Boolean(req.session && req.session.isAdmin) });
});

// Everything below requires authentication.
router.use(requireAdmin);

/* ------------------------------------------------------------------ */
/* Statistics                                                           */
/* ------------------------------------------------------------------ */

router.get('/stats', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM invitations)                                            AS "totalInvitations",
        (SELECT COUNT(*)::int FROM invitations WHERE status = 'unused')                    AS "unusedInvitations",
        (SELECT COUNT(*)::int FROM invitations WHERE status = 'used')                      AS "usedInvitations",
        (SELECT COUNT(*)::int FROM registrations)                                          AS "totalRegistrations",
        (SELECT COUNT(*)::int FROM registrations WHERE has_plus_one)                       AS "withPlusOne",
        (SELECT COUNT(*)::int FROM registrations WHERE NOT has_plus_one)                   AS "withoutPlusOne",
        (SELECT COUNT(*)::int FROM registrations WHERE registered_at::date = CURRENT_DATE) AS "todayRegistrations"
    `);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Listing helpers (search / filter / sort / paginate)                  */
/* ------------------------------------------------------------------ */

/**
 * Build a safe paginated list query. Sort columns are whitelisted per table
 * so user input can never reach SQL identifiers; all values are bound
 * parameters (prevents injection).
 */
async function listQuery({ table, searchCols, sortWhitelist, req, filter }) {
  const search = String(req.query.search || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
  const sort = sortWhitelist.includes(req.query.sort) ? req.query.sort : sortWhitelist[0];
  const dir = String(req.query.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = [];
  if (filter) {
    params.push(filter.value);
    where.push(`${filter.column} = $${params.length}`);
  }
  if (search) {
    const parts = searchCols.map((col) => {
      params.push(`%${search}%`);
      return `${col} ILIKE $${params.length}`;
    });
    where.push(`(${parts.join(' OR ')})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} ${whereSql}`, params)
  ).rows[0].n;

  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await pool.query(
    `SELECT * FROM ${table} ${whereSql}
     ORDER BY ${sort} ${dir} NULLS LAST
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

router.get('/invitations', async (req, res, next) => {
  try {
    const status = ['used', 'unused'].includes(req.query.status) ? req.query.status : null;
    res.json(
      await listQuery({
        table: 'invitations',
        searchCols: ['invitation_code', 'guest_name'],
        sortWhitelist: ['created_at', 'guest_name', 'invitation_code', 'status', 'used_at'],
        req,
        filter: status ? { column: 'status', value: status } : null,
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get('/registrations', async (req, res, next) => {
  try {
    const plusOne = ['1', '0'].includes(req.query.plusOne) ? req.query.plusOne : null;
    res.json(
      await listQuery({
        table: 'registrations',
        searchCols: ['guest_name', 'guest_email', 'invitation_code', 'plus_one_name'],
        sortWhitelist: ['registered_at', 'guest_name', 'guest_email', 'invitation_code'],
        req,
        filter: plusOne !== null ? { column: 'has_plus_one', value: plusOne === '1' } : null,
      })
    );
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Bulk invitation code generation                                      */
/* ------------------------------------------------------------------ */

router.post('/invitations/generate', async (req, res, next) => {
  try {
    const count = Math.min(500, Math.max(1, parseInt(req.body.count, 10) || 1));
    const guestName = String(req.body.guestName || 'Guest').trim().slice(0, 120) || 'Guest';

    const created = [];
    for (let i = 0; i < count; i++) {
      // Retry on the (astronomically unlikely) collision with an existing code.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateInvitationCode();
        const result = await pool.query(
          `INSERT INTO invitations (guest_name, invitation_code) VALUES ($1, $2)
           ON CONFLICT (invitation_code) DO NOTHING`,
          [count > 1 ? `${guestName} ${i + 1}` : guestName, code]
        );
        if (result.rowCount === 1) {
          created.push(code);
          break;
        }
      }
    }

    logEvent('codes_generated', { ip: req.ip, detail: `${created.length} codes` });
    res.status(201).json({ success: true, created });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Bulk deletion (post-event cleanup)                                   */
/* ------------------------------------------------------------------ */

// Delete every registration. Invitations keep their 'used' status so the
// invitation history survives; delete invitations too for a full reset.
router.delete('/registrations', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM registrations');
    logEvent('registrations_deleted_all', { ip: req.ip, detail: `${result.rowCount} rows` });
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) {
    next(err);
  }
});

// Delete every invitation AND every registration in one transaction.
router.delete('/invitations', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const regs = (await client.query('DELETE FROM registrations')).rowCount;
    const invs = (await client.query('DELETE FROM invitations')).rowCount;
    await client.query('COMMIT');
    logEvent('invitations_deleted_all', { ip: req.ip, detail: `${invs} invitations, ${regs} registrations` });
    res.json({ success: true, deleted: invs, registrationsDeleted: regs });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

/* ------------------------------------------------------------------ */
/* Excel export                                                         */
/* ------------------------------------------------------------------ */

router.get('/export', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT invitation_code, guest_name, guest_email, guest_phone,
              has_plus_one, plus_one_name, plus_one_phone, plus_one_id, registered_at
       FROM registrations ORDER BY registered_at DESC`
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Wedding Guest Registration System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Wedding Guest Registrations', {
      views: [{ state: 'frozen', ySplit: 1 }], // freeze the header row
    });

    sheet.columns = [
      { header: 'Invitation Code', key: 'invitation_code', width: 20 },
      { header: 'Guest Name', key: 'guest_name', width: 28 },
      { header: 'Email', key: 'guest_email', width: 32 },
      // Phone columns use text format so leading zeros survive.
      { header: 'Phone', key: 'guest_phone', width: 18, style: { numFmt: '@' } },
      { header: 'Plus One', key: 'plus_one_name', width: 28 },
      { header: 'Plus One Phone', key: 'plus_one_phone', width: 18, style: { numFmt: '@' } },
      { header: 'Registered At', key: 'registered_at', width: 22 },
    ];

    for (const row of rows) {
      sheet.addRow({
        invitation_code: row.invitation_code,
        guest_name: row.guest_name,
        guest_email: row.guest_email,
        guest_phone: row.guest_phone ? String(row.guest_phone) : '',
        plus_one_name: row.has_plus_one ? row.plus_one_name : '—',
        plus_one_phone: row.has_plus_one && row.plus_one_phone ? String(row.plus_one_phone) : '',
        registered_at: formatDate(row.registered_at),
      });
    }

    // Header styling: bold white text on a soft rose band.
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    header.alignment = { vertical: 'middle' };
    header.height = 24;
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9D5C63' } };
    });

    // Auto-filter across every column.
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

    // Auto-size: widen columns to fit their longest value (capped for sanity).
    sheet.columns.forEach((col) => {
      let max = String(col.header).length;
      col.eachCell({ includeEmpty: false }, (cell) => {
        max = Math.max(max, String(cell.value ?? '').length);
      });
      col.width = Math.min(45, Math.max(col.width || 10, max + 3));
    });

    const filename = `wedding-registrations-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

/** pg returns TIMESTAMPTZ columns as JS Date objects. */
function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

module.exports = router;
