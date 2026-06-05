/**
 * generateInsights.js
 * Reads the scraped xlsx files and produces output/insights.html —
 * a self-contained dashboard with KPIs, charts and tables.
 *
 * Run standalone:   node src/generateInsights.js
 * Called by:        runExtraction() in shocappExtractor.js (auto after every extraction)
 */

import XLSX from 'xlsx';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.join(__dirname, '..');
const OUTPUT_DIR    = path.join(ROOT, 'output');
const TEMPLATE_PATH = path.join(ROOT, 'gelato_flavors.xlsx');
const DECISIONS_PATH = path.join(OUTPUT_DIR, 'shocapp_da_ordinare.xlsx');

// ── Helpers ───────────────────────────────────────────────────────────────────
function trendClass(t) {
  return t === '↑↑' ? 'trend-up2' : t === '↑' ? 'trend-up' :
         t === '↓↓' ? 'trend-dn2' : t === '↓' ? 'trend-dn' : 'trend-flat';
}

function readSheet(filePath, sheetIndex = 0) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[sheetIndex]];
    return XLSX.utils.sheet_to_json(ws);
  } catch { return []; }
}

function loadCategoryMap() {
  try {
    if (!fs.existsSync(TEMPLATE_PATH)) return {};
    const wb   = XLSX.readFile(TEMPLATE_PATH);
    const ws   = wb.Sheets['Flavors'];
    if (!ws) return {};
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const cats = ['Gelato', 'Creme', 'Cioccolati', 'Sorbetti'];
    const map  = {};
    for (const row of rows.slice(1)) {
      for (let ci = 0; ci < 4; ci++) {
        const v = row[ci * 2];
        if (v && !['ORDINE', 'TOTAL:', 'Varie'].includes(String(v).trim()))
          map[String(v).trim().toUpperCase()] = cats[ci];
      }
    }
    return map;
  } catch { return {}; }
}

function j(v) { return JSON.stringify(v); }

