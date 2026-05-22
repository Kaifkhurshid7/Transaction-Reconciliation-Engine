'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Structured Logger (Winston)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides a centralized, structured logging interface for the entire application.
 *
 * Transport Strategy:
 *   - Console: Human-readable colorized output in development, JSON in production
 *   - Daily Rotate File (combined): All logs, rotated daily, retained 14 days
 *   - Daily Rotate File (errors): Error-level only, retained 30 days for debugging
 *
 * In test environment, console output is suppressed to keep test output clean.
 * File transports still write so test runs can be audited if needed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, errors, json, colorize, printf } = format;

/**
 * Development console format — colorized, human-readable, with metadata.
 * Example output: "14:32:05 [info] Reconciliation run started {"runId":"abc-123"}
 */
const developmentFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, ...metadata }) => {
    const metaString = Object.keys(metadata).length
      ? ` ${JSON.stringify(metadata)}`
      : '';
    return `${ts} [${level}] ${message}${metaString}`;
  }),
);

/**
 * Production format — structured JSON for log aggregation tools
 * (e.g., ELK stack, CloudWatch, Datadog).
 */
const productionFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

const isNonProductionEnv = config.env === 'development' || config.env === 'test';

const logger = createLogger({
  level: config.logging.level,
  format: productionFormat,
  defaultMeta: { service: 'crypto-reconciliation-engine' },
  transports: [
    // Console transport — always active, format varies by environment
    new transports.Console({
      format: isNonProductionEnv ? developmentFormat : productionFormat,
      silent: config.env === 'test', // Suppress noise during test runs
    }),

    // Combined log — all levels, daily rotation, 14-day retention
    new transports.DailyRotateFile({
      filename: path.join(config.logging.dir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      zippedArchive: true,
    }),

    // Error log — errors only, 30-day retention for post-mortem analysis
    new transports.DailyRotateFile({
      filename: path.join(config.logging.dir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
