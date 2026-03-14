/**
 * shocappExtractor.js - Playwright-based extractor for the SHOCAPP (Lista Vaschette) page.
 *
 * Logs in, navigates to SHOCAPP, runs two filter presets via direct AJAX
 * calls to tbl_shocapp.php (matching the browser's manual workflow), and
 * exports separate CSV/JSON per preset.
 *
 * Filter presets:
 *   1. Tutto il periodo + Mantenimento
 *   2. Ultimi 7 giorni  + Esaurito
 *
 * Also generates a "Da Ordinare" CSV combining both presets.
 *
 * Usage:
 *   node src/shocappExtractor.js
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import https from 'https';
import JSZip from 'jszip';
import nodemailer from 'nodemailer';
import { exportJSON, exportCSV, exportXLSX } from './exportData.js';
import { createLogger } from './logger.js';

const log = createLogger('shocapp');

const LOGIN_URL =
  'https://www.gelateriafatamorgana.com/fata/tracking-manager/html/login.php';

const HEADERS = ['Negozio', 'Gusto', 'Icona', 'Stato', 'N. Vasche', 'Peso Kg'];

/** The two filter presets to run. */
const FILTER_PRESETS = [
  {
    name: 'mantenimento_tutto',
    label: 'Tutto il periodo + Mantenimento',
    selData: '6',       // Tutto il periodo
    selStatus: '1',     // Mantenimento
  },
  {
    name: 'esaurito_7giorni',
    label: 'Ultimi 7 giorni + Esaurito',
    selData: '2',       // Ultimi 7 giorni
    selStatus: '3',     // Esaurito
  },
];

// -- Helpers ----------------------------------------------------------------

/**
 * Make a direct AJAX call to tbl_shocapp.php with the given filter params.
 * Returns the raw HTML response (table head + body).
 */
async function fetchShocappTable(bPage, preset, pageNum = 1) {
  const ajaxUser = process.env.GELATERIA_USER ?? '';
  return bPage.evaluate(({ p, pg, u }) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const params = new URLSearchParams({
      l: '1', sel_frigo: '', page_param: 'shocapp',
      h_causale: '', h_negozi: '',
      Selperiodo: '1', SelData: p.selData, SelStatus: p.selStatus,
      SelTabella: '1', SelFamiglia: '', cercaStringa: '', q: '',
      searchrow: '', searchcol: '', datatable1_length: '100',
      date1: dateStr, date2: dateStr,
      shop: '', sStatus: p.selStatus, sCausale: '',
      m: '100', p: String(pg), o_by: '', o_mode: 'asc',
      lng: '1', lid: '31', usr: u,
    });

    return new Promise((resolve, reject) => {
      $.ajax({
        type: 'POST',
        url: '../lib/tbl_shocapp.php?' + params.toString(),
        success: (response) => resolve(response),
        error: (xhr, status, err) => reject(new Error(status + ': ' + err)),
      });
    });
  }, { p: preset, pg: pageNum, u: ajaxUser });
}

/**
 * Parse the HTML response from tbl_shocapp.php into rows.
 * Skips summary rows (Peso complessivo) and pagination rows.
 */
function parseTableHTML(html) {
  const $ = cheerio.load('<table>' + html + '</table>');
  const rows = [];
  let pagination = null;

  $('tbody tr').each((_, tr) => {
    const cells = [];
    $(tr).find('td').each((__, td) => cells.push($(td).text().trim()));

    if (cells.length < 4) return;
    if (cells[0].startsWith('Peso complessivo')) return;

    // Check for pagination row: "Pag. 1 di 3 tot. record: 250"
    const pagMatch = cells[0].match(/Pag\.\s*(\d+)\s*di\s*(\d+)\s*tot\.\s*record:\s*(\d+)/);
    if (pagMatch) {
      pagination = {
        currentPage: +pagMatch[1],
        totalPages: +pagMatch[2],
        totalRecords: +pagMatch[3],
      };
      return;
    }

    rows.push(cells);
  });

  return { rows, pagination };
}

/**
 * Fetch all pages for a given preset and return all data rows.
 */