// ── Main ──────────────────────────────────────────────────────────────────────
export async function generateInsights() {
  if (!fs.existsSync(DECISIONS_PATH))
    throw new Error('Nessun dato trovato — esegui prima una estrazione.');

  const raw    = readSheet(DECISIONS_PATH);
  const catMap = loadCategoryMap();

  // Normalise column names (the xlsx may use Italian headers)
  const data = raw.map(r => ({
    flavor:   String(r['Gusto']                ?? r.flavor   ?? ''),
    stock:    Number(r['Scorta']               ?? r.stock    ?? 0),
    sold7d:   Number(r['Venduti 7gg']          ?? r.sold7d   ?? 0),
    sold30d:  Number(r['Venduti 30gg']         ?? r.sold30d  ?? 0),
    hist:     Number(r['Venduti storici']       ?? r.hist     ?? 0),
    rate:     Number(r['Rate/giorno (blend)']  ?? r.dailyRate ?? 0),
    trend:    String(r['Trend']                ?? r.trend    ?? '→'),
    target:   Number(r['Target']               ?? r.target   ?? 0),
    order:    Number(r['Da Ordinare']          ?? r.order    ?? 0),
    reason:   String(r['Motivo']               ?? r.reason   ?? ''),
  })).filter(d => d.flavor.length > 1);

  // Attach category
  data.forEach(d => { d.category = catMap[d.flavor.toUpperCase()] ?? 'Altro'; });

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const totalStock   = data.reduce((s, d) => s + d.stock,  0);
  const totalSold7d  = data.reduce((s, d) => s + d.sold7d, 0);
  const totalSold30d = data.reduce((s, d) => s + d.sold30d,0);
  const totalOrder   = data.reduce((s, d) => s + d.order,  0);
  const activeCount  = data.filter(d => d.sold30d > 0).length;
  const outOfStock   = data.filter(d => d.stock === 0 && d.sold7d > 0).length;
  const needOrder    = data.filter(d => d.order  > 0).length;
  const turnover     = totalStock > 0 ? ((totalSold30d / totalStock) * 10 / 3).toFixed(1) : '—'; // weekly turns

  // ── Chart datasets ──────────────────────────────────────────────────────────
  const byDemand7d = [...data].filter(d => d.sold7d > 0)
    .sort((a, b) => b.sold7d - a.sold7d).slice(0, 15);
  const byDemand30d = [...data].filter(d => d.sold30d > 0)
    .sort((a, b) => b.sold30d - a.sold30d).slice(0, 15);
  const byOrder = [...data].filter(d => d.order > 0)
    .sort((a, b) => b.order - a.order).slice(0, 20);

  // Stock vs demand (top 20 by sold7d, showing both bars)
  const svd = [...data].filter(d => d.sold7d > 0 || d.stock > 0)
    .sort((a, b) => b.sold7d - a.sold7d).slice(0, 20);

  // Days of stock remaining per flavor (stock / daily_rate)
  const daysRemaining = data
    .filter(d => d.stock > 0 && d.rate > 0)
    .map(d => ({ flavor: d.flavor, days: +(d.stock / d.rate).toFixed(1), category: d.category }))
    .sort((a, b) => a.days - b.days).slice(0, 20);

  // Category aggregates
  const cats = ['Gelato', 'Creme', 'Cioccolati', 'Sorbetti', 'Altro'];
  const catData = cats.map(c => {
    const subset = data.filter(d => d.category === c);
    return {
      name:    c,
      count:   subset.length,
      stock:   subset.reduce((s, d) => s + d.stock,   0),
      sold7d:  subset.reduce((s, d) => s + d.sold7d,  0),
      sold30d: subset.reduce((s, d) => s + d.sold30d, 0),
      order:   subset.reduce((s, d) => s + d.order,   0),
      active:  subset.filter(d => d.sold30d > 0).length,
    };
  }).filter(c => c.count > 0);

  // Trend distribution
  const trendOrder = ['↑↑', '↑', '→', '↓', '↓↓'];
  const trendDist  = trendOrder.map(t => data.filter(d => d.trend === t).length);

  // Slow movers: in stock but not sold this week
  const slowMovers = data
    .filter(d => d.stock > 0 && d.sold7d === 0)
    .sort((a, b) => b.stock - a.stock);

  // Stars: high demand + low stock (potential stockout risk)
  const atRisk = data
    .filter(d => d.sold7d > 0 && d.stock <= d.sold7d)
    .sort((a, b) => (b.sold7d - b.stock) - (a.sold7d - a.stock));

  const today = new Date().toLocaleDateString('it-IT',
    { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  // ── Colour helpers ──────────────────────────────────────────────────────────
  const CAT_COLORS = {
    'Gelato':     '#4e8ef7', 'Creme': '#f5a623',
    'Cioccolati': '#7b4f2e', 'Sorbetti': '#50c878', 'Altro': '#aaaaaa',
  };
  const catColors = catData.map(c => CAT_COLORS[c.name] ?? '#aaa');

  // ── Build HTML ───────────────────────────────────────────────────────────────
  const html = /* html */`<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fata Morgana — Insights ${today}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js" crossorigin="anonymous"></script>
<script>
/* Fallback CDN if jsDelivr is blocked (e.g. in WebView offline env) */
if (typeof Chart === 'undefined') {
  document.write('<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.3/chart.umd.min.js" crossorigin="anonymous"><\/script>');
}
</script>
<style>
  :root {
    --navy:#1a1a2e; --gold:#f5c518; --blue:#4e8ef7;
    --green:#27ae60; --red:#e74c3c; --orange:#e67e22;
    --bg:#f0f4f8; --card:#fff; --border:#dde3ec;
    --text:#1a1a2e; --muted:#6b7a99;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:14px}
  a{color:inherit;text-decoration:none}

  /* ── Header ── */
  .header{background:var(--navy);color:#fff;padding:20px 32px;display:flex;align-items:center;gap:16px}
  .header h1{font-size:22px;font-weight:700;letter-spacing:.5px}
  .header .sub{font-size:13px;opacity:.7;margin-top:2px}
  .header .badge{margin-left:auto;background:var(--gold);color:var(--navy);
    font-weight:700;font-size:12px;padding:4px 12px;border-radius:20px}

  /* ── Layout ── */
  .page{max-width:1400px;margin:0 auto;padding:24px 20px}
  .section-title{font-size:16px;font-weight:700;color:var(--navy);
    margin:28px 0 12px;padding-left:10px;border-left:4px solid var(--gold)}

  /* ── KPI cards ── */
  .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:8px}
  .kpi{background:var(--card);border-radius:10px;padding:16px 18px;
    border:1px solid var(--border);box-shadow:0 1px 4px rgba(0,0,0,.06)}
  .kpi .val{font-size:28px;font-weight:800;line-height:1.1}
  .kpi .lbl{font-size:11.5px;color:var(--muted);margin-top:4px;font-weight:500;text-transform:uppercase;letter-spacing:.3px}
  .kpi.accent-green .val{color:var(--green)}
  .kpi.accent-red   .val{color:var(--red)}
  .kpi.accent-blue  .val{color:var(--blue)}
  .kpi.accent-gold  .val{color:var(--orange)}

  /* ── Charts grid ── */
  .chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(480px,1fr));gap:16px}
  .chart-card{background:var(--card);border-radius:10px;padding:18px 20px;
    border:1px solid var(--border);box-shadow:0 1px 4px rgba(0,0,0,.06)}
  .chart-card h3{font-size:13px;font-weight:700;color:var(--navy);margin-bottom:14px;
    text-transform:uppercase;letter-spacing:.4px}
  .chart-wrap{position:relative}

  /* ── Tables ── */
  .table-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:16px}
  .table-card{background:var(--card);border-radius:10px;padding:18px 20px;
    border:1px solid var(--border);box-shadow:0 1px 4px rgba(0,0,0,.06)}
  .table-card h3{font-size:13px;font-weight:700;color:var(--navy);margin-bottom:12px;
    text-transform:uppercase;letter-spacing:.4px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{background:#f5f7fb;color:var(--muted);font-weight:600;padding:7px 10px;
    text-align:left;border-bottom:2px solid var(--border);font-size:11px;text-transform:uppercase}
  td{padding:6px 10px;border-bottom:1px solid #eef1f7;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fafbff}
  .tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
  .tag-green{background:#e8f8ef;color:#1a7a3f}
  .tag-red  {background:#fdecea;color:#b71c1c}
  .tag-orange{background:#fff3e0;color:#c35a00}
  .tag-blue {background:#e3f0ff;color:#1a4fa3}
  .tag-gray {background:#f0f0f0;color:#555}
  .trend-up2{color:#1a7a3f;font-weight:700}
  .trend-up {color:#27ae60;font-weight:600}
  .trend-flat{color:#888}
  .trend-dn {color:#e67e22;font-weight:600}
  .trend-dn2{color:#e74c3c;font-weight:700}

  /* ── Footer ── */
  .footer{text-align:center;color:var(--muted);font-size:11px;padding:24px 0 16px;margin-top:24px;
    border-top:1px solid var(--border)}
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>🍦 Fata Morgana — Dashboard Insights</h1>
    <div class="sub">Generato il ${today}</div>
  </div>
  <div class="badge">${data.length} gusti monitorati</div>
</div>

<div class="page">

<!-- ── KPI cards ──────────────────────────────────────────────────────────── -->
<div class="section-title">📊 Riepilogo Generale</div>
<div class="kpi-grid">
  <div class="kpi accent-blue">
    <div class="val">${totalStock}</div>
    <div class="lbl">Vaschette in magazzino</div>
  </div>
  <div class="kpi accent-green">
    <div class="val">${totalSold7d}</div>
    <div class="lbl">Venduti questa settimana</div>
  </div>
  <div class="kpi accent-green">
    <div class="val">${totalSold30d}</div>
    <div class="lbl">Venduti ultimi 30 giorni</div>
  </div>
  <div class="kpi accent-gold">
    <div class="val">${totalOrder}</div>
    <div class="lbl">Da ordinare (vaschette)</div>
  </div>
  <div class="kpi">
    <div class="val">${needOrder}</div>
    <div class="lbl">Gusti da riordinare</div>
  </div>
  <div class="kpi">
    <div class="val">${activeCount}</div>
    <div class="lbl">Gusti attivi (30gg)</div>
  </div>
  <div class="kpi accent-red">
    <div class="val">${outOfStock}</div>
    <div class="lbl">Esauriti questa settimana</div>
  </div>
  <div class="kpi">
    <div class="val">${turnover}×</div>
    <div class="lbl">Rotazione stock / settimana</div>
  </div>
</div>

<!-- ── Category summary cards ─────────────────────────────────────────────── -->
<div class="section-title">🗂️ Per Categoria</div>
<div class="kpi-grid">
${catData.map(c => `
  <div class="kpi" style="border-top:3px solid ${CAT_COLORS[c.name] ?? '#aaa'}">
    <div class="val" style="color:${CAT_COLORS[c.name] ?? '#aaa'};font-size:22px">${c.sold7d}</div>
    <div class="lbl">${c.name} — venduti 7gg</div>
    <div style="margin-top:6px;font-size:11px;color:var(--muted)">
      Stock: <b>${c.stock}</b> &nbsp;·&nbsp; 30gg: <b>${c.sold30d}</b> &nbsp;·&nbsp; Da ord: <b>${c.order}</b>
    </div>
  </div>`).join('')}
</div>

<!-- ── Charts row 1: Top sellers ──────────────────────────────────────────── -->
<div class="section-title">🏆 Gusti più venduti</div>
<div class="chart-grid">

  <div class="chart-card">
    <h3>Top 15 — Ultimi 7 giorni</h3>
    <div class="chart-wrap"><canvas id="top7d" height="320"></canvas></div>
  </div>

  <div class="chart-card">
    <h3>Top 15 — Ultimi 30 giorni</h3>
    <div class="chart-wrap"><canvas id="top30d" height="320"></canvas></div>
  </div>

</div>

<!-- ── Charts row 2: Stock vs demand & days remaining ──────────────────────── -->
<div class="section-title">⚖️ Stock vs Domanda</div>
<div class="chart-grid">

  <div class="chart-card">
    <h3>Scorta attuale vs Venduti 7gg (top 20)</h3>
    <div class="chart-wrap"><canvas id="svd" height="340"></canvas></div>
  </div>

  <div class="chart-card">
    <h3>Giorni di scorta rimanenti (top 20 critici)</h3>
    <div class="chart-wrap"><canvas id="days" height="340"></canvas></div>
  </div>

</div>

<!-- ── Charts row 3: Trend & category breakdown ────────────────────────────── -->
<div class="section-title">📈 Trend & Distribuzione</div>
<div class="chart-grid">

  <div class="chart-card">
    <h3>Distribuzione trend settimanale</h3>
    <div class="chart-wrap" style="max-width:360px;margin:auto">
      <canvas id="trendPie" height="260"></canvas>
    </div>
  </div>

  <div class="chart-card">
    <h3>Venduti 30gg per categoria</h3>
    <div class="chart-wrap" style="max-width:360px;margin:auto">
      <canvas id="catPie" height="260"></canvas>
    </div>
  </div>

</div>

<!-- ── Charts row 4: Orders ────────────────────────────────────────────────── -->
<div class="section-title">📦 Ordine in preparazione</div>
<div class="chart-grid">

  <div class="chart-card" style="grid-column:1/-1">
    <h3>Quantità da ordinare per gusto</h3>
    <div class="chart-wrap"><canvas id="orders" height="260"></canvas></div>
  </div>

</div>

<!-- ── Tables ──────────────────────────────────────────────────────────────── -->
<div class="section-title">⚠️ Attenzione richiesta</div>
<div class="table-grid">

  <div class="table-card">
    <h3>🔴 A rischio esaurimento (stock ≤ venduti 7gg)</h3>
    <table>
      <thead><tr><th>Gusto</th><th>Categoria</th><th>Scorta</th><th>Venduti 7gg</th><th>Trend</th><th>Da ordinare</th></tr></thead>
      <tbody>
${atRisk.slice(0, 15).map(d => `
        <tr>
          <td><b>${d.flavor}</b></td>
          <td><span class="tag tag-blue">${d.category}</span></td>
          <td style="color:var(--red);font-weight:700">${d.stock}</td>
          <td>${d.sold7d}</td>
          <td class="${trendClass(d.trend)}">${d.trend}</td>
          <td><span class="tag ${d.order > 0 ? 'tag-orange' : 'tag-gray'}">${d.order}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="table-card">
    <h3>🐌 Slow movers (in stock, non venduto questa settimana)</h3>
    <table>
      <thead><tr><th>Gusto</th><th>Categoria</th><th>Scorta</th><th>Venduti 30gg</th><th>Trend</th></tr></thead>
      <tbody>
${slowMovers.slice(0, 15).map(d => `
        <tr>
          <td><b>${d.flavor}</b></td>
          <td><span class="tag tag-blue">${d.category}</span></td>
          <td><b>${d.stock}</b></td>
          <td>${d.sold30d}</td>
          <td class="${trendClass(d.trend)}">${d.trend}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

</div>

<div class="section-title">📋 Dettaglio ordine completo</div>
<div class="table-card">
  <table>
    <thead>
      <tr>
        <th>Gusto</th><th>Cat.</th><th>Scorta</th>
        <th>Venduti 7gg</th><th>Venduti 30gg</th>
        <th>Rate/giorno</th><th>Trend</th><th>Target</th>
        <th>Da ordinare</th><th>Motivo</th>
      </tr>
    </thead>
    <tbody>
${[...data].sort((a,b) => b.order - a.order || b.sold7d - a.sold7d).map(d => `
      <tr>
        <td><b>${d.flavor}</b></td>
        <td><span class="tag tag-blue" style="font-size:10px">${d.category}</span></td>
        <td>${d.stock}</td>
        <td>${d.sold7d}</td>
        <td>${d.sold30d}</td>
        <td>${Number(d.rate).toFixed(2)}</td>
        <td class="${trendClass(d.trend)}">${d.trend}</td>
        <td>${d.target}</td>
        <td><b ${d.order > 0 ? 'style="color:var(--orange)"' : ''}>${d.order}</b></td>
        <td style="font-size:11px;color:var(--muted);max-width:260px">${d.reason}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="footer">Fata Morgana Gelateria · Dashboard generato automaticamente dal sistema di estrazione SHOCAPP</div>
</div><!-- /page -->

<script>
// ── Chart.js guard ───────────────────────────────────────────────────────────
if (typeof Chart === 'undefined') {
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="color:#e74c3c;padding:12px 20px;background:#fff3f3;border-bottom:1px solid #fcc">⚠️ Chart.js non caricato — grafici non disponibili. Verifica la connessione internet.</div>');
} else {
// ── Chart.js defaults ────────────────────────────────────────────────────────
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#6b7a99';

function hBar(id, labels, values, color, height) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: color,
        borderRadius: 4, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#eef1f7' }, ticks: { stepSize: 1 } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
  ctx.parentElement.style.height = height + 'px';
}

function groupedBar(id, labels, datasets) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { grid: { color: '#eef1f7' }, stacked: false },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

function donut(id, labels, values, colors) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors,
      borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }] },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 14 } },
        tooltip: { callbacks: {
          label: ctx => ' ' + ctx.label + ': ' + ctx.parsed + ' gusti (' + Math.round(ctx.parsed/ctx.dataset.data.reduce((a,b)=>a+b,0)*100) + '%)'
        }}
      }
    }
  });
}

