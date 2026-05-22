'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * HTTP Request Logger Middleware
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bridges Morgan (HTTP request logging) with Winston (structured logging).
 * All HTTP access logs flow through the same transport pipeline as application
 * logs, ensuring unified log management (rotation, formatting, aggregation).
 *
 * Log Format: ":method :url :status :content-length - :response-time ms"
 * Log Level: 'http' (between 'info' and 'verbose' in Winston's hierarchy)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const morgan = require('morgan');
const logger = require('../utils/logger');

/** Pipe Morgan output into Winston's 'http' level */
const winstonStream = {
  write: (message) => logger.http(message.trim()),
};

const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  { stream: winstonStream },
);

module.exports = requestLogger;