async function fetchAllPages(bPage, preset) {
  const allRows = [];

  // Fetch page 1
  const html1 = await fetchShocappTable(bPage, preset, 1);
  const { rows: rows1, pagination } = parseTableHTML(html1);
  allRows.push(...rows1);

  const totalPages = pagination?.totalPages ?? 1;
  log.info('  Page 1: %d rows, %d page(s) total, %d records',
    rows1.length, totalPages, pagination?.totalRecords ?? rows1.length);

  // Fetch remaining pages
  for (let pg = 2; pg <= totalPages; pg++) {
    const html = await fetchShocappTable(bPage, preset, pg);
    const { rows } = parseTableHTML(html);
    allRows.push(...rows);
    log.info('  Page %d: %d rows', pg, rows.length);
  }

  return allRows;
}

// -- Template name mapping --------------------------------------------------

/**
 * Map from abbreviated template name -> full Da Ordinare gusto name.
 * Handles prefixed abbreviations (C.=CIOCCOLATO, M.=MANDORLA, Z.=ZABAIONE, etc.)
 * and other short names used in the inventory template.
 */
const TEMPLATE_TO_DATA = {
  // Column A (Flavor 1)
  'ARACHIDI':             'ARACHIDI COCCO E CIOCCOLATO',
  'BACIO DEL PRINCIPE':   'BACIO DEL PRINCIPE',
  'BASILICO NOCI E MELE': 'BASILICO NOCI E MIELE',
  'BIANCANEVE':           'BIANCANEVE',
  'CAFFÈ':                "CAFFE'",
  'COCCO CREMA':          'COCCO CREMA',
  'C. BANANA':            'CREMA BANANA CON CROCCANTINO CIOCCOLATO & SESAMO',
  'FIORDILATTE':          'FIORDILATTE',
  'MENTA CIOCC.':         'LATTE MENTA E CIOCCOLATO',
  'M. BIANCA':            'MANDORLA BIANCA',
  'M. ARANCIA':           'MANDORLA E ARANCIA',
  'M. CARDAMOMO':         'MANDORLA AL CARDAMOMO',
  'NOCCIOLA':             'NOCCIOLA',
  'PERE BH':              'PERE BELLE HELENE',
  'POLLICINA':            'POLLICINA',
  'BRONTE':               'PISTACCHIO DI BRONTE',
  'RICOTTA AGRUMI':       'RICOTTA E AGRUMI',
  'RISO E VANIGLIA':      'RISO E VANIGLIA',
  'STRACCIATELLA':        'STRACCIATELLA',
  'SEADAS':               'SEADAS',
  'YOGURT':               'YOGURT',
  'THE VERDE':            'TE VERDE MATCHA',
  'STRIA':                'PISTACCHIO SIRIANO',

  // Column C (Flavor 2)
  'CREMA':                'CREMA  PASTICCIERA PARISI',
  'C. VANIGLIA':          'CREMA VANIGLIA',
  'C. FRAGOLE':           'CREMA FRAGOLE E MANDORLE',
  'C. ZENZERO':           'CREMA ZENZERO MIELE DI CASTAGNO E LIMONE',
  'C. CANNELLA':          'CREMA CANNELLA',
  'C. AGNESE':            'CREMA AGNESE',
  'C. LEMON CURD':        'LEMON CURD',
  'CHEESE MIRT':          'CHEESECAKE MIRTILLI',
  'TIRAMISU':             "TIRAMISU'",
  'SACRIPANTE':           'SACRIPANTE',
  'ZABAIONE':             'ZABAIONE GELATO',
  'Z. MOSCATO':           "ZABAIONE AL SAKE'",
  'SACHER':               'SACHER TORTE',
  'LA-LA-':               "RICOTTA ROMANA, CACAO CRUDO & PERA (LA-LA-LAND)",
  'STRACCHINO':           'STRACCHINO, ALBICOCCHE AL ROSMARINO & BRICIOLE DI CROSTATA',
  'LAVANDA':              'FIORI DI LAVANDA E FRAGOLINE DI NEMI',
  'MONTBLANC':            'MONT BLANC',
  'PISTACCHI':            'PISTACCHIO SIRIANO',
  'PANETTONE':            'MOU LATTE SALATO',
  'SEMIFREDDO TIRAMISU':  'SEMIFREDDO  TIRAMISU',

  // Column E (Flavor 3)
  'CIOCCOLATO':           'CIOCCOLATO',
  'C. LATTE':             'CIOCCOLATO AL LATTE gelato',
  'C. KENTUCKY':          'CIOCCOLATO KENTUCKY',
  'C. MADAGASCAR':        'CIOCCOLATO MADAGASCAR',
  'C. VENEZUELA':         'CIOCCOLATO VENEZUELA',
  'C. PIMENTO':           'CIOCCOLATO AL PIMENTO',
  'C. LAPSANG':           'CIOCCOLATO LAPSANG SOUCHOUNG',
  'C. WASABY':            'CIOCCOLATO WASABI',
  'C. ARANCIA':           'CIOCCOLATO E ARANCIA',
  'C. ESTASY':            'CIOCCOLATO CRUDO DEL PERU\'',
  'P. VEGAN':             'EVERGREEN  BRONTE VEGAN',
  'C. CALDA':             'CIOCCOLATA CALDA FONDENTE',

  // Column G (Flavor 4)
  'ALBICOCCA':            'ALBICOCCA',
  'AMARENA':              'AMARENA',
  'ANANAS E ZENZ.':       'ANANAS E ZENZERO',
  'ANGURIA':              'ANGURIA',
  'AVOCADO E LIME':       'AVOCADO LIME E VINO BIANCO',
  'BANANA E LIME':        'BANANA E LIME',
  'CACHI':                'CACHI',
  'CASTAGNA':             'CASTAGNA AL WHISKY',
  'FRAGOLA':              'FRAGOLA',
  'FRUTTI BOSCO':         'FRUTTI DI BOSCO(LAMPONE,RIBES,MORA,MIRTILLO)',
  'LAMPONE':              'LAMPONI SORBETTO',
  'LIMONE':               'LIMONE',
  'MANGO':                'MANGO SOLE DI SICILIA',
  'MELA N. E C.':         'MELA MANDORLA E CANNELLA',
  'MORA':                 'MORA',
  'PANACEA':              'PANACEA (Latte di mandorla Menta & Ginseng)',
  'PASSION':              'PASSION FRUIT',
  'PENSIERO':             'PENSIERO',
  'PERA':                 'PERA',
  'PERA GORGONZOLA':      'PERA GORGONZOLA',
  'PESCA AL VINO':        'PESCHE AL VINO',
  'CREMA MASCARPONE':     'CREMA MASCARPONE',
  'ZUCCA E SEMI':         'ZUCCA E SEMI',
};

