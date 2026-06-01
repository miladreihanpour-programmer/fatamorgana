/**
 * email.js
 * Nodemailer helper for sending output files via Gmail.
 */

import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

export async function sendEmail(filePaths, subject = 'Report Fata Morgana') {
  const { EMAIL_USER, EMAIL_PASS, EMAIL_TO } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) { console.warn('Email credentials not set, skipping'); return; }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === 'true' },
  });

  const attachments = filePaths
    .filter(fp => fs.existsSync(fp))
    .map(fp => ({ filename: path.basename(fp), path: fp }));

  const recipients = (EMAIL_TO ?? EMAIL_USER).split(',').map(s => s.trim()).join(', ');

  await transporter.sendMail({
    from: `Fata Morgana Bot <${EMAIL_USER}>`,
    to: recipients,
    subject,
    text: `Report allegato — ${new Date().toLocaleDateString('it-IT')}`,
    attachments,
  });

  console.log(`Email inviata a ${recipients}`);
}
