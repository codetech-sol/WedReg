/**
 * Tiny API client. Fetches the CSRF token once from the server session
 * and attaches it to every state-changing request.
 */
let csrfToken = null;

export async function initSession() {
  const res = await fetch('/api/session', { credentials: 'same-origin' });
  const data = await res.json();
  csrfToken = data.csrfToken;
  return data;
}

/**
 * JSON request wrapper. Throws an ApiError carrying the server's
 * status code and (optionally) per-field validation errors.
 */
export async function api(path, { method = 'GET', body, _csrfRetried = false } = {}) {
  // Sync CSRF token before every mutation so other tabs (e.g. admin login)
  // cannot leave this page with a stale token in memory.
  if (method !== 'GET') {
    await initSession();
  }

  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (
    res.status === 403
    && !_csrfRetried
    && typeof data.error === 'string'
    && data.error.toLowerCase().includes('csrf')
  ) {
    await initSession();
    return api(path, { method, body, _csrfRetried: true });
  }

  if (!res.ok) {
    const err = new Error(data.error || 'Request failed. Please try again.');
    err.status = res.status;
    err.hint = data.hint;
    err.fields = data.fields;
    throw err;
  }
  return data;
}
