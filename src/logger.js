/**
 * logger.js – Lightweight structured logger.
 *
 * Never logs credentials, cookies, or tokens.
 */

import { format } from 'util';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

/**
 * Create a namespaced logger.
 * @param {string} namespace
 */
export function createLogger(namespace) {
  function write(level, msg, ...args) {
    if (LEVELS[level] < CURRENT_LEVEL) return;
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}] [${namespace}]`;
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'log'](`${prefix} ${format(msg, ...args)}`);
  }

  return {
    debug: (msg, ...a) => write('debug', msg, ...a),
    info: (msg, ...a) => write('info', msg, ...a),
    warn: (msg, ...a) => write('warn', msg, ...a),
    error: (msg, ...a) => write('error', msg, ...a),
  };
}
