'use strict';

const { Router } = require('express');
const {
  triggerReconciliation,
  fetchReport,
  fetchSummary,
  fetchUnmatched,
} = require('../controllers/reconciliationController');

const router = Router();

/**
 * POST /reconcile
 * Trigger a reconciliation run.
 * Body (JSON):
 *   { useSampleData?: boolean, userCsv?: string, exchangeCsv?: string,
 *     timestampToleranceSeconds?: number, quantityTolerancePct?: number }
 */
router.post('/reconcile', triggerReconciliation);

/**
 * GET /report/:runId?page=1&limit=100&category=matched&format=csv
 * Full report for a run.
 */
router.get('/report/:runId', fetchReport);

/**
 * GET /report/:runId/summary
 * Counts only: matched, conflicting, unmatched.
 */
router.get('/report/:runId/summary', fetchSummary);

/**
 * GET /report/:runId/unmatched?page=1&limit=100&format=csv
 * Unmatched rows with reasons.
 */
router.get('/report/:runId/unmatched', fetchUnmatched);

module.exports = router;