// ── Render charts ────────────────────────────────────────────────────────────
hBar('top7d',
  ${j(byDemand7d.map(d => d.flavor))},
  ${j(byDemand7d.map(d => d.sold7d))},
  '#4e8ef7', ${Math.max(280, byDemand7d.length * 28)});

hBar('top30d',
  ${j(byDemand30d.map(d => d.flavor))},
  ${j(byDemand30d.map(d => d.sold30d))},
  '#50c878', ${Math.max(280, byDemand30d.length * 28)});

hBar('orders',
  ${j(byOrder.map(d => d.flavor))},
  ${j(byOrder.map(d => d.order))},
  '#f5a623', ${Math.max(160, byOrder.length * 28)});

// Stock vs demand grouped
(function(){
  const labels = ${j(svd.map(d => d.flavor))};
  const ctx = document.getElementById('svd');
  if (!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Scorta attuale', data: ${j(svd.map(d => d.stock))},
          backgroundColor: 'rgba(78,142,247,0.7)', borderRadius: 3 },
        { label: 'Venduti 7gg',    data: ${j(svd.map(d => d.sold7d))},
          backgroundColor: 'rgba(231,76,60,0.7)',  borderRadius: 3 },
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { grid: { color: '#eef1f7' } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } }
    }
  });
  ctx.parentElement.style.height = ${Math.max(300, svd.length * 26)} + 'px';
})();

