/**
 * Client helpers for personalised invitation PDF preview, print, and download.
 * Fetches the server-generated PDF from /api/registrations/invitation.pdf.
 */

/** @type {Blob|null} */
let pdfBlob = null;

/** @type {string|null} */
let pdfFilename = null;

/** @type {string|null} */
let pdfApiUrl = null;

/** @type {string|null} */
let blobUrl = null;

function revokeBlobUrl() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
}

function isPdfBytes(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer);
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Fetch invitation PDF after successful registration.
 * @param {string} pdfUrl — from registration API response
 * @param {string} filename — suggested download name
 */
export async function loadInvitationPdf(pdfUrl, filename) {
  revokeBlobUrl();
  pdfBlob = null;
  pdfApiUrl = pdfUrl;
  pdfFilename = filename || 'Wedding Invitation.pdf';

  const res = await fetch(pdfUrl, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && !data.error) {
      throw new Error('Invitation PDF endpoint not found. Restart the server and try registering again.');
    }
    throw new Error(data.error || 'Could not load your invitation PDF.');
  }

  const bytes = await res.arrayBuffer();
  if (!isPdfBytes(bytes)) {
    throw new Error('The server did not return a valid PDF. Restart the server and try again.');
  }

  pdfBlob = new Blob([bytes], { type: 'application/pdf' });
  blobUrl = URL.createObjectURL(pdfBlob);
  return blobUrl;
}

/**
 * Show PDF in an iframe preview element.
 * Uses the same-origin API URL in the iframe (not a blob URL) so the preview
 * works with the app's Content-Security-Policy.
 * @param {HTMLIFrameElement} iframe
 * @param {string} pdfUrl
 * @param {string} filename
 */
export async function showInvitationPreview(iframe, pdfUrl, filename) {
  await loadInvitationPdf(pdfUrl, filename);
  iframe.src = pdfApiUrl || pdfUrl;
  iframe.hidden = false;
  return pdfApiUrl || pdfUrl;
}

/** Open the browser print dialog for the generated PDF. */
export function printInvitationPdf() {
  const url = pdfApiUrl || blobUrl;
  if (!url) throw new Error('Invitation PDF is not loaded yet.');

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = 'none';
  frame.src = url;
  document.body.appendChild(frame);

  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      setTimeout(() => frame.remove(), 1000);
    }
  };
}

/** Trigger download of the personalised invitation PDF. */
export function downloadInvitationPdf() {
  if (!pdfBlob || !blobUrl) throw new Error('Invitation PDF is not loaded yet.');

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = pdfFilename || 'Wedding Invitation.pdf';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function getInvitationBlobUrl() {
  return blobUrl;
}

export function clearInvitationPdf() {
  revokeBlobUrl();
  pdfBlob = null;
  pdfFilename = null;
  pdfApiUrl = null;
}
