/**
 * Invitation PDF Generator
 *
 * Loads the master template PDF (unchanged artwork) and draws personalised
 * guest data + the existing signed QR ticket on top.
 *
 * Reusable from registration, admin reprints, email, and WhatsApp flows.
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const layout = require('../config/invitationLayout');

const FONT_MAP = {
  Helvetica: StandardFonts.Helvetica,
  HelveticaBold: StandardFonts.HelveticaBold,
  TimesRoman: StandardFonts.TimesRoman,
  TimesRomanBold: StandardFonts.TimesRomanBold,
};

/** @type {Buffer|null} */
let cachedTemplate = null;

/**
 * Resolve absolute path to the template PDF.
 * @returns {string}
 */
function templatePath() {
  if (process.env.INVITATION_TEMPLATE_PATH) {
    return path.resolve(process.env.INVITATION_TEMPLATE_PATH);
  }
  return path.join(__dirname, '..', '..', layout.templateFile);
}

/**
 * Load template bytes (cached in memory after first read).
 * @returns {Promise<Buffer>}
 */
async function loadTemplateBytes() {
  if (cachedTemplate) return cachedTemplate;
  const file = templatePath();
  if (!fs.existsSync(file)) {
    throw new Error(`Invitation template not found at ${file}`);
  }
  cachedTemplate = fs.readFileSync(file);
  return cachedTemplate;
}

/**
 * Build display name for the guest writing area.
 * @param {object} data
 * @returns {string}
 */
function formatGuestName(data) {
  return formatAreaText(data.guestName);
}

/**
 * Build display name for the plus-one writing area.
 * @param {object} data
 * @returns {string}
 */
function formatPlusOneName(data) {
  if (!data.hasPlusOne) return '';
  return formatAreaText(data.plusOneName);
}

/**
 * Normalise a single name for drawing inside a writing area.
 * @param {string|null|undefined} value
 * @returns {string}
 */
function formatAreaText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return layout.typography?.uppercase === false ? text : text.toUpperCase();
}

/**
 * Decode a PNG data URL to a Buffer.
 * @param {string} dataUrl
 * @returns {Buffer}
 */
function pngBufferFromDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('QR data URL must be a PNG base64 string.');
  return Buffer.from(match[1], 'base64');
}

/**
 * @param {string} fontKey
 * @returns {string}
 */
function resolveFont(fontKey) {
  return FONT_MAP[fontKey] || StandardFonts.TimesRoman;
}

/**
 * Resolve the first embeddable font from typography preferences.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {Record<string, import('pdf-lib').PDFFont>} cache
 * @returns {Promise<import('pdf-lib').PDFFont>}
 */
async function getTypographyFont(pdfDoc, cache) {
  const prefs = [
    layout.typography?.font,
    ...(layout.typography?.fontFallbacks || []),
    'TimesRoman',
  ].filter(Boolean);

  for (const key of prefs) {
    if (!cache[key]) {
      cache[key] = await pdfDoc.embedFont(resolveFont(key));
    }
    return cache[key];
  }

  if (!cache.TimesRoman) {
    cache.TimesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  }
  return cache.TimesRoman;
}

/**
 * Choose the largest font size that fits on one line inside a writing area.
 * @param {string} text
 * @param {import('pdf-lib').PDFFont} font
 * @param {object} area
 * @param {object} typography
 * @returns {number}
 */
function fitFontSize(text, font, area, typography) {
  const maxWidth = area.width - typography.paddingX * 2;
  const maxHeight = area.height - typography.paddingY * 2;
  const maxSize = typography.maxFontSize;
  const minSize = typography.minFontSize;
  const step = typography.sizeStep || 0.5;

  for (let size = maxSize; size >= minSize; size -= step) {
    const textWidth = font.widthOfTextAtSize(text, size);
    const fontHeight = font.heightAtSize(size);
    if (textWidth <= maxWidth && fontHeight <= maxHeight) {
      return size;
    }
  }

  return minSize;
}

/**
 * Compute centred draw coordinates for single-line text inside a rectangle.
 * Uses pdf-lib font measurement only — no hard-coded text positions.
 * @param {string} text
 * @param {import('pdf-lib').PDFFont} font
 * @param {number} fontSize
 * @param {object} area
 * @returns {{ x: number, y: number, textWidth: number, fontHeight: number }}
 */
