/**
 * diagnose.js
 * Stop guessing. Logs in, opens SHOCAPP, then:
 *   1. Lists EVERY button on the page (text + classes + data-attrs)
 *   2. Lists EVERY dropdown menu and its options
 *   3. Reports which row counts are returned for each manual filter combo
 *
 * Run with:  node src/diagnose.js
 * Output appears in the terminal AND in output/diagnose_report.txt
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.join(__dirname, '..');
const OUT_DIR    = path.join(ROOT, 'output');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE  = 'https://gelateriafatamorgana.com/fata/tracking-manager/html';
const LOGIN = `${BASE}/login.php`;

const lines = [];
const log = (...args) => {
  const line = args.join(' ');
  console.log(line);
  lines.push(line);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  log('▶ Login…');
  await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.fill('input[name="username"]', process.env.GELATERIA_USER);
  await page.fill('input[name="password"]', process.env.GELATERIA_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    page.click('button[type="submit"], input[type="submit"]'),
  ]);
  log('  URL:', page.url());

  log('\n▶ Apri SHOCAPP - Lista Vaschette');
  const link = page.locator('a:has-text("SHOCAPP")').first();
  if (await link.count()) await link.click();
  await page.waitForSelector('table', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // ─── DUMP ALL BUTTONS ────────────────────────────────────────────────────
  log('\n▶ TUTTI I PULSANTI VISIBILI:');
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a.btn, .btn'))
      .filter(el => el.offsetParent !== null)
      .map(el => ({
        tag:        el.tagName,
        text:       (el.textContent || '').trim().slice(0, 60),
        className:  el.className,
        dataset:    Object.assign({}, el.dataset),
        id:         el.id,
      }));
  });
  buttons.forEach((b, i) => {
    log(`  [${i}] <${b.tag}> "${b.text}" class="${b.className}" data=${JSON.stringify(b.dataset)} id="${b.id}"`);
  });

  // ─── DUMP DROPDOWN MENUS ─────────────────────────────────────────────────
  log('\n▶ DROPDOWN MENUS E LORO OPZIONI:');
  const dropdowns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.dropdown-menu, ul[role="menu"]'))
      .map(menu => ({
        parent_text: (menu.parentElement?.querySelector('button')?.textContent || '').trim().slice(0, 50),
        options:     Array.from(menu.querySelectorAll('a, li, button'))
                       .map(o => (o.textContent || '').trim())
                       .filter(t => t.length > 0 && t.length < 80),
      }));
  });
  dropdowns.forEach((d, i) => {
    log(`  Menu ${i} (parent button: "${d.parent_text}"):`);
    d.options.forEach(o => log(`    - ${o}`));
  });

  // ─── COUNT INITIAL ROWS ──────────────────────────────────────────────────
  const countRows = async (label) => {
    const cnt = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let max = 0;
      for (const t of tables) {
        const c = t.querySelectorAll('tbody tr, tr').length;
        if (c > max) max = c;
      }
      return max;
    });
    const headerCells = await page.locator('thead th, thead td').allTextContents();
    log(`  ${label}: ${cnt} righe — headers: [${headerCells.map(s => s.trim()).join(' | ')}]`);

    // Save first 8 rows of data
    const sample = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let best = null, bm = 0;
      for (const t of tables) {
        const c = t.querySelectorAll('tbody tr').length;
        if (c > bm) { bm = c; best = t; }
      }
      if (!best) return [];
      const rows = Array.from(best.querySelectorAll('tbody tr')).slice(0, 8);
      return rows.map(tr =>
        Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim())
      );
    });
    log('    primi 8 righe:');
    sample.forEach((r, i) => log(`      ${i}: ${JSON.stringify(r)}`));
  };

  log('\n▶ STATO INIZIALE DELLA TABELLA:');
  await countRows('init');

  // ─── TRY EACH FILTER COMBO MANUALLY ─────────────────────────────────────
  log('\n▶ Test combinazioni filtri:');

  const tryCombo = async (statusBtn, statusOpt, periodBtn, periodOpt) => {
    log(`\n  → Cliccando "${statusBtn}" → "${statusOpt}"`);
    const sb = page.locator(`button:has-text("${statusBtn}")`).first();
    if (await sb.count()) {
      await sb.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      const so = page.locator(`a:has-text("${statusOpt}"):visible, li:has-text("${statusOpt}"):visible`).last();
      if (await so.count()) {
        await so.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
      } else {
        log(`    ⚠️  Opzione "${statusOpt}" non trovata`);
      }
    } else {
      log(`    ⚠️  Pulsante "${statusBtn}" non trovato`);
    }

    log(`  → Cliccando "${periodBtn}" → "${periodOpt}"`);
    const pb = page.locator(`button:has-text("${periodBtn}")`).first();
    if (await pb.count()) {
      await pb.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      const po = page.locator(`a:has-text("${periodOpt}"):visible, li:has-text("${periodOpt}"):visible`).last();
      if (await po.count()) {
        await po.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
      } else {
        log(`    ⚠️  Opzione "${periodOpt}" non trovata`);
      }
    }

    // Cerca
    log('  → Click Cerca');
    const cerca = page.locator('button:has-text("Cerca"), button:has-text("CERCA"), .btn:has-text("Cerca")').first();
    if (await cerca.count()) {
      await cerca.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(2500);
    } else {
      log('    ⚠️  Pulsante Cerca non trovato');
    }

    await countRows(`${statusOpt}/${periodOpt}`);
  };

  await tryCombo('Mantenimento', 'Mantenimento', 'Tutto il periodo', 'Tutto il periodo');
  await tryCombo('Mantenimento', 'Esaurito',     'Tutto il periodo', 'Ultimi 7 giorni');
  await tryCombo('Esaurito',     'Esaurito',     'Ultimi 7 giorni',  'Tutto il periodo');

  // ─── SAVE ───
  fs.writeFileSync(path.join(OUT_DIR, 'diagnose_report.txt'), lines.join('\n'));
  await page.screenshot({ path: path.join(OUT_DIR, 'diagnose_final.png'), fullPage: true });

  log('\n✓ Salvato output/diagnose_report.txt e output/diagnose_final.png');
  await browser.close();
})();
