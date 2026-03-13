import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto('https://www.gelateriafatamorgana.com/fata/tracking-manager/html/login.php', { waitUntil: 'networkidle' });
await page.fill('input[name="username"]', process.env.GELATERIA_USER);
await page.fill('input[name="password"]', process.env.GELATERIA_PASS);
await page.click('button[type="submit"]');
await page.waitForURL('**/index.php**', { timeout: 15000 });

// Navigate to SHOCAPP (sets session)
await page.evaluate(() => page_reload('shocapp'));
await page.waitForTimeout(5000);

// Build the exact URL from the user's manual browser request
// with SelStatus=3 (Esaurito) and SelData=2 (Ultimi 7 giorni)
const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

// Test 1: Direct AJAX with SelStatus=3 (Esaurito) — EXACTLY like user's browser
console.log('=== TEST 1: Direct AJAX SelStatus=3 SelData=2 (no fridge) ===');
const html1 = await page.evaluate((d) => {
  return new Promise((resolve, reject) => {
    $.ajax({
      type: 'POST',
      url: '../lib/tbl_shocapp.php?l=1&sel_frigo=&page_param=shocapp&h_causale=&h_negozi='
        + '&Selperiodo=1&SelData=2&SelStatus=3&SelTabella=1&SelFamiglia=&cercaStringa=&q='
        + '&searchrow=&searchcol=&datatable1_length=100'
        + '&date1=' + encodeURIComponent(d) + '&date2=' + encodeURIComponent(d)
        + '&shop=&sStatus=3&sCausale=&m=100&p=1&o_by=&o_mode=asc&lng=1&lid=31&usr=' + encodeURIComponent(process.env.GELATERIA_USER ?? ''),
      success: (response) => resolve(response),
      error: (xhr, status, err) => reject(status + ': ' + err)
    });
  });
}, now);
console.log('Response length:', html1.length, 'bytes');
console.log('First 1500 chars:', html1.substring(0, 1500));

// Count status values in response
const statuses1 = {};
const re1 = />(Mantenimento|In Vendita|Esaurito|Da Abbinare|Distrutto|Rabbocco|Venduto|Arrivato in negozio|Reparto Dolci)</g;
let m1;
while ((m1 = re1.exec(html1)) !== null) statuses1[m1[1]] = (statuses1[m1[1]] || 0) + 1;
console.log('Status counts:', statuses1);

// Test 2: Direct AJAX with SelStatus=1 (Mantenimento) for comparison
console.log('\n=== TEST 2: Direct AJAX SelStatus=1 SelData=6 (no fridge) ===');
const html2 = await page.evaluate((d) => {
  return new Promise((resolve, reject) => {
    $.ajax({
      type: 'POST',
      url: '../lib/tbl_shocapp.php?l=1&sel_frigo=&page_param=shocapp&h_causale=&h_negozi='
        + '&Selperiodo=1&SelData=6&SelStatus=1&SelTabella=1&SelFamiglia=&cercaStringa=&q='
        + '&searchrow=&searchcol=&datatable1_length=100'
        + '&date1=' + encodeURIComponent(d) + '&date2=' + encodeURIComponent(d)
        + '&shop=&sStatus=1&sCausale=&m=100&p=1&o_by=&o_mode=asc&lng=1&lid=31&usr=' + encodeURIComponent(process.env.GELATERIA_USER ?? ''),
      success: (response) => resolve(response),
      error: (xhr, status, err) => reject(status + ': ' + err)
    });
  });
}, now);
console.log('Response length:', html2.length, 'bytes');

const statuses2 = {};
const re2 = />(Mantenimento|In Vendita|Esaurito|Da Abbinare|Distrutto|Rabbocco|Venduto|Arrivato in negozio|Reparto Dolci)</g;
let m2;
while ((m2 = re2.exec(html2)) !== null) statuses2[m2[1]] = (statuses2[m2[1]] || 0) + 1;
console.log('Status counts:', statuses2);

// Test 3: WITH fridge sel_frigo=2_1 + SelStatus=3
console.log('\n=== TEST 3: Direct AJAX SelStatus=3 SelData=2 sel_frigo=2_1 ===');
const html3 = await page.evaluate((d) => {
  return new Promise((resolve, reject) => {
    $.ajax({
      type: 'POST',
      url: '../lib/tbl_shocapp.php?l=1&sel_frigo=2_1&page_param=shocapp&h_causale=&h_negozi='
        + '&Selperiodo=1&SelData=2&SelStatus=3&SelTabella=1&SelFamiglia=&cercaStringa=&q='
        + '&searchrow=&searchcol=&datatable1_length=100'
        + '&date1=' + encodeURIComponent(d) + '&date2=' + encodeURIComponent(d)
        + '&shop=&sStatus=3&sCausale=&m=100&p=1&o_by=&o_mode=asc&lng=1&lid=31&usr=' + encodeURIComponent(process.env.GELATERIA_USER ?? ''),
      success: (response) => resolve(response),
      error: (xhr, status, err) => reject(status + ': ' + err)
    });
  });
}, now);
console.log('Response length:', html3.length, 'bytes');

const statuses3 = {};
const re3 = />(Mantenimento|In Vendita|Esaurito|Da Abbinare|Distrutto|Rabbocco|Venduto|Arrivato in negozio|Reparto Dolci)</g;
let m3;
while ((m3 = re3.exec(html3)) !== null) statuses3[m3[1]] = (statuses3[m3[1]] || 0) + 1;
console.log('Status counts:', statuses3);

await browser.close();