// Days of stock remaining
(function(){
  const days = ${j(daysRemaining)};
  if (!days.length) return;
  const ctx = document.getElementById('days');
  const colors = days.map(d => d.days < 3 ? '#e74c3c' : d.days < 7 ? '#e67e22' : '#27ae60');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map(d => d.flavor),
      datasets: [{ data: days.map(d => d.days), backgroundColor: colors, borderRadius: 4 }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ' ' + c.parsed + ' giorni rimanenti' } }
      },
      scales: {
        x: { grid: { color: '#eef1f7' }, title: { display: true, text: 'Giorni' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
  ctx.parentElement.style.height = ${Math.max(280, daysRemaining.length * 26)} + 'px';
})();

donut('trendPie',
  ['↑↑ In crescita', '↑ Lieve aumento', '→ Stabile', '↓ Lieve calo', '↓↓ In calo'],
  ${j(trendDist)},
  ['#1a7a3f','#27ae60','#3498db','#e67e22','#e74c3c']
);

donut('catPie',
  ${j(catData.map(c => c.name))},
  ${j(catData.map(c => c.sold30d))},
  ${j(catColors)}
);

} // end Chart guard
</script>
</body>
</html>`;

  const outPath = path.join(OUTPUT_DIR, 'insights.html');
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}

// Standalone
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = await generateInsights();
  console.log('Insights:', p);
}