const AMBIGUOUS_TARGETS = (() => {
  const reverse = new Map();
  for (const [alias, target] of Object.entries(TEMPLATE_TO_DATA)) {
    if (!reverse.has(target)) reverse.set(target, []);
    reverse.get(target).push(alias);
  }

  const ambiguous = new Set();
  for (const [target, aliases] of reverse.entries()) {
    if (aliases.length > 1) {
      ambiguous.add(target);
    }
  }
  return ambiguous;
})();

function resolveDataFlavorName(templateName, qtyMap) {
  if (!templateName) return null;

  const clean = String(templateName).trim();
  const normalize = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  const cleanNorm = normalize(clean);

  const qtyNormalized = new Map();
  for (const key of qtyMap.keys()) {
    qtyNormalized.set(normalize(key), key);
  }

  // 1) Strict exact match first (safest)
  if (qtyMap.has(clean)) {
    return clean;
  }

  // 1b) Normalized exact match fallback
  if (qtyNormalized.has(cleanNorm)) {
    return qtyNormalized.get(cleanNorm);
  }

  // 2) Fallback alias map only when unambiguous
  const mapped = TEMPLATE_TO_DATA[clean];
  if (!mapped) return null;

  if (AMBIGUOUS_TARGETS.has(mapped)) {
    return null;
  }

  if (qtyMap.has(mapped)) {
    return mapped;
  }

  const mappedNorm = normalize(mapped);
  if (qtyNormalized.has(mappedNorm)) {
    return qtyNormalized.get(mappedNorm);
  }

  return mapped;
}

function pickTemplateFilePath() {
  const candidates = [
    'gelato_flavors_ONLY_ORDINE.xlsx',
    'gelato_flavors.xlsx',
    'Flavor_Inventory_Template.xlsx',
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }

  throw new Error('No supported template file found. Expected one of: ' + candidates.join(', '));
}

