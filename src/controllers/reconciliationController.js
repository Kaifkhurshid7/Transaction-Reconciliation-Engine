'use strict';

const { runReconciliation, runWithSampleData } = require('../services/reconciliationService');
const { getReport, getSummary, getUnmatched } = require('../services/reportService');
const { entriesToCSV } = require('../utils/csvExporter');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/* ── POST /reconcile ─────────────────────────────────────────────────────── */

/**
 * Accepts optional JSON body:
 * {
 *   "timestampToleranceSeconds": 300,   // override
 *   "quantityTolerancePct": 0.01,       // override
 *   "useSampleData": true               // use bundled sample CSVs (demo mode)
 * }
 *
 * For real usage, POST multipart/form-data with files:
 *   - userCsv
 *   - exchangeCsv
 *
 * For simplicity (no file-upload middleware added), the body can also contain
 * raw CSV strings under keys "userCsv" and "exchangeCsv".
 */
async function triggerReconciliation(req, res) {
  const {
    timestampToleranceSeconds,
    quantityTolerancePct,
    useSampleData = false,
    userCsv,
    exchangeCsv,
  } = req.body || {};

  /* Build tolerance override object (only include if provided) */
  const toleranceOverrides = {};
  if (timestampToleranceSeconds !== undefined) {
    const v = parseFloat(timestampToleranceSeconds);
    if (isNaN(v) || v < 0) {
      throw ApiError.badRequest('timestampToleranceSeconds must be a non-negative number');
    }
    toleranceOverrides.timestampToleranceSeconds = v;
  }
  if (quantityTolerancePct !== undefined) {
    const v = parseFloat(quantityTolerancePct);
    if (isNaN(v) || v < 0) {
      throw ApiError.badRequest('quantityTolerancePct must be a non-negative number');
    }
    toleranceOverrides.quantityTolerancePct = v;
  }

  let result;

  if (useSampleData) {
    logger.info('Running reconciliation with bundled sample data');
    result = await runWithSampleData(toleranceOverrides);
  } else {
    /* Expect inline CSV strings in the request body */
    if (!userCsv || !exchangeCsv) {
      throw ApiError.badRequest(
        'Provide "userCsv" and "exchangeCsv" strings in the request body, ' +
        'or set "useSampleData": true to use the bundled sample files.',
      );
    }
    result = await runReconciliation({
      userCsv,
      exchangeCsv,
      toleranceOverrides,
    });
  }

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

async function fetchReport(req, res) {
  const { runId } = req.params;
  const { category, page, limit, format } = req.query;

  const data = await getReport(runId, {
    category,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 100,
  });

  /* CSV export mode */
  if (format === 'csv') {
    const csv = entriesToCSV(data.entries);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report-${runId}.csv"`);
    return res.send(csv);
  }

  return res.json({ success: true, data });
}

/* ── GET /report/:runId/summary ──────────────────────────────────────────── */

async function fetchSummary(req, res) {
  const { runId } = req.params;
  const data = await getSummary(runId);
  return res.json({ success: true, data });
}

/* ── GET /report/:runId/unmatched ────────────────────────────────────────── */

async function fetchUnmatched(req, res) {
  const { runId } = req.params;
  const { page, limit, format } = req.query;

  const data = await getUnmatched(runId, {
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 100,
  });

  if (format === 'csv') {
    const csv = entriesToCSV(data.entries);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="unmatched-${runId}.csv"`);
    return res.send(csv);
  }

  return res.json({ success: true, data });
}

module.exports = {
  triggerReconciliation,
  fetchReport,
  fetchSummary,
  fetchUnmatched,
};
