'use strict';

const ReconciliationRun = require('../models/ReconciliationRun');
const ReportEntry = require('../models/ReportEntry');
const ApiError = require('../utils/ApiError');

/**
 * Fetches the run document and throws 404 if not found.
 */
async function getRunOrThrow(runId) {
  const run = await ReconciliationRun.findOne({ runId }).lean();
  if (!run) { throw ApiError.notFound(`Reconciliation run "${runId}" not found`); }
  return run;
}

/**
 * Returns the full report entries for a run.
 * Supports optional category filter and pagination.
 *
 * @param {string}  runId
 * @param {object}  [opts]
 * @param {string}  [opts.category]   - filter by category
 * @param {number}  [opts.page=1]
 * @param {number}  [opts.limit=100]
 */
async function getReport(runId, { category, page = 1, limit = 100 } = {}) {
  await getRunOrThrow(runId);

  const filter = { runId };
  if (category) { filter.category = category; }

  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    ReportEntry.find(filter).skip(skip).limit(limit).lean(),
    ReportEntry.countDocuments(filter),
  ]);

  return {
    runId,
    page,
    limit,
    total,
    entries,
  };
}

/**
 * Returns only the summary counts for a run.
 *
 * @param {string} runId
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
 * Returns only the unmatched entries (both user-only and exchange-only) for a run.
 *
 * @param {string} runId
 * @param {object} [opts]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=100]
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

  return {
    runId,
    page,
    limit,
    total,
    entries,
  };
}

module.exports = { getReport, getSummary, getUnmatched };
