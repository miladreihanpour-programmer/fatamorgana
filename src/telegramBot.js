/**
 * telegramBot.js
 * Interactive Telegram bot for Gelateria Fata Morgana.
 *
 * One-button workflow:
 *   1. /start or 🔄 Estrai  → runs SHOCAPP extraction → sends PDF + Excel automatically
 *   2. 🧮 Calcola Manuale   → user types quantities per flavour
 *   3. 📁 Invia File        → choose which output files to send
 *   4. 📧 Invia Email       → send selected files by email
 *   5. 🛑 Ferma Bot         → stop polling
 *
 * Target rules for Calcola Manuale:
 *   - MOUSSE          → target 20
 *   - SUSHI GELATO    → target 8
 *   - SUSHI MISTI, SUSHI TIRAMISU → target 0
 *   - everything else → target 2
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import {
  sendMessage, sendDocument, getUpdates,
  answerCallbackQuery, sendInlineKeyboard, editMessageReplyMarkup,
} from './telegram.js';
import { generateOrderPdf } from './generatePdf.js';
import { fillTemplate } from './shocappExtractor.js';
import { sendEmail } from './email.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const TEMPLATE_PATH = path.join(ROOT, 'gelato_flavors.xlsx');

const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

// ─── Target quantities for Calcola Manuale ───────────────────────────────────
const TARGETS = {
  'MOUSSE':         20,
  'SUSHI GELATO':   8,
  'SUSHI MISTI':    0,
  'SUSHI TIRAMISU': 0,
};
const DEFAULT_TARGET = 2;

function getTarget(flavor) {
  return TARGETS[flavor.toUpperCase().trim()] ?? DEFAULT_TARGET;
}

// ─── Load all flavors from template ─────────────────────────────────────────
function loadAllFlavors() {
  const wb = XLSX.readFile(TEMPLATE_PATH);
  const ws = wb.Sheets['Flavors'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const flavorCols = [0, 2, 4, 6];
  const flavors = [];
  for (const row of rows.slice(1)) {
    for (const c of flavorCols) {
      const v = row[c];
      if (v && !['ORDINE', 'TOTAL:', 'Varie'].includes(String(v).trim())) {
        flavors.push(String(v).trim());
      }
    }
  }
  return [...new Set(flavors)];
}

// ─── Available output files ──────────────────────────────────────────────────
function outputFiles() {
  const files = [
    { id: 'pdf',      label: '📄 Ordine PDF',            path: path.join(OUTPUT_DIR, 'shocapp_da_ordinare.pdf') },
    { id: 'filled',   label: '📊 Template Riempito',     path: path.join(OUTPUT_DIR, 'shocapp_template_filled.xlsx') },
    { id: 'ordine',   label: '📋 Da Ordinare',           path: path.join(OUTPUT_DIR, 'shocapp_da_ordinare.xlsx') },
    { id: 'manten',   label: '📦 Mantenimento',          path: path.join(OUTPUT_DIR, 'shocapp_mantenimento.xlsx') },
    { id: 'esaurito', label: '🚫 Esaurito 7gg',          path: path.join(OUTPUT_DIR, 'shocapp_esaurito_7gg.xlsx') },
    { id: 'insights', label: '📊 Insights Dashboard',    path: path.join(OUTPUT_DIR, 'insights.html') },
  ];
  return files.filter(f => fs.existsSync(f.path));
}

// ─── Bot state ───────────────────────────────────────────────────────────────
let running = true;
let offset  = 0;

// Per-chat session state
const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = {
      mode: 'idle',          // idle | awaiting_qty | awaiting_email
      manualFlavors: [],     // all flavor names
      manualIdx: 0,          // current flavor index
      manualQtys: {},        // flavor → qty entered
      fileSelection: new Set(),
    };
  }
  return sessions[chatId];
}

// ─── Keyboard builders ───────────────────────────────────────────────────────

function mainKeyboard() {
  return [
    [{ text: '🔄 Estrai da SHOCAPP',    callback_data: 'extract' }],
    [{ text: '🧮 Calcola Ordine Manuale', callback_data: 'calc_manual' }],
    [{ text: '📁 Invia File',           callback_data: 'send_files' }],
    [{ text: '📧 Invia Email',          callback_data: 'send_email' }],
    [{ text: '🛑 Ferma Bot',            callback_data: 'stop' }],
  ];
}

function fileKeyboard(selection) {
  const files = outputFiles();
  if (!files.length) return [[{ text: '⚠️ Nessun file disponibile', callback_data: 'noop' }]];
  const rows = files.map(f => {
    const on = selection.has(f.id);
    return [{ text: `${on ? '✅' : '⬜'} ${f.label}`, callback_data: `toggle_${f.id}` }];
  });
  rows.push([
    { text: '📨 Invia a questa chat', callback_data: 'send_selected' },
    { text: '🧹 Pulisci',             callback_data: 'clear_sel'    },
  ]);
  rows.push([{ text: '↩️ Menu principale', callback_data: 'main_menu' }]);
  return rows;
}

// ─── Core extraction (calls SHOCAPP via Playwright) ──────────────────────────
async function runExtraction(chatId) {
  await sendMessage(chatId, '⏳ Avvio estrazione da SHOCAPP… (può richiedere 1-2 minuti)');
  try {
    // Dynamic import so it doesn't fail if playwright is absent
    const { runExtraction: extract } = await import('./shocappExtractor.js');
    const result = await extract();

    // Support both old (daOrdinare) and new (decisions) shapes
    const items = result.decisions ?? result.daOrdinare ?? [];
    const ordered = items.filter(r => r.order > 0);
    const totalVas = ordered.reduce((s, r) => s + r.order, 0);

    const msg = `✅ Estrazione completata!\n\n` +
      `📦 Da ordinare: <b>${ordered.length} gusti</b> (${totalVas} vaschette)\n` +
      `📊 File generati in <code>output/</code>\n\n` +
      `Apri <code>shocapp_da_ordinare.xlsx</code> per vedere il ragionamento dietro ogni decisione.`;

    await sendMessage(chatId, msg);

    // Auto-send PDF + filled Excel + insights
    const toSend = [result.pdfPath, result.filledPath, result.insightsPath].filter(p => p && fs.existsSync(p));
    for (const fp of toSend) await sendDocument(chatId, fp, '🍦 Ordine Fata Morgana');

  } catch (err) {
    logger.error('Extraction error:', err);
    await sendMessage(chatId, `❌ Errore durante l'estrazione:\n<code>${err.message}</code>`);
  }
}

// ─── Manual calculation flow ─────────────────────────────────────────────────
async function startManualCalc(chatId) {
  const sess = getSession(chatId);
  const flavors = loadAllFlavors();

  sess.mode         = 'awaiting_qty';
  sess.manualFlavors = flavors;
  sess.manualIdx    = 0;
  sess.manualQtys   = {};

  await sendMessage(chatId,
    `🧮 <b>Calcolo Ordine Manuale</b>\n\n` +
    `Inserisci le quantità <b>disponibili</b> per ogni gusto.\n` +
    `Il bot calcolerà: <code>Da ordinare = max(0, target − disponibili)</code>\n\n` +
    `Rispondi con un numero (o <code>skip</code> per saltare, <code>stop</code> per interrompere)`
  );

  await askNextFlavor(chatId);
}

async function askNextFlavor(chatId) {
  const sess = getSession(chatId);
  const { manualFlavors, manualIdx } = sess;

  if (manualIdx >= manualFlavors.length) {
    await finishManualCalc(chatId);
    return;
  }

  const flavor = manualFlavors[manualIdx];
  const target = getTarget(flavor);
  const total  = manualFlavors.length;

  await sendMessage(chatId,
    `[${manualIdx + 1}/${total}] <b>${flavor}</b>\n` +
    `🎯 Target: <code>${target}</code>\n` +
    `Quante vaschette hai disponibili?`
  );
}

async function handleManualInput(chatId, text) {
  const sess = getSession(chatId);
  const lower = text.trim().toLowerCase();

  if (lower === 'stop') {
    sess.mode = 'idle';
    await sendMessage(chatId, '❌ Calcolo manuale annullato.');
    await sendInlineKeyboard(chatId, 'Menu principale:', mainKeyboard());
    return;
  }

  const flavor = sess.manualFlavors[sess.manualIdx];

  if (lower !== 'skip') {
    const available = parseInt(text.trim());
    if (isNaN(available)) {
      await sendMessage(chatId, '⚠️ Inserisci un numero valido (o <code>skip</code> / <code>stop</code>).');
      return;
    }
    const target  = getTarget(flavor);
    const order   = Math.max(0, target - available);
    sess.manualQtys[flavor.toUpperCase()] = order;
  }

  sess.manualIdx++;
  await askNextFlavor(chatId);
}

async function finishManualCalc(chatId) {
  const sess = getSession(chatId);
  sess.mode = 'idle';

  const orderMap = sess.manualQtys;
  const ordered  = Object.entries(orderMap).filter(([, v]) => v > 0);

  if (!ordered.length) {
    await sendMessage(chatId, '✅ Nessun gusto da ordinare al momento.');
    await sendInlineKeyboard(chatId, 'Menu principale:', mainKeyboard());
    return;
  }

  await sendMessage(chatId, `⏳ Generazione PDF e Excel in corso…`);

  // Fill template + generate PDF
  const filledPath = fillTemplate(orderMap);
  const pdfPath = await generateOrderPdf(filledPath);

  const summary = ordered
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `• ${k}: <b>${v}</b>`)
    .join('\n');

  await sendMessage(chatId,
    `✅ <b>Ordine calcolato!</b>\n\n${summary}\n\n` +
    `📦 Totale vaschette: <b>${ordered.reduce((s, [, v]) => s + v, 0)}</b>`
  );

  // Auto-send PDF + Excel
  for (const fp of [pdfPath, filledPath]) {
    if (fs.existsSync(fp)) await sendDocument(chatId, fp, '🍦 Ordine Fata Morgana');
  }

  await sendInlineKeyboard(chatId, 'Cosa vuoi fare?', mainKeyboard());
}

// ─── Email flow ───────────────────────────────────────────────────────────────
async function startEmailFlow(chatId) {
  const sess = getSession(chatId);
  sess.mode = 'awaiting_email';
  await sendMessage(chatId,
    '📧 Inserisci gli indirizzi email (separati da virgola) a cui inviare i file:'
  );
}

async function handleEmailInput(chatId, text) {
  const sess = getSession(chatId);
  sess.mode = 'idle';

  const addresses = text.split(',').map(s => s.trim()).filter(Boolean);
  if (!addresses.length) {
    await sendMessage(chatId, '⚠️ Nessun indirizzo valido inserito.');
    return;
  }

  const files = outputFiles().map(f => f.path);
  process.env.EMAIL_TO = addresses.join(',');
  await sendMessage(chatId, `⏳ Invio email a ${addresses.join(', ')}…`);
  try {
    await sendEmail(files, 'Report settimanale Fata Morgana');
    await sendMessage(chatId, `✅ Email inviata a: ${addresses.join(', ')}`);
  } catch (err) {
    await sendMessage(chatId, `❌ Errore email: ${err.message}`);
  }
  await sendInlineKeyboard(chatId, 'Menu principale:', mainKeyboard());
}

// ─── Update handler ───────────────────────────────────────────────────────────

async function handleUpdate(update) {
  // Callback queries (button presses)
  if (update.callback_query) {
    const cb     = update.callback_query;
    const chatId = String(cb.message.chat.id);
    const data   = cb.data;
    await answerCallbackQuery(cb.id);
    const sess   = getSession(chatId);

    if (data === 'extract') {
      await runExtraction(chatId);
      await sendInlineKeyboard(chatId, 'Menu principale:', mainKeyboard());
      return;
    }

    if (data === 'calc_manual') {
      await startManualCalc(chatId);
      return;
    }

    if (data === 'send_files') {
      sess.fileSelection = new Set();
      await sendInlineKeyboard(chatId, '📁 <b>Seleziona i file da inviare:</b>', fileKeyboard(sess.fileSelection));
      return;
    }

    if (data === 'send_email') {
      await startEmailFlow(chatId);
      return;
    }

    if (data === 'stop') {
      await sendMessage(chatId, '🛑 Bot fermato. Arrivederci!');
      running = false;
      return;
    }

    if (data === 'main_menu') {
      await sendInlineKeyboard(chatId, 'Menu principale:', mainKeyboard());
      return;
    }

    if (data.startsWith('toggle_')) {
      const id = data.replace('toggle_', '');
      if (sess.fileSelection.has(id)) sess.fileSelection.delete(id);
      else sess.fileSelection.add(id);
      await editMessageReplyMarkup(chatId, cb.message.message_id, fileKeyboard(sess.fileSelection));
      return;
    }

    if (data === 'clear_sel') {
      sess.fileSelection = new Set();
      await editMessageReplyMarkup(chatId, cb.message.message_id, fileKeyboard(sess.fileSelection));
      return;
    }

    if (data === 'send_selected') {
      const toSend = outputFiles().filter(f => sess.fileSelection.has(f.id));
      if (!toSend.length) {
        await sendMessage(chatId, '⚠️ Nessun file selezionato.');
        return;
      }
      for (const f of toSend) await sendDocument(chatId, f.path, f.label);
      await sendMessage(chatId, `✅ Inviati ${toSend.length} file.`);
      sess.fileSelection = new Set();
      await sendInlineKeyboard(chatId, 'Menu principale:', mainKeyboard());
      return;
    }

    if (data === 'noop') return;
  }

  // Text messages
  if (update.message?.text) {
    const chatId = String(update.message.chat.id);
    const text   = update.message.text.trim();
    const sess   = getSession(chatId);

    if (text === '/start' || text === '/menu') {
      await sendInlineKeyboard(chatId,
        '🍦 <b>Gelateria Fata Morgana — Bot Inventario</b>\n\nCosa vuoi fare?',
        mainKeyboard()
      );
      return;
    }

    if (sess.mode === 'awaiting_qty') {
      await handleManualInput(chatId, text);
      return;
    }

    if (sess.mode === 'awaiting_email') {
      await handleEmailInput(chatId, text);
      return;
    }

    // Default: show menu
    await sendInlineKeyboard(chatId, 'Menu principale:', mainKeyboard());
  }
}

// ─── Polling loop ─────────────────────────────────────────────────────────────

async function poll() {
  logger.info('Bot avviato. Drop di update vecchi…');

  // ── Drain any pending updates from previous sessions ──────────────────────
  // Without this, an old "Ferma Bot" button click would immediately stop the
  // bot as soon as it starts.
  try {
    const stale = await getUpdates(0);
    if (stale.length > 0) {
      const lastId = stale[stale.length - 1].update_id;
      offset = lastId + 1;
      // Confirm with Telegram so they're not redelivered
      await getUpdates(offset);
      logger.info(`Skipped ${stale.length} old update(s)`);
    }
  } catch (err) {
    logger.warn('Could not drain old updates:', err.message);
  }

  if (CHAT_ID) {
    await sendInlineKeyboard(CHAT_ID,
      '🍦 <b>Gelateria Fata Morgana — Bot Inventario</b>\n\nBot avviato e pronto! Cosa vuoi fare?',
      mainKeyboard()
    );
  }

  while (running) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u).catch(err => logger.error('Update error:', err));
      }
    } catch (err) {
      logger.error('Polling error:', err);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  logger.info('Bot fermato.');
  process.exit(0);
}

poll();