function centeredTextPosition(text, font, fontSize, area) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const fontHeight = font.heightAtSize(fontSize);
  const centerX = area.x + area.width / 2;
  const centerY = area.y + area.height / 2;
  const x = centerX - textWidth / 2;
  // pdf-lib drawText uses a baseline; offset from box centre using measured height.
  const y = centerY - fontHeight / 2;
  return { x, y, textWidth, fontHeight };
}

/**
 * Draw text centred inside a configured writing area with automatic font scaling.
 * @param {import('pdf-lib').PDFPage} page
 * @param {string} text
 * @param {object} area
 * @param {import('pdf-lib').PDFFont} font
 * @param {object} typography
 */
function drawTextInArea(page, text, area, font, typography) {
  if (!text) return;

  const fontSize = fitFontSize(text, font, area, typography);
  const { x, y } = centeredTextPosition(text, font, fontSize, area);
  const color = typography.color || { r: 0.11, g: 0.11, b: 0.11 };

  page.drawText(text, {
    x,
    y,
    size: fontSize,
    font,
    color: rgb(color.r, color.g, color.b),
  });
}

/**
 * Draw optional text centred under the QR block.
 */
function drawAuxText(page, text, cfg, font, qrArea) {
  if (!text || cfg.enabled === false) return;

  const size = cfg.fontSize;
  const textWidth = font.widthOfTextAtSize(text, size);
  let x = cfg.x;
  if (cfg.centerUnderQr && qrArea) {
    x = qrArea.x + qrArea.width / 2 - textWidth / 2;
  }

  const c = cfg.color || { r: 0, g: 0, b: 0 };
  page.drawText(text, {
    x,
    y: cfg.y,
    size,
    font,
    color: rgb(c.r, c.g, c.b),
  });
}

/**
 * Generate a personalised invitation PDF.
 *
 * @param {object} data
 * @param {number} data.registrationId
 * @param {string} data.invitationCode
 * @param {string} data.guestName
 * @param {boolean} [data.hasPlusOne]
 * @param {string|null} [data.plusOneName]
 * @param {string} data.qr - PNG data URL from existing QR module
 * @returns {Promise<Buffer>} PDF bytes
 */
async function generateInvitationPdf(data) {
  const templateBytes = await loadTemplateBytes();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const pages = pdfDoc.getPages();
  const fonts = {};
  const typography = layout.typography || {};
  const guestArea = layout.guestArea;
  const plusOneArea = layout.plusOneArea;
  const qrArea = layout.qr;

  if (!guestArea) throw new Error('guestArea is not configured.');

  const guestPage = pages[guestArea.page - 1];
  if (!guestPage) throw new Error(`Template has no page ${guestArea.page}.`);

  const nameFont = await getTypographyFont(pdfDoc, fonts);

  // 1. Guest name in writing area 1
  drawTextInArea(guestPage, formatGuestName(data), guestArea, nameFont, typography);

  // 2. Plus-one in writing area 2 when present; otherwise leave blank
  if (plusOneArea) {
    const plusPage = pages[plusOneArea.page - 1];
    if (plusPage) {
      drawTextInArea(plusPage, formatPlusOneName(data), plusOneArea, nameFont, typography);
    }
  }

  // 3. QR code — bottom-left corner
  if (data.qr && qrArea) {
    const qrPage = pages[qrArea.page - 1];
    if (qrPage) {
      const pngBytes = pngBufferFromDataUrl(data.qr);
      const qrImage = await pdfDoc.embedPng(pngBytes);
      qrPage.drawImage(qrImage, {
        x: qrArea.x,
        y: qrArea.y,
        width: qrArea.width,
        height: qrArea.height,
      });
    }
  }

  // 4. Optional tiny invitation code beneath QR
  if (data.invitationCode && layout.invitationCode) {
    const codeCfg = layout.invitationCode;
    const codePage = pages[codeCfg.page - 1];
    if (codePage) {
      drawAuxText(
        codePage,
        String(data.invitationCode),
        codeCfg,
        await getTypographyFont(pdfDoc, fonts),
        qrArea
      );
    }
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Suggested download filename.
 * @param {string} guestName
 * @returns {string}
 */
function invitationFilename(guestName) {
  const safe = String(guestName || 'Guest')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return `Wedding Invitation - ${safe || 'Guest'}.pdf`;
}

/** Clear cached template (e.g. after template file swap in dev). */
function clearTemplateCache() {
  cachedTemplate = null;
}

module.exports = {
  generateInvitationPdf,
  invitationFilename,
  formatGuestName,
  formatPlusOneName,
  templatePath,
  clearTemplateCache,
  fitFontSize,
  centeredTextPosition,
};
