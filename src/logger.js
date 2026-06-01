const logger = {
  info:  (...a) => console.log( '[INFO]',  new Date().toISOString(), ...a),
  warn:  (...a) => console.warn('[WARN]',  new Date().toISOString(), ...a),
  error: (...a) => console.error('[ERR]',  new Date().toISOString(), ...a),
};
export default logger;