function detectFlavorOrderColumns(headerRow) {
  const normalize = (value) => String(value ?? '').trim().toUpperCase();
  const metricHeaders = new Set(['ESAURITO', 'MANTENIMENTO', 'ORDINE']);

  const categoryStarts = [];
  for (let c = 0; c < headerRow.length; c++) {
    const h = normalize(headerRow[c]);
    if (!h) continue;
    if (!metricHeaders.has(h)) {
      categoryStarts.push(c);
    }
  }

  const pairs = [];
  for (let i = 0; i < categoryStarts.length; i++) {
    const flavorCol = categoryStarts[i];
    const nextStart = i + 1 < categoryStarts.length ? categoryStarts[i + 1] : headerRow.length;

    let ordineCol = null;
    for (let c = flavorCol + 1; c < nextStart; c++) {
      if (normalize(headerRow[c]) === 'ORDINE') {
        ordineCol = c;
        break;
      }
    }

    if (ordineCol !== null) {
      pairs.push({ flavorCol, ordineCol });
    }
  }

  return pairs;
}

/**
 * Read the Excel template, fill in Qty columns from Da Ordinare data, save.
 */
function fillExcelTemplate(daOrdinareRows) {
  const templatePath = pickTemplateFilePath();
  const wb = XLSX.readFile(templatePath);
  const firstSheet = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheet];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Build gusto -> order qty map from daOrdinareRows [gusto, stato, qty]
  const qtyMap = new Map();
  for (const row of daOrdinareRows) {
    qtyMap.set(row[0], parseInt(row[2], 10) || 0);
  }

  const headerRow = data[0] ?? [];
  const columnPairs = detectFlavorOrderColumns(headerRow);

  if (columnPairs.length === 0) {
    throw new Error(`Template format not supported in ${templatePath}: could not detect flavor/ORDINE columns`);
  }

  let filled = 0;

  for (let r = 1; r < data.length; r++) {
    for (const pair of columnPairs) {
      const templateName = data[r]?.[pair.flavorCol];
      if (!templateName) continue;

      const dataName = resolveDataFlavorName(templateName, qtyMap);
      if (!dataName) continue;

      const qty = qtyMap.get(dataName) ?? 0;
      const cellRef = XLSX.utils.encode_cell({ r: r, c: pair.ordineCol });
      ws[cellRef] = { t: 'n', v: qty };
      if (qty > 0) filled++;
    }
  }

  const outPath = 'output/shocapp_template_filled.xlsx';
  XLSX.writeFile(wb, outPath);
  log.info('Excel template filled from %s (%s): %d items with qty > 0 -> %s', templatePath, firstSheet, filled, outPath);

  return ws;
}

/**
 * Create a clean xlsx with each dataset as a separate sheet.
 */
function exportCleanXlsx(filledTemplateSheet, presetRows, daOrdinareHeaders, daOrdinareRows) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Ordini Settimanali (filled template)
  if (filledTemplateSheet) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    XLSX.utils.book_append_sheet(wb, filledTemplateSheet, `Ordini Settimanali ${dd}-${mm}-${yyyy}`);
  }

  // Sheet 2: Mantenimento
  const mData = [HEADERS, ...(presetRows['mantenimento_tutto'] ?? [])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mData), 'Mantenimento');

  // Sheet 3: Esaurito
  const eData = [HEADERS, ...(presetRows['esaurito_7giorni'] ?? [])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(eData), 'Esaurito');

  // Sheet 4: Da Ordinare
  const dData = [daOrdinareHeaders, ...daOrdinareRows];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dData), 'Da Ordinare');

  const outPath = 'output/shocapp_report.xlsx';
  XLSX.writeFile(wb, outPath);
  log.info('Clean xlsx: %d sheets -> %s', wb.SheetNames.length, outPath);
}

async function createAllFormatsZip(filePaths) {
  const zip = new JSZip();

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    zip.file(path.basename(filePath), await fs.promises.readFile(filePath));
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const outPath = 'output/shocapp_all_formats.zip';
  await fs.promises.writeFile(outPath, zipBuffer);
  log.info('ZIP bundle created -> %s', outPath);
  return outPath;
}

