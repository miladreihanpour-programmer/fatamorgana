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
 *   6. Compute orders: A=sold7d, D=ceil(A*15%), target=A+D, order=max(0, target-B)
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateOrderPdf } from './generatePdf.js';
import { generateInsights } from './generateInsights.js';
import { sendTelegram } from './telegram.js';
import { sendEmail } from './email.js';
import logger from './logger.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ROOT         = path.join(__dirname, '..');
const OUTPUT_DIR   = path.join(ROOT, 'output');
const TEMPLATE_PATH = path.join(ROOT, 'gelato_flavors.xlsx');

const BASE  = 'https://gelateriafatamorgana.com/fata/tracking-manager/html';
const LOGIN = `${BASE}/login.php`;

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── NAME MAP (SHOCAPP → template) ────────────────────────────────────────────
const NAME_MAP = {
  // ── CIOCCOLATO → C. (abbreviated) ──
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

  // ── CREMA → C. (template uses abbreviated form) ──
  'CREMA PASTICCIERA PARISI':                      'C. PASTICCIERA PARISI',
  'CREMA AGNESE':                                  'C. AGNESE',
  'CREMA FRAGOLE E MANDORLE':                      'C. FRAGOLE E MANDORLE',
  'CREMA ZENZERO MIELE DI CASTAGNO E LIMONE':      'C. ZENZERO',
  'CREMA ZENZERO':                                 'C. ZENZERO',
  'CREMA CANNELLA':                                'C. CANNELLA',
  'CREMA VANIGLIA':                                'C. VANIGLIA',
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
  'BRONTE':                                        'P.BRONTE',
  'PISTACCHIO LARNAKA, CIPRO':                     'PISTACCHIO LARNAKA',
  'PISTACCHIO LARNAKA , CIPRO':                    'PISTACCHIO LARNAKA',
  'PISTACCHIO LARNAKA':                            'PISTACCHIO LARNAKA',
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
  'ZABAIONE GELATO':                               'ZABAIONE GELATO',
  'ZABAIONE NEW':                                  'ZABAIONE GELATO',
  'RICOTTA, MIELE E COCCO':                        'RICOTTA E COCCO',
  'RICOTTA E AGRUMI':                              'RICOTTA E AGRUMI',
  'CHEESECAKE MIRTILLI':                           'CHEESECAKE MIRTILLI',
  'BUONGIORNO AMORE':                              'BUONGIORNO AMORE',
  // ── MANDORLA — SHOCAPP sends full name, template uses M. abbreviation ──
  'MANDORLA AL CARDAMOMO':                         'M. AL CARDAMOMO',
  'MANDORLA BIANCA':                               'M. BIANCA',
  'MANDORLA E ARANCIA':                            'M. E ARANCIA',
  'MANDORLA TOSTATA':                              'M. TOSTATA',
  // ── Additional unmapped flavors (corrected 2026-06-05) ──
  'BAKLAVA':                                       'BAKLAVA',
  'CREMA BANANA CON CROCCANTINO CIOCCOLATO & SESAMO': 'C. BANANA',
  'DRACARYS (DRAGON FRUIT ,FRAGOLE & PEPERONCINO)': 'DRACARYS',
  'LATTE DI FICO (PAMPANELLA)':                    'PAMPANELLA',
  'FRAGOLE DI TERRACINA & CHAMPAGNE':              'FRAGOLE CHAMP',
  'FASHIONED SPRITZ':                              'SPRITZ',
  'NOCI  E UVETTA DI CORINTO':                     'NOCI UVETTA',
  'NOCI E UVETTA DI CORINTO':                      'NOCI UVETTA',
  'SACRIPANTE NEW':                                'SACRIPANTE',
  'FIORDILATTE NEW':                               'FIORDILATTE',
  // ── 18 specialty/seasonal flavors (mapped 2026-06-05) ──
  'CIOCCOLATO':                                    'C. UGANDA',
  'COCCO AL RUM':                                  'COCCO AL RUM',
  'FICHI':                                         'FICHI',
  'FICHI ALLA GRECA':                              'FICHI ALLA GRECA',
  'FRAGOLINE DI BOSCO AL CALVADOS':                'FRAGOLE CALVADOS',
  'MANDARINO':                                     'MANDARINO',
  'MOJITO ALLA AMARENA':                           'AMARENA MOJITO',
  'PERA AL GORGONZOLA':                            'PERA GORGONZOLA',
  'TORRONE SALATO':                                'TORRONE SALATO',
  'UVA FRAGOLA E ZENZERO':                         'UVA FRAGOLA',
  'ZUCCA COI SUOI SEMI CARAMELLATI':               'ZUCCA',
  'RICOTTA E FICHI ALLA GRECA':                    'RICOTTA E FICHI',
  // ── Missing unmapped flavors that exist in template ──
  'CILIEGIA':                                      'CILIEGIA',
  'PISTACCHIO LARNAKA':                            'PISTACCHIO LARNAKA',
  'NOCI UVETTA':                                   'NOCI UVETTA',
  'NOCI PECAN':                                    'NOCI PECAN',
  // ── Discontinued — track stock but never order ──
  'PISTACCHIO SIRIANO':                            'PISTACCHIO SIRIANO',
  // ── Reactivated flavors (removed from IGNORE) ──
  'LIMONE & BASILICO':                             'LIMONE & BASILICO',
  'FAVE FRESCHE & PECORINO':                       'FAVE FRESCHE & PECORINO',
  'STRAWBERRY FIELD FOREVER':                      'STRAWBERRY FIELD FOREVER',
};

// Flavors to track in stock counts but never order (lab stopped production)
const NO_ORDER = new Set([
  'PISTACCHIO SIRIANO',
]);

const IGNORE = new Set([
  'CREMA MASCARPONE',
  'CREMA COGNAC E NOCE MOSCATA',
  'FINOCCHIO MIELE LIQUIRIZIA',
  'GORGONZOLA',
  'PECORINO',
  'PANETTONE GELATO AL PISTACCHIO GLASSATO AL CIOCCOLATO BIANCO',
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
  // Wait for any pending navigation to settle after login redirect
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const link = page.locator('a:has-text("SHOCAPP")').first();
  if (await link.count()) {
    await link.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
  await page.waitForSelector('table', { timeout: 20000 });
  // Extra wait to ensure all JS dropdowns are fully rendered
  await page.waitForTimeout(1500);
}

// ─── Find and set the TABLE row-per-page dropdown to the MAXIMUM available ───
// Multiple <select> elements exist on the page. We want the one INSIDE the
// table area whose options are 10/25/50/100/500 etc.
// We always pick the LARGEST numeric option to ensure all rows are visible on
// one page and we never miss items due to pagination.
async function setTablePageSize(page) {
  const result = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const opts = Array.from(sel.options).map(o => o.value);
      // The table page-size dropdown has numeric options like 10, 25, 50, 100
      const numericOpts = opts.map(o => parseInt(o)).filter(n => !isNaN(n) && n > 0);
      if (numericOpts.length >= 2 && numericOpts.some(n => n >= 50)) {
        // Use the LARGEST available option to show all rows at once
        const maxOpt = Math.max(...numericOpts).toString();
        sel.value = maxOpt;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, opts, set: parseInt(maxOpt) };
      }
    }
    return { found: false };
  });
  if (result.found) logger.info(`  page-size set to ${result.set} (options: ${result.opts.join(',')})`);
  else logger.warn('  table page-size dropdown not found');
  await page.waitForTimeout(1200);
}

