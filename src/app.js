'use strict';

require('express-async-errors'); // patches express to forward async errors to error handler

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');

function createApp() {
  const app = express();

  /* ── Security & compression ─────────────────────────────────────────────── */
  app.use(helmet());
  app.use(cors());
  app.use(compression());

  /* ── Body parsing ───────────────────────────────────────────────────────── */
  // Allow large bodies so callers can POST raw CSV strings directly
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  /* ── HTTP request logging ───────────────────────────────────────────────── */
  app.use(requestLogger);

  /* ── Rate limiting ──────────────────────────────────────────────────────── */
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: { message: 'Too many requests, please try again later.' } },
    }),
  );

  /* ── Routes ─────────────────────────────────────────────────────────────── */
  app.use(config.apiPrefix, routes);

  /* ── 404 handler ────────────────────────────────────────────────────────── */
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { message: 'Route not found' } });
  });

  /* ── Global error handler (must be last) ────────────────────────────────── */
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
