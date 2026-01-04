'use strict';

const os = require('os');

/**
 * Convert Pino log level to Graylog/Syslog severity level
 * Pino levels: trace=10, debug=20, info=30, warn=40, error=50, fatal=60
 * Syslog levels: 0=emerg, 1=alert, 2=crit, 3=error, 4=warn, 5=notice, 6=info, 7=debug
 */
function pinoLevelToSyslog(pinoLevel) {
  if (pinoLevel >= 60) return 2; // fatal -> critical
  if (pinoLevel >= 50) return 3; // error -> error
  if (pinoLevel >= 40) return 4; // warn -> warning
  if (pinoLevel >= 30) return 6; // info -> informational
  if (pinoLevel >= 20) return 7; // debug -> debug
  return 7; // trace -> debug
}

/**
 * Format a Pino log object into GELF (Graylog Extended Log Format)
 * @param {Object} log - Pino log object
 * @param {Object} options - Formatting options
 * @returns {Object} GELF formatted message
 */
function formatGelf(log, options = {}) {
  const {
    facility = 'nodejs',
    host = os.hostname(),
    version = '1.1'
  } = options;

  // Build the base GELF message
  const gelfMessage = {
    version,
    host,
    timestamp: log.time ? log.time / 1000 : Date.now() / 1000,
    level: pinoLevelToSyslog(log.level),
    short_message: log.msg || 'No message',
    facility
  };

  // Add full_message if there's a stack trace
  if (log.stack) {
    gelfMessage.full_message = log.stack;
  }

  // Add all custom fields with _ prefix (GELF spec)
  for (const key in log) {
    if (key === 'msg' || key === 'time' || key === 'level' || key === 'v' || 
        key === 'pid' || key === 'hostname' || key === 'stack') {
      // Skip standard Pino fields already processed
      continue;
    }

    // Add custom fields with underscore prefix
    const gelfKey = `_${key}`;
    const value = log[key];

    // GELF only supports strings and numbers for custom fields
    if (typeof value === 'object' && value !== null) {
      gelfMessage[gelfKey] = JSON.stringify(value);
    } else {
      gelfMessage[gelfKey] = value;
    }
  }

  // Add standard Pino metadata fields
  if (log.pid !== undefined) {
    gelfMessage._pid = log.pid;
  }
  if (log.hostname !== undefined) {
    gelfMessage._hostname = log.hostname;
  }

  return gelfMessage;
}

module.exports = { formatGelf, pinoLevelToSyslog };
