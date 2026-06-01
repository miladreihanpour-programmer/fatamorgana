/**
 * generatePdf.js
 * Single-page A3 landscape order sheet.
 * - Full grid lines around every cell
 * - Bold fonts everywhere
 * - Auto-fit: every flavor name is measured and the font is reduced
 *   automatically until it fits on a single line
 * - Renames a couple of names that are too long to abbreviate
 */

import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.join(__dirname, '..');
const OUTPUT_DIR   = path.join(ROOT, 'output');
const TEMPLATE_PATH = path.join(ROOT, 'gelato_flavors.xlsx');

// ── Palette ───────────────────────────────────────────────────────────────────
const NAVY      = '#1a1a2e';
const CAT_BG    = '#dce8f0';
const CAT_ORD   = '#c8dde8';
const ROW_ALT   = '#f7fafc';
const WRITE_BOX = '#fffde7';
const GRID      = '#b0c8d8';
const TEXT_DARK = '#1a1a2e';
const TEXT_RED  = '#c0392b';
const TOTAL_BG  = '#fef3cd';
const TOTAL_BOX = '#ffe082';

// ── Display rules ─────────────────────────────────────────────────────────────
const RENAME = {
  'C. LAPSANG SOUCHOUNG':  'C. LAPSANG',
  'V. GIANDUIA VARIEGATA': 'VEGAN GIANDUIA',
};
function displayName(flavor) {
  return RENAME[flavor.toUpperCase()] ?? flavor;
}

