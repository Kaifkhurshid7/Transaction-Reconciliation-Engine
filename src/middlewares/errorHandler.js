'use strict';

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Global Express error-handling middleware.
 * Must be registered LAST (after all routes).
 *
 * Handles:
 *   - ApiError instances → structured JSON response with the right HTTP code
 *   - Mongoose validation errors → 400
 *   - Everything else → 500
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  /* Mongoose CastError (invalid ObjectId, etc.) */
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: { message: `Invalid value for field "${err.path}": ${err.value}` },
    });
  }

  /* Mongoose ValidationError */
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      error: { message: 'Validation failed', details: messages },
    });
  }

  /* Our own ApiError */
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error('ApiError (server-side)', { message: err.message, stack: err.stack });
    }
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  /* Unexpected error */
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  return res.status(500).json({
    success: false,
    error: { message: 'Internal server error' },
  });
}

module.exports = errorHandler;
