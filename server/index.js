/**
 * server/index.js — Fata Morgana Multi-Shop API
 *
 * Supports multiple shops. Each shop logs in with their own
 * SHOCAPP credentials. Data is stored separately per shop.
 *
 * Shop registry: set SHOPS_CONFIG env var on Render as JSON array:
 * [
 *   {"id":"shop1","name":"Roma Prati",    "user":"storoma10","pass":"crocevia"},
 *   {"id":"shop2","name":"Roma Trastevere","user":"shopuser2","pass":"shoppass2"},
 *   ...
 * ]
 */

import 'dotenv/config';
import express from 'express';
import cors    from 'cors';
import jwt     from 'jsonwebtoken';
import fs      from 'fs';
import path    from 'path';
import os      from 'os';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { generateOrderPdf } from '../src/generatePdf.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, 'data.json');
const JWT_SECRET   = process.env.JWT_SECRET   ?? 'change-me';
const PORT         = process.env.PORT         ?? 3001;
const GH_TOKEN     = process.env.GITHUB_TOKEN ?? '';
const GH_REPO      = process.env.GITHUB_REPO  ?? '';
const RENDER_URL   = process.env.RENDER_URL   ?? '';

// ── Shop registry ─────────────────────────────────────────────────────────────
// Primary shop always comes from GELATERIA_USER / GELATERIA_PASS env vars.
// Additional shops are merged in from SHOPS_CONFIG (JSON array) — no need to
// re-enter the primary shop there.  SHOP_NAME customises the primary shop name.
function loadShops() {
  const shops = [];

  if (process.env.GELATERIA_USER) {
    shops.push({
      id:   process.env.GELATERIA_USER,
      name: process.env.SHOP_NAME ?? 'Fata Morgana',
      user: process.env.GELATERIA_USER,
      pass: process.env.GELATERIA_PASS ?? '',
    });
  }

  try {
    if (process.env.SHOPS_CONFIG) {
      const extra = JSON.parse(process.env.SHOPS_CONFIG);
      for (const s of extra) {
        if (!shops.some(e => e.user === s.user)) shops.push(s);
      }
    }
  } catch (e) { console.warn('SHOPS_CONFIG parse error:', e.message); }

  return shops;
}

const SHOPS = loadShops();
console.log(`Shops loaded: ${SHOPS.map(s => s.name).join(', ')}`);

function findShop(username, password) {
  return SHOPS.find(s => s.user === username && s.pass === password) ?? null;
}

// ── Per-shop data store ───────────────────────────────────────────────────────
// Each shop has its own dashboard data stored separately
let shopData = {};         // { shopId: { lastSync, kpis, data, pdfBase64, insightsHtml, decisions } }
let shopHistory = {};      // { shopId: [ ...history rows ] }
let extractionState = {};  // { shopId: { running, startedAt, lastResult, error } }

function getStore(shopId) {
  if (!shopData[shopId]) shopData[shopId] = { lastSync: null, kpis: null, data: [], pdfBase64: null, xlsxBase64: null, insightsHtml: null, decisions: [], varie: {} };
  return shopData[shopId];
}

function getHistory(shopId) {
  return shopHistory[shopId] ?? [];
}

function getExState(shopId) {
  if (!extractionState[shopId]) extractionState[shopId] = { running: false, startedAt: null, lastResult: null, error: null };
  return extractionState[shopId];
}

// Persist to disk so data survives server restarts
function saveAll() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ shopData, shopHistory }, null, 2));
  } catch {}
}

function loadAll() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const f = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (f.shopData)    shopData    = f.shopData;
      if (f.shopHistory) shopHistory = f.shopHistory;
      console.log(`Data loaded for shops: ${Object.keys(shopData).join(', ') || 'none yet'}`);
    }
  } catch {}
}

loadAll();

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const shop = findShop(username, password);

  if (!shop) return res.status(401).json({ error: 'Credenziali non valide' });

  const token = jwt.sign(
    { shopId: shop.id, shopName: shop.name, user: shop.user },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  console.log(`Login: ${shop.name} (${shop.id})`);
  res.json({ token, user: shop.user, shopId: shop.id, shopName: shop.name });
});

function auth(req, res, next) {
  const raw = (req.headers.authorization ?? '').replace('Bearer ', '')
            || (req.query.token ?? '');
  if (!raw) return res.status(401).json({ error: 'Non autorizzato' });
  try {
    req.jwt     = jwt.verify(raw, JWT_SECRET);
    req.shopId  = req.jwt.shopId;
    req.shop    = SHOPS.find(s => s.id === req.shopId);
    next();
  } catch {
    res.status(401).json({ error: 'Token scaduto — accedi di nuovo' });
  }
}

