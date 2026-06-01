/**
 * diagnose3.js
 * Inspect the actual JS handlers on the dropdown options.
 * The goal: find what function we need to call to trigger a filter change.
 *
 * Run with:  node src/diagnose3.js
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const OUT       = path.join(ROOT, 'output');
fs.mkdirSync(OUT, { recursive: true });

const BASE  = 'https://gelateriafatamorgana.com/fata/tracking-manager/html';
const LOGIN = `${BASE}/login.php`;

const lines = [];
const log = (...a) => { const s = a.join(' '); console.log(s); lines.push(s); };

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage();

  // Log every network request to catch AJAX calls
  page.on('request', req => {
    if (req.url().includes('.php') && req.method() === 'POST') {
      log(`▶ POST ${req.url()}`);
      const post = req.postData();
      if (post) log(`   body: ${post.slice(0, 300)}`);
    }
  });
  page.on('response', resp => {
    if (resp.url().includes('.php') && resp.request().method() === 'POST') {
      log(`◀ ${resp.status()} ${resp.url()}`);
    }
  });

  log('▶ Login');
  await page.goto(LOGIN, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="username"]', process.env.GELATERIA_USER);
  await page.fill('input[name="password"]', process.env.GELATERIA_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('button[type="submit"]'),
  ]);

  log('▶ Open SHOCAPP');
  await page.click('a:has-text("SHOCAPP")');
  await page.waitForSelector('table', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // ─── INSPECT THE SelStatus DROPDOWN AND ITS OPTIONS ───────────────────────
  log('\n▶ Inspecting SelStatus dropdown structure');
  const info = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button[data-toggle="dropdown"]'))
      .find(b => b.dataset?.id === 'SelStatus');
    if (!btn) return { error: 'SelStatus button not found' };

    const result = {
      buttonHTML: btn.outerHTML.slice(0, 500),
      buttonOnclick: btn.onclick ? btn.onclick.toString() : null,
      buttonAttrs: {},
    };
    for (const a of btn.attributes) result.buttonAttrs[a.name] = a.value;

    // Find the menu
    let menu = btn.parentElement?.querySelector('.dropdown-menu');
    if (!menu) {
      menu = btn.nextElementSibling;
      while (menu && !menu.classList.contains('dropdown-menu')) menu = menu.nextElementSibling;
    }
    if (!menu) return { ...result, menuError: 'menu not found' };

    result.menuHTML = menu.outerHTML.slice(0, 2000);
    result.options = Array.from(menu.querySelectorAll('a, li')).slice(0, 12).map(o => ({
      tag: o.tagName,
      text: (o.textContent || '').trim(),
      onclick: o.getAttribute('onclick'),
      href: o.getAttribute('href'),
      dataAttrs: Object.assign({}, o.dataset),
      className: o.className,
    }));

    // Globals that might be the function we need
    result.windowFunctions = Object.keys(window).filter(k =>
      /sel|filt|status|setStat|setData|cerca|search/i.test(k) &&
      typeof window[k] === 'function'
    );

    return result;
  });

  log('Button HTML:    ' + (info.buttonHTML || ''));
  log('Button attrs:   ' + JSON.stringify(info.buttonAttrs));
  log('Button onclick: ' + (info.buttonOnclick || '(none)'));
  log('');
  log('Menu HTML (first 2000 chars):');
  log(info.menuHTML || '(none)');
  log('');
  log('Options:');
  for (const o of info.options || []) {
    log(`  <${o.tag}> "${o.text}"`);
    if (o.onclick) log(`     onclick: ${o.onclick}`);
    if (o.href)    log(`     href:    ${o.href}`);
    if (Object.keys(o.dataAttrs).length) log(`     data:    ${JSON.stringify(o.dataAttrs)}`);
    log(`     class:   ${o.className}`);
  }
  log('');
  log('Window functions matching filter/status: ' + JSON.stringify(info.windowFunctions));

  // ─── NOW SIMULATE A REAL USER CLICK AND SEE WHAT NETWORK REQUEST FIRES ──
  log('\n▶ Now: actually click "Esaurito" via mouse and watch network');
  // Open dropdown
  await page.click('button[data-toggle="dropdown"]', { force: true });
  // Try to click on SelStatus specifically
  const trig = page.locator('button[data-toggle="dropdown"]').filter({ hasText: 'Mantenimento' });
  if (await trig.count()) await trig.first().click();
  await page.waitForTimeout(500);
  // Now find and click "Esaurito" option
  const esauOpt = page.locator('.dropdown-menu a:has-text("Esaurito"), .dropdown-menu li:has-text("Esaurito")').first();
  if (await esauOpt.count()) {
    log('  Clicking Esaurito option via Playwright .click()');
    await esauOpt.click();
  } else {
    log('  ⚠️  Esaurito option not visible');
  }
  await page.waitForTimeout(2000);

  // Now check what the button shows
  const newBtnText = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button[data-toggle="dropdown"]'))
      .find(x => x.dataset?.id === 'SelStatus');
    return (b?.textContent || '').trim();
  });
  log(`  Button text after click: "${newBtnText}"`);

  // Click Cerca and see what happens
  log('\n▶ Click Cerca and watch network');
  const cerca = page.locator('a:has-text("Cerca")').first();
  if (await cerca.count()) await cerca.click();
  await page.waitForTimeout(3000);

  // What does the table show now?
  const tableSample = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    let best = null, bm = 0;
    for (const t of tables) {
      const c = t.querySelectorAll('tbody tr').length;
      if (c > bm) { bm = c; best = t; }
    }
    if (!best) return [];
    return Array.from(best.querySelectorAll('tbody tr')).slice(0, 6).map(tr =>
      Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim())
    );
  });
  log('Top 6 rows after Cerca:');
  for (const r of tableSample) log(`  ${JSON.stringify(r)}`);

  fs.writeFileSync(path.join(OUT, 'diagnose3_report.txt'), lines.join('\n'));
  log('\nSaved: output/diagnose3_report.txt');
  await browser.close();
})();
