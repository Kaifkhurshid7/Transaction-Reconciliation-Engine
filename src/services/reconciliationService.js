'use strict';

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const config = require('../config');
const { parseCSV } = require('../utils/csvParser');
const { reconcile } = require('./matchingEngine');
const logger = require('../utils/logger');

const Transaction = require('../models/Transaction');
const ReconciliationRun = require('../models/ReconciliationRun');
const ReportEntry = require('../models/ReportEntry');

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Reads a CSV from the filesystem (used by the sample-data loader).
 * @param {string} filePath
 * @returns {string}
 */
function readCSVFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Converts a raw validated record into a Transaction document object.
 */
function toTransactionDoc(record, runId, isValid) {
  return {
    transactionId: record.transactionId,
    source: record.source,
    runId,
    timestamp: record.timestamp || null,
    rawTimestamp: record.rawTimestamp || '',
    type: record.type || '',
    asset: record.asset || '',
    rawAsset: record.rawAsset || record.asset || '',
    quantity: record.quantity ?? null,
    priceUsd: record.priceUsd ?? null,
    fee: record.fee ?? null,
    note: record.note || '',
    isValid,
    dataQualityIssues: record.dataQualityIssues || [],
    warnings: record.warnings || [],
    lineNumber: record.lineNumber,
  };
}

/* ── Main service ─────────────────────────────────────────────────────────── */

/**
 * Runs a full reconciliation cycle:
 *   1. Parse both CSVs
 *   2. Persist all rows (valid + invalid) to Transactions collection
 *   3. Run matching engine on valid rows
 *   4. Persist report entries
 *   5. Update run summary & status
 *
 * @param {object} options
 * @param {string|Buffer} options.userCsv          - Raw CSV content
 * @param {string|Buffer} options.exchangeCsv      - Raw CSV content
 * @param {object}        [options.toleranceOverrides] - Optional config overrides
 * @returns {Promise<{ runId: string, summary: object }>}
 */