// ── Trigger extraction via GitHub Actions ─────────────────────────────────────
app.post('/api/extract', auth, async (req, res) => {
  const { shopId, shop } = req;
  const state = getExState(shopId);

  if (state.running) {
    return res.status(409).json({ error: 'Estrazione già in corso', startedAt: state.startedAt });
  }

  if (!GH_TOKEN || !GH_REPO) {
    return res.status(503).json({ error: 'GitHub Actions non configurato. Vedi DEPLOY.md.' });
  }

  if (!shop) return res.status(400).json({ error: 'Negozio non trovato' });

  const url = `https://api.github.com/repos/${GH_REPO}/actions/workflows/extract.yml/dispatches`;
  try {
    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          shop_id:   shopId,
          shop_user: shop.user,
          shop_pass: shop.pass,
          sync_url:  RENDER_URL,
        },
      }),
    });

    if (!ghRes.ok) {
      const body = await ghRes.text();
      return res.status(500).json({ error: `GitHub errore ${ghRes.status}: ${body}` });
    }

    state.running   = true;
    state.startedAt = new Date().toISOString();
    state.error     = null;

    console.log(`GitHub Actions triggered: ${shop.name} (${shopId})`);
    res.json({ status: 'started', message: 'Estrazione avviata — pronta in 4-5 minuti', shopName: shop.name });

  } catch (e) {
    res.status(500).json({ error: `Impossibile contattare GitHub: ${e.message}` });
  }
});

// ── Extraction status ─────────────────────────────────────────────────────────
app.get('/api/extract/status', auth, (req, res) => {
  const state = getExState(req.shopId);
  res.json({
    running:    state.running,
    startedAt:  state.startedAt,
    error:      state.error,
    lastResult: state.lastResult,
    progress:   state.running ? buildProgress(state.startedAt) : [],
  });
});

function buildProgress(startedAt) {
  if (!startedAt) return [];
  const secs = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
  return [
    { at: 0,   msg: '🚀 GitHub Actions avviato…' },
    { at: 40,  msg: '📦 Installazione dipendenze…' },
    { at: 90,  msg: '🌐 Apertura SHOCAPP…' },
    { at: 120, msg: '🔍 Lettura inventario…' },
    { at: 160, msg: '📊 Lettura vendite 7gg e 30gg…' },
    { at: 210, msg: '🧮 Calcolo ordini…' },
    { at: 250, msg: '📄 Generazione PDF…' },
  ].filter(s => secs >= s.at).map(s => s.msg);
}

// ── SYNC — GitHub Actions pushes results here when done ───────────────────────
app.post('/api/sync', auth, (req, res) => {
  const { shopId } = req;
  const { kpis, data, pdfBase64, xlsxBase64, insightsHtml } = req.body;
  // The extractor sends decisions as `data`; fall back so both field names work
  const decisions = req.body.decisions ?? data ?? [];

  if (!kpis || !data) return res.status(400).json({ error: 'Dati mancanti' });

  const prev = shopData[shopId] ?? {};
  // Store per-shop — preserve varie so it survives re-extraction
  shopData[shopId] = {
    lastSync: new Date().toISOString(), kpis, data,
    pdfBase64:    pdfBase64  ?? null,
    xlsxBase64:   xlsxBase64 ?? null,
    insightsHtml: insightsHtml ?? null,
    decisions,
    varie: prev.varie ?? {},
  };

  const ordered = decisions.filter(d => d.order > 0);
  const state   = getExState(shopId);
  state.running   = false;
  state.lastResult = {
    ordered:   ordered.length,
    totalVas:  ordered.reduce((s, d) => s + d.order, 0),
    timestamp: shopData[shopId].lastSync,
  };

  // History
  if (!shopHistory[shopId]) shopHistory[shopId] = [];
  shopHistory[shopId].unshift({
    id:        Date.now(),
    ts:        shopData[shopId].lastSync,
    total_ord: ordered.length,
    total_vas: state.lastResult.totalVas,
    status:    'ok',
  });
  shopHistory[shopId] = shopHistory[shopId].slice(0, 100);
  saveAll();

  const shop = SHOPS.find(s => s.id === shopId);
  console.log(`✅ Sync: ${shop?.name ?? shopId} — ${ordered.length} ordini, ${state.lastResult.totalVas} vaschette`);
  res.json({ ok: true });
});