async function deleteFiles(filePaths) {
  for (const filePath of filePaths) {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
}

// -- Telegram ---------------------------------------------------------------

/**
 * Send one file to a Telegram chat via the Bot API.
 * Returns a promise that resolves when the upload completes.
 */
function sendTelegramFile(botToken, chatId, filePath) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Date.now().toString(16);

    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="chat_id"`,
      '', chatId,
      `--${boundary}`,
      `Content-Disposition: form-data; name="document"; filename="${fileName}"`,
      'Content-Type: application/octet-stream',
      '', '',
    ].join('\r\n');

    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(header), fileData, Buffer.from(footer),
    ]);

    const req = https.request({
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendDocument`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.ok) resolve(json);
        else reject(new Error(`Telegram API error: ${json.description}`));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send the two Excel output files to Telegram.
 */
async function sendToTelegram() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (!botToken) {
    log.warn('TELEGRAM_BOT_TOKEN not set — skipping Telegram send.');
    return;
  }

  const files = [
    'output/shocapp_template_filled.xlsx',
    'output/shocapp_report.xlsx',
  ];

  for (const chatId of chatIds) {
    for (const f of files) {
      if (!fs.existsSync(f)) {
        log.warn('File not found, skipping Telegram send: %s', f);
        continue;
      }
      await sendTelegramFile(botToken, chatId, f);
      log.info('Sent to Telegram (chat %s): %s', chatId, f);
    }
  }
}

function shouldAutoSend(envName) {
  return process.env[envName] !== 'false';
}

// -- Email ------------------------------------------------------------------

/**
 * Send the two Excel output files via email.
 */
async function sendEmail() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const recipients = (process.env.EMAIL_TO || '').split(',').map(e => e.trim()).filter(Boolean);

  if (!user || !pass) {
    log.warn('EMAIL_USER / EMAIL_PASS not set — skipping email send.');
    return;
  }
  if (recipients.length === 0) {
    log.warn('EMAIL_TO not set — skipping email send.');
    return;
  }

  const files = [
    'output/shocapp_template_filled.xlsx',
    'output/shocapp_report.xlsx',
  ];
  const attachments = files
    .filter(f => fs.existsSync(f))
    .map(f => ({ filename: path.basename(f), path: f }));

  if (attachments.length === 0) {
    log.warn('No Excel files found — skipping email send.');
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: user,
    to: recipients.join(', '),
    subject: `Gelateria Fatamorgana SHOCAPP Report — ${dateStr}`,
    text: 'Report settimanale della Gelateria Fatamorgana: situazione esauriti, mantenimento scorte e lista ordini.',
    attachments,
  });

  log.info('Email sent to: %s', recipients.join(', '));
}

// -- Main -------------------------------------------------------------------

