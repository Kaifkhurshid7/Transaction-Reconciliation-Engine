'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Application Entry Point
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bootstraps the application:
 *   1. Establishes MongoDB connection (with retry logic)
 *   2. Creates the Express application
 *   3. Starts the HTTP server
 *   4. Registers graceful shutdown handlers
 *   5. Catches unhandled rejections and uncaught exceptions
 *
 * Graceful Shutdown:
 *   On SIGTERM/SIGINT, the server stops accepting new connections,
 *   waits for in-flight requests to complete, disconnects from MongoDB,
 *   and then exits cleanly. This is critical for zero-downtime deployments
 *   in containerized environments (Docker, Kubernetes).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const createApp = require('./app');
const { connectDB } = require('./db');
const config = require('./config');
const logger = require('./utils/logger');

/**
 * Application bootstrap sequence.
 * Connects to the database before accepting HTTP traffic (fail-fast principle).
 */
async function bootstrap() {
  // Phase 1: Establish database connectivity
  await connectDB();

  // Phase 2: Create and start HTTP server
  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info('Server started successfully', {
      port: config.port,
      environment: config.env,
      apiPrefix: config.apiPrefix,
    });
  });

  // ── Graceful Shutdown Handler ──────────────────────────────────────────────
  const initiateGracefulShutdown = async (signal) => {
    logger.info(`${signal} received — initiating graceful shutdown`);

    server.close(async () => {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
      logger.info('Server shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => initiateGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => initiateGracefulShutdown('SIGINT'));

  // ── Global Error Safety Nets ───────────────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception — process will exit', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

// ── Execute Bootstrap ────────────────────────────────────────────────────────
bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', error);
  process.exit(1);
});
