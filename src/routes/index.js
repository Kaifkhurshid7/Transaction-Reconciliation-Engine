'use strict';

const { Router } = require('express');
const reconciliationRoutes = require('./reconciliation');

const router = Router();

/* Health check — useful for uptime monitoring and k8s readiness probes */
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/', reconciliationRoutes);

module.exports = router;