export async function extractShocapp() {
  const user = process.env.GELATERIA_USER;
  const pass = process.env.GELATERIA_PASS;

  if (!user || !pass) {
    log.error('GELATERIA_USER and GELATERIA_PASS must be set in .env');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const bPage = await context.newPage();

  try {
    // -- Login --------------------------------------------------------------
    log.info('Logging in...');
    await bPage.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await bPage.fill('input[name="username"]', user);
    await bPage.fill('input[name="password"]', pass);
    await bPage.click('button[type="submit"]');
    await bPage.waitForURL('**/index.php**', { timeout: 15000 });
    log.info('Login successful');

    // -- Navigate to SHOCAPP (establish session) ----------------------------
    log.info('Navigating to SHOCAPP...');
    await bPage.evaluate(() => page_reload('shocapp'));
    await bPage.waitForTimeout(4000);

    // -- Run each filter preset via direct AJAX -----------------------------
    const presetRows = {};

    for (const preset of FILTER_PRESETS) {
      log.info('\n========================================');
      log.info('Filter preset: %s', preset.label);
      log.info('========================================');

      const rows = await fetchAllPages(bPage, preset);
      presetRows[preset.name] = rows;

      if (rows.length === 0) {
        log.warn('No data for preset "%s" -- skipping export.', preset.label);
        continue;
      }

      const outputPath = `output/shocapp_${preset.name}`;
      await exportJSON(outputPath, HEADERS, rows);
      await exportCSV(outputPath, HEADERS, rows);
      await exportXLSX(outputPath, HEADERS, rows, preset.label);

      log.info('Preset "%s": %d rows -> %s.csv / %s.json / %s.xlsx',
        preset.label, rows.length, outputPath, outputPath, outputPath);
    }

    // -- Build "Da Ordinare" CSV --------------------------------------------
    // A = last week sales (Esaurito 7 giorni)
    // B = current usable stock (Mantenimento)
    // C = incoming stock (not available, 0)
    // D = safety stock = ceil(A * 0.15)
    // Order = MAX(0, A + D - B - C)
    const COL_GUSTO = 1;
    const COL_VASCHE = 4;
    const mRows = presetRows['mantenimento_tutto'] ?? [];
    const eRows = presetRows['esaurito_7giorni'] ?? [];

    // Sum N. Vasche per Gusto in each dataset
    const sumByGusto = (rows) => {
      const map = new Map();
      for (const r of rows) {
        const gusto = r[COL_GUSTO];
        const n = parseInt(r[COL_VASCHE], 10) || 0;
        map.set(gusto, (map.get(gusto) || 0) + n);
      }
      return map;
    };

    const mMap = sumByGusto(mRows);  // B per gusto
    const eMap = sumByGusto(eRows);  // A per gusto

    const allGusti = new Set([...mMap.keys(), ...eMap.keys()]);
    const daOrdinareHeaders = ['Gusto', 'Stato', 'N. Vasche'];
    const daOrdinareRows = [];

    for (const gusto of allGusti) {
      const A = eMap.get(gusto) || 0;  // last week sales
      const B = mMap.get(gusto) || 0;  // current usable stock
      const C = 0;                      // incoming stock
      const D = Math.ceil(A * 0.15);    // safety stock (15% buffer)

      const order = Math.max(0, A + D - B - C);
      daOrdinareRows.push([gusto, 'Da Ordinare', String(order)]);
    }

    const daOrdPath = 'output/shocapp_da_ordinare';
    await exportJSON(daOrdPath, daOrdinareHeaders, daOrdinareRows);
    await exportCSV(daOrdPath, daOrdinareHeaders, daOrdinareRows);
    await exportXLSX(daOrdPath, daOrdinareHeaders, daOrdinareRows, 'Da Ordinare');
    log.info('"Da Ordinare": %d gusti -> %s.csv / %s.json / %s.xlsx',
      daOrdinareRows.length, daOrdPath, daOrdPath, daOrdPath);

    // -- Fill Excel template ------------------------------------------------
    const filledSheet = fillExcelTemplate(daOrdinareRows);

    // -- Clean multi-sheet xlsx ---------------------------------------------
    exportCleanXlsx(filledSheet, presetRows, daOrdinareHeaders, daOrdinareRows);

    // -- Bundle all formats into a ZIP and keep final output xlsx-only ------
    const temporaryFiles = [
      'output/shocapp_mantenimento_tutto.csv',
      'output/shocapp_mantenimento_tutto.json',
      'output/shocapp_esaurito_7giorni.csv',
      'output/shocapp_esaurito_7giorni.json',
      'output/shocapp_da_ordinare.csv',
      'output/shocapp_da_ordinare.json',
    ];
    const bundleFiles = [
      ...temporaryFiles,
      'output/shocapp_mantenimento_tutto.xlsx',
      'output/shocapp_esaurito_7giorni.xlsx',
      'output/shocapp_da_ordinare.xlsx',
      'output/shocapp_template_filled.xlsx',
      'output/shocapp_report.xlsx',
    ];
    await createAllFormatsZip(bundleFiles);
    await deleteFiles(temporaryFiles);

    // -- Send to Telegram ---------------------------------------------------
    if (shouldAutoSend('AUTO_SEND_TELEGRAM')) {
      await sendToTelegram();
    } else {
      log.info('AUTO_SEND_TELEGRAM=false -> skipping Telegram auto-send');
    }

    // -- Send email ---------------------------------------------------------
    if (shouldAutoSend('AUTO_SEND_EMAIL')) {
      await sendEmail();
    } else {
      log.info('AUTO_SEND_EMAIL=false -> skipping email auto-send');
    }

    log.info('\nAll done.');
  } finally {
    await browser.close();
    log.info('Browser closed.');
  }
}

// -- CLI --------------------------------------------------------------------
extractShocapp().catch((err) => {
  log.error('Fatal: %s', err.message);
  process.exit(1);
});
