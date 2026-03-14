/**
 * telegramBot.js - Interactive Telegram bot for @croceviabot
 *
 * Sends a menu of buttons on /start. Users can select which files they want,
 * then send the current selection to the current chat, to another Telegram ID,
 * or to a custom email address.
 *
 * Usage:
 *   node src/telegramBot.js
 */

import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import path from 'path';
import nodemailer from 'nodemailer';
import { createLogger } from './logger.js';

const log = createLogger('bot');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const FILES = [
  { id: 'report', label: 'Report Completo', file: 'output/shocapp_report.xlsx' },
  { id: 'ordini', label: 'Ordini Settimanali', file: 'output/shocapp_template_filled.xlsx' },
  { id: 'ordini_pdf', label: 'Ordini (PDF)', file: 'output/shocapp_da_ordinare.pdf' },
  { id: 'mantenimento', label: 'Mantenimento', file: 'output/shocapp_mantenimento_tutto.xlsx' },
  { id: 'esaurito', label: 'Esaurito', file: 'output/shocapp_esaurito_7giorni.xlsx' },
  { id: 'da_ordinare', label: 'Da Ordinare', file: 'output/shocapp_da_ordinare.xlsx' },
  { id: 'zip', label: 'ZIP Completo', file: 'output/shocapp_all_formats.zip' },
];

const EMAIL_BODY = 'Report settimanale della Gelateria Fatamorgana: situazione esauriti, mantenimento scorte e lista ordini.';
const chatSessions = new Map();

if (!TOKEN) {
  log.error('TELEGRAM_BOT_TOKEN not set in .env');
  process.exit(1);
}

function apiRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req = https.request({
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendDocument(chatId, filePath) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const boundary = '----Boundary' + Date.now().toString(16);

    const header = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="chat_id"',
      '',
      String(chatId),
      `--${boundary}`,
      `Content-Disposition: form-data; name="document"; filename="${fileName}"`,
      'Content-Type: application/octet-stream',
      '',
      '',
    ].join('\r\n');

    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
      Buffer.from(header),
      fileData,
      Buffer.from(footer),
    ]);

    const req = https.request({
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/sendDocument`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.ok) {
            resolve(json);
          } else {
            reject(new Error(json.description || 'Telegram API error'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getSession(chatId) {
  if (!chatSessions.has(chatId)) {
    chatSessions.set(chatId, {
      selected: new Set(['report', 'ordini']),
      awaiting: null,
    });
  }

  return chatSessions.get(chatId);
}

function getSelectedEntries(chatId) {
  const session = getSession(chatId);
  return FILES.filter((entry) => session.selected.has(entry.id));
}

function getAvailableSelectedEntries(chatId) {
  return getSelectedEntries(chatId).filter((entry) => fs.existsSync(entry.file));
}

function formatSelected(chatId) {
  const selected = getSelectedEntries(chatId);
  if (selected.length === 0) {
    return 'nessun file selezionato';
  }

  return selected.map((entry) => entry.label).join(', ');
}

function buildMenu(chatId) {
  const session = getSession(chatId);
  const toggles = [];

  for (let i = 0; i < FILES.length; i += 2) {
    const rowEntries = FILES.slice(i, i + 2);
    toggles.push(rowEntries.map((entry) => ({
      text: `${session.selected.has(entry.id) ? '✅' : '⬜'} ${entry.label}`,
      callback_data: `toggle:${entry.id}`,
    })));
  }

  return {
    inline_keyboard: [
      ...toggles,
      [{ text: '📨 Invia a questa chat', callback_data: 'send:self' }],
      [
        { text: '📧 Invia a email', callback_data: 'send:email' },
        { text: '👤 Invia a Telegram ID', callback_data: 'send:telegram' },
      ],
      [
        { text: '🧹 Pulisci selezione', callback_data: 'clear' },
        { text: '🛑 Ferma Bot', callback_data: 'stop' },
      ],
    ],
  };
}

async function sendMessage(chatId, text, extra = {}) {
  await apiRequest('sendMessage', {
    chat_id: chatId,
    text,
    ...extra,
  });
}

async function sendMenu(chatId) {
  await sendMessage(chatId, `📁 *Gelateria Fatamorgana*\nSelezione attuale: ${formatSelected(chatId)}`, {
    parse_mode: 'Markdown',
    reply_markup: buildMenu(chatId),
  });
}

async function editMenu(chatId, messageId) {
  await apiRequest('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `📁 *Gelateria Fatamorgana*\nSelezione attuale: ${formatSelected(chatId)}`,
    parse_mode: 'Markdown',
    reply_markup: buildMenu(chatId),
  });
}

function createMailer() {
  const user = process.env.EMAIL_USER;
  const pass = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === 'true',
    },
  });
}

async function sendFilesByEmail(to, entries) {
  const transporter = createMailer();

  if (!transporter) {
    throw new Error('EMAIL_USER / EMAIL_PASS non configurati');
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `Gelateria Fatamorgana SHOCAPP Report — ${dateStr}`,
    text: EMAIL_BODY,
    attachments: entries.map((entry) => ({
      filename: path.basename(entry.file),
      path: entry.file,
    })),
  });
}

async function sendFilesToChat(chatId, entries) {
  for (const entry of entries) {
    await sendDocument(chatId, entry.file);
    log.info('Sent %s to chat %s', entry.file, chatId);
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidTelegramTarget(value) {
  return /^-?\d+$/.test(value) || /^@[A-Za-z0-9_]{5,}$/.test(value);
}

function parseCommaSeparatedValues(input) {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function handleInputReply(chatId, input) {
  const session = getSession(chatId);
  const entries = getAvailableSelectedEntries(chatId);

  if (entries.length === 0) {
    session.awaiting = null;
    await sendMessage(chatId, 'Nessun file disponibile nella selezione corrente.');
    await sendMenu(chatId);
    return;
  }

  if (session.awaiting === 'email') {
    const recipients = parseCommaSeparatedValues(input);
    if (recipients.length === 0 || recipients.some((value) => !isValidEmail(value))) {
      await sendMessage(chatId, 'Email non valida. Invia uno o piu indirizzi separati da virgola, oppure /cancel.');
      return;
    }

    try {
      await sendFilesByEmail(recipients.join(', '), entries);
      await sendMessage(chatId, `✅ File inviati a ${recipients.join(', ')}`);
    } catch (error) {
      await sendMessage(chatId, `❌ Errore invio email: ${error.message}`);
    }
  }

  if (session.awaiting === 'telegram') {
    const targets = parseCommaSeparatedValues(input);
    if (targets.length === 0 || targets.some((value) => !isValidTelegramTarget(value))) {
      await sendMessage(chatId, 'Destinazione Telegram non valida. Invia uno o piu ID numerici separati da virgola. Per i canali puoi usare anche @username. Oppure /cancel.');
      return;
    }

    try {
      for (const target of targets) {
        await sendFilesToChat(target, entries);
      }
      await sendMessage(chatId, `✅ File inviati a ${targets.join(', ')}`);
    } catch (error) {
      await sendMessage(chatId, `❌ Errore invio Telegram: ${error.message}`);
    }
  }

  session.awaiting = null;
  await sendMenu(chatId);
}

async function handleCallback(chatId, update) {
  const session = getSession(chatId);
  const callbackId = update.callback_query.id;
  const data = update.callback_query.data;
  const messageId = update.callback_query.message.message_id;

  await apiRequest('answerCallbackQuery', { callback_query_id: callbackId });

  if (data === 'stop') {
    await sendMessage(chatId, '✅ Bot fermato. Arrivederci!');
    log.info('Bot stopped by user (chat %s)', chatId);
    process.exit(0);
  }

  if (data === 'clear') {
    session.selected.clear();
    session.awaiting = null;
    await editMenu(chatId, messageId);
    return;
  }

  if (data.startsWith('toggle:')) {
    const fileId = data.slice('toggle:'.length);
    if (!FILES.some((entry) => entry.id === fileId)) {
      return;
    }

    if (session.selected.has(fileId)) {
      session.selected.delete(fileId);
    } else {
      session.selected.add(fileId);
    }

    session.awaiting = null;
    await editMenu(chatId, messageId);
    return;
  }

  if (data === 'send:self') {
    const entries = getAvailableSelectedEntries(chatId);
    if (entries.length === 0) {
      await sendMessage(chatId, 'Nessun file disponibile nella selezione corrente.');
      return;
    }

    await sendMessage(chatId, `⏳ Invio in corso: ${entries.map((entry) => path.basename(entry.file)).join(', ')}`);
    await sendFilesToChat(chatId, entries);
    await sendMessage(chatId, '✅ Invio completato.');
    return;
  }

  if (data === 'send:email') {
    session.awaiting = 'email';
    await sendMessage(chatId, 'Inserisci uno o piu indirizzi email separati da virgola. Usa /cancel per annullare.');
    return;
  }

  if (data === 'send:telegram') {
    session.awaiting = 'telegram';
    await sendMessage(chatId, 'Inserisci uno o piu Telegram ID numerici separati da virgola. Per i canali puoi usare anche @username. Usa /cancel per annullare.');
  }
}

async function handleUpdate(update) {
  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) {
    return;
  }

  if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(String(chatId))) {
    log.warn('Ignoring message from unauthorized chat: %s', chatId);
    return;
  }

  const session = getSession(chatId);
  const text = update.message?.text?.trim();

  if (text?.startsWith('/cancel')) {
    session.awaiting = null;
    await sendMessage(chatId, 'Operazione annullata.');
    await sendMenu(chatId);
    return;
  }

  if (session.awaiting && text && !text.startsWith('/')) {
    await handleInputReply(chatId, text);
    return;
  }

  if (text?.startsWith('/start') || text?.startsWith('/menu')) {
    await sendMenu(chatId);
    return;
  }

  if (update.callback_query) {
    await handleCallback(chatId, update);
  }
}

let offset = 0;

async function poll() {
  try {
    const res = await apiRequest('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message', 'callback_query'],
    });

    if (res.ok && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        handleUpdate(update).catch((error) => {
          log.error('Error handling update: %s', error.message);
        });
      }
    }
  } catch (error) {
    log.error('Poll error: %s', error.message);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  poll();
}

log.info('Starting @croceviabot... Press Ctrl+C to stop.');
poll();