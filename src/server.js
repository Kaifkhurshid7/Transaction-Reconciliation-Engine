'use strict';

const createApp = require('./app');
const { connectDB } = require('./db');
const config = require('./config');
const logger = require('./utils/logger');

async function bootstrap() {
  /* Connect to MongoDB before accepting traffic */
  await connectDB();

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info(`Server listening`, {
      port: config.port,
      env: config.env,
      apiPrefix: config.apiPrefix,
    });
  });

  /* ── Graceful shutdown ──────────────────────────────────────────────────── */
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  /* ── Unhandled rejections / exceptions ──────────────────────────────────── */
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason });
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
