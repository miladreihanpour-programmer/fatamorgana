/**
 * shocappExtractor.js
 * Definitive version — uses the actual SHOCAPP UI structure discovered via diagnose.js
 *
 * Key insights:
 *  - Filter dropdowns have stable IDs: #SelStatus, #SelData, #SelTabella
 *  - "Cerca" is an <a class="btn-support3">, not a <button>
 *  - The table mixes Stato values; we must filter rows by the Stato cell ourselves
 *  - Switching to "Sintesi" mode gives one row per flavor (cleaner)
 *
 * Workflow:
 *   1. Open SHOCAPP Lista Vaschette
 *   2. Set table to Sintesi mode
 *   3. Read with Stato=Mantenimento + Tutto il periodo  → stock B
 *   4. Set Stato=Esaurito + Ultimi 7 giorni             → sold last 7 days A
 *   5. Set Stato=Esaurito + Tutto il periodo            → all-time sold H
 *   6. Compute orders: target = ceil(A/7 * 10 days), order = max(0, target - B)
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateOrderPdf } from './generatePdf.js';
import { sendTelegram } from './telegram.js';
import { sendEmail } from './email.js';
import logger from './logger.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.join(__dirname, '..');
const OUTPUT_DIR   = path.join(ROOT, 'output');
const TEMPLATE_PATH = path.join(ROOT, 'gelato_flavors.xlsx');

const BASE  = 'https://gelateriafatamorgana.com/fata/tracking-manager/html';
const LOGIN = `${BASE}/login.php`;

// ─── ORDERING PARAMS ──────────────────────────────────────────────────────────
const COVER_DAYS  = 10;   // target stock = enough to cover this many days
const MAX_ORDER   = 8;    // safety cap per flavor

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── NAME MAP (SHOCAPP → template) ────────────────────────────────────────────
const NAME_MAP = {
  'CIOCCOLATO AL PIMENTO':                         'C. AL PIMENTO',
  "CIOCCOLATO CRUDO DEL PERU'":                    "C. CRUDO DEL PERU'",
  'CIOCCOLATO KENTUCKY':                           'C. KENTUCKY',
  'CIOCCOLATO LAPSANG SOUCHOUNG':                  'C. LAPSANG SOUCHOUNG',
  'CIOCCOLATO VENEZUELA':                          'C. VENEZUELA',
  'CIOCCOLATO WASABI':                             'C. WASABI',
  "CIOCCOLATO UGANDA PERLA D'AFRICA":              'C. UGANDA',
  'CIOCCOLATO MADAGASCAR':                         'C. MADAGASCAR',
  'CIOCCOLATO ROSEMARY':                           'C. ROSEMARY',
  'CIOCCOLATO AL LATTE GELATO':                    'C. AL LATTE GELATO',
  'CIOCCOLATO BIANCO':                             'C. BIANCO',
  'CIOCCOLATO E ARANCIA':                          'C. E ARANCIA',
  'CIOCCOLATO EQUADOR':                            'C. EQUADOR',
  'CIOCCOLATO VANIGLIA':                           'C. VANIGLIA',
  'CIOCCOLATO CANNELLA':                           'C. CANNELLA',
  'CIOCCOLATO AL WHISKY':                          'C. AL WHISKY',
  'CREMA PASTICCIERA PARISI':                      'C. PASTICCIERA PARISI',
  'CREMA AGNESE':                                  'C. AGNESE',
  'CREMA FRAGOLE E MANDORLE':                      'C. FRAGOLE E MANDORLE',
  'CREMA ZENZERO MIELE DI CASTAGNO E LIMONE':      'C. ZENZERO',
  'CREMA ZENZERO':                                 'C. ZENZERO',
  'COCCO CREMA':                                   'COCCO C.',
  'GIANDUIA VARIEGATA':                            'V. GIANDUIA VARIEGATA',
  'EVERGREEN BRONTE VEGAN':                        'V.BRONTE GREEN',
  'NOCCIOLA AL FRUTTOSIO':                         'V. NOCCIOLA F.',
  'BANACHI, BANANA ARACHIDI & CARAMELLO':          'V. BANACHI',
  'CASTAGNA AL WHISKY':                            'V. CASTAGNA AL WHISKY',
  'CASTAGNA E MIRTO':                              'V. CASTAGNA E MIRTO',
  'FIOR DI CIOCCOLATO':                            'V. FIOR DI CIOCCOLATO',
  'BACIO DEL PRINCIPE':                            'BACIO',
  'LATTE MENTA E CIOCCOLATO':                      'MENTA E C.',
  'MELA MANDORLA E CANNELLA':                      'MELA M.C.',
  'MANGO SOLE DI SICILIA':                         'MANGO',
  'FRUTTI DI BOSCO(LAMPONE,RIBES,MORA,MIRTILLO)':  'FRUTTI DI BOSCO',
  'PANACEA (LATTE DI MANDORLA MENTA & GINSENG)':   'PANACEA',
  'PANACEA(LATTE DI MANDORLA MENTA & GINSENG)':    'PANACEA',
  'FIORI DI LAVANDA E FRAGOLINE DI NEMI':          'LAVANDA',
  'PISTACCHIO BRONTE':                             'P.BRONTE',
  'PISTACCHIO DI BRONTE':                          'P.BRONTE',
  'PISTACCHIO LARNAKA, CIPRO':                     'P.BRONTE',
  'PISTACCHIO LARNAKA , CIPRO':                    'P.BRONTE',
  'RICOTTA ROMANA, CACAO CRUDO & PERA (LA-LA-LAND)':'RICOTTA E PERA',
  'BASILICO NOCI E MIELE':                         'BASILICO',
  'ANANAS E ZENZERO':                              'ANANAS',
  // ── New mappings from diagnose screenshots ──
  'STRACCHINO, ALBICOCCHE AL ROSMARINO & BRICIOLE DI CROSTATA': 'STRACCHINO ALBICOCCHA',
  'STRACCHINO ALBICOCCHE AL ROSMARINO & BRICIOLE DI CROSTATA':  'STRACCHINO ALBICOCCHA',
  'STRACCHINO CON SALSA DI PERE AL MARSALA & NOCI LARA':        'STRACCHINO PERA',
  'NOCCIOLA, BURRO & FIORI DI SALVIA':             'NOCCIOLA BURRO',
  'NOCCIOLA BURRO & FIORI DI SALVIA':              'NOCCIOLA BURRO',
  'PERE BELLE HELENE':                             'PEREBH',
  'COCONUT RICE CAKE':                             'COCONUT RICE CAKE',
  'ROSA KARKADE E ARANCIA':                        'ROSA E ARANCIA',
  'AVOCADO LIME E VINO BIANCO':                    'AVOCADO',
  'ARACHIDI COCCO E CIOCCOLATO':                   'ARACHIDI',
  'MELOGRANO WONDERFUL':                           'MELOGRANO',
  'TE VERDE MATCHA':                               'TE VERDE MATCHA',
  'CASTAGNA E MIRTO':                              'V. CASTAGNA E MIRTO',
  'CASTAGNA AL WHISKY':                            'V. CASTAGNA AL WHISKY',
  'ZABAIONE GELATO':                               'ZABAIONE GELATO',
  'ZABAIONE NEW':                                  'ZABAIONE GELATO',
  'CIOCCOLATO ROSEMARY':                           'C. ROSEMARY',
  'RICOTTA, MIELE E COCCO':                        'RICOTTA E COCCO',
  'RICOTTA E AGRUMI':                              'RICOTTA E AGRUMI',
  'CHEESECAKE MIRTILLI':                           'CHEESECAKE MIRTILLI',
  'BUONGIORNO AMORE':                              'BUONGIORNO AMORE',
};

const IGNORE = new Set([
  'PISTACCHIO SIRIANO',           // discontinued
  'CREMA MASCARPONE',
  'FAVE FRESCHE & PECORINO',
  'LIMONE & BASILICO',
  'STRAWBERRY FIELD FOREVER',
]);

const norm = s => String(s).toUpperCase().replace(/['']/g, "'").replace(/\s+/g, ' ').trim();

// ─── Login ───────────────────────────────────────────────────────────────────
async function login(page) {
  await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.fill('input[name="username"]', process.env.GELATERIA_USER);
  await page.fill('input[name="password"]', process.env.GELATERIA_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);
  if (page.url().includes('login')) throw new Error('Login failed — check .env');
  logger.info('Login OK');
}

// ─── Open SHOCAPP page ───────────────────────────────────────────────────────
async function openShocapp(page) {
  const link = page.locator('a:has-text("SHOCAPP")').first();
  if (await link.count()) await link.click();
  await page.waitForSelector('table', { timeout: 15000 });
  await page.waitForTimeout(800);
}

// ─── Find and set the TABLE row-per-page dropdown (not the date format one) ──
// Multiple <select> elements exist on the page. We want the one INSIDE the
// table area whose options are 10/25/50/100 etc.
async function setTablePageSize(page) {
  const result = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const opts = Array.from(sel.options).map(o => o.value);
      // The table page-size dropdown has numeric options like 10, 25, 50, 100
      const numericOpts = opts.map(o => parseInt(o)).filter(n => !isNaN(n));
      if (numericOpts.length >= 2 && numericOpts.includes(100)) {
        sel.value = '100';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, opts, set: 100 };
      }
    }
    return { found: false };
  });
  if (result.found) logger.info(`  page-size set to ${result.set} (options: ${result.opts.join(',')})`);
  else logger.warn('  table page-size dropdown not found');
  await page.waitForTimeout(800);
}

// ─── Set a dropdown by its trigger ID and the option text ────────────────────
// This is the RELIABLE way: target the dropdown's stable #id, not its text.
async function pickDropdown(page, triggerId, optionText) {
  const trigger = page.locator(`button[data-id="${triggerId}"], button#${triggerId}, button[id*="${triggerId}"]`).first();
  const fallback = page.locator(`button[data-toggle="dropdown"]`);

  // Find the right trigger: the one whose data-id (in dataset.id) matches
  const idx = await fallback.evaluateAll((els, id) =>
    els.findIndex(el => el.dataset?.id === id), triggerId);

  let btn;
  if (idx >= 0) btn = fallback.nth(idx);
  else if (await trigger.count()) btn = trigger;
  else {
    logger.warn(`Trigger ${triggerId} not found`);
    return false;
  }

  await btn.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(250);

  // Pick option from the open menu
  const opt = page.locator(`.dropdown-menu.show a:has-text("${optionText}"), .dropdown-menu a:has-text("${optionText}"):visible, ul.dropdown-menu li:has-text("${optionText}"):visible`).first();
  if (!(await opt.count())) {
    logger.warn(`Option "${optionText}" not found for ${triggerId}`);
    // Close dropdown
    await btn.click({ timeout: 2000 }).catch(() => {});
    return false;
  }
  await opt.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  return true;
}

// ─── Click "Cerca" (which is actually an <a>) ────────────────────────────────
async function clickCerca(page) {
  const cerca = page.locator('a.btn-support3:has-text("Cerca"), a:has-text("Cerca"), .btn:has-text("Cerca")').first();
  if (await cerca.count()) {
    await cerca.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);
  } else {
    logger.warn('Cerca link not found');
    await page.waitForTimeout(1500);
  }
}

// ─── Read table, KEEPING the Stato column so we can filter ourselves ────────
async function readTable(page, label) {
  await page.waitForTimeout(400);
  fs.writeFileSync(path.join(OUTPUT_DIR, `debug_${label}.html`), await page.content());
  await page.screenshot({ path: path.join(OUTPUT_DIR, `screenshot_${label}.png`) }).catch(() => {});

  return page.evaluate(() => {
    // Pick the data table — the one with most rows, must contain a "Gusto" header
    const tables = Array.from(document.querySelectorAll('table'));
    let best = null, bestRows = 0;
    for (const t of tables) {
      const headerText = (t.querySelector('thead')?.textContent || '').toUpperCase();
      if (!headerText.includes('GUSTO')) continue;
      const rc = t.querySelectorAll('tbody tr').length;
      if (rc > bestRows) { bestRows = rc; best = t; }
    }
    if (!best) return [];

    // Determine column indexes from header
    const headerCells = Array.from(best.querySelectorAll('thead th, thead td'));
    const headers = headerCells.map(h => (h.textContent || '').trim().toUpperCase());
    const gustoIdx = headers.findIndex(h => h.includes('GUSTO'));
    const statoIdx = headers.findIndex(h => h.includes('STATO'));
    const vasIdx   = headers.findIndex(h => h.includes('VASCHE'));

    const out = [];
    for (const tr of best.querySelectorAll('tbody tr')) {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
      if (cells.length < 3) continue;
      const flavor = gustoIdx >= 0 ? cells[gustoIdx] : cells[1];
      const stato  = statoIdx >= 0 ? cells[statoIdx] : '';
      const qty    = parseInt((cells[vasIdx >= 0 ? vasIdx : 4] || '').replace(/[^0-9]/g, ''));
      if (!flavor || flavor.length < 2) continue;
      if (flavor.toLowerCase().includes('peso')) continue;
      if (!isNaN(qty) && qty > 0) out.push({ flavor, stato, qty });
    }
    return out;
  });
}

// ─── Filter rows by exact Stato value, then aggregate ───────────────────────
function filterByStato(rows, stato) {
  return rows.filter(r => norm(r.stato) === norm(stato));
}

function aggregate(rows) {
  const m = {};
  for (const r of rows) m[r.flavor] = (m[r.flavor] ?? 0) + r.qty;
  return Object.entries(m).map(([flavor, qty]) => ({ flavor, qty }));
}

// ─── Map names to template ──────────────────────────────────────────────────
function loadTemplateNames() {
  const wb = XLSX.readFile(TEMPLATE_PATH);
  const ws = wb.Sheets['Flavors'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const set = new Set();
  for (const row of rows.slice(1)) {
    for (const c of [0, 2, 4, 6]) {
      const v = row[c];
      if (v && !['ORDINE', 'TOTAL:', 'Varie'].includes(String(v).trim())) set.add(norm(v));
    }
  }
  return set;
}

function mapName(s, set) {
  const n = norm(s);
  if (set.has(n)) return n;
  if (NAME_MAP[n]) return norm(NAME_MAP[n]);
  if (IGNORE.has(n)) return null;
  return null;
}

function aggregateAndMap(rawRows, set) {
  const m = {};
  const unmatched = [];
  for (const r of rawRows) {
    const k = mapName(r.flavor, set);
    if (k) m[k] = (m[k] ?? 0) + r.qty;
    else if (!IGNORE.has(norm(r.flavor))) unmatched.push(r.flavor);
  }
  if (unmatched.length) logger.warn(`Unmatched: ${[...new Set(unmatched)].join(', ')}`);
  return m;
}

// ─── Decision logic ─────────────────────────────────────────────────────────
function decideOrders({ stock, sold7d, hist }) {
  const histVals = Object.values(hist).filter(v => v > 0).sort((a, b) => a - b);
  const median   = histVals.length ? histVals[Math.floor(histVals.length / 2)] : 0;

  const flavors = new Set([...Object.keys(stock), ...Object.keys(sold7d), ...Object.keys(hist)]);
  const decisions = [];

  for (const f of flavors) {
    const A = sold7d[f] ?? 0;
    const B = stock[f]  ?? 0;
    const H = hist[f]   ?? 0;

    let target, order, reason;

    if (A === 0 && H === 0) {
      target = 0; order = 0; reason = 'mai venduto';
    } else if (A === 0) {
      // Bestseller with no recent sales: keep 1 in stock as minimum
      target = H >= median ? 1 : 0;
      order  = Math.max(0, target - B);
      reason = order > 0 ? 'storico — scorta minima 1' : 'scorta sufficiente';
    } else {
      const dailyRate = A / 7;
      target = Math.ceil(dailyRate * COVER_DAYS);
      const bestseller = H > median;
      if (bestseller) target += 1;
      order = Math.max(0, target - B);
      order = Math.min(order, MAX_ORDER);
      reason = order === 0
        ? `scorta copre ${COVER_DAYS}gg`
        : (bestseller ? `bestseller, ${COVER_DAYS}gg + 1` : `${COVER_DAYS}gg`);
    }

    decisions.push({
      flavor: f, stock: B, sold7d: A, hist: H,
      dailyRate: A > 0 ? (A / 7).toFixed(2) : '0',
      target, order, reason,
    });
  }
  return decisions.sort((a, b) => b.order - a.order || b.sold7d - a.sold7d);
}

// ─── Excel + PDF ────────────────────────────────────────────────────────────
function fillTemplate(orderMap) {
  const wb = XLSX.readFile(TEMPLATE_PATH);
  const ws = wb.Sheets['Flavors'];
  const ref = XLSX.utils.decode_range(ws['!ref']);
  for (let R = ref.s.r; R <= ref.e.r; R++) {
    for (let C = ref.s.c; C <= ref.e.c; C += 2) {
      const fc = XLSX.utils.encode_cell({ r: R, c: C });
      const oc = XLSX.utils.encode_cell({ r: R, c: C + 1 });
      if (!ws[fc]?.v) continue;
      const key = norm(ws[fc].v);
      if (['ORDINE', 'TOTAL:', 'VARIE'].includes(key)) continue;
      const qty = orderMap[key];
      ws[oc] = qty > 0 ? { t: 'n', v: qty } : { t: 's', v: '' };
    }
  }
  const p = path.join(OUTPUT_DIR, 'shocapp_template_filled.xlsx');
  XLSX.writeFile(wb, p);
  return p;
}

function saveDecisionsExcel(decisions) {
  const headers = ['Gusto', 'Scorta', 'Venduti 7gg', 'Venduti storici', 'Rate/giorno', 'Target', 'Da Ordinare', 'Motivo'];
  const rows = decisions.map(d => [d.flavor, d.stock, d.sold7d, d.hist, d.dailyRate, d.target, d.order, d.reason]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Decisioni');
  XLSX.writeFile(wb, path.join(OUTPUT_DIR, 'shocapp_da_ordinare.xlsx'));
}

function saveRaw(map, filename, sheetName) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.aoa_to_sheet([['flavor', 'qty'], ...Object.entries(map)]), sheetName);
  XLSX.writeFile(wb, path.join(OUTPUT_DIR, filename));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function runExtraction() {
  let browser;
  try {
    const t0 = Date.now();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await login(page);
    await openShocapp(page);

    // Make sure we're in Sintesi mode (one row per flavor, aggregated)
    await pickDropdown(page, 'SelTabella', 'Sintesi');

    // ── 1. Filter to Mantenimento + Tutto il periodo ──
    logger.info('▸ Mantenimento, tutto il periodo (Sintesi)');
    await pickDropdown(page, 'SelStatus', 'Mantenimento');
    await pickDropdown(page, 'SelData',   'Tutto il periodo');
    await clickCerca(page);
    await setTablePageSize(page);
    const stockRows = await readTable(page, 'Mantenimento');
    logger.info(`  ${stockRows.length} righe`);

    // ── 2. Esaurito + Ultimi 7 giorni ──
    logger.info('▸ Esaurito, ultimi 7 giorni (Sintesi)');
    await pickDropdown(page, 'SelStatus', 'Esaurito');
    await pickDropdown(page, 'SelData',   'Ultimi 7 giorni');
    await clickCerca(page);
    await setTablePageSize(page);
    const sold7dRows = await readTable(page, 'Esaurito_7gg');
    logger.info(`  ${sold7dRows.length} righe`);

    // ── 3. Esaurito + Tutto il periodo ──
    logger.info('▸ Esaurito, tutto il periodo (Sintesi)');
    await pickDropdown(page, 'SelData', 'Tutto il periodo');
    await clickCerca(page);
    await setTablePageSize(page);
    const histRows = await readTable(page, 'Esaurito_storico');
    logger.info(`  ${histRows.length} righe`);

    await browser.close(); browser = null;

    // ── Sanity check ──
    const sig = arr => arr.map(r => `${r.flavor}:${r.qty}`).sort().join('|');
    if (sig(stockRows) === sig(sold7dRows)) {
      logger.warn('⚠️  Stock === Sold7d — il filtro Stato non ha funzionato!');
    }
    if (sig(sold7dRows) === sig(histRows)) {
      logger.warn('⚠️  Sold7d === Hist — il filtro Periodo non ha funzionato!');
    }

    // ── Aggregate raw counts (before name mapping) ──
    const stockAgg  = aggregate(stockRows);
    const sold7dAgg = aggregate(sold7dRows);
    const histAgg   = aggregate(histRows);

    logger.info(`Aggregati: stock=${stockAgg.length}, sold7d=${sold7dAgg.length}, hist=${histAgg.length} gusti`);

    // ── Map to template names ──
    const set    = loadTemplateNames();
    const stock  = aggregateAndMap(stockRows,  set);
    const sold7d = aggregateAndMap(sold7dRows, set);
    const hist   = aggregateAndMap(histRows,   set);

    saveRaw(stock,  'shocapp_mantenimento.xlsx',     'Mantenimento');
    saveRaw(sold7d, 'shocapp_esaurito_7gg.xlsx',     'Esaurito 7gg');
    saveRaw(hist,   'shocapp_esaurito_storico.xlsx', 'Storico');

    const decisions = decideOrders({ stock, sold7d, hist });
    saveDecisionsExcel(decisions);

    const orderMap = {};
    for (const d of decisions) if (d.order > 0) orderMap[d.flavor] = d.order;

    const filledPath = fillTemplate(orderMap);
    const pdfPath    = await generateOrderPdf(orderMap);

    const ordered = decisions.filter(d => d.order > 0);
    const total   = ordered.reduce((s, d) => s + d.order, 0);
    const dt      = ((Date.now() - t0) / 1000).toFixed(1);

    logger.info(`✓ ${ordered.length} gusti, ${total} vaschette in ${dt}s`);
    logger.info('Top decisioni:');
    for (const d of ordered.slice(0, 12)) {
      logger.info(`  ${d.flavor.padEnd(28)} stock=${d.stock} sold7d=${d.sold7d} hist=${d.hist} → ${d.order}  (${d.reason})`);
    }

    return { filledPath, pdfPath, decisions, orderMap };
  } catch (err) {
    if (browser) await browser.close();
    logger.error('Extraction failed:', err.message);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await runExtraction();
  if (process.env.AUTO_SEND_TELEGRAM !== 'false' && process.env.TELEGRAM_BOT_TOKEN)
    await sendTelegram([r.filledPath, r.pdfPath], '✅ Estrazione completata');
  if (process.env.AUTO_SEND_EMAIL !== 'false' && process.env.EMAIL_USER)
    await sendEmail([r.filledPath, r.pdfPath], 'Report settimanale Fata Morgana');
}
