'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Custom API Error Class
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides a structured error type that carries an HTTP status code and optional
 * details. The global error handler middleware inspects these properties to
 * produce consistent JSON error responses.
 *
 * Usage Pattern:
 *   throw ApiError.badRequest('Invalid tolerance value');
 *   throw ApiError.notFound(`Run "${runId}" not found`);
 *   throw new ApiError(422, 'Unprocessable entity', { field: 'quantity' });
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code (4xx or 5xx)
   * @param {string} message    - Human-readable error description
   * @param {object} [details]  - Optional structured context (field errors, validation info)
   */
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;

    // Capture stack trace excluding this constructor from the trace
    Error.captureStackTrace(this, this.constructor);
  }

  /** Factory: 400 Bad Request — client sent invalid input */
  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  /** Factory: 404 Not Found — requested resource doesn't exist */
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  /** Factory: 500 Internal Server Error — unexpected server-side failure */
  static internal(message = 'Internal server error') {
    return new ApiError(500, message);
  }

  /** Factory: 422 Unprocessable Entity — valid syntax but semantic errors */
  static unprocessable(message, details) {
    return new ApiError(422, message, details);
  }
}

module.exports = ApiError;