// ─── Set a multi-select dropdown to ONE option (uncheck all others first) ───
//
// SHOCAPP uses Bootstrap-select dropdowns. The reliable approach is to set the
// underlying <select> element's value directly and trigger Bootstrap-select's
// refresh — this avoids fragile visual-click interactions where the plugin's
// event handler may not fire from programmatic clicks.
async function pickDropdown(page, triggerId, optionText) {
  const target = optionText.toUpperCase().trim();

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      // Wait for page to fully settle before interacting — critical on cloud runners
      // where SHOCAPP does JS-driven redirects after login
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
    } catch (_) {}
    let result;
    try {
    result = await page.evaluate(({ triggerId, target }) => {
      // ── Strategy 1: drive underlying <select> directly ──────────────────────
      const sel = document.querySelector(`select[id="${triggerId}"]`);
      if (sel) {
        const available = Array.from(sel.options).map(o => o.text.trim());
        const opt = Array.from(sel.options).find(
          o => o.text.trim().toUpperCase() === target || o.value.trim().toUpperCase() === target
        );
        if (!opt) return { ok: false, error: 'option not in select', available };

        // Deselect all, select target
        for (const o of sel.options) o.selected = false;
        opt.selected = true;

        // Fire change so Bootstrap-select refreshes its button title
        sel.dispatchEvent(new Event('change', { bubbles: true }));

        // Explicit Bootstrap-select refresh if jQuery/selectpicker present
        try {
          if (window.jQuery && window.jQuery.fn.selectpicker) {
            window.jQuery(sel).selectpicker('refresh');
          }
        } catch (_) {}

        return { ok: true, via: 'select', selected: opt.text };
      }

      // ── Strategy 2: fallback — visual click inside the dropdown menu ─────────
      const triggers = Array.from(document.querySelectorAll('button[data-toggle="dropdown"]'));
      const btn = triggers.find(b => b.dataset?.id === triggerId);
      if (!btn) return { ok: false, error: 'trigger not found' };

      // Ensure menu is open
      btn.click();
      btn.setAttribute('aria-expanded', 'true');
      let menu = btn.parentElement?.querySelector('.dropdown-menu');
      if (!menu) return { ok: false, error: 'menu not found' };
      menu.classList.add('show');
      menu.style.display = 'block';

      const options = Array.from(menu.querySelectorAll('a[data-original-index], li > a'));
      const available = options.map(o => (o.textContent || '').trim());
      const targetOpt = options.find(o => (o.textContent || '').trim().toUpperCase() === target);
      if (!targetOpt) return { ok: false, error: 'target not in menu', available };

      // Deselect others
      for (const o of options) {
        const cb = o.querySelector('input[type="checkbox"]');
        if (cb && cb.checked && (o.textContent || '').trim().toUpperCase() !== target) o.click();
        else if (o.classList.contains('selected') && (o.textContent || '').trim().toUpperCase() !== target) o.click();
      }
      targetOpt.click();

      return { ok: true, via: 'visual', selected: targetOpt.textContent.trim(), available };
    }, { triggerId, target });
    } catch (evalErr) {
      // Page navigated mid-evaluate — wait and retry
      if (evalErr.message && evalErr.message.includes('Execution context was destroyed')) {
        logger.warn(`pickDropdown ${triggerId}: navigation during evaluate (attempt ${attempt}), retrying…`);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);
        continue;
      }
      throw evalErr;
    }

    if (!result.ok) {
      logger.warn(`pickDropdown ${triggerId} -> "${optionText}": ${result.error}`);
      if (result.available) logger.warn(`  options: ${result.available.slice(0, 10).join(' | ')}`);
      await page.waitForTimeout(500);
      continue;
    }

    logger.info(`  ✓ ${triggerId} = "${result.selected}" (via ${result.via})`);

    // Close any open menu and give the page time to update
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify — check both underlying select value and button title
    const verified = await page.evaluate(({ triggerId, target }) => {
      // Check underlying select first (most reliable)
      const sel = document.querySelector(`select[id="${triggerId}"]`);
      if (sel) {
        const selected = Array.from(sel.selectedOptions).map(o => o.text.trim().toUpperCase());
        if (selected.includes(target)) return { ok: true, via: 'select' };
      }
      // Fallback: check button title text
      const triggers = Array.from(document.querySelectorAll('button[data-toggle="dropdown"]'));
      const btn = triggers.find(b => b.dataset?.id === triggerId);
      if (!btn) return { ok: false, text: 'btn not found' };
      const txt = (btn.title || btn.textContent || '').toUpperCase().trim();
      return { ok: txt.includes(target), text: txt };
    }, { triggerId, target });

    if (verified.ok) return true;
    logger.warn(`  attempt ${attempt}: not verified (${JSON.stringify(verified)})`);
    await page.waitForTimeout(600);
  }

  logger.error(`pickDropdown ${triggerId} -> "${optionText}" FAILED after 3 attempts`);
  return false;
}

