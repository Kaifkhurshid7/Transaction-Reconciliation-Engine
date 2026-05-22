'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Reconciliation Orchestration Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates the complete reconciliation lifecycle:
 *   1. Parse both CSV sources (user + exchange)
 *   2. Persist all ingested rows to the database (valid + invalid)
 *   3. Execute the matching engine on valid rows
 *   4. Persist the reconciliation report entries
 *   5. Update the run document with summary statistics
 *
 * This service is the single entry point for triggering reconciliation.
 * It coordinates between the CSV parser, matching engine, and database models.
 *
 * Error Handling:
 *   If any step fails, the run status is set to 'failed' with the error message,
 *   and the error is re-thrown for the controller to handle.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

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

/* ── Internal Helpers ─────────────────────────────────────────────────────── */

/**
 * Reads a CSV file from the filesystem.
 * Used by the sample-data loader for demo/testing purposes.
 *
 * @param {string} filePath - Absolute path to the CSV file
 * @returns {string} Raw CSV content as a UTF-8 string
 */
function readCSVFromDisk(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Transforms a validated record into a Transaction document shape.
 * Handles both valid and invalid records uniformly.
 *
 * @param {object}  record  - Parsed and validated record from csvParser
 * @param {string}  runId   - UUID of the current reconciliation run
 * @param {boolean} isValid - Whether this record passed validation
 * @returns {object} Document ready for MongoDB insertion
 */
function buildTransactionDocument(record, runId, isValid) {
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

/**
 * Transforms a matching engine result into a ReportEntry document shape.
 *
 * @param {object} entry - Raw entry from the matching engine
 * @param {string} runId - UUID of the current reconciliation run
 * @returns {object} Document ready for MongoDB insertion
 */
function buildReportEntryDocument(entry, runId) {
  return {
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
  };
}

/**
 * Aggregates report entries into summary counts by category.
 *
 * @param {object[]} reportEntries - Array of matching engine results
 * @returns {object} Summary counts: { matched, conflicting, unmatchedUser, unmatchedExchange }
 */
function buildSummaryCounts(reportEntries) {
  const summary = {
    matched: 0,
    conflicting: 0,
    unmatchedUser: 0,
    unmatchedExchange: 0,
  };

  for (const entry of reportEntries) {
    switch (entry.category) {
      case 'matched':
        summary.matched++;
        break;
      case 'conflicting':
        summary.conflicting++;
        break;
      case 'unmatched_user':
        summary.unmatchedUser++;
        break;
      case 'unmatched_exchange':
        summary.unmatchedExchange++;
        break;
    }
  }

  return summary;
}

/* ── Main Reconciliation Service ──────────────────────────────────────────── */

/**
 * Executes a complete reconciliation run from CSV ingestion to report generation.
 *
 * @param {object}        options
 * @param {string|Buffer} options.userCsv              - Raw user CSV content
 * @param {string|Buffer} options.exchangeCsv          - Raw exchange CSV content
 * @param {object}        [options.toleranceOverrides]  - Per-request tolerance overrides
 * @returns {Promise<{ runId: string, summary: object }>}
 */
async function runReconciliation({ userCsv, exchangeCsv, toleranceOverrides = {} }) {
  const runId = uuidv4();
  const startedAt = new Date();

  // ── Resolve effective tolerances (request overrides take precedence) ────
  const effectiveTolerance = {
    timestampToleranceSeconds:
      toleranceOverrides.timestampToleranceSeconds ??
      config.matching.timestampToleranceSeconds,
    quantityTolerancePct:
      toleranceOverrides.quantityTolerancePct ??
      config.matching.quantityTolerancePct,
  };

  logger.info('Reconciliation run initiated', { runId, tolerance: effectiveTolerance });

  // ── Create run document with 'running' status ──────────────────────────
  await ReconciliationRun.create({
    runId,
    status: 'running',
    startedAt,
    config: effectiveTolerance,
  });

  try {
    // ── Phase 1: CSV Ingestion ─────────────────────────────────────────────
    logger.info('Phase 1: Parsing CSV sources', { runId });

    const [userParseResult, exchangeParseResult] = await Promise.all([
      parseCSV(userCsv, 'user'),
      parseCSV(exchangeCsv, 'exchange'),
    ]);

    // ── Phase 2: Persist all transactions to database ──────────────────────
    logger.info('Phase 2: Persisting transactions', { runId });

    const userDocuments = [
      ...userParseResult.validRecords.map((r) => buildTransactionDocument(r, runId, true)),
      ...userParseResult.invalidRecords.map((r) => buildTransactionDocument(r, runId, false)),
    ];

    const exchangeDocuments = [
      ...exchangeParseResult.validRecords.map((r) => buildTransactionDocument(r, runId, true)),
      ...exchangeParseResult.invalidRecords.map((r) => buildTransactionDocument(r, runId, false)),
    ];

    await Transaction.insertMany(
      [...userDocuments, ...exchangeDocuments],
      { ordered: false }, // Continue inserting even if individual docs fail
    );

    // ── Phase 3: Execute matching engine ───────────────────────────────────
    logger.info('Phase 3: Running matching engine', { runId });

    const reportEntries = reconcile(
      userParseResult.validRecords,
      exchangeParseResult.validRecords,
      effectiveTolerance,
    );

    // ── Phase 4: Persist report entries ────────────────────────────────────
    logger.info('Phase 4: Persisting report entries', { runId, count: reportEntries.length });

    const reportDocuments = reportEntries.map((entry) => buildReportEntryDocument(entry, runId));
    await ReportEntry.insertMany(reportDocuments, { ordered: false });

    // ── Phase 5: Finalize run with summary ─────────────────────────────────
    const summary = buildSummaryCounts(reportEntries);
    const completedAt = new Date();

    await ReconciliationRun.updateOne(
      { runId },
      {
        status: 'completed',
        completedAt,
        durationMs: completedAt - startedAt,
        ingestion: {
          userTotal: userParseResult.validRecords.length + userParseResult.invalidRecords.length,
          userValid: userParseResult.validRecords.length,
          userInvalid: userParseResult.invalidRecords.length,
          userDuplicates: userParseResult.duplicateIds.length,
          exchangeTotal: exchangeParseResult.validRecords.length + exchangeParseResult.invalidRecords.length,
          exchangeValid: exchangeParseResult.validRecords.length,
          exchangeInvalid: exchangeParseResult.invalidRecords.length,
          exchangeDuplicates: exchangeParseResult.duplicateIds.length,
        },
        summary,
      },
    );

    logger.info('Reconciliation run completed successfully', { runId, summary });

    return { runId, summary };
  } catch (error) {
    // ── Error handling: mark run as failed ──────────────────────────────────
    logger.error('Reconciliation run failed', {
      runId,
      error: error.message,
      stack: error.stack,
    });

    await ReconciliationRun.updateOne(
      { runId },
      {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date(),
      },
    );

    throw error;
  }
}

/* ── Convenience: Run with bundled sample data ────────────────────────────── */

/**
 * Executes reconciliation using the bundled sample CSV files.
 * Useful for demos, testing, and the `useSampleData: true` API option.
 *
 * @param {object} [toleranceOverrides] - Optional tolerance overrides
 * @returns {Promise<{ runId: string, summary: object }>}
 */
async function runWithSampleData(toleranceOverrides = {}) {
  const samplesDirectory = path.resolve(__dirname, '../../data/samples');

  const userCsv = readCSVFromDisk(path.join(samplesDirectory, 'user_transactions.csv'));
  const exchangeCsv = readCSVFromDisk(path.join(samplesDirectory, 'exchange_transactions.csv'));

  return runReconciliation({ userCsv, exchangeCsv, toleranceOverrides });
}

module.exports = { runReconciliation, runWithSampleData };
