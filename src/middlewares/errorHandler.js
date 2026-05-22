'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Global Error Handler Middleware
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Catches all errors that propagate through the Express middleware chain
 * and transforms them into consistent JSON error responses.
 *
 * Error Classification:
 *   1. ApiError (our custom class) → uses the attached statusCode
 *   2. Mongoose CastError → 400 (invalid ObjectId or field value)
 *   3. Mongoose ValidationError → 400 (schema validation failure)
 *   4. Everything else → 500 (unexpected server error)
 *
 * Security Note:
 *   Stack traces and internal error details are NEVER exposed to clients.
 *   They are logged server-side for debugging but the response only contains
 *   a safe, human-readable message.
 *
 * Must be registered LAST in the middleware chain (after all routes).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  // ── Mongoose CastError (e.g., invalid ObjectId format) ───────────────────
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: {
        message: `Invalid value for field "${err.path}": ${err.value}`,
      },
    });
  }

  // ── Mongoose ValidationError (schema constraint violation) ───────────────
  if (err.name === 'ValidationError') {
    const fieldErrors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        details: fieldErrors,
      },
    });
  }

  // ── Our custom ApiError (controlled, expected errors) ────────────────────
  if (err instanceof ApiError) {
    // Log server-side errors (5xx) for investigation
    if (err.statusCode >= 500) {
      logger.error('Server-side ApiError', {
        message: err.message,
        stack: err.stack,
      });
    }

    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  // ── Unexpected/unhandled errors (always 500) ─────────────────────────────
  logger.error('Unhandled error in request pipeline', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  return res.status(500).json({
    success: false,
    error: { message: 'Internal server error' },
  });
}

module.exports = errorHandler;
