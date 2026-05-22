'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Root Router
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Aggregates all route modules and provides infrastructure endpoints.
 * New feature routes should be mounted here.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { Router } = require('express');
const reconciliationRoutes = require('./reconciliation');

const router = Router();

/**
 * GET /health
 * Health check endpoint for uptime monitoring, load balancer probes,
 * and Kubernetes readiness/liveness checks.
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'crypto-reconciliation-engine',
    timestamp: new Date().toISOString(),
  });
});

// Mount reconciliation routes (POST /reconcile, GET /report/:runId, etc.)
router.use('/', reconciliationRoutes);

module.exports = router;
