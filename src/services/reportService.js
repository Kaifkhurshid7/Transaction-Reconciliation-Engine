'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Report Query Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides read-only access to reconciliation reports stored in MongoDB.
 * Handles pagination, category filtering, and run existence validation.
 *
 * Separation of Concerns:
 *   - reconciliationService: writes (creates runs, persists results)
 *   - reportService: reads (queries reports, summaries, filtered views)
 *
 * This separation allows independent scaling and caching of read operations
 * without affecting the write path.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ReconciliationRun = require('../models/ReconciliationRun');
const ReportEntry = require('../models/ReportEntry');
const ApiError = require('../utils/ApiError');

/* ── Internal Helpers ─────────────────────────────────────────────────────── */

/**
 * Fetches a reconciliation run by ID, throwing 404 if not found.
 * Used as a guard before querying report entries.
 *
 * @param {string} runId - UUID of the reconciliation run
 * @returns {Promise<object>} The run document (lean)
 * @throws {ApiError} 404 if run doesn't exist
 */
async function getRunOrThrow(runId) {
  const run = await ReconciliationRun.findOne({ runId }).lean();

  if (!run) {
    throw ApiError.notFound(`Reconciliation run "${runId}" not found`);
  }

  return run;
}

/* ── Public Service Methods ───────────────────────────────────────────────── */

/**
 * Retrieves the full reconciliation report for a run.
 * Supports pagination and optional category filtering.
 *
 * @param {string} runId              - UUID of the reconciliation run
 * @param {object} [options]          - Query options
 * @param {string} [options.category] - Filter by category (matched, conflicting, etc.)
 * @param {number} [options.page=1]   - Page number (1-based)
 * @param {number} [options.limit=100] - Results per page
 * @returns {Promise<{ runId, page, limit, total, entries }>}
 */
async function getReport(runId, { category, page = 1, limit = 100 } = {}) {
  await getRunOrThrow(runId);

  const filter = { runId };
  if (category) {
    filter.category = category;
  }

  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    ReportEntry.find(filter).skip(skip).limit(limit).lean(),
    ReportEntry.countDocuments(filter),
  ]);

  return { runId, page, limit, total, entries };
}

/**
 * Retrieves the summary metadata for a reconciliation run.
 * Includes configuration used, ingestion stats, and category counts.
 *
 * @param {string} runId - UUID of the reconciliation run
 * @returns {Promise<object>} Run metadata with summary counts
 */
async function getSummary(runId) {
  const run = await getRunOrThrow(runId);

  return {
    runId,
    status: run.status,
    config: run.config,
    ingestion: run.ingestion,
    summary: run.summary,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
  };
}

/**
 * Retrieves only unmatched entries (user-only + exchange-only) for a run.
 * Useful for investigating why certain transactions couldn't be paired.
 *
 * @param {string} runId              - UUID of the reconciliation run
 * @param {object} [options]          - Query options
 * @param {number} [options.page=1]   - Page number (1-based)
 * @param {number} [options.limit=100] - Results per page
 * @returns {Promise<{ runId, page, limit, total, entries }>}
 */
async function getUnmatched(runId, { page = 1, limit = 100 } = {}) {
  await getRunOrThrow(runId);

  const filter = {
    runId,
    category: { $in: ['unmatched_user', 'unmatched_exchange'] },
  };

  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    ReportEntry.find(filter).skip(skip).limit(limit).lean(),
    ReportEntry.countDocuments(filter),
  ]);

  return { runId, page, limit, total, entries };
}

module.exports = { getReport, getSummary, getUnmatched };
