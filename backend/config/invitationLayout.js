/**
 * Invitation PDF layout — all drawing regions and typography settings.
 *
 * PDF coordinate system (pdf-lib): origin bottom-left, units in points (1/72 inch).
 * Page size of invitation-template.pdf: 420 × 595.56 pt (portrait, 2 pages).
 *
 * guestArea / plusOneArea were calibrated against templates/SAMPLE.pdf page 2
 * (blank dotted-line writing areas below "Dr./Ms./Mr. & Mrs.").
 * Adjust values here when swapping templates; the renderer reads only this file.
 *
 * page: 1-based page number in the template PDF
 */
module.exports = {
  /** Path relative to project root; override with INVITATION_TEMPLATE_PATH env var */
  templateFile: 'templates/invitation-template.pdf',

  /** Writing area 1 — guest full name (centred inside this rectangle) */
  guestArea: {
    page: 2,
    x: 78,
    y: 158,
    width: 264,
    height: 22,
  },

  /** Writing area 2 — plus-one name when applicable; left blank otherwise */
  plusOneArea: {
    page: 2,
    x: 78,
    y: 136,
    width: 264,
    height: 22,
  },

  typography: {
    font: 'TimesRoman',
    fontFallbacks: ['TimesRoman', 'Helvetica'],
    color: { r: 0.11, g: 0.11, b: 0.11 },
    maxFontSize: 14,
    minFontSize: 7,
    sizeStep: 0.5,
    paddingX: 8,
    paddingY: 2,
    uppercase: true,
  },

  /** QR code — bottom-left corner of page 2 */
  qr: {
    page: 2,
    x: 34,
    y: 52,
    width: 76,
    height: 76,
  },

  /**
   * Optional tiny invitation code beneath the QR for operational reference.
   * Set enabled: false to omit entirely (the QR already encodes verification data).
   */
  invitationCode: {
    enabled: true,
    page: 2,
    centerUnderQr: true,
    y: 38,
    fontSize: 6,
    font: 'TimesRoman',
    color: { r: 0.38, g: 0.34, b: 0.3 },
  },

  /** Registration numbers are stored in the database only — never shown on the invitation */
  registrationNumber: {
    enabled: false,
  },
};