async function runReconciliation({ userCsv, exchangeCsv, toleranceOverrides = {} }) {
  const runId = uuidv4();
  const startedAt = new Date();

  /* ── Resolve effective tolerance (request overrides > env config) ──────── */
  const tolerance = {
    timestampToleranceSeconds:
      toleranceOverrides.timestampToleranceSeconds ??
      config.matching.timestampToleranceSeconds,
    quantityTolerancePct:
      toleranceOverrides.quantityTolerancePct ??
      config.matching.quantityTolerancePct,
  };

  logger.info('Reconciliation run started', { runId, tolerance });

  /* ── Create run document (status: running) ─────────────────────────────── */
  const run = await ReconciliationRun.create({
    runId,
    status: 'running',
    startedAt,
    config: tolerance,
  });

  try {
    /* ── Step 1: Parse CSVs ──────────────────────────────────────────────── */
    logger.info('Parsing CSVs', { runId });

    const [userResult, exchangeResult] = await Promise.all([
      parseCSV(userCsv, 'user'),
      parseCSV(exchangeCsv, 'exchange'),
    ]);

    /* ── Step 2: Persist all transactions ───────────────────────────────── */
    logger.info('Persisting transactions to DB', { runId });

    const userDocs = [
      ...userResult.validRecords.map((r) => toTransactionDoc(r, runId, true)),
      ...userResult.invalidRecords.map((r) => toTransactionDoc(r, runId, false)),
    ];
    const exchangeDocs = [
      ...exchangeResult.validRecords.map((r) => toTransactionDoc(r, runId, true)),
      ...exchangeResult.invalidRecords.map((r) => toTransactionDoc(r, runId, false)),
    ];

    await Transaction.insertMany([...userDocs, ...exchangeDocs], { ordered: false });

    /* ── Step 3: Run matching engine ─────────────────────────────────────── */
    logger.info('Running matching engine', { runId });

    const reportEntries = reconcile(
      userResult.validRecords,
      exchangeResult.validRecords,
      tolerance,
    );

    /* ── Step 4: Persist report entries ─────────────────────────────────── */
    logger.info('Persisting report entries', { runId, count: reportEntries.length });

    const entryDocs = reportEntries.map((entry) => ({
      runId,
      category: entry.category,
      reason: entry.reason,
      userTransaction: entry.userTransaction
        ? {
            transactionId: entry.userTransaction.transactionId,
            timestamp: entry.userTransaction.timestamp,
            rawTimestamp: entry.userTransaction.rawTimestamp,
            type: entry.userTransaction.type,
            asset: entry.userTransaction.asset,
            rawAsset: entry.userTransaction.rawAsset,
            quantity: entry.userTransaction.quantity,
            priceUsd: entry.userTransaction.priceUsd,
            fee: entry.userTransaction.fee,
            note: entry.userTransaction.note,
            source: 'user',
            warnings: entry.userTransaction.warnings || [],
          }
        : null,
      exchangeTransaction: entry.exchangeTransaction
        ? {
            transactionId: entry.exchangeTransaction.transactionId,
            timestamp: entry.exchangeTransaction.timestamp,
            rawTimestamp: entry.exchangeTransaction.rawTimestamp,
            type: entry.exchangeTransaction.type,
            asset: entry.exchangeTransaction.asset,
            rawAsset: entry.exchangeTransaction.rawAsset,
            quantity: entry.exchangeTransaction.quantity,
            priceUsd: entry.exchangeTransaction.priceUsd,
            fee: entry.exchangeTransaction.fee,
            note: entry.exchangeTransaction.note,
            source: 'exchange',
            warnings: entry.exchangeTransaction.warnings || [],
          }
        : null,
      timestampDiffSeconds: entry.timestampDiffSeconds ?? null,
      quantityDiffPct: entry.quantityDiffPct ?? null,
    }));

    await ReportEntry.insertMany(entryDocs, { ordered: false });

    /* ── Step 5: Build summary ───────────────────────────────────────────── */
    const summary = {
      matched: 0,
      conflicting: 0,
      unmatchedUser: 0,
      unmatchedExchange: 0,
    };

    for (const entry of reportEntries) {
      if (entry.category === 'matched') { summary.matched++; }
      else if (entry.category === 'conflicting') { summary.conflicting++; }
      else if (entry.category === 'unmatched_user') { summary.unmatchedUser++; }
      else if (entry.category === 'unmatched_exchange') { summary.unmatchedExchange++; }
    }

    /* ── Step 6: Finalise run document ───────────────────────────────────── */
    const completedAt = new Date();
    await ReconciliationRun.updateOne(
      { runId },
      {
        status: 'completed',
        completedAt,
        durationMs: completedAt - startedAt,
        ingestion: {
          userTotal: userResult.validRecords.length + userResult.invalidRecords.length,
          userValid: userResult.validRecords.length,
          userInvalid: userResult.invalidRecords.length,
          userDuplicates: userResult.duplicateIds.length,

          exchangeTotal: exchangeResult.validRecords.length + exchangeResult.invalidRecords.length,
          exchangeValid: exchangeResult.validRecords.length,
          exchangeInvalid: exchangeResult.invalidRecords.length,
          exchangeDuplicates: exchangeResult.duplicateIds.length,
        },
        summary,
      },
    );

    logger.info('Reconciliation run completed', { runId, summary });

    return { runId, summary, ingestion: run.ingestion };
  } catch (err) {
    logger.error('Reconciliation run failed', { runId, error: err.message, stack: err.stack });

    await ReconciliationRun.updateOne(
      { runId },
      { status: 'failed', errorMessage: err.message, completedAt: new Date() },
    );

    throw err;
  }
}

/* ── Convenience: run against the bundled sample files ───────────────────── */
async function runWithSampleData(toleranceOverrides = {}) {
  const samplesDir = path.resolve(__dirname, '../../data/samples');
  const userCsv = readCSVFile(path.join(samplesDir, 'user_transactions.csv'));
  const exchangeCsv = readCSVFile(path.join(samplesDir, 'exchange_transactions.csv'));
  return runReconciliation({ userCsv, exchangeCsv, toleranceOverrides });
}

module.exports = { runReconciliation, runWithSampleData };
