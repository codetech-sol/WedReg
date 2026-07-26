/**
 * Guest flow controller:
 *   Step 1 — verify invitation code (server-side check via API)
 *   Step 2 — registration form with optional Plus One
 *   Step 3 — success screen with personalised invitation PDF
 */
import { api, initSession } from '/components/api.js';
import { toast } from '/components/toast.js';
import { initTheme } from '/components/theme.js';
import {
  showInvitationPreview,
  printInvitationPdf,
  downloadInvitationPdf,
} from '/assets/js/invitationPdf.js';

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

let submitting = false;

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
    showPanel('success');

    const previewFrame = document.getElementById('invitation-pdf-preview');
    const previewLoading = document.getElementById('invitation-preview-loading');
    previewLoading.hidden = false;
    previewFrame.hidden = true;
    previewLoading.textContent = 'Generating your invitation PDF… this may take a moment.';
    document.getElementById('print-invitation-btn').disabled = true;
    document.getElementById('download-invitation-btn').disabled = true;

    try {
      await showInvitationPreview(
        previewFrame,
        result.invitationPdfUrl || `/api/registrations/${result.registrationId}/invitation.pdf`,
        result.invitationFilename
      );
      previewLoading.hidden = true;
      document.getElementById('print-invitation-btn').disabled = false;
      document.getElementById('download-invitation-btn').disabled = false;
      toast('Your personalised invitation is ready!', 'success');
    } catch (pdfErr) {
      previewLoading.textContent = pdfErr.message || 'Could not load invitation preview.';
      document.getElementById('print-invitation-btn').disabled = true;
      document.getElementById('download-invitation-btn').disabled = true;
      toast(pdfErr.message || 'Registration saved, but the invitation PDF could not be loaded.', 'error');
    }
  } catch (err) {
    if (err.fields) {
      Object.entries(err.fields).forEach(([field, message]) => showFieldError(field, message));
    }
    if (err.status === 409 || err.status === 401) {
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

document.getElementById('print-invitation-btn').addEventListener('click', () => {
  try {
    printInvitationPdf();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('download-invitation-btn').addEventListener('click', () => {
  try {
    downloadInvitationPdf();
    toast('Invitation PDF downloaded.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('home-btn').addEventListener('click', () => {
  window.location.href = '/';
});
