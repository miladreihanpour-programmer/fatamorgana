/**
 * exportData.js – Export structured table data to JSON and CSV.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import XLSX from 'xlsx';
import { createLogger } from './logger.js';

const log = createLogger('export');

/**
 * Write rows to a JSON file (array of objects keyed by header).
 *
 * @param {string}     filePath – Output path (without extension).
 * @param {string[]}   headers
 * @param {string[][]}  rows
 */
export async function exportJSON(filePath, headers, rows) {
  const dest = `${filePath}.json`;
  await ensureDir(dest);

  const data = rows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
  );

  await writeFile(dest, JSON.stringify(data, null, 2), 'utf-8');
  log.info('Wrote %d records to %s', data.length, dest);
}

/**
 * Write rows to a CSV file.
 *
 * @param {string}     filePath – Output path (without extension).
 * @param {string[]}   headers
 * @param {string[][]}  rows
 */
export async function exportCSV(filePath, headers, rows) {
  const dest = `${filePath}.csv`;
  await ensureDir(dest);

  const escape = (v) => {
    const str = String(v ?? '');
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ];

  await writeFile(dest, lines.join('\n') + '\n', 'utf-8');
  log.info('Wrote %d rows to %s', rows.length, dest);
}

/**
 * Write rows to an XLSX file.
 *
 * @param {string}     filePath – Output path (without extension).
 * @param {string[]}   headers
 * @param {string[][]} rows
 * @param {string}     sheetName
 */
export async function exportXLSX(filePath, headers, rows, sheetName = 'Sheet1') {
  const dest = `${filePath}.xlsx`;
  await ensureDir(dest);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, dest);
  log.info('Wrote %d rows to %s', rows.length, dest);
}

/** Ensure the directory for a file exists. */
async function ensureDir(filePath) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}
