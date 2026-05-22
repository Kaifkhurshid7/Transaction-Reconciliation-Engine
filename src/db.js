'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MongoDB Connection Manager
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Handles database connectivity with exponential backoff retry logic.
 * The server will not accept HTTP traffic until a successful DB connection
 * is established (fail-fast principle for infrastructure dependencies).
 *
 * Retry Strategy:
 *   - Linear backoff: delay = BASE_DELAY × attempt_number
 *   - Maximum 5 attempts before process exit
 *   - Logs each attempt for operational visibility
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./utils/logger');

/** Base delay between retry attempts (multiplied by attempt number) */
const RETRY_BASE_DELAY_MS = 5000;

/** Maximum connection attempts before giving up */
const MAX_CONNECTION_RETRIES = 5;

/**
 * Establishes a MongoDB connection with retry logic.
 *
 * @param {number} [attempt=1] - Current attempt number (used internally for recursion)
 * @returns {Promise<void>} Resolves when connected, exits process on failure
 */
async function connectDB(attempt = 1) {
  try {
    await mongoose.connect(config.db.uri, {
      serverSelectionTimeoutMS: 5000,
    });

    logger.info('MongoDB connection established', {
      uri: config.db.uri.replace(/\/\/.*@/, '//<credentials>@'), // Mask credentials in logs
    });
  } catch (error) {
    logger.error('MongoDB connection attempt failed', {
      attempt,
      maxRetries: MAX_CONNECTION_RETRIES,
      error: error.message,
    });

    if (attempt >= MAX_CONNECTION_RETRIES) {
      logger.error('All MongoDB connection retries exhausted — terminating process');
      process.exit(1);
    }

    const delayMs = RETRY_BASE_DELAY_MS * attempt;
    logger.info(`Retrying MongoDB connection in ${delayMs / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    return connectDB(attempt + 1);
  }
}

/**
 * Gracefully disconnects from MongoDB.
 * Called during server shutdown to release connection pool resources.
 *
 * @returns {Promise<void>}
 */
async function disconnectDB() {
  await mongoose.disconnect();
  logger.info('MongoDB connection closed');
}

module.exports = { connectDB, disconnectDB };
