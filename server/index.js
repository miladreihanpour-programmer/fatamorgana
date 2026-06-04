/**
 * server/index.js — Fata Morgana API
 *
 * Architecture (100% free):
 *   • This server runs on Render.com FREE tier (~50MB RAM)
 *   • When app presses "Avvia Estrazione", this server triggers a
 *     GitHub Actions workflow (free, 7GB RAM, runs Playwright)
 *   • GitHub Actions scrapes SHOCAPP, then pushes results here via /api/sync
 *   • Mobile app polls /api/extract/status until done, then reads /api/insights
 *   • Total cost: €0/month
 */

import 'dotenv/config';
import express     from 'express';
import cors        from 'cors';
import jwt         from 'jsonwebtoken';
import fs          from 'fs';
import path        from 'path';
import { fileURLToPath } from 'url';
import cron        from 'node-cron';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.join(__dirname, 'history.json');
const JWT_SECRET   = process.env.JWT_SECRET   ?? 'change-me';
const PORT         = process.env.PORT         ?? 3001;
const GH_TOKEN     = process.env.GITHUB_TOKEN ?? '';       // fine-grained PAT
const GH_REPO      = process.env.GITHUB_REPO  ?? '';       // "username/reponame"
const RENDER_URL   = process.env.RENDER_URL   ?? '';       // this server's public URL

// ── Data store (in-memory + file backup) ─────────────────────────────────────
let store = { lastSync: null, kpis: null, data: [], pdfBase64: null, insightsHtml: null, decisions: [] };

function loadStore() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const f = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (f.store) { store = f.store; console.log(`Store loaded (last sync: ${store.lastSync})`); }
    }
  } catch {}
}

function saveStore() {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify({ store, history: readHistory() }, null, 2)); }
  catch (e) { console.warn('saveStore:', e.message); }
}

function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')).history ?? [];
  } catch {}
  return [];
}

loadStore();

// ── Extraction state ──────────────────────────────────────────────────────────
const exState = {
  running:    false,
  startedAt:  null,
  triggeredBy:'',
  lastResult: null,
  error:      null,
};

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (username === process.env.GELATERIA_USER && password === process.env.GELATERIA_PASS) {
    const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: username });
  }
  res.status(401).json({ error: 'Credenziali non valide' });
});

function auth(req, res, next) {
  const raw = (req.headers.authorization ?? '').replace('Bearer ', '') || (req.query.token ?? '');
  if (!raw) return res.status(401).json({ error: 'Non autorizzato' });
  try { req.user = jwt.verify(raw, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token scaduto — accedi di nuovo' }); }
}

// ── TRIGGER extraction via GitHub Actions ─────────────────────────────────────
app.post('/api/extract', auth, async (req, res) => {
  if (exState.running) {
    return res.status(409).json({
      error: 'Estrazione già in corso',
      startedAt: exState.startedAt,
    });
  }

  // Check GitHub config
  if (!GH_TOKEN || !GH_REPO) {
    return res.status(503).json({
      error: 'GitHub Actions non configurato.\nSegui la guida DEPLOY.md per completare il setup.',
    });
  }

  // Trigger GitHub Actions workflow
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
        inputs: { sync_url: RENDER_URL },
      }),
    });

    if (!ghRes.ok) {
      const body = await ghRes.text();
      return res.status(500).json({ error: `GitHub API error: ${ghRes.status} — ${body}` });
    }

    exState.running    = true;
    exState.startedAt  = new Date().toISOString();
    exState.error      = null;
    exState.triggeredBy = 'app';

    console.log(`✅ GitHub Actions triggered by app (${new Date().toLocaleTimeString('it-IT')})`);
    res.json({ status: 'started', message: 'Estrazione avviata — pronta in circa 4-5 minuti' });

  } catch (e) {
    res.status(500).json({ error: `Impossibile contattare GitHub: ${e.message}` });
  }
});

