'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Reconciliation Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Defines the REST API surface for the reconciliation engine.
 *
 * Endpoints:
 *   POST /reconcile              - Trigger a new reconciliation run
 *   GET  /report/:runId          - Full report (paginated, filterable, CSV export)
 *   GET  /report/:runId/summary  - Summary counts only
 *   GET  /report/:runId/unmatched - Unmatched entries with reasons
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

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
 *
 * Triggers a reconciliation run. Accepts optional configuration overrides.
 *
 * Request Body (JSON):
 *   {
 *     "useSampleData": boolean,              // Use bundled sample CSVs
 *     "userCsv": string,                     // Raw user CSV content
 *     "exchangeCsv": string,                 // Raw exchange CSV content
 *     "timestampToleranceSeconds": number,   // Override timestamp tolerance
 *     "quantityTolerancePct": number         // Override quantity tolerance
 *   }
 *
 * Response: 202 Accepted with runId and summary counts
 */
router.post('/reconcile', triggerReconciliation);

/**
 * GET /report/:runId
 *
 * Retrieves the full reconciliation report for a completed run.
 *
 * Query Parameters:
 *   - page (number, default: 1)
 *   - limit (number, default: 100)
 *   - category (string): matched | conflicting | unmatched_user | unmatched_exchange
 *   - format (string): json (default) | csv
 */
router.get('/report/:runId', fetchReport);

/**
 * GET /report/:runId/summary
 *
 * Lightweight endpoint returning only aggregate counts and run metadata.
 * No report entries are included in the response.
 */
router.get('/report/:runId/summary', fetchSummary);

/**
 * GET /report/:runId/unmatched
 *
 * Returns only unmatched entries (user-only + exchange-only) with reasons.
 * Useful for investigating reconciliation gaps.
 *
 * Query Parameters:
 *   - page (number, default: 1)
 *   - limit (number, default: 100)
 *   - format (string): json (default) | csv
 */
router.get('/report/:runId/unmatched', fetchUnmatched);

module.exports = router;
