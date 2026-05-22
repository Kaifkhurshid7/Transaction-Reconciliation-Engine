'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Centralized Application Configuration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for all environment-driven configuration.
 * Every module imports from here — no direct process.env access elsewhere.
 *
 * Benefits:
 *   - Changing an env var name requires editing only this file
 *   - Defaults are documented in one place
 *   - Type coercion (string → number) happens once, consistently
 *   - Easy to mock in tests
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const config = Object.freeze({
  /** Application environment: development | production | test */
  env: process.env.NODE_ENV || 'development',

  /** HTTP server port */
  port: parseInt(process.env.PORT, 10) || 3000,

  /** Base path prefix for all API routes (enables versioned APIs) */
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  /** MongoDB connection settings */
  db: Object.freeze({
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/crypto_reconciliation',
  }),

  /**
   * Matching engine tolerance thresholds.
   * These define the "closeness" criteria for pairing transactions.
   * Can be overridden per-request via the POST /reconcile body.
   */
  matching: Object.freeze({
    /**
     * Maximum allowable timestamp difference (seconds).
     * Two transactions with timestamps further apart than this
     * will never be considered a match.
     */
    timestampToleranceSeconds: parseFloat(process.env.TIMESTAMP_TOLERANCE_SECONDS) || 300,

    /**
     * Maximum allowable quantity difference (percentage).
     * Calculated as: |qty_a - qty_b| / max(|qty_a|, |qty_b|) * 100
     * A value of 0.01 means 0.01% tolerance.
     */
    quantityTolerancePct: parseFloat(process.env.QUANTITY_TOLERANCE_PCT) || 0.01,
  }),

  /** Structured logging configuration */
  logging: Object.freeze({
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  }),

  /** Express rate limiting (per-IP) */
  rateLimit: Object.freeze({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  }),
});

module.exports = config;
