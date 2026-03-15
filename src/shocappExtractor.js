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
import { promisify } from 'util';
import { execFile } from 'child_process';
import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';
import https from 'https';
import JSZip from 'jszip';
import nodemailer from 'nodemailer';
import { exportJSON, exportCSV, exportXLSX } from './exportData.js';
import { createLogger } from './logger.js';

const log = createLogger('shocapp');
const execFileAsync = promisify(execFile);

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
    const formatDate = (value) => `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
    const date1 = p.dateFrom ? formatDate(new Date(p.dateFrom)) : formatDate(now);
    const date2 = p.dateTo ? formatDate(new Date(p.dateTo)) : formatDate(now);

    const params = new URLSearchParams({
      l: '1', sel_frigo: '', page_param: 'shocapp',
      h_causale: '', h_negozi: '',
      Selperiodo: p.selPeriodo || '1', SelData: p.selData, SelStatus: p.selStatus,
      SelTabella: p.selTabella || '1', SelFamiglia: '', cercaStringa: '', q: '',
      searchrow: '', searchcol: '', datatable1_length: '100',
      date1, date2,
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

function sumByGusto(rows) {
  const map = new Map();
  for (const r of rows) {
    const gusto = r[1];
    const n = parseInt(r[4], 10) || 0;
    map.set(gusto, (map.get(gusto) || 0) + n);
  }
  return map;
}

function getHistoricalWeekRange(weeksAgo, now = new Date()) {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const day = base.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(base);
  monday.setDate(base.getDate() - daysSinceMonday - (weeksAgo * 7));
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

async function fetchWeeklySalesHistory(bPage, weeks = 8) {
  const history = [];

  for (let weeksAgo = 0; weeksAgo < weeks; weeksAgo++) {
    const range = getHistoricalWeekRange(weeksAgo);
    const preset = {
      name: `esaurito_week_${weeksAgo + 1}`,
      label: `Esaurito storico settimana ${weeksAgo + 1}`,
      selData: '5',
      selStatus: '3',
      selTabella: '1',
      dateFrom: range.start.toISOString(),
      dateTo: range.end.toISOString(),
    };

    const rows = await fetchAllPages(bPage, preset);
    const salesMap = sumByGusto(rows);
    history.push({
      weekIndex: weeksAgo + 1,
      start: range.start,
      end: range.end,
      rows,
      salesMap,
    });

    log.info('Historical week %d: %s -> %s, %d rows', weeksAgo + 1, range.start.toISOString().slice(0, 10), range.end.toISOString().slice(0, 10), rows.length);
  }

  return history;
}

function parseItalianDateTime(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const match = text.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return null;

  const [, dd, mm, yyyy, hh = '00', min = '00'] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
}

async function fetchWeeklyArrivalHistory(bPage, weeks = 8) {
  const history = [];

  for (let weeksAgo = 0; weeksAgo < weeks; weeksAgo++) {
    const range = getHistoricalWeekRange(weeksAgo);
    const preset = {
      name: `mantenimento_week_${weeksAgo + 1}`,
      label: `Mantenimento storico settimana ${weeksAgo + 1}`,
      selData: '5',
      selStatus: '1',
      selTabella: '0',
      dateFrom: range.start.toISOString(),
      dateTo: range.end.toISOString(),
    };

    const rows = await fetchAllPages(bPage, preset);
    const arrivalsByFlavor = new Map();

    for (const row of rows) {
      const gusto = String(row?.[1] ?? '').trim();
      const updatedAt = parseItalianDateTime(row?.[4]);
      if (!gusto || !updatedAt) continue;

      const arrivalDateKey = updatedAt.toISOString().slice(0, 10);
      if (!arrivalsByFlavor.has(gusto)) {
        arrivalsByFlavor.set(gusto, new Set());
      }
      arrivalsByFlavor.get(gusto).add(arrivalDateKey);
    }

    history.push({
      weekIndex: weeksAgo + 1,
      start: range.start,
      end: range.end,
      rows,
      arrivalsByFlavor,
    });

    log.info('Arrival week %d: %s -> %s, %d rows', weeksAgo + 1, range.start.toISOString().slice(0, 10), range.end.toISOString().slice(0, 10), rows.length);
  }

  return history;
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

function pickTemplateStructurePath() {
  const candidates = [
    'gelato_flavors.xlsx',
    'gelato_flavors_ONLY_ORDINE.xlsx',
    'Flavor_Inventory_Template.xlsx',
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }

  throw new Error('No supported template structure file found. Expected one of: ' + candidates.join(', '));
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

function buildFlavorMetadataMap(actualFlavorNames) {
  const structurePath = pickTemplateStructurePath();
  const wb = XLSX.readFile(structurePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const headerRow = data[0] ?? [];
  const columnPairs = detectFlavorOrderColumns(headerRow);
  const qtyMap = new Map(Array.from(actualFlavorNames, (name) => [name, 0]));
  const metadata = new Map();
  const currentSectionByFlavorCol = new Map();

  for (let r = 1; r < data.length; r++) {
    for (const pair of columnPairs) {
      const templateName = data[r]?.[pair.flavorCol];
      if (!templateName) continue;
      const rawName = String(templateName).trim();
      if (!rawName) continue;

      const normalizedRaw = normalizeFlavorName(rawName);
      if (normalizedRaw === 'SPECIALI') {
        currentSectionByFlavorCol.set(pair.flavorCol, 'SPECIALI');
        continue;
      }

      const category = String(headerRow[pair.flavorCol] ?? '').trim().toUpperCase();
      const resolved = resolveDataFlavorName(templateName, qtyMap);
      if (resolved) {
        metadata.set(resolved, {
          category,
          section: currentSectionByFlavorCol.get(pair.flavorCol) || null,
        });
      }
    }
  }

  return metadata;
}

function calculateStandardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateForecast(historyRecentFirst) {
  const weights = [0.4, 0.3, 0.2, 0.1];
  let forecast = 0;
  for (let i = 0; i < weights.length; i++) {
    forecast += weights[i] * (historyRecentFirst[i] || 0);
  }
  return forecast;
}

function getSeasonalMultiplier(category, now = new Date()) {
  const month = now.getMonth() + 1;
  const upper = String(category ?? '').toUpperCase();

  if (upper.includes('SORBETTI')) {
    return month >= 5 && month <= 9 ? 1.25 : 1.0;
  }
  if (upper.includes('CREME')) {
    return month >= 10 || month <= 3 ? 1.1 : 1.0;
  }
  if (upper.includes('CIOCCOLATI')) {
    return 1.05;
  }
  return 1.0;
}

function getSpecialSectionMultiplier(section) {
  return String(section ?? '').toUpperCase() === 'SPECIALI' ? 0.55 : 1.0;
}

function calculateFinalOrder(target, currentStock, section) {
  const netNeed = target - currentStock;
  if (String(section ?? '').toUpperCase() === 'SPECIALI' && netNeed < 1.0) {
    return 0;
  }
  return Math.max(0, Math.ceil(netNeed));
}

function calculateAverageArrivalsPerWeek(arrivalHistoryRecentFirst) {
  if (!arrivalHistoryRecentFirst.length) return 1;
  const avg = arrivalHistoryRecentFirst.reduce((sum, count) => sum + count, 0) / arrivalHistoryRecentFirst.length;
  return Math.max(1, Math.round(avg));
}

/**
 * Read the Excel template, fill in Qty columns from Da Ordinare data, save.
 */
function fillExcelTemplate(daOrdinareRows) {
  const structurePath = pickTemplateStructurePath();
  const sourceWb = XLSX.readFile(structurePath);
  const sourceSheetName = sourceWb.SheetNames[0];
  const sourceWs = sourceWb.Sheets[sourceSheetName];
  const sourceData = XLSX.utils.sheet_to_json(sourceWs, { header: 1 });

  // Build gusto -> order qty map from daOrdinareRows [gusto, stato, qty]
  const qtyMap = new Map();
  for (const row of daOrdinareRows) {
    qtyMap.set(row[0], parseInt(row[2], 10) || 0);
  }

  const headerRow = sourceData[0] ?? [];
  const columnPairs = detectFlavorOrderColumns(headerRow);

  if (columnPairs.length === 0) {
    throw new Error(`Template format not supported in ${structurePath}: could not detect flavor/ORDINE columns`);
  }

  const rebuiltData = [
    columnPairs.flatMap((pair) => {
      const category = String(headerRow[pair.flavorCol] ?? '').trim() || 'Categoria';
      return [category, 'ESAURITO', 'MANTENIMENTO', 'ORDINE'];
    }),
  ];

  let filled = 0;

  for (let r = 1; r < sourceData.length; r++) {
    const outRow = [];
    let hasFlavor = false;

    for (const pair of columnPairs) {
      const templateName = sourceData[r]?.[pair.flavorCol];
      const flavorText = String(templateName ?? '').trim();

      if (!flavorText) {
        outRow.push('', '', '', '');
        continue;
      }

      hasFlavor = true;

      const dataName = resolveDataFlavorName(templateName, qtyMap);
      const qty = dataName ? (qtyMap.get(dataName) ?? 0) : 0;
      outRow.push(flavorText, '', '', qty > 0 ? qty : '');
      if (qty > 0) filled++;
    }

    if (hasFlavor) {
      rebuiltData.push(outRow);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rebuiltData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Flavors');

  const outPath = 'output/shocapp_template_filled.xlsx';
  XLSX.writeFile(wb, outPath);
  log.info('Excel template recreated from %s (%s): %d items with qty > 0 -> %s', structurePath, sourceSheetName, filled, outPath);

  return {
    sheet: ws,
    data: rebuiltData,
    columnPairs,
    sheetName: 'Flavors',
    templatePath: structurePath,
  };
}

/**
 * Create a clean xlsx with each dataset as a separate sheet.
 */
function exportCleanXlsx(filledTemplateSheet, presetRows, daOrdinareHeaders, daOrdinareRows) {
  const wb = XLSX.utils.book_new();
  let ordiniSheetName = null;

  // Sheet 1: Ordini Settimanali (filled template)
  if (filledTemplateSheet) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    ordiniSheetName = `Ordini Settimanali ${dd}-${mm}-${yyyy}`;
    XLSX.utils.book_append_sheet(wb, filledTemplateSheet, ordiniSheetName);
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

  return {
    reportPath: outPath,
    ordiniSheetName,
  };
}

function normalizeFlavorName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function computeTotalOrderExcludingMascarpone(daOrdinareRows) {
  return daOrdinareRows.reduce((sum, row) => {
    const gusto = normalizeFlavorName(row?.[0]);
    const qty = parseInt(row?.[2], 10) || 0;
    if (gusto === 'CREMA MASCARPONE') {
      return sum;
    }
    return sum + Math.max(0, qty);
  }, 0);
}

function buildTemplateOrderRows(templateData, columnPairs) {
  const rows = [];
  for (let r = 1; r < templateData.length; r++) {
    const resultRow = [];
    let hasAnyOrder = false;

    for (const pair of columnPairs) {
      const flavor = String(templateData[r]?.[pair.flavorCol] ?? '').trim();
      const qty = parseInt(templateData[r]?.[pair.ordineCol], 10) || 0;
      if (qty > 0) hasAnyOrder = true;
      resultRow.push({ flavor, qty: qty > 0 ? qty : '' });
    }

    if (hasAnyOrder) {
      rows.push(resultRow);
    }
  }
  return rows;
}

function resolvePythonExecutable() {
  const localVenvPython = path.resolve('.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(localVenvPython)) {
    return localVenvPython;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function formatWorkbookForPdf(inputPath, outputPath = inputPath, sheetName = null, onlySheet = false) {
  const pythonExe = resolvePythonExecutable();
  const formatterScript = path.resolve('src', 'format_excel_for_pdf.py');
  const args = [formatterScript, inputPath, outputPath];

  if (sheetName) {
    args.push('--sheet', sheetName);
  }
  if (onlySheet) {
    args.push('--only-sheet');
  }

  await execFileAsync(pythonExe, args, {
    cwd: process.cwd(),
    windowsHide: true,
  });

  log.info('Workbook formatted for PDF conversion: %s', outputPath);
  return outputPath;
}

function createPdfSourceWorkbookFromOrdiniSheet(reportPath, ordiniSheetName, outPath, totalVaschette) {
  const reportWb = XLSX.readFile(reportPath);
  const sourceWs = reportWb.Sheets[ordiniSheetName];
  if (!sourceWs) {
    throw new Error(`Sheet not found in report: ${ordiniSheetName}`);
  }

  const data = XLSX.utils.sheet_to_json(sourceWs, { header: 1 });
  const headerRow = data[0] ?? [];
  const columnPairs = detectFlavorOrderColumns(headerRow);

  if (columnPairs.length === 0) {
    throw new Error(`Could not detect flavor/ORDINE columns in report sheet: ${ordiniSheetName}`);
  }

  const reducedRows = data.map((row, rowIndex) => {
    const outRow = [];
    for (const pair of columnPairs) {
      const flavorValue = row?.[pair.flavorCol] ?? '';
      const ordineValue = row?.[pair.ordineCol] ?? '';
      if (rowIndex === 0) {
        outRow.push(String(flavorValue || '').trim(), 'ORDINE');
      } else {
        outRow.push(flavorValue, ordineValue);
      }
    }
    return outRow;
  });

  const filteredRows = [reducedRows[0], ...reducedRows.slice(1).filter((row) => row.some((v) => String(v ?? '').trim() !== ''))];

  // Add total in a single bottom-left cell as requested.
  filteredRows.push([`Totale vaschette: ${totalVaschette}`]);

  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, XLSX.utils.aoa_to_sheet(filteredRows), 'Ordini Settimanali');
  XLSX.writeFile(outWb, outPath);
  log.info('Prepared PDF source workbook (Flavor + ORDINE only): %s', outPath);
  return outPath;
}

async function convertExcelToPdfViaILovePdf(browser, excelPath, outputPdfPath) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto('https://www.ilovepdf.com/excel_to_pdf', { waitUntil: 'domcontentloaded', timeout: 120000 });

    const acceptButton = page.getByText('ACCEPT ALL', { exact: true });
    if (await acceptButton.count()) {
      await acceptButton.click({ timeout: 5000 }).catch(() => {});
    }

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 60000 });
    await fileInput.setInputFiles(path.resolve(excelPath));

    const processButton = page.locator('#processTask, button:has-text("Convert to PDF"), a:has-text("Convert to PDF")').first();
    await processButton.waitFor({ state: 'visible', timeout: 120000 });
    await processButton.click();

    const downloadButton = page.locator('#download, a:has-text("Download PDF"), button:has-text("Download PDF")').first();
    await downloadButton.waitFor({ state: 'visible', timeout: 180000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      downloadButton.click(),
    ]);

    await fs.promises.mkdir(path.dirname(outputPdfPath), { recursive: true });
    await download.saveAs(path.resolve(outputPdfPath));
    log.info('Order PDF converted via iLovePDF: %s', outputPdfPath);
    return outputPdfPath;
  } finally {
    await context.close();
  }
}

async function exportOrderPdf(templateInfo, daOrdinareRows, browser, reportInfo) {
  const pdfSourceWorkbookRawPath = 'output/shocapp_ordini_settimanali_for_pdf_raw.xlsx';
  const pdfSourceWorkbookPath = 'output/shocapp_ordini_settimanali_for_pdf.xlsx';
  const outPath = 'output/shocapp_da_ordinare.pdf';

  try {
    if (!reportInfo?.reportPath || !reportInfo?.ordiniSheetName) {
      throw new Error('Ordini Settimanali sheet not available in report');
    }

    const totalVaschette = computeTotalOrderExcludingMascarpone(daOrdinareRows);
    createPdfSourceWorkbookFromOrdiniSheet(
      reportInfo.reportPath,
      reportInfo.ordiniSheetName,
      pdfSourceWorkbookRawPath,
      totalVaschette,
    );

    await formatWorkbookForPdf(
      pdfSourceWorkbookRawPath,
      pdfSourceWorkbookPath,
      'Ordini Settimanali',
      true,
    );

    if (browser) {
      return await convertExcelToPdfViaILovePdf(browser, pdfSourceWorkbookPath, outPath);
    }
  } catch (error) {
    log.warn('Excel->PDF web conversion failed (%s). Falling back to local PDF generation.', error.message);
  }

  const templatePdfPath = 'TEMPLATE PDF.pdf';
  if (fs.existsSync(templatePdfPath)) {
    const outPathFromTemplate = await exportOrderPdfFromPdfTemplate(templateInfo, daOrdinareRows, templatePdfPath);
    if (outPathFromTemplate) {
      return outPathFromTemplate;
    }
  }

  return exportOrderPdfFallback(templateInfo, daOrdinareRows);
}

async function exportOrderPdfFromPdfTemplate(templateInfo, daOrdinareRows, templatePdfPath) {
  const outPath = 'output/shocapp_da_ordinare.pdf';
  const { data: templateData, columnPairs } = templateInfo;
  const tableRows = buildTemplateOrderRows(templateData, columnPairs);
  const totalVaschette = computeTotalOrderExcludingMascarpone(daOrdinareRows);

  const entries = [];
  for (const row of tableRows) {
    for (const item of row) {
      const qty = parseInt(item.qty, 10) || 0;
      if (qty > 0 && item.flavor) {
        entries.push({ flavor: String(item.flavor).trim(), qty });
      }
    }
  }

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

  try {
    const templateBytes = await fs.promises.readFile(templatePdfPath);
    const templateData = new Uint8Array(templateBytes);
    const pdfDoc = await PdfLibDocument.load(templateData);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const loadingTask = getDocument({ data: templateData });
    const parsedPdf = await loadingTask.promise;
    const parsedPage = await parsedPdf.getPage(1);
    const textContent = await parsedPage.getTextContent();

    const normalize = normalizeFlavorName;
    const textItems = textContent.items
      .filter((it) => it && typeof it.str === 'string')
      .map((it) => {
        const str = it.str.trim();
        return {
          str,
          norm: normalize(str),
          x: it.transform[4],
          y: it.transform[5],
          width: it.width || 0,
          height: Math.abs(it.height || it.transform[0] || 10),
        };
      })
      .filter((it) => it.str.length > 0);

    const ordineHeaders = textItems
      .filter((it) => it.norm === 'ORDINE' || it.norm === 'ORD')
      .map((it) => ({
        xCenter: it.x + (it.width / 2),
      }));

    const totalLabel = textItems.find((it) => it.norm.startsWith('TOTAL'));
    const usedIndexes = new Set();

    const page = pdfDoc.getPages()[0];
    const qtyFontSize = 7;
    const sortedOrdineCenters = ordineHeaders.map(h => h.xCenter).sort((a, b) => a - b);

    const placements = [];
    const occupied = new Set();

    const groupForX = (x) => {
      if (sortedOrdineCenters.length === 0) return 0;
      let bestIdx = 0;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (let i = 0; i < sortedOrdineCenters.length; i++) {
        const d = Math.abs(sortedOrdineCenters[i] - x);
        if (d < bestDiff) {
          bestDiff = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    const allTemplateFlavors = [];
    for (let r = 0; r < templateData.length; r++) {
      for (const pair of columnPairs) {
        const flavorRaw = String(templateData[r]?.[pair.flavorCol] ?? '').trim();
        if (!flavorRaw) continue;
        const normFlavor = normalize(flavorRaw);
        if (!normFlavor) continue;
        allTemplateFlavors.push(normFlavor);
      }
    }

    for (const entry of entries) {
      const targetNorm = normalize(entry.flavor);
      const candidates = [];
      for (let i = 0; i < textItems.length; i++) {
        if (usedIndexes.has(i)) continue;
        if (textItems[i].norm === targetNorm) {
          candidates.push({ idx: i, item: textItems[i] });
        }
      }
      if (candidates.length === 0) continue;

      const selected = candidates[0];
      usedIndexes.add(selected.idx);
      const flavorItem = selected.item;

      let ordineCenterX = flavorItem.x + flavorItem.width + 36;
      if (sortedOrdineCenters.length > 0) {
        const rightSide = sortedOrdineCenters.filter((x) => x > flavorItem.x + flavorItem.width - 2);
        if (rightSide.length > 0) {
          ordineCenterX = rightSide[0];
        } else {
          ordineCenterX = sortedOrdineCenters[sortedOrdineCenters.length - 1];
        }
      }

      const qtyText = String(entry.qty);
      const textWidth = helveticaBold.widthOfTextAtSize(qtyText, qtyFontSize);
      const cellWidth = Math.max(18, textWidth + 8);
      const cellHeight = Math.max(10, flavorItem.height * 1.15);
      const cellX = ordineCenterX - (cellWidth / 2);
      let cellY = flavorItem.y - (cellHeight * 0.34);

      const keyBase = `${Math.round(ordineCenterX)}:${Math.round(cellY)}`;
      if (occupied.has(keyBase)) {
        cellY -= cellHeight + 1;
      }
      occupied.add(`${Math.round(ordineCenterX)}:${Math.round(cellY)}`);

      const drawX = ordineCenterX - (textWidth / 2);
      const drawY = cellY + ((cellHeight - qtyFontSize) / 2) + 0.2;

      page.drawText(qtyText, {
        x: drawX,
        y: drawY,
        size: qtyFontSize,
        font: helveticaBold,
        color: rgb(0.08, 0.08, 0.08),
      });

      placements.push({
        flavorX: flavorItem.x,
        ordineCenterX,
        groupIndex: groupForX(ordineCenterX),
        cellX,
        cellY,
        cellWidth,
        cellHeight,
      });
    }

    if (placements.length > 0) {
      const rowCenters = [];

      for (const normFlavor of allTemplateFlavors) {
        const flavorMatches = textItems.filter((it) => it.norm === normFlavor);
        for (const m of flavorMatches) {
          const centerY = m.y + (m.height / 2);
          const existing = rowCenters.find((v) => Math.abs(v - centerY) < 2.2);
          if (!existing) rowCenters.push(centerY);
        }
      }

      for (const p of placements) {
        const centerY = p.cellY + p.cellHeight / 2;
        const existing = rowCenters.find((v) => Math.abs(v - centerY) < 2.2);
        if (!existing) rowCenters.push(centerY);
      }

      rowCenters.sort((a, b) => b - a);

      const avgCellHeight = placements.reduce((s, p) => s + p.cellHeight, 0) / placements.length;
      const rowHeight = Math.max(10, avgCellHeight + 1);

      const leftBound = Math.min(...placements.map(p => p.flavorX)) - 4;
      const rightBound = Math.max(...placements.map(p => p.cellX + p.cellWidth)) + 4;

      const centersByGroup = [];
      for (let i = 0; i < sortedOrdineCenters.length; i++) {
        centersByGroup.push(sortedOrdineCenters[i]);
      }
      if (centersByGroup.length === 0) {
        centersByGroup.push(...Array.from(new Set(placements.map(p => p.ordineCenterX))).sort((a, b) => a - b));
      }

      const groupBounds = [];
      for (let i = 0; i < centersByGroup.length; i++) {
        const left = i === 0 ? leftBound : (centersByGroup[i - 1] + centersByGroup[i]) / 2;
        const right = i === centersByGroup.length - 1 ? rightBound : (centersByGroup[i] + centersByGroup[i + 1]) / 2;
        groupBounds.push({ left, right, center: centersByGroup[i] });
      }

      const rowTop = rowCenters[0] + rowHeight / 2;
      const rowBottom = rowCenters[rowCenters.length - 1] - rowHeight / 2;

      // Horizontal lines (full table width)
      page.drawLine({ start: { x: leftBound, y: rowTop }, end: { x: rightBound, y: rowTop }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });
      for (const c of rowCenters) {
        const y = c - rowHeight / 2;
        page.drawLine({ start: { x: leftBound, y }, end: { x: rightBound, y }, thickness: 0.7, color: rgb(0.2, 0.2, 0.2) });
      }

      // Vertical outer borders
      page.drawLine({ start: { x: leftBound, y: rowTop }, end: { x: leftBound, y: rowBottom }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });
      page.drawLine({ start: { x: rightBound, y: rowTop }, end: { x: rightBound, y: rowBottom }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });

      // Group and ORDINE divider lines
      for (let i = 0; i < groupBounds.length; i++) {
        const g = groupBounds[i];
        if (i > 0) {
          page.drawLine({ start: { x: g.left, y: rowTop }, end: { x: g.left, y: rowBottom }, thickness: 0.7, color: rgb(0.2, 0.2, 0.2) });
        }
        const qtyDivider = g.center - 12;
        if (qtyDivider > g.left + 12 && qtyDivider < g.right - 8) {
          page.drawLine({ start: { x: qtyDivider, y: rowTop }, end: { x: qtyDivider, y: rowBottom }, thickness: 0.6, color: rgb(0.35, 0.35, 0.35) });
        }
      }
    }

    if (totalLabel) {
      const totalText = String(totalVaschette);
      const totalFontSize = 11;
      const drawX = totalLabel.x + totalLabel.width + 10;
      const drawY = totalLabel.y - (totalFontSize * 0.15);
      page.drawText(totalText, {
        x: drawX,
        y: drawY,
        size: totalFontSize,
        font: helveticaBold,
        color: rgb(0.05, 0.05, 0.05),
      });
    }

    const outBytes = await pdfDoc.save();
    await fs.promises.writeFile(outPath, outBytes);
    log.info('Order PDF generated from template: %s', outPath);
    return outPath;
  } catch (error) {
    log.warn('Template PDF fill failed (%s). Falling back to generated table PDF.', error.message);
    return null;
  }
}

async function exportOrderPdfFallback(templateInfo, daOrdinareRows) {
  const outPath = 'output/shocapp_da_ordinare.pdf';
  const { data: templateData, columnPairs } = templateInfo;
  const tableRows = buildTemplateOrderRows(templateData, columnPairs);
  const totalVaschette = computeTotalOrderExcludingMascarpone(daOrdinareRows);

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 16, bottom: 16, left: 16, right: 16 },
    });

    const stream = fs.createWriteStream(outPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const right = pageWidth - doc.page.margins.right;
    const top = doc.page.margins.top;
    const bottom = pageHeight - doc.page.margins.bottom;
    const tableWidth = right - left;

    const title = `Ordini (${new Date().toLocaleDateString('it-IT')})`;
    doc.font('Helvetica-Bold').fontSize(14).text(title, left, top, {
      width: tableWidth,
      align: 'left',
    });

    doc.font('Helvetica').fontSize(10).fillColor('#333333').text(
      `Totale vaschette: ${totalVaschette}`,
      left,
      top + 15,
      { width: tableWidth, align: 'left' },
    );

    const startY = top + 32;
    const headerRows = 1;
    const totalRows = Math.max(1, tableRows.length) + headerRows;
    const availableHeight = Math.max(40, bottom - startY - 4);
    const rowHeight = availableHeight / totalRows;
    const fontSize = Math.max(6.5, Math.min(10.5, rowHeight * 0.5));

    const groupCount = columnPairs.length;
    const groupWidth = tableWidth / groupCount;
    const flavorRatio = 0.78;
    const flavorColWidth = groupWidth * flavorRatio;
    const qtyColWidth = groupWidth - flavorColWidth;

    const headerLabels = columnPairs.map((pair, idx) => {
      const raw = String(templateData[0]?.[pair.flavorCol] ?? '').trim();
      return raw || `Gruppo ${idx + 1}`;
    });

    let y = startY;
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#111111');
    for (let i = 0; i < groupCount; i++) {
      const groupLeft = left + i * groupWidth;
      const xFlavor = groupLeft;
      const xQty = groupLeft + flavorColWidth;
      doc.rect(groupLeft, y, groupWidth, rowHeight).fillAndStroke('#f0f4ff', '#3f3f46');
      doc.fillColor('#111111');
      doc.text(headerLabels[i], xFlavor + 4, y + 3, {
        width: flavorColWidth - 8,
        align: 'left',
        ellipsis: true,
        lineBreak: false,
      });
      doc.text('Ord', xQty + 2, y + 3, {
        width: qtyColWidth - 6,
        align: 'right',
        lineBreak: false,
      });
    }

    y += rowHeight;

    doc.font('Helvetica').fontSize(fontSize).fillColor('#111111');
    if (tableRows.length === 0) {
      doc.rect(left, y, tableWidth, rowHeight).stroke('#3f3f46');
      doc.text('Nessun ordine (> 0) da mostrare.', left + 4, y + 3, {
        width: tableWidth - 8,
        align: 'left',
        lineBreak: false,
      });
      y += rowHeight;
    } else {
      for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex++) {
        const row = tableRows[rowIndex];
        const stripe = rowIndex % 2 === 0 ? '#ffffff' : '#fafafa';
        doc.rect(left, y, tableWidth, rowHeight).fillAndStroke(stripe, '#d4d4d8');
        const rowTextY = y + 2;
        for (let i = 0; i < groupCount; i++) {
          const groupLeft = left + i * groupWidth;
          const xFlavor = groupLeft;
          const xQty = groupLeft + flavorColWidth;
          const flavor = row[i]?.flavor ?? '';
          const qty = row[i]?.qty ?? '';
          doc.fillColor('#111111');
          doc.text(flavor, xFlavor + 4, rowTextY + 1, {
            width: flavorColWidth - 8,
            align: 'left',
            ellipsis: true,
            lineBreak: false,
          });
          doc.fillColor('#0f172a');
          doc.text(String(qty), xQty + 2, rowTextY + 1, {
            width: qtyColWidth - 6,
            align: 'right',
            lineBreak: false,
          });
        }
        y += rowHeight;
      }
    }

    for (let i = 0; i < groupCount; i++) {
      const groupLeft = left + i * groupWidth;
      const xQty = groupLeft + flavorColWidth;
      if (i > 0) {
        doc.moveTo(groupLeft, startY).lineTo(groupLeft, y).lineWidth(0.7).stroke('#a1a1aa');
      }
      doc.moveTo(xQty, startY).lineTo(xQty, y).lineWidth(0.7).stroke('#a1a1aa');
    }
    doc.rect(left, startY, tableWidth, y - startY).lineWidth(0.9).stroke('#3f3f46');

    doc.end();
  });

  log.info('Order PDF generated (fallback table mode): %s', outPath);
  return outPath;
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
    'output/shocapp_da_ordinare.pdf',
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
  const pass = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');
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
    'output/shocapp_da_ordinare.pdf',
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
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === 'true',
    },
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
    // Forecast next week with weighted moving average of the last 4 weeks,
    // add variability buffer from the last 8 weeks, then apply seasonal multiplier.
    const mRows = presetRows['mantenimento_tutto'] ?? [];
    const eRows = presetRows['esaurito_7giorni'] ?? [];

    const mMap = sumByGusto(mRows);
    const eMap = sumByGusto(eRows);
    const weeklyHistory = await fetchWeeklySalesHistory(bPage, 8);
    const weeklyArrivalHistory = await fetchWeeklyArrivalHistory(bPage, 8);

    const allGusti = new Set([...mMap.keys(), ...eMap.keys()]);
    for (const week of weeklyHistory) {
      for (const gusto of week.salesMap.keys()) {
        allGusti.add(gusto);
      }
    }
    for (const week of weeklyArrivalHistory) {
      for (const gusto of week.arrivalsByFlavor.keys()) {
        allGusti.add(gusto);
      }
    }

    const flavorMetadataMap = buildFlavorMetadataMap(allGusti);
    const daOrdinareHeaders = ['Gusto', 'Stato', 'N. Vasche'];
    const daOrdinareRows = [];

    for (const gusto of allGusti) {
      const salesHistory = weeklyHistory.map((week) => week.salesMap.get(gusto) || 0);
      const arrivalsHistory = weeklyArrivalHistory.map((week) => week.arrivalsByFlavor.get(gusto)?.size || 0);
      const forecast = calculateForecast(salesHistory);
      const buffer = calculateStandardDeviation(salesHistory);
      const flavorMetadata = flavorMetadataMap.get(gusto) || { category: 'GELATO', section: null };
      const category = flavorMetadata.category;
      const section = flavorMetadata.section;
      const seasonalMultiplier = getSeasonalMultiplier(category);
      const specialSectionMultiplier = getSpecialSectionMultiplier(section);
      const currentStock = mMap.get(gusto) || 0;
      const weeklyTargetStock = (((forecast * seasonalMultiplier) + buffer) * specialSectionMultiplier);
      const weeklyOrder = calculateFinalOrder(weeklyTargetStock, currentStock, section);
      const arrivalsPerWeek = calculateAverageArrivalsPerWeek(arrivalsHistory);
      const orderPerArrival = weeklyOrder > 0 ? Math.ceil(weeklyOrder / arrivalsPerWeek) : 0;

      log.info(
        'Forecast %s | weekly_history=%s | arrivals=%s | weekly_forecast=%s | buffer=%s | season=%s | weekly_target=%s | stock=%d | arrivals_per_week=%d | order_per_arrival=%d',
        gusto,
        salesHistory.join(','),
        arrivalsHistory.join(','),
        forecast.toFixed(2),
        buffer.toFixed(2),
        seasonalMultiplier.toFixed(2),
        weeklyTargetStock.toFixed(2),
        currentStock,
        arrivalsPerWeek,
        orderPerArrival,
      );

      daOrdinareRows.push([gusto, 'Da Ordinare', String(orderPerArrival)]);
    }

    const daOrdPath = 'output/shocapp_da_ordinare';
    await exportJSON(daOrdPath, daOrdinareHeaders, daOrdinareRows);
    await exportCSV(daOrdPath, daOrdinareHeaders, daOrdinareRows);
    await exportXLSX(daOrdPath, daOrdinareHeaders, daOrdinareRows, 'Da Ordinare');
    log.info('"Da Ordinare": %d gusti -> %s.csv / %s.json / %s.xlsx',
      daOrdinareRows.length, daOrdPath, daOrdPath, daOrdPath);

    // -- Fill Excel template ------------------------------------------------
    const templateInfo = fillExcelTemplate(daOrdinareRows);

    // -- Clean multi-sheet xlsx ---------------------------------------------
    const reportInfo = exportCleanXlsx(templateInfo.sheet, presetRows, daOrdinareHeaders, daOrdinareRows);

    // -- Export order-only PDF ----------------------------------------------
    const orderPdfPath = await exportOrderPdf(templateInfo, daOrdinareRows, browser, reportInfo);

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
      orderPdfPath,
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
