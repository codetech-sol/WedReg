/**
 * Regulator dashboard controller.
 *
 * Streams the device camera, decodes QR codes (native BarcodeDetector when
 * available, jsQR fallback otherwise), and asks the server to verify each
 * scan. The page flashes GREEN when the ticket matches the system and RED
 * when it does not. A manual invitation-code lookup covers unreadable codes.
 */
import { api, initSession } from '/components/api.js';
import { toast } from '/components/toast.js';
import { initTheme } from '/components/theme.js';

initTheme(document.getElementById('theme-toggle'));

const loginView = document.getElementById('login-view');
const scannerView = document.getElementById('scanner-view');
const authBoot = document.getElementById('auth-boot');

function setLoading(btn, loading) {
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
}

/* ------------------------------------------------------------------ */
/* Boot & login                                                         */
/* ------------------------------------------------------------------ */
(async function boot() {
  loginView.hidden = true;
  scannerView.hidden = true;
  await initSession();
  const { authenticated } = await api('/api/regulator/session');
  authBoot.hidden = true;
  if (authenticated) enterScanner();
  else loginView.hidden = false;
})().catch(() => {
  authBoot.hidden = true;
  loginView.hidden = false;
  toast('Could not reach the server.', 'error');
});

const loginBtn = document.getElementById('login-btn');
document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setLoading(loginBtn, true);
  try {
    await api('/api/regulator/login', {
      method: 'POST',
      body: { password: document.getElementById('password').value },
    });
    await initSession(); // session regenerated — refresh CSRF token
    enterScanner();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(loginBtn, false);
  }
});

function enterScanner() {
  loginView.hidden = true;
  scannerView.hidden = false;
  startCamera();
}

/* ------------------------------------------------------------------ */
/* Camera & QR decoding                                                 */
/* ------------------------------------------------------------------ */
const video = document.getElementById('camera');
const cameraError = document.getElementById('camera-error');
const scanHint = document.getElementById('scan-hint');

let scanning = false;          // decode loop active
let lastPayload = null;        // dedupe: don't re-verify the same code
let lastPayloadAt = 0;
let detector = null;           // native BarcodeDetector, if supported
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError('Camera is not available in this browser. Use the manual lookup below.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      } catch { /* fall through to jsQR */ }
    }
    scanning = true;
    scanLoop();
  } catch (err) {
    showCameraError(
      err.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access and reload, or use the manual lookup below.'
        : 'Could not start the camera. Use the manual lookup below.'
    );
  }
}

function showCameraError(message) {
  cameraError.textContent = message;
  cameraError.hidden = false;
  scanHint.textContent = 'Camera unavailable — manual lookup only.';
}

async function scanLoop() {
  if (!scanning) return;
  if (video.readyState >= 2) {
    const decoded = await decodeFrame();
    if (decoded) {
      const now = Date.now();
      // Ignore the same code re-read within 4s (guest holding it steady).
      if (decoded !== lastPayload || now - lastPayloadAt > 4000) {
        lastPayload = decoded;
        lastPayloadAt = now;
        await handleScan(decoded);
      }
    }
  }
  setTimeout(scanLoop, 180);
}

async function decodeFrame() {
  try {
    if (detector) {
      const codes = await detector.detect(video);
      return codes.length ? codes[0].rawValue : null;
    }
    // jsQR fallback: sample the frame through a canvas.
    const size = 480;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(video, 0, 0, size, size);
    const image = ctx.getImageData(0, 0, size, size);
    const result = window.jsQR?.(image.data, size, size, { inversionAttempts: 'dontInvert' });
    return result ? result.data : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Verification & verdict display                                       */
/* ------------------------------------------------------------------ */
const resultCard = document.getElementById('result-card');
const resultIdle = document.getElementById('result-idle');
const resultBody = document.getElementById('result-body');
const guestDetails = document.getElementById('guest-details');

async function handleScan(payload) {
  scanning = false; // pause while we verify and show the verdict
  scanHint.textContent = 'Verifying…';
  try {
    const result = await api('/api/regulator/verify', { method: 'POST', body: { payload } });
    showVerdict(result);
  } catch (err) {
    toast(err.message, 'error');
    resumeScanning();
  }
}

function showVerdict({ match, guest, reason }) {
  resultIdle.hidden = true;
  resultBody.hidden = false;
  resultCard.classList.remove('match', 'mismatch', 'result-pop');
  document.body.classList.remove('verdict-match', 'verdict-mismatch');
  void resultCard.offsetWidth; // restart the pop animation

  document.getElementById('result-icon').textContent = match ? '✔' : '✖';
  document.getElementById('result-title').textContent = match ? 'Guest Verified' : 'Not Verified';
  document.getElementById('result-reason').textContent = match
    ? 'Details match the system record.'
    : reason || 'This code does not match the system.';

  guestDetails.replaceChildren();
  if (match && guest) {
    const add = (label, value) => {
      if (!value) return;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      guestDetails.append(dt, dd);
    };
    add('Guest', guest.guestName);
    add('Invitation Code', guest.invitationCode);
    add('Plus One', guest.hasPlusOne ? guest.plusOneName : 'No plus one');
    add('Phone', guest.guestPhone);
  }

  resultCard.classList.add(match ? 'match' : 'mismatch', 'result-pop');
  document.body.classList.add(match ? 'verdict-match' : 'verdict-mismatch');
  scanHint.textContent = 'Press "Scan Next Guest" to continue.';
}

function resumeScanning() {
  resultCard.classList.remove('match', 'mismatch');
  document.body.classList.remove('verdict-match', 'verdict-mismatch');
  resultBody.hidden = true;
  resultIdle.hidden = false;
  scanHint.textContent = video.srcObject ? 'Waiting for a QR code…' : 'Camera unavailable — manual lookup only.';
  lastPayload = null;
  if (video.srcObject) {
    scanning = true;
    scanLoop();
  }
}

document.getElementById('next-btn').addEventListener('click', resumeScanning);

/* ------------------------------------------------------------------ */
/* Manual lookup fallback                                               */
/* ------------------------------------------------------------------ */
const manualBtn = document.getElementById('manual-btn');
document.getElementById('manual-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = document.getElementById('manual-code').value.trim();
  if (!code) return;
  setLoading(manualBtn, true);
  scanning = false;
  try {
    const result = await api('/api/regulator/verify', { method: 'POST', body: { code } });
    showVerdict(result);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(manualBtn, false);
  }
});
