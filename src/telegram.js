/**
 * telegram.js
 * Low-level Telegram helpers used by both the extractor and the bot.
 */

import fs from 'fs';
import path from 'path';

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function apiCall(method, body, formData = null) {
  const url = `${API}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    ...(formData
      ? { body: formData }
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return res.json();
}

export async function sendMessage(chatId, text) {
  return apiCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

export async function sendDocument(chatId, filePath, caption = '') {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  return apiCall('sendDocument', null, form);
}

export async function getUpdates(offset = 0) {
  const data = await apiCall('getUpdates', { offset, timeout: 30, limit: 100 });
  return data.result ?? [];
}

export async function answerCallbackQuery(callbackQueryId) {
  return apiCall('answerCallbackQuery', { callback_query_id: callbackQueryId });
}

export async function sendInlineKeyboard(chatId, text, buttons) {
  return apiCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  });
}

export async function editMessageReplyMarkup(chatId, messageId, buttons) {
  return apiCall('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  });
}

/**
 * Send a list of files to one or more Telegram chat IDs.
 */
export async function sendTelegram(filePaths, caption = '') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('TELEGRAM_BOT_TOKEN not set, skipping'); return; }

  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? '').split(',').map(s => s.trim()).filter(Boolean);
  for (const chatId of chatIds) {
    for (const fp of filePaths) {
      if (fs.existsSync(fp)) {
        await sendDocument(chatId, fp, caption);
      }
    }
  }
}