// ─── Click "Cerca" (which is actually an <a>) ────────────────────────────────
// ─── Get the "Peso complessivo" summary line (changes with every filter) ─────
async function getPesoSummary(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tr, td, th, div, p'));
    for (const el of rows) {
      const t = (el.textContent || '').trim();
      if (t.startsWith('Peso complessivo')) return t;
    }
    return '';
  });
}

// ─── Click "Cerca" and wait until Peso summary changes ──────────────────────
async function clickCerca(page, prevSummary = null) {
  const cerca = page.locator('a.btn-support3:has-text("Cerca"), a:has-text("Cerca"), .btn:has-text("Cerca")').first();
  if (!(await cerca.count())) {
    logger.warn('Cerca not found');
    await page.waitForTimeout(2000);
    return;
  }

  // force:true bypasses overlay elements (open dropdown menus) that intercept clicks
  await cerca.click({ timeout: 5000, force: true }).catch(e => logger.warn(`Cerca click: ${e.message}`));

  if (prevSummary !== null) {
    const maxWait = 12000;
    const step = 400;
    let waited = 0;
    while (waited < maxWait) {
      await page.waitForTimeout(step);
      waited += step;
      const cur = await getPesoSummary(page);
      if (cur && cur !== prevSummary) {
        logger.info(`  ✓ table changed after ${waited}ms  (${cur.slice(0,60)})`);
        await page.waitForTimeout(300);
        return;
      }
    }
    logger.warn(`  ⚠️ table summary unchanged after ${maxWait}ms`);
  } else {
    await page.waitForTimeout(2500);
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
    // Return column metadata for caller to log
    const _vasIdxUsed = vasIdx >= 0 ? vasIdx : 4;
    const _vasIdxFallback = vasIdx < 0;

    const out = [];
    for (const tr of best.querySelectorAll('tbody tr')) {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
      if (cells.length < 3) continue;
      const flavor = gustoIdx >= 0 ? cells[gustoIdx] : cells[1];
      const stato  = statoIdx >= 0 ? cells[statoIdx] : '';
      const qty    = parseInt((cells[_vasIdxUsed] || '').replace(/[^0-9]/g, ''));
      if (!flavor || flavor.length < 2) continue;
      if (flavor.toLowerCase().includes('peso')) continue;
      // Include ALL items even with qty=0 — depleted items still have sales
      // history and need to appear in the order calculation.
      // Only skip rows where qty is completely unparseable (header/footer rows).
      out.push({ flavor, stato, qty: isNaN(qty) ? 0 : qty });
    }
    // Attach metadata as non-enumerable so callers can inspect it
    return { rows: out, vasIdxFallback: _vasIdxFallback, vasIdxUsed: _vasIdxUsed, headers };
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

// ─── Decision logic ───────────────────────────────────────────────────────
// Rule:
//   A = sold last 7 days
//   D = safety stock = ceil(A * 15%)
//   B = current stock
//   Target = A + D (enough to cover last week + 15% buffer)
//   Order = max(0, target - B)
//
// Only consider flavors with actual recent demand (A > 0 or B > 0)
// ─── Predictive order logic ──────────────────────────────────────────────────
//
// Formula (blended forecast + trend-aware safety):
//
//   rate7d  = A / 7          (daily rate, last 7 days)
//   rate30d = M / 30         (daily rate, last 30 days — more stable baseline)
//   blended = 0.6*rate7d + 0.4*rate30d   (60% recent, 40% medium-term)
//   forecast = blended * 7   (weekly units needed)
//   trend   = rate7d / rate30d  (>1 demand rising, <1 falling) — clamped [0.5, 2.0]
//   safety  = max(1, ceil(blended * 2))  (covers ~2 days of demand)
//   target  = ceil(forecast) + safety
//   order   = max(0, target - B)
//
// Special case: flavor sold 0 last week but active last 30 days AND out of stock
//   → order 1 (don't let it disappear from the case entirely)
//
function decideOrders({ stock, sold7d, sold30d, hist }) {
  const flavors = new Set([
    ...Object.keys(stock),
    ...Object.keys(sold7d),
    ...Object.keys(sold30d),
  ]);
  const decisions = [];

  for (const f of flavors) {
    const A = sold7d[f]  ?? 0;   // sold last 7 days
    const M = sold30d[f] ?? 0;   // sold last 30 days
    const B = stock[f]   ?? 0;   // current stock
    const H = hist[f]    ?? 0;   // all-time (info only)

    if (A === 0 && M === 0 && B === 0) continue;

    if (NO_ORDER.has(f)) {
      decisions.push({ flavor: f, stock: B, sold7d: A, sold30d: M, hist: H,
        dailyRate: '0.00', trend: '—', target: 0, order: 0,
        reason: 'fuori produzione — nessun ordine' });
      continue;
    }

    const rate7d  = A / 7;
    const rate30d = M / 30;
    const blended = 0.6 * rate7d + 0.4 * rate30d;

    // Trend: how this week compares to the monthly average (clamped to avoid overreaction)
    const rawTrend = rate30d > 0 ? rate7d / rate30d : (A > 0 ? 2.0 : 1.0);
    const trend    = Math.min(2.0, Math.max(0.5, rawTrend));
    const trendLabel = trend >= 1.3 ? '↑↑' : trend >= 1.1 ? '↑' : trend <= 0.7 ? '↓↓' : trend <= 0.9 ? '↓' : '→';

    let order, reason;

    if (M === 0 && A === 0) {
      // No sales in 30 days — do not order
      order = 0;
      reason = 'nessuna vendita 30gg';

    } else if (A === 0 && M > 0 && B === 0) {
      // Sold nothing this week but was active last month and is out of stock
      // Keep at least 1 in the case so it doesn't vanish
      order = 1;
      reason = `venduto nel mese (${M} vasche), assente questa settimana — ordine minimo`;

    } else if (A === 0) {
      // Has stock or no recent sales — don't order
      order = 0;
      reason = `nessuna vendita 7gg (30gg: ${M}, scorta: ${B})`;

    } else {
      const forecast = blended * 7;              // expected weekly demand
      const safety   = Math.max(1, Math.ceil(blended * 2));  // 2-day buffer
      const target   = Math.ceil(forecast) + safety;
      order = Math.max(0, target - B);

      reason = order === 0
        ? `scorta (${B}) copre forecast ${Math.ceil(forecast)}+safety ${safety} [trend ${trendLabel}]`
        : `forecast ${Math.ceil(forecast)} (7d:${A} 30d:${M} trend:${trendLabel}) +safety ${safety} -scorta ${B}`;
    }

    decisions.push({
      flavor: f,
      stock: B,
      sold7d: A,
      sold30d: M,
      hist: H,
      dailyRate: blended.toFixed(2),
      trend: trendLabel,
      target: M > 0 || A > 0 ? Math.ceil(blended * 7) + Math.max(1, Math.ceil(blended * 2)) : 0,
      order,
      reason,
    });
  }
  return decisions.sort((a, b) => b.order - a.order || b.sold7d - a.sold7d);
}

// ─── Excel + PDF ────────────────────────────────────────────────────────────
export function fillTemplate(orderMap, varieMap = {}) {
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
      const qty = orderMap[key] ?? varieMap[key];
      ws[oc] = qty > 0 ? { t: 'n', v: qty } : { t: 's', v: '' };
    }
  }
  const p = path.join(OUTPUT_DIR, 'shocapp_template_filled.xlsx');
  XLSX.writeFile(wb, p);
  return p;
}

