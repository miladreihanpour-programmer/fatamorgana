/**
 * diagnose2.js
 * Deep diagnostic to find why we're reading only ~17 of ~160 Esaurito vasche.
 *
 * Checks:
 *   1. Is there pagination? How many total rows across all pages?
 *   2. Does Sintesi mode show different (aggregated) data than Dettaglio?
 *   3. What's the page-size dropdown set to? What options exist?
 *   4. Does each filter combo actually return different row counts?
 *   5. For each combo, save FULL csv of what we see vs what's actually visible
 *
 * Run with:  node src/diagnose2.js
 * Reports in: output/diag/
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.join(__dirname, '..');
const DIAG_DIR   = path.join(ROOT, 'output', 'diag');
fs.mkdirSync(DIAG_DIR, { recursive: true });

const BASE  = 'https://gelateriafatamorgana.com/fata/tracking-manager/html';
const LOGIN = `${BASE}/login.php`;

const lines = [];
const log = (...args) => { const s = args.join(' '); console.log(s); lines.push(s); };

async function pickDropdown(page, triggerId, optionText) {
  const triggers = page.locator('button[data-toggle="dropdown"]');
  const idx = await triggers.evaluateAll((els, id) =>
    els.findIndex(el => el.dataset?.id === id), triggerId);
  if (idx < 0) { log(`  ⚠️ trigger ${triggerId} not found`); return false; }
  await triggers.nth(idx).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const opt = page.locator(`.dropdown-menu a:has-text("${optionText}"):visible, ul.dropdown-menu li:has-text("${optionText}"):visible`).first();
  if (!(await opt.count())) { log(`  ⚠️ option "${optionText}" not found`); return false; }
  await opt.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  return true;
}

async function clickCerca(page) {
  const cerca = page.locator('a.btn-support3:has-text("Cerca"), a:has-text("Cerca"):visible').first();
  if (await cerca.count()) {
    await cerca.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
}

async function inspectTable(page, label) {
  await page.waitForTimeout(500);

  // Full HTML
  fs.writeFileSync(path.join(DIAG_DIR, `${label}.html`), await page.content());
  await page.screenshot({ path: path.join(DIAG_DIR, `${label}.png`), fullPage: true });

  const info = await page.evaluate(() => {
    const result = { tables: [], pageSize: null, pageSizeOptions: [], paginationInfo: null };

    // Page size dropdown info
    const sel = document.querySelector('select');
    if (sel) {
      result.pageSize = sel.value;
      result.pageSizeOptions = Array.from(sel.options).map(o => o.value);
    }

    // Pagination text (DataTables-like)
    const paginate = document.querySelector('.dataTables_info, .pagination, [class*="paginat"]');
    if (paginate) result.paginationInfo = paginate.textContent.trim();

    // ALL tables on page
    const tables = Array.from(document.querySelectorAll('table'));
    for (const t of tables) {
      const thead = t.querySelector('thead')?.textContent?.trim() || '';
      if (!thead.toUpperCase().includes('GUSTO')) continue;

      const headerCells = Array.from(t.querySelectorAll('thead th, thead td'))
        .map(h => (h.textContent || '').trim());

      const rows = Array.from(t.querySelectorAll('tbody tr')).map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim())
      );

      result.tables.push({ headers: headerCells, rows });
    }
    return result;
  });

  log(`\n══ ${label} ══`);
  log(`  Page-size dropdown: value=${info.pageSize}  options=[${info.pageSizeOptions.join(',')}]`);
  log(`  Pagination text:    ${info.paginationInfo || '(none)'}`);
  log(`  Tables matching Gusto: ${info.tables.length}`);

  for (let i = 0; i < info.tables.length; i++) {
    const t = info.tables[i];
    log(`\n  Table #${i}: ${t.rows.length} rows`);
    log(`    Headers: [${t.headers.join(' | ')}]`);

    // Find Gusto + N. Vasche column indexes
    const gustoIdx = t.headers.findIndex(h => h.toUpperCase().includes('GUSTO'));
    const vasIdx   = t.headers.findIndex(h => h.toUpperCase().includes('VASCHE'));
    const statoIdx = t.headers.findIndex(h => h.toUpperCase().includes('STATO'));
    log(`    gustoIdx=${gustoIdx} vasIdx=${vasIdx} statoIdx=${statoIdx}`);

    // Count rows per stato
    const statoCounts = {};
    let totalVasche = 0;
    for (const r of t.rows) {
      const s = statoIdx >= 0 ? (r[statoIdx] || '') : '';
      statoCounts[s] = (statoCounts[s] || 0) + 1;
      const qty = parseInt((r[vasIdx >= 0 ? vasIdx : 4] || '').replace(/[^0-9]/g, ''));
      if (!isNaN(qty)) totalVasche += qty;
    }
    log(`    Rows per Stato: ${JSON.stringify(statoCounts)}`);
    log(`    Sum of N. Vasche column: ${totalVasche}`);

    // Save full CSV
    const csv = [t.headers.join(','), ...t.rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
    fs.writeFileSync(path.join(DIAG_DIR, `${label}_table${i}.csv`), csv);
  }

  return info;
}

(async () => {
  log(`Diagnostic v2  —  ${new Date().toISOString()}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Login
  log('▶ Login');
  await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.fill('input[name="username"]', process.env.GELATERIA_USER);
  await page.fill('input[name="password"]', process.env.GELATERIA_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);

  // SHOCAPP
  log('▶ Open SHOCAPP');
  const link = page.locator('a:has-text("SHOCAPP")').first();
  if (await link.count()) await link.click();
  await page.waitForSelector('table', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Try to maximize page size
  const sel = page.locator('select').first();
  if (await sel.count()) {
    const opts = await sel.locator('option').allTextContents();
    log(`▶ Page-size options found: ${opts.join(', ')}`);
    const numericOpts = opts.map(o => parseInt(o)).filter(n => !isNaN(n)).sort((a, b) => b - a);
    if (numericOpts.length) {
      await sel.selectOption(String(numericOpts[0])).catch(() => {});
      await page.waitForTimeout(500);
      log(`  set to ${numericOpts[0]}`);
    }
  }

  // INITIAL STATE
  await inspectTable(page, '00_initial');

  // ── Mantenimento + Tutto il periodo ──
  log('\n▶ Setting Mantenimento + Tutto il periodo + Sintesi');
  await pickDropdown(page, 'SelStatus',  'Mantenimento');
  await pickDropdown(page, 'SelData',    'Tutto il periodo');
  await pickDropdown(page, 'SelTabella', 'Sintesi');
  await clickCerca(page);
  await inspectTable(page, '01_mantenimento_sintesi');

  // Same but Dettaglio
  log('\n▶ Same filters but Dettaglio mode');
  await pickDropdown(page, 'SelTabella', 'Dettaglio');
  await clickCerca(page);
  await inspectTable(page, '02_mantenimento_dettaglio');

  // ── Esaurito + Ultimi 7 giorni, Sintesi ──
  log('\n▶ Esaurito + Ultimi 7 giorni + Sintesi');
  await pickDropdown(page, 'SelStatus',  'Esaurito');
  await pickDropdown(page, 'SelData',    'Ultimi 7 giorni');
  await pickDropdown(page, 'SelTabella', 'Sintesi');
  await clickCerca(page);
  await inspectTable(page, '03_esaurito_7gg_sintesi');

  // ── Esaurito + Ultimi 7 giorni, Dettaglio ──
  log('\n▶ Esaurito + Ultimi 7 giorni + Dettaglio');
  await pickDropdown(page, 'SelTabella', 'Dettaglio');
  await clickCerca(page);
  await inspectTable(page, '04_esaurito_7gg_dettaglio');

  // ── Venduto + Ultimi 7 giorni (in case Esaurito is wrong) ──
  log('\n▶ Venduto + Ultimi 7 giorni + Sintesi  (alt status)');
  await pickDropdown(page, 'SelStatus',  'Venduto');
  await pickDropdown(page, 'SelTabella', 'Sintesi');
  await clickCerca(page);
  await inspectTable(page, '05_venduto_7gg_sintesi');

  // Save report
  fs.writeFileSync(path.join(DIAG_DIR, 'report.txt'), lines.join('\n'));
  log(`\n✓ All output saved to: ${DIAG_DIR}`);
  await browser.close();
})();
