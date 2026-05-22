'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Reconciliation Controller
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * HTTP request handlers for the reconciliation API.
 * Responsibilities:
 *   - Input validation and sanitization
 *   - Delegating business logic to service layer
 *   - Formatting HTTP responses (JSON or CSV)
 *
 * This layer is intentionally thin — it validates input, calls services,
 * and formats output. No business logic lives here.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { runReconciliation, runWithSampleData } = require('../services/reconciliationService');
const { getReport, getSummary, getUnmatched } = require('../services/reportService');
const { entriesToCSV } = require('../utils/csvExporter');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/* ── POST /reconcile ─────────────────────────────────────────────────────── */

/**
 * Triggers a new reconciliation run.
 *
 * Accepts either:
 *   - { useSampleData: true } to use bundled sample CSVs (demo mode)
 *   - { userCsv: "...", exchangeCsv: "..." } with raw CSV content
 *
 * Optional tolerance overrides:
 *   - timestampToleranceSeconds: number (must be ≥ 0)
 *   - quantityTolerancePct: number (must be ≥ 0)
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function triggerReconciliation(req, res) {
  const {
    timestampToleranceSeconds,
    quantityTolerancePct,
    useSampleData = false,
    userCsv,
    exchangeCsv,
  } = req.body || {};

  // ── Validate tolerance overrides ─────────────────────────────────────────
  const toleranceOverrides = {};

  if (timestampToleranceSeconds !== undefined) {
    const parsed = parseFloat(timestampToleranceSeconds);
    if (isNaN(parsed) || parsed < 0) {
      throw ApiError.badRequest('timestampToleranceSeconds must be a non-negative number');
    }
    toleranceOverrides.timestampToleranceSeconds = parsed;
  }

  if (quantityTolerancePct !== undefined) {
    const parsed = parseFloat(quantityTolerancePct);
    if (isNaN(parsed) || parsed < 0) {
      throw ApiError.badRequest('quantityTolerancePct must be a non-negative number');
    }
    toleranceOverrides.quantityTolerancePct = parsed;
  }

  // ── Execute reconciliation ───────────────────────────────────────────────
  let result;

  if (useSampleData) {
    logger.info('Reconciliation triggered with bundled sample data');
    result = await runWithSampleData(toleranceOverrides);
  } else {
    // Validate that CSV content was provided
    if (!userCsv || !exchangeCsv) {
      throw ApiError.badRequest(
        'Provide "userCsv" and "exchangeCsv" strings in the request body, ' +
        'or set "useSampleData": true to use the bundled sample files.',
      );
    }
    result = await runReconciliation({ userCsv, exchangeCsv, toleranceOverrides });
  }

  // ── Return 202 Accepted (processing complete, report available) ──────────
  return res.status(202).json({
    success: true,
    message: 'Reconciliation completed',
    data: {
      runId: result.runId,
      summary: result.summary,
    },
  });
}

/* ── GET /report/:runId ──────────────────────────────────────────────────── */

/**
 * Retrieves the full reconciliation report for a run.
 * Supports pagination, category filtering, and CSV export.
 *
 * Query Parameters:
 *   - page (default: 1)
 *   - limit (default: 100)
 *   - category: matched | conflicting | unmatched_user | unmatched_exchange
 *   - format: json (default) | csv
 */
async function fetchReport(req, res) {
  const { runId } = req.params;
  const { category, page, limit, format } = req.query;

  const data = await getReport(runId, {
    category,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 100,
  });

  // CSV export mode — returns downloadable file
  if (format === 'csv') {
    const csvContent = entriesToCSV(data.entries);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report-${runId}.csv"`);
    return res.send(csvContent);
  }

  return res.json({ success: true, data });
}

/* ── GET /report/:runId/summary ──────────────────────────────────────────── */

/**
 * Retrieves summary counts and metadata for a reconciliation run.
 * Lightweight endpoint — no report entries returned.
 */
async function fetchSummary(req, res) {
  const { runId } = req.params;
  const data = await getSummary(runId);
  return res.json({ success: true, data });
}

/* ── GET /report/:runId/unmatched ────────────────────────────────────────── */

/**
 * Retrieves only unmatched entries with reasons.
 * Supports pagination and CSV export.
 *
 * Query Parameters:
 *   - page (default: 1)
 *   - limit (default: 100)
 *   - format: json (default) | csv
 */
async function fetchUnmatched(req, res) {
  const { runId } = req.params;
  const { page, limit, format } = req.query;

  const data = await getUnmatched(runId, {
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 100,
  });

  if (format === 'csv') {
    const csvContent = entriesToCSV(data.entries);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="unmatched-${runId}.csv"`);
    return res.send(csvContent);
  }

  return res.json({ success: true, data });
}

module.exports = {
  triggerReconciliation,
  fetchReport,
  fetchSummary,
  fetchUnmatched,
};