// ── STATUS — app polls this every 5s while running ────────────────────────────
app.get('/api/extract/status', auth, (req, res) => {
  res.json({
    running:    exState.running,
    startedAt:  exState.startedAt,
    error:      exState.error,
    lastResult: exState.lastResult,
    // Estimate progress based on elapsed time (extraction takes ~4-5 min)
    progress: exState.running ? buildProgress(exState.startedAt) : [],
  });
});

function buildProgress(startedAt) {
  if (!startedAt) return [];
  const elapsed = Math.round((Date.now() - new Date(startedAt).getTime()) / 1000);
  const steps = [
    { at: 0,   msg: '🚀 GitHub Actions avviato…' },
    { at: 40,  msg: '📦 Installazione dipendenze…' },
    { at: 90,  msg: '🌐 Apertura SHOCAPP…' },
    { at: 120, msg: '🔍 Lettura inventario (Mantenimento)…' },
    { at: 150, msg: '📊 Lettura vendite 7 giorni…' },
    { at: 180, msg: '📅 Lettura vendite 30 giorni…' },
    { at: 210, msg: '🧮 Calcolo ordini…' },
    { at: 240, msg: '📄 Generazione PDF e insights…' },
  ];
  return steps.filter(s => elapsed >= s.at).map(s => s.msg);
}

// ── SYNC — GitHub Actions pushes results here after extraction ────────────────
app.post('/api/sync', auth, (req, res) => {
  const { kpis, data, pdfBase64, insightsHtml, decisions } = req.body;
  if (!kpis || !data) return res.status(400).json({ error: 'Dati mancanti' });

  store = { lastSync: new Date().toISOString(), kpis, data, pdfBase64: pdfBase64 ?? null, insightsHtml: insightsHtml ?? null, decisions: decisions ?? [] };

  const ordered = (decisions ?? []).filter((d) => d.order > 0);
  exState.running   = false;
  exState.lastResult = {
    ordered:   ordered.length,
    totalVas:  ordered.reduce((s, d) => s + d.order, 0),
    timestamp: store.lastSync,
  };

  // Save history
  const history = readHistory();
  history.unshift({ id: Date.now(), ts: store.lastSync, total_ord: ordered.length, total_vas: exState.lastResult.totalVas, status: 'ok' });
  saveStore();

  console.log(`✅ Sync OK: ${data.length} gusti, ${ordered.length} ordini, ${exState.lastResult.totalVas} vaschette`);
  res.json({ ok: true });
});

// ── DATA endpoints ────────────────────────────────────────────────────────────
app.get('/api/insights', auth, (req, res) => {
  if (!store.kpis) return res.status(404).json({ error: 'Nessun dato — premi Avvia Estrazione' });
  res.json({ kpis: store.kpis, data: store.data, lastUpdated: store.lastSync });
});

app.get('/api/insights/html', auth, (req, res) => {
  if (!store.insightsHtml) return res.status(404).send('<h2 style="font-family:sans-serif;padding:32px;color:#555">Nessun dato.<br><br>Premi <b>Avvia Estrazione</b> dall\'app per generare i grafici.</h2>');
  res.setHeader('Content-Type', 'text/html');
  res.send(store.insightsHtml);
});

app.get('/api/orders/pdf', auth, (req, res) => {
  if (!store.pdfBase64) return res.status(404).json({ error: 'PDF non trovato — esegui prima una estrazione' });
  const buf = Buffer.from(store.pdfBase64, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ordine_${new Date().toISOString().slice(0,10)}.pdf"`);
  res.send(buf);
});

app.get('/api/history', auth, (req, res) => {
  res.json(readHistory().slice(0, 30));
});

// ── Health (pinged by UptimeRobot every 5 min to keep Render awake) ───────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString(), lastSync: store.lastSync }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Fata Morgana API — port ${PORT}`);
  console.log(`   GitHub repo:  ${GH_REPO || '⚠️  NOT SET'}`);
  console.log(`   GitHub token: ${GH_TOKEN ? '✓ set' : '⚠️  NOT SET'}`);
  console.log(`   Render URL:   ${RENDER_URL || '⚠️  NOT SET'}`);
  console.log(`   Last sync:    ${store.lastSync ?? 'never'}`);
});