// ── Data endpoints (all scoped to the logged-in shop) ─────────────────────────
app.get('/api/insights', auth, (req, res) => {
  const store = getStore(req.shopId);
  if (!store.kpis) return res.status(404).json({ error: 'Nessun dato — premi Avvia Estrazione' });
  res.json({ kpis: store.kpis, data: store.data, lastUpdated: store.lastSync, shopName: req.jwt.shopName });
});

app.get('/api/insights/html', auth, (req, res) => {
  const store = getStore(req.shopId);
  if (!store.insightsHtml) {
    return res.status(404).send(`<h2 style="font-family:sans-serif;padding:32px;color:#888">Nessun dato per ${req.jwt.shopName}.<br><br>Premi Avvia Estrazione.</h2>`);
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(store.insightsHtml);
});

app.get('/api/orders/pdf', auth, async (req, res) => {
  const store = getStore(req.shopId);
  const varie = store.varie ?? {};
  const hasVarie = Object.values(varie).some(v => v > 0);

  // If Varie are set and we have the filled xlsx, regenerate PDF with Varie injected
  if (hasVarie && store.xlsxBase64) {
    let tmpXlsx;
    try {
      const norm = s => String(s).toUpperCase().replace(/['']/g, "'").replace(/\s+/g, ' ').trim();
      const normVarie = {};
      for (const [k, v] of Object.entries(varie)) if (v > 0) normVarie[norm(k)] = v;

      const xlsxBuf = Buffer.from(store.xlsxBase64, 'base64');
      const wb = XLSX.read(xlsxBuf, { type: 'buffer' });
      const ws = wb.Sheets['Flavors'];
      const ref = XLSX.utils.decode_range(ws['!ref']);

      // Inject Varie quantities into column C (Creme/Varie), ORDINE column D
      for (let R = ref.s.r; R <= ref.e.r; R++) {
        const fc = XLSX.utils.encode_cell({ r: R, c: 2 }); // flavor name (col C)
        const oc = XLSX.utils.encode_cell({ r: R, c: 3 }); // ordine (col D)
        if (!ws[fc]?.v) continue;
        const key = norm(ws[fc].v);
        if (['ORDINE', 'TOTAL:', 'VARIE', 'CREME'].includes(key)) continue;
        const qty = normVarie[key];
        if (qty > 0) ws[oc] = { t: 'n', v: qty };
      }

      tmpXlsx = path.join(os.tmpdir(), `fata_${req.shopId}_${Date.now()}.xlsx`);
      XLSX.writeFile(wb, tmpXlsx);

      const pdfPath = await generateOrderPdf(tmpXlsx);
      const buf = fs.readFileSync(pdfPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ordine_${req.shopId}_${new Date().toISOString().slice(0,10)}.pdf"`);
      return res.send(buf);
    } catch (e) {
      console.error('PDF regen error:', e.message);
      // Fall through to stored PDF on error
    } finally {
      if (tmpXlsx) try { fs.unlinkSync(tmpXlsx); } catch {}
    }
  }

  // Fallback: return the stored PDF from last extraction
  if (!store.pdfBase64) return res.status(404).json({ error: 'PDF non trovato — esegui prima un\'estrazione' });
  const buf = Buffer.from(store.pdfBase64, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ordine_${req.shopId}_${new Date().toISOString().slice(0,10)}.pdf"`);
  res.send(buf);
});

app.get('/api/history', auth, (req, res) => {
  res.json(getHistory(req.shopId).slice(0, 30));
});

// ── Varie — manual order quantities for non-SHOCAPP items ────────────────────
app.get('/api/varie', auth, (req, res) => {
  res.json(getStore(req.shopId).varie ?? {});
});

app.post('/api/varie', auth, (req, res) => {
  const { quantities } = req.body ?? {};
  if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities))
    return res.status(400).json({ error: 'quantities object richiesto' });
  const store = getStore(req.shopId);
  store.varie = quantities;
  saveAll();
  console.log(`📝 Varie aggiornate: ${req.shopId} — ${Object.entries(quantities).filter(([,v]) => v > 0).length} items`);
  res.json({ ok: true });
});

// ── List shops (for admin — no auth needed, shows only names not credentials) ──
app.get('/api/shops', (req, res) => {
  res.json(SHOPS.map(s => ({ id: s.id, name: s.name })));
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    shops: SHOPS.map(s => ({
      name: s.name,
      lastSync: getStore(s.id).lastSync,
    })),
  });
});

app.listen(PORT, () => {
  console.log(`✅ Fata Morgana Multi-Shop API — port ${PORT}`);
  console.log(`   ${SHOPS.length} negozi registrati`);
  console.log(`   GitHub: ${GH_REPO || '⚠️  non configurato'}`);
});
