/**
 * Client helpers for personalised invitation PDF preview, print, and download.
 * Fetches the server-generated PDF from /api/registrations/invitation.pdf.
 */

/** @type {Blob|null} */
let pdfBlob = null;

/** @type {string|null} */
let pdfFilename = null;

/** @type {string|null} */
let blobUrl = null;

function revokeBlobUrl() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
}

/**
 * Fetch invitation PDF after successful registration.
 * @param {string} pdfUrl — from registration API response
 * @param {string} filename — suggested download name
 */
export async function loadInvitationPdf(pdfUrl, filename) {
  revokeBlobUrl();
  pdfBlob = null;
  pdfFilename = filename || 'Wedding Invitation.pdf';

  const res = await fetch(pdfUrl, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && !data.error) {
      throw new Error('Invitation PDF endpoint not found. Restart the server and try registering again.');
    }
    throw new Error(data.error || 'Could not load your invitation PDF.');
  }

  pdfBlob = await res.blob();
  if (!pdfBlob.type.includes('pdf') && pdfBlob.size < 1000) {
    throw new Error('The server did not return a valid PDF. Restart the server and try again.');
  }
  blobUrl = URL.createObjectURL(pdfBlob);
  return blobUrl;
}

/**
 * Show PDF in an iframe preview element.
 * @param {HTMLIFrameElement} iframe
 * @param {string} pdfUrl
 * @param {string} filename
 */
export async function showInvitationPreview(iframe, pdfUrl, filename) {
  const url = await loadInvitationPdf(pdfUrl, filename);
  iframe.src = url;
  iframe.hidden = false;
  return url;
}

/** Open the browser print dialog for the generated PDF. */
export function printInvitationPdf() {
  if (!blobUrl) throw new Error('Invitation PDF is not loaded yet.');

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = 'none';
  frame.src = blobUrl;
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
}