// ── Load flavors + ORDINE quantities from a workbook path ────────────────────
// If filledPath is provided (the filled template), quantities come from the
// ORDINE column already written there. Falls back to TEMPLATE_PATH if not.
function loadFlavors(filledPath) {
  const wb   = XLSX.readFile(filledPath ?? TEMPLATE_PATH);
  const ws   = wb.Sheets['Flavors'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  return ['Gelato', 'Creme', 'Cioccolati', 'Sorbetti'].map((name, ci) => ({
    name,
    items: rows.slice(1)
      .filter(r => {
        const v = r[ci * 2];
        return v && !['ORDINE', 'TOTAL:', 'Varie'].includes(String(v).trim());
      })
      .map(r => ({
        flavor: String(r[ci * 2]).trim(),
        qty:    r[ci * 2 + 1] > 0 ? Number(r[ci * 2 + 1]) : null,
      })),
  }));
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function fillRect(doc, x, y, w, h, fill) {
  doc.rect(x, y, w, h).fillColor(fill).fill();
}
function strokeRect(doc, x, y, w, h, color = GRID, lw = 0.4) {
  doc.rect(x, y, w, h).strokeColor(color).lineWidth(lw).stroke();
}
function hline(doc, x1, y, x2, color, lw = 0.6) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(lw).stroke();
}
function txt(doc, text, x, y, w, size, font, color, align = 'left', padX = 6) {
  doc.fontSize(size).font(font).fillColor(color)
     .text(String(text), x + (align === 'left' ? padX : 0), y,
       { width: w - (align === 'left' ? padX * 2 : 0),
         align, lineBreak: false, ellipsis: true });
}

/**
 * Find the largest font size (≤ maxSize) at which `text` fits in `availableW`.
 * Stops shrinking at minSize.
 */
function fitFontSize(doc, text, availableW, font, maxSize, minSize = 6) {
  doc.font(font);
  let size = maxSize;
  while (size > minSize) {
    doc.fontSize(size);
    if (doc.widthOfString(String(text)) <= availableW) break;
    size -= 0.25;
  }
  return size;
}

// ── Main ──────────────────────────────────────────────────────────────────────
// filledPath: path to shocapp_template_filled.xlsx (quantities already written).
// Falls back to reading from the blank template + orderMap if filledPath is null.
export async function generateOrderPdf(filledPath = null) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const OUT  = path.join(OUTPUT_DIR, 'shocapp_da_ordinare.pdf');
  const cats = loadFlavors(filledPath);

  // ── A3 landscape ──────────────────────────────────────────────────────────
  const PW = 1190.55, PH = 841.89;
  const ML = 28, MR = 28, MT = 22, MB = 22;
  const UW = PW - ML - MR;

  // Slightly wider flavor column so fewer names need shrinking
  const FLAVOR_W = 145;
  const SEC_W    = UW / 4;
  const ORDINE_W = SEC_W - FLAVOR_W;
  const colX     = i => ML + i * SEC_W;

  // Heights
  const maxRows = Math.max(...cats.map(c => c.items.length));
  const TITLE_H = 36;
  const CATH_H  = 22;
  const GT_H    = 28;
  const GAPS    = 14;
  const ROW_H   = (PH - MT - MB - TITLE_H - CATH_H - GT_H - GAPS) / (maxRows + 1);

  const FONT_SZ = Math.min(10,    ROW_H * 0.55);
  const QTY_SZ  = Math.min(11.5,  ROW_H * 0.62);

  const doc = new PDFDocument({ size: [PW, PH], margin: 0 });
  const stream = fs.createWriteStream(OUT);
  doc.pipe(stream);

  // Available width inside flavor cell (after left/right padding of 6pt each)
  const FLAVOR_TEXT_W = FLAVOR_W - 12;

  // ── Title bar ─────────────────────────────────────────────────────────────
  fillRect(doc, ML, MT, UW, TITLE_H, NAVY);
  const today = new Date().toLocaleDateString('it-IT',
    { day: '2-digit', month: '2-digit', year: 'numeric' });
  txt(doc, `FATA MORGANA  —  ORDINE SETTIMANALE  —  ${today}`,
    ML, MT + (TITLE_H - 16) / 2, UW, 16, 'Helvetica-Bold', '#ffffff', 'left', 12);

  // ── Category headers ───────────────────────────────────────────────────────
  const catY = MT + TITLE_H + 4;
  for (let ci = 0; ci < 4; ci++) {
    const x = colX(ci);
    fillRect(doc, x,            catY, FLAVOR_W, CATH_H, CAT_BG);
    fillRect(doc, x + FLAVOR_W, catY, ORDINE_W, CATH_H, CAT_ORD);
    strokeRect(doc, x,            catY, FLAVOR_W, CATH_H);
    strokeRect(doc, x + FLAVOR_W, catY, ORDINE_W, CATH_H);

    txt(doc, cats[ci].name.toUpperCase(),
        x, catY + (CATH_H - FONT_SZ) / 2,
        FLAVOR_W, FONT_SZ, 'Helvetica-Bold', TEXT_DARK, 'left');
    txt(doc, 'ORDINE',
        x + FLAVOR_W, catY + (CATH_H - FONT_SZ * 0.85) / 2,
        ORDINE_W, FONT_SZ * 0.85, 'Helvetica-Bold', TEXT_DARK, 'center');
  }
  hline(doc, ML, catY + CATH_H, ML + UW, NAVY, 0.8);

  // ── Flavor rows (auto-fit font per name) ──────────────────────────────────
  let curY  = catY + CATH_H;
  let grand = 0;

  for (let ri = 0; ri < maxRows; ri++) {
    for (let ci = 0; ci < 4; ci++) {
      const x    = colX(ci);
      const item = cats[ci].items[ri];
      const qty  = item?.qty ?? null;
      if (qty) grand += qty;

      const flavorBg = ri % 2 === 1 ? ROW_ALT : '#ffffff';
      fillRect(doc, x, curY, FLAVOR_W, ROW_H, flavorBg);
      fillRect(doc, x + FLAVOR_W, curY, ORDINE_W, ROW_H, WRITE_BOX);
      strokeRect(doc, x,            curY, FLAVOR_W, ROW_H);
      strokeRect(doc, x + FLAVOR_W, curY, ORDINE_W, ROW_H);

      if (item) {
        const display = displayName(item.flavor);
        const size = fitFontSize(doc, display, FLAVOR_TEXT_W, 'Helvetica-Bold', FONT_SZ, 6.5);

        txt(doc, display,
            x, curY + (ROW_H - size) / 2,
            FLAVOR_W, size, 'Helvetica-Bold', TEXT_DARK, 'left');

        if (qty != null && qty > 0) {
          txt(doc, qty,
              x + FLAVOR_W, curY + (ROW_H - QTY_SZ) / 2,
              ORDINE_W, QTY_SZ, 'Helvetica-Bold', TEXT_RED, 'center', 0);
        }
      }
    }
    curY += ROW_H;
  }

  // ── ONE grand total row ────────────────────────────────────────────────────
  hline(doc, ML, curY, ML + UW, NAVY, 0.8);

  fillRect(doc, ML,            curY, FLAVOR_W,         ROW_H, TOTAL_BG);
  fillRect(doc, ML + FLAVOR_W, curY, UW - FLAVOR_W,    ROW_H, TOTAL_BOX);
  strokeRect(doc, ML,            curY, FLAVOR_W,      ROW_H);
  strokeRect(doc, ML + FLAVOR_W, curY, UW - FLAVOR_W, ROW_H);

  txt(doc, 'TOTALE',
      ML, curY + (ROW_H - FONT_SZ) / 2,
      FLAVOR_W, FONT_SZ, 'Helvetica-Bold', TEXT_DARK, 'left');

  if (grand > 0) {
    txt(doc, grand,
        ML + FLAVOR_W, curY + (ROW_H - QTY_SZ) / 2,
        UW - FLAVOR_W, QTY_SZ, 'Helvetica-Bold', TEXT_RED, 'center', 0);
  }
  curY += ROW_H + 6;

  // ── Grand total banner ─────────────────────────────────────────────────────
  fillRect(doc, ML, curY, UW, GT_H, NAVY);
  txt(doc, `TOTALE VASCHETTE DA ORDINARE: ${grand}`,
      ML, curY + (GT_H - 13) / 2, UW, 13, 'Helvetica-Bold', '#ffffff', 'left', 12);

  doc.end();
  await new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
  return OUT;
}

// Standalone: node src/generatePdf.js [path/to/shocapp_template_filled.xlsx]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = await generateOrderPdf(process.argv[2] ?? null);
  console.log('PDF:', p);
}
