/**
 * Guest flow controller:
 *   Step 1 — verify invitation code (server-side check via API)
 *   Step 2 — registration form with optional Plus One
 *   Step 3 — success screen with printable confirmation
 */
import { api, initSession } from '/components/api.js';
import { toast } from '/components/toast.js';
import { initTheme } from '/components/theme.js';

initTheme(document.getElementById('theme-toggle'));

const panels = {
  verify: document.getElementById('panel-verify'),
  form: document.getElementById('panel-form'),
  success: document.getElementById('panel-success'),
};

function showPanel(name) {
  for (const [key, el] of Object.entries(panels)) {
    el.hidden = key !== name;
  }
  panels[name].querySelector('input, button')?.focus({ preventScroll: true });
}

function setLoading(btn, loading) {
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
}

function showFieldError(id, message) {
  const input = document.getElementById(id);
  const errorEl = document.getElementById(`${id}-error`);
  if (!errorEl) return;
  errorEl.textContent = message || '';
  errorEl.classList.toggle('visible', Boolean(message));
  input?.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach((el) => {
    el.textContent = '';
    el.classList.remove('visible');
  });
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.setAttribute('aria-invalid', 'false'));
}

/* ------------------------------------------------------------------ */
/* Boot: restore session state (already-verified guests skip step 1)   */
/* ------------------------------------------------------------------ */
(async function boot() {
  try {
    const session = await initSession();
    if (session.invitation) {
      greet(session.invitation.guestName);
      showPanel('form');
    }
  } catch {
    toast('Could not reach the server. Please refresh the page.', 'error');
  }
})();

function greet(guestName) {
  document.getElementById('greeting').textContent =
    `Welcome, ${guestName}! Please complete your registration below.`;
  const nameInput = document.getElementById('guestName');
  if (!nameInput.value) nameInput.value = guestName;
}

/* ------------------------------------------------------------------ */
/* Step 1 — invitation code verification                               */
/* ------------------------------------------------------------------ */
const verifyForm = document.getElementById('verify-form');
const verifyBtn = document.getElementById('verify-btn');

verifyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(verifyForm);

  const code = document.getElementById('code').value.trim();
  if (!code) {
    showFieldError('code', 'Please enter your invitation code.');
    return;
  }

  setLoading(verifyBtn, true);
  try {
    const result = await api('/api/invitations/verify', { method: 'POST', body: { code } });
    toast(`Welcome, ${result.guestName}!`, 'success');
    greet(result.guestName);
    showPanel('form');
  } catch (err) {
    const message = err.hint ? `${err.message} ${err.hint}` : err.message;
    showFieldError('code', message);
    toast(err.message, 'error');
  } finally {
    setLoading(verifyBtn, false);
  }
});

/* ------------------------------------------------------------------ */
/* Step 2 — registration form                                          */
/* ------------------------------------------------------------------ */
const registrationForm = document.getElementById('registration-form');
const submitBtn = document.getElementById('submit-btn');
const plusOneCheckbox = document.getElementById('hasPlusOne');
const plusOneFields = document.getElementById('plus-one-fields');

plusOneCheckbox.addEventListener('change', () => {
  plusOneFields.hidden = !plusOneCheckbox.checked;
  if (plusOneCheckbox.checked) {
    document.getElementById('plusOneName').focus();
  } else {
    ['plusOneName', 'plusOnePhone', 'plusOneId'].forEach((id) => showFieldError(id, ''));
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

/** Client-side validation mirrors the server rules (server is authoritative). */
function validateClientSide(values) {
  const errors = {};
  if (!values.guestName) errors.guestName = 'Full name is required.';
  if (!values.guestEmail) errors.guestEmail = 'Email address is required.';
  else if (!EMAIL_RE.test(values.guestEmail)) errors.guestEmail = 'Please enter a valid email address.';
  if (values.guestPhone && !PHONE_RE.test(values.guestPhone))
    errors.guestPhone = 'Please enter a valid phone number.';
  if (values.hasPlusOne) {
    if (!values.plusOneName) errors.plusOneName = "Please enter your plus one's full name.";
    if (values.plusOnePhone && !PHONE_RE.test(values.plusOnePhone))
      errors.plusOnePhone = 'Please enter a valid phone number.';
    if (!values.plusOneId) errors.plusOneId = 'National ID / passport number is required.';
  }
  return errors;
}

let submitting = false; // guards against double-clicks / double submits

registrationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting) return;
  clearFieldErrors(registrationForm);

  const values = {
    guestName: document.getElementById('guestName').value.trim(),
    guestEmail: document.getElementById('guestEmail').value.trim(),
    guestPhone: document.getElementById('guestPhone').value.trim(),
    hasPlusOne: plusOneCheckbox.checked,
    plusOneName: document.getElementById('plusOneName').value.trim(),
    plusOnePhone: document.getElementById('plusOnePhone').value.trim(),
    plusOneId: document.getElementById('plusOneId').value.trim(),
  };

  const errors = validateClientSide(values);
  if (Object.keys(errors).length) {
    Object.entries(errors).forEach(([field, message]) => showFieldError(field, message));
    document.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  submitting = true;
  setLoading(submitBtn, true);
  try {
    const result = await api('/api/registrations', { method: 'POST', body: values });
    renderConfirmation(values);
    renderQrTicket(result.qr);
    showPanel('success');
  } catch (err) {
    if (err.fields) {
      Object.entries(err.fields).forEach(([field, message]) => showFieldError(field, message));
    }
    if (err.status === 409 || err.status === 401) {
      // Invitation consumed or session expired — send them back to step 1.
      toast(err.message, 'error');
      setTimeout(() => window.location.reload(), 2600);
    } else {
      toast(err.message, 'error');
    }
  } finally {
    submitting = false;
    setLoading(submitBtn, false);
  }
});

/* ------------------------------------------------------------------ */
/* Step 3 — success & printable confirmation                           */
/* ------------------------------------------------------------------ */
function renderConfirmation(values) {
  const dl = document.createElement('dl');
  const add = (label, value) => {
    if (!value) return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value; // textContent — no XSS risk
    dl.append(dt, dd);
  };
  add('Guest', values.guestName);
  add('Email', values.guestEmail);
  add('Phone', values.guestPhone);
  if (values.hasPlusOne) add('Plus One', values.plusOneName);
  add('Registered', new Date().toLocaleString());
  const confirmation = document.getElementById('confirmation');
  confirmation.replaceChildren(dl);
}

/** Show the signed entry-ticket QR issued by the server. */
function renderQrTicket(qrDataUrl) {
  if (!qrDataUrl) return; // registration succeeded even if QR rendering failed
  const ticket = document.getElementById('qr-ticket');
  document.getElementById('qr-image').src = qrDataUrl;
  ticket.hidden = false;
}

document.getElementById('print-btn').addEventListener('click', () => window.print());