function saveDecisionsExcel(decisions) {
  const headers = ['Gusto', 'Scorta', 'Venduti 7gg', 'Venduti 30gg', 'Venduti storici', 'Rate/giorno (blend)', 'Trend', 'Target', 'Da Ordinare', 'Motivo'];
  const rows = decisions.map(d => [d.flavor, d.stock, d.sold7d, d.sold30d, d.hist, d.dailyRate, d.trend, d.target, d.order, d.reason]);
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

    // Debug: log environment setup
    logger.info(`🚀 Estrazione avviata`);
    logger.info(`   User: ${process.env.GELATERIA_USER || '⚠️ non impostato'}`);
    logger.info(`   Shop ID: ${process.env.SHOP_ID || '⚠️ non impostato'}`);
    logger.info(`   Sync URL: ${process.env.SYNC_URL ? '✓' : '⚠️ non impostato'}`);
    logger.info(`   JWT Secret: ${process.env.JWT_SECRET ? '✓' : '⚠️ non impostato'}`);

    // Use system Chromium on Linux servers (VPS), download on Windows/Mac dev
    const execPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    logger.info(`🌐 Avvio browser (headless mode)...`);
    browser = await chromium.launch({
      headless: true,
      ...(execPath ? { executablePath: execPath } : {}),
    });
    const page = await browser.newPage();

    logger.info(`📝 Login...`);
    await login(page);
    logger.info(`✓ Login riuscito`);
    logger.info(`📋 Apertura SHOCAPP...`);
    await openShocapp(page);
    logger.info(`✓ SHOCAPP aperto`);

    // Make sure we're in Sintesi mode (one row per flavor, aggregated)
    logger.info(`🎯 Impostazione modalità Sintesi...`);
    if (!await pickDropdown(page, 'SelTabella', 'Sintesi'))
      throw new Error('Impossibile impostare modalità Sintesi');
    logger.info(`✓ Sintesi mode impostato`);

    // Helper: enforce Sintesi mode + set max page size before each read.
    // clickCerca() reloads the table and resets SelTabella to Dettaglio each time,
    // so we must re-set it before every readTable call.
    async function ensureSintesi() {
      if (!await pickDropdown(page, 'SelTabella', 'Sintesi'))
        logger.warn('  ⚠️ SelTabella Sintesi non riuscito — conteggi potrebbero essere errati');
      await setTablePageSize(page);
    }

    // ── 1. Filter to Mantenimento + Tutto il periodo ──
    logger.info('▸ Mantenimento, tutto il periodo (Sintesi)');
    if (!await pickDropdown(page, 'SelStatus', 'Mantenimento'))
      throw new Error('Filtro Stato=Mantenimento fallito');
    if (!await pickDropdown(page, 'SelData', 'Tutto il periodo'))
      throw new Error('Filtro Data=Tutto il periodo fallito');
    await clickCerca(page);
    await ensureSintesi();
    const _stockResult = await readTable(page, 'Mantenimento');
    if (_stockResult.vasIdxFallback)
      logger.warn(`  ⚠️ VASCHE header not found in Mantenimento table (headers: ${_stockResult.headers.join('|')}); using fallback column ${_stockResult.vasIdxUsed}`);
    const stockRows = _stockResult.rows;
    logger.info(`  ${stockRows.length} righe, totalQty=${stockRows.reduce((s,r)=>s+r.qty,0)}`);
    // Log unique stato values seen so we can verify filter is working
    logger.info(`  Stato valori: ${[...new Set(stockRows.map(r=>r.stato))].join(', ')}`);
    let prevSummary = await getPesoSummary(page);
    logger.info(`  Peso summary: ${prevSummary.slice(0,70)}`);

    // ── 2. Esaurito + Ultimi 7 giorni ──
    logger.info('▸ Esaurito, ultimi 7 giorni (Sintesi)');
    if (!await pickDropdown(page, 'SelStatus', 'Esaurito'))
      throw new Error('Filtro Stato=Esaurito fallito');
    if (!await pickDropdown(page, 'SelData', 'Ultimi 7 giorni'))
      throw new Error('Filtro Data=Ultimi 7 giorni fallito');
    await clickCerca(page, prevSummary);
    await ensureSintesi();
    const _sold7dResult = await readTable(page, 'Esaurito_7gg');
    if (_sold7dResult.vasIdxFallback)
      logger.warn(`  ⚠️ VASCHE header not found in Esaurito_7gg table; using fallback column ${_sold7dResult.vasIdxUsed}`);
    const sold7dRows = _sold7dResult.rows;
    logger.info(`  ${sold7dRows.length} righe, totalQty=${sold7dRows.reduce((s,r)=>s+r.qty,0)}`);
    logger.info(`  Stato valori: ${[...new Set(sold7dRows.map(r=>r.stato))].join(', ')}`);
    prevSummary = await getPesoSummary(page);
    logger.info(`  Peso summary: ${prevSummary.slice(0,70)}`);

    // ── 3. Esaurito + Ultimi 30 giorni ──
    logger.info('▸ Esaurito, ultimi 30 giorni (Sintesi)');
    if (!await pickDropdown(page, 'SelData', 'Ultimi 30 giorni'))
      throw new Error('Filtro Data=Ultimi 30 giorni fallito');
    await clickCerca(page, prevSummary);
    await ensureSintesi();
    const _sold30dResult = await readTable(page, 'Esaurito_30gg');
    if (_sold30dResult.vasIdxFallback)
      logger.warn(`  ⚠️ VASCHE header not found in Esaurito_30gg table; using fallback column ${_sold30dResult.vasIdxUsed}`);
    const sold30dRows = _sold30dResult.rows;
    logger.info(`  ${sold30dRows.length} righe, totalQty=${sold30dRows.reduce((s,r)=>s+r.qty,0)}`);
    logger.info(`  Stato valori: ${[...new Set(sold30dRows.map(r=>r.stato))].join(', ')}`);
    prevSummary = await getPesoSummary(page);

    // ── 4. Esaurito + Tutto il periodo ──
    logger.info('▸ Esaurito, tutto il periodo (Sintesi)');
    if (!await pickDropdown(page, 'SelData', 'Tutto il periodo'))
      throw new Error('Filtro Data=Tutto il periodo (storico) fallito');
    await clickCerca(page, prevSummary);
    await ensureSintesi();
    const _histResult = await readTable(page, 'Esaurito_storico');
    if (_histResult.vasIdxFallback)
      logger.warn(`  ⚠️ VASCHE header not found in Esaurito_storico table; using fallback column ${_histResult.vasIdxUsed}`);
    const histRows = _histResult.rows;
    logger.info(`  ${histRows.length} righe, totalQty=${histRows.reduce((s,r)=>s+r.qty,0)}`);
    logger.info(`  Stato valori: ${[...new Set(histRows.map(r=>r.stato))].join(', ')}`);

    await browser.close(); browser = null;

    // ── Sanity check — ABORT if the filters obviously did nothing ──
    const sig = arr => arr.map(r => `${r.flavor}:${r.qty}`).sort().join('|');
    if (sig(stockRows) === sig(sold7dRows)) {
      throw new Error(
        'Filtro Stato non funziona: Mantenimento e Esaurito hanno restituito gli stessi dati. ' +
        'Controlla output/debug_*.html. Riprova tra qualche secondo.'
      );
    }
    if (sig(sold7dRows) === sig(histRows)) {
      logger.warn('⚠️  Sold7d === Hist — il filtro Periodo non ha funzionato!');
    }

    // ── Aggregate raw counts (before name mapping) ──
    // Note: in Sintesi mode the server-side filter (SelStatus) already restricts
    // rows to the selected stato, so filterByStato() is not needed. However we
    // log the stato distribution above so any leakage is visible in the logs.
    const stockAgg   = aggregate(stockRows);
    const sold7dAgg  = aggregate(sold7dRows);
    const sold30dAgg = aggregate(sold30dRows);
    const histAgg    = aggregate(histRows);

    logger.info(`Aggregati: stock=${stockAgg.length}, sold7d=${sold7dAgg.length}, sold30d=${sold30dAgg.length}, hist=${histAgg.length} gusti`);

    // ── Map to template names ──
    const set     = loadTemplateNames();
    const stock   = aggregateAndMap(stockRows,   set);
    const sold7d  = aggregateAndMap(sold7dRows,  set);
    const sold30d = aggregateAndMap(sold30dRows, set);
    const hist    = aggregateAndMap(histRows,    set);

    saveRaw(stock,   'shocapp_mantenimento.xlsx',      'Mantenimento');
    saveRaw(sold7d,  'shocapp_esaurito_7gg.xlsx',      'Esaurito 7gg');
    saveRaw(sold30d, 'shocapp_esaurito_30gg.xlsx',     'Esaurito 30gg');
    saveRaw(hist,    'shocapp_esaurito_storico.xlsx',  'Storico');

    const decisions = decideOrders({ stock, sold7d, sold30d, hist });
    saveDecisionsExcel(decisions);

    const orderMap = {};
    for (const d of decisions) if (d.order > 0) orderMap[d.flavor] = d.order;

    const filledPath = fillTemplate(orderMap);
    const pdfPath    = await generateOrderPdf(filledPath);

    // ── Verify: every order in orderMap should map to a template row ──
    const templateNames = loadTemplateNames();
    const missingFromTemplate = [];
    for (const [name, qty] of Object.entries(orderMap)) {
      if (qty > 0 && !templateNames.has(name)) missingFromTemplate.push(`${name}=${qty}`);
    }
    if (missingFromTemplate.length) {
      logger.warn(`⚠️ ${missingFromTemplate.length} ordini NON appariranno nel PDF (nome non trovato nel template):`);
      for (const m of missingFromTemplate) logger.warn(`    ${m}`);
    }

    const ordered = decisions.filter(d => d.order > 0);
    const total   = ordered.reduce((s, d) => s + d.order, 0);
    const totalInPdf = ordered.filter(d => templateNames.has(d.flavor)).reduce((s, d) => s + d.order, 0);
    const dt      = ((Date.now() - t0) / 1000).toFixed(1);

    logger.info(`✓ ${ordered.length} gusti, ${total} vaschette calcolate, ${totalInPdf} mostrate nel PDF (in ${dt}s)`);
    logger.info('Top decisioni:');
    for (const d of ordered.slice(0, 12)) {
      logger.info(`  ${d.flavor.padEnd(28)} stock=${d.stock} 7d=${d.sold7d} 30d=${d.sold30d} trend=${d.trend} → ${d.order}  (${d.reason})`);
    }

    // ── Build kpis (before generating insights so we can pass them along) ──────
    // Note: totalStock sums from raw stock map (all flavors), not just decisions
    // because decisions excludes zero-stock flavors, but we still want to count
    // any stock from flavors with no recent sales
    // aggregateAndMap() returns m[flavor] = qty (number), so we sum the raw values
    const totalStockVal = Object.values(stock).reduce((s, qty) => s + qty, 0);
    const kpis = {
      totalStock:   totalStockVal,
      totalSold7d:  decisions.reduce((s, d) => s + d.sold7d, 0),
      totalSold30d: decisions.reduce((s, d) => s + d.sold30d,0),
      totalOrder:   ordered.reduce((s, d) => s + d.order, 0),
      activeCount:  decisions.filter(d => d.sold30d > 0).length,
      outOfStock:   decisions.filter(d => d.stock === 0 && d.sold7d > 0).length,
      needOrder:    ordered.length,
      flavorCount:  decisions.length,
    };

    // ── Generate insights dashboard ──
    let insightsPath, insightsHtml = null;
    try {
      insightsPath = await generateInsights(kpis);  // Pass kpis so HTML shows correct totals
      insightsHtml = fs.readFileSync(insightsPath, 'utf8');
      logger.info(`✓ Insights: ${insightsPath}`);
    } catch (e) {
      logger.warn(`Insights non generati: ${e.message}`);
    }

    // ── Push results to cloud server (if SYNC_URL is set in .env) ─────────────
    // This makes the data available to the mobile app on any network, for free.
    if (process.env.SYNC_URL && process.env.JWT_SECRET) {
      try {
        const pdfBase64  = fs.existsSync(pdfPath)      ? fs.readFileSync(pdfPath).toString('base64')      : null;
        const xlsxBase64 = fs.existsSync(filledPath)   ? fs.readFileSync(filledPath).toString('base64')  : null;

        // shopId must match the shop registered on the server (set via SHOP_ID env in GitHub Actions)
        const shopId = process.env.SHOP_ID || process.env.GELATERIA_USER;
        const token = jwt.sign({ user: process.env.GELATERIA_USER, shopId }, process.env.JWT_SECRET, { expiresIn: '1h' });

        const syncRes = await fetch(`${process.env.SYNC_URL}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ kpis, data: decisions, pdfBase64, xlsxBase64, insightsHtml }),
        });

        if (syncRes.ok) logger.info(`✓ Dati sincronizzati con il server cloud (${process.env.SYNC_URL})`);
        else logger.warn(`⚠️ Sync fallita: ${syncRes.status} ${await syncRes.text()}`);
      } catch (e) {
        logger.warn(`⚠️ Sync cloud fallita: ${e.message}`);
      }
    }

    return { filledPath, pdfPath, insightsPath, decisions, orderMap };
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
