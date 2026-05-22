'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Express Application Factory
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Creates and configures the Express application instance.
 * Uses the factory pattern so the app can be instantiated independently
 * for testing (without starting the HTTP server or connecting to the DB).
 *
 * Middleware Stack (order matters):
 *   1. Security headers (Helmet)
 *   2. CORS
 *   3. Response compression
 *   4. Body parsing (JSON + URL-encoded, 10MB limit for CSV payloads)
 *   5. HTTP request logging (Morgan → Winston)
 *   6. Rate limiting (per-IP)
 *   7. Application routes
 *   8. 404 handler (catch-all for undefined routes)
 *   9. Global error handler (must be LAST)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('express-async-errors'); // Patches Express to forward async errors automatically

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');

/**
 * Creates a fully configured Express application.
 *
 * @returns {import('express').Application} Configured Express app
 */
function createApp() {
  const app = express();

  // ── Security Hardening ───────────────────────────────────────────────────
  app.use(helmet());   // Sets security-related HTTP headers
  app.use(cors());     // Enable Cross-Origin Resource Sharing

  // ── Performance ──────────────────────────────────────────────────────────
  app.use(compression()); // Gzip response compression

  // ── Body Parsing ─────────────────────────────────────────────────────────
  // 10MB limit accommodates large CSV payloads sent as JSON string values
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Observability ────────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Rate Limiting ────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,   // Return rate limit info in `RateLimit-*` headers
      legacyHeaders: false,    // Disable `X-RateLimit-*` headers
      message: {
        success: false,
        error: { message: 'Too many requests, please try again later.' },
      },
    }),
  );

  // ── Application Routes ───────────────────────────────────────────────────
  app.use(config.apiPrefix, routes);

  // ── 404 Catch-All ────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { message: 'Route not found' },
    });
  });

  // ── Global Error Handler (must be registered last) ───────────────────────
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
