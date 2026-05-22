'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CSV Ingestion & Row-Level Validation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Responsible for:
 *   1. Streaming CSV content through a parser (handles large files efficiently)
 *   2. Validating each row against business rules
 *   3. Normalizing data (asset aliases, type casing, numeric parsing)
 *   4. Detecting and flagging data quality issues WITHOUT silently dropping rows
 *   5. Detecting duplicate transaction IDs within a single source
 *
 * Design Decisions:
 *   - Invalid rows are NEVER dropped — they're collected with reasons attached
 *   - Warnings (non-fatal issues like alias resolution) are tracked separately
 *   - The parser uses streaming mode for memory efficiency with large CSVs
 *   - Duplicate detection keeps the FIRST occurrence and flags subsequent ones
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { parse } = require('csv-parse');
const { Readable } = require('stream');
const { canonicalAsset } = require('../config/assetAliases');
const logger = require('./logger');

/* ── Column Schema ────────────────────────────────────────────────────────── */

/** Columns that must be present and non-empty for a row to be valid */
const REQUIRED_COLUMNS = Object.freeze([
  'transaction_id',
  'timestamp',
  'type',
  'asset',
  'quantity',
]);

/** Recognized transaction types (unknown types generate a warning, not an error) */
const VALID_TRANSACTION_TYPES = new Set(['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT']);

/* ── Field-Level Validators ───────────────────────────────────────────────── */

/**
 * Validates and parses a timestamp string into a Date object.
 *
 * Edge cases handled:
 *   - Empty/null values → flagged as missing
 *   - Truncated ISO strings (e.g., "2024-03-09T") → flagged as malformed
 *   - Non-parseable strings → flagged as malformed
 *
 * @param {string} rawTimestamp - Raw timestamp value from CSV
 * @returns {{ valid: boolean, value?: Date, reason?: string }}
 */
function parseTimestamp(rawTimestamp) {
  if (!rawTimestamp || rawTimestamp.trim() === '') {
    return { valid: false, reason: 'Missing timestamp' };
  }

  const parsed = new Date(rawTimestamp.trim());

  if (isNaN(parsed.getTime())) {
    return { valid: false, reason: `Malformed timestamp: "${rawTimestamp}"` };
  }

  return { valid: true, value: parsed };
}

/**
 * Validates and parses a quantity field.
 *
 * Business Rule: Quantities must be non-negative numbers.
 * A negative quantity indicates a data entry error (the type field
 * already encodes direction via BUY/SELL/TRANSFER_IN/TRANSFER_OUT).
 *
 * @param {string} rawQuantity - Raw quantity value from CSV
 * @returns {{ valid: boolean, value?: number, reason?: string }}
 */
function parseQuantity(rawQuantity) {
  if (rawQuantity === null || rawQuantity === undefined || rawQuantity.trim() === '') {
    return { valid: false, reason: 'Missing quantity' };
  }

  const numericValue = parseFloat(rawQuantity);

  if (isNaN(numericValue)) {
    return { valid: false, reason: `Non-numeric quantity: "${rawQuantity}"` };
  }

  if (numericValue < 0) {
    return { valid: false, reason: `Negative quantity: ${numericValue}` };
  }

  return { valid: true, value: numericValue };
}

/**
 * Validates and normalizes a transaction type.
 *
 * Unknown types generate a WARNING (not an error) because exchanges may
 * introduce new transaction types that we haven't mapped yet. The row
 * remains valid but carries a warning for manual review.
 *
 * @param {string} rawType - Raw type value from CSV
 * @returns {{ valid: boolean, value?: string, warning?: string, reason?: string }}
 */
function parseTransactionType(rawType) {
  if (!rawType || rawType.trim() === '') {
    return { valid: false, reason: 'Missing type' };
  }

  const normalized = rawType.trim().toUpperCase();

  if (!VALID_TRANSACTION_TYPES.has(normalized)) {
    // Non-fatal: unknown type is still stored, but flagged for review
    return { valid: true, value: normalized, warning: `Unrecognised type: "${rawType}"` };
  }

  return { valid: true, value: normalized };
}

/* ── Row-Level Validation ─────────────────────────────────────────────────── */

/**
 * Validates a single parsed CSV row against all business rules.
 *
 * Validation pipeline:
 *   1. Check structural completeness (all required columns present)
 *   2. Validate transaction_id (non-empty)
 *   3. Validate and parse timestamp
 *   4. Validate and normalize type
 *   5. Validate and resolve asset (with alias lookup)
 *   6. Validate and parse quantity
 *   7. Parse optional numeric fields (price_usd, fee)
 *
 * @param {Record<string, string>} row        - Raw CSV row as key-value pairs
 * @param {number}                 lineNumber - 1-based line number in source file
 * @param {'user'|'exchange'}      source     - Which data source this row belongs to
 * @returns {{ valid: boolean, record: object, issues: string[], warnings: string[] }}
 */
function validateRow(row, lineNumber, source) {
  const issues = [];
  const warnings = [];

  // ── Step 1: Structural completeness check ──────────────────────────────
  for (const column of REQUIRED_COLUMNS) {
    if (!(column in row)) {
      issues.push(`Missing required column: "${column}"`);
    }
  }

  if (issues.length > 0) {
    return { valid: false, record: { ...row, source, lineNumber }, issues, warnings };
  }

  // ── Step 2: Transaction ID validation ──────────────────────────────────
  const transactionId = (row.transaction_id || '').trim();
  if (!transactionId) {
    issues.push('Empty transaction_id');
  }

  // ── Step 3: Timestamp validation ───────────────────────────────────────
  const timestampResult = parseTimestamp(row.timestamp);
  if (!timestampResult.valid) {
    issues.push(timestampResult.reason);
  }

  // ── Step 4: Type validation ────────────────────────────────────────────
  const typeResult = parseTransactionType(row.type);
  if (!typeResult.valid) {
    issues.push(typeResult.reason);
  }
  if (typeResult.warning) {
    warnings.push(typeResult.warning);
  }

  // ── Step 5: Asset validation & alias resolution ────────────────────────
  const rawAsset = (row.asset || '').trim();
  if (!rawAsset) {
    issues.push('Missing asset');
  }

  const resolvedAsset = canonicalAsset(rawAsset);

  // Track when an alias was resolved (useful for audit trail)
  if (rawAsset && resolvedAsset !== rawAsset.toUpperCase()) {
    warnings.push(`Asset alias resolved: "${rawAsset}" → "${resolvedAsset}"`);
  }

  // ── Step 6: Quantity validation ────────────────────────────────────────
  const quantityResult = parseQuantity(row.quantity);
  if (!quantityResult.valid) {
    issues.push(quantityResult.reason);
  }

  // ── Step 7: Optional numeric fields ────────────────────────────────────
  const priceUsd = row.price_usd ? parseFloat(row.price_usd) : null;
  const fee = row.fee ? parseFloat(row.fee) : null;

  // ── Build result ───────────────────────────────────────────────────────
  if (issues.length > 0) {
    logger.warn('Row flagged with data quality issues', {
      source,
      lineNumber,
      transactionId: transactionId || row.transaction_id,
      issues,
    });

    return {
      valid: false,
      record: {
        transactionId: transactionId || row.transaction_id,
        rawTimestamp: row.timestamp,
        type: row.type,
        asset: rawAsset,
        quantity: row.quantity,
        priceUsd,
        fee,
        note: row.note || null,
        source,
        lineNumber,
      },
      issues,
      warnings,
    };
  }

  return {
    valid: true,
    record: {
      transactionId,
      timestamp: timestampResult.value,
      rawTimestamp: row.timestamp,
      type: typeResult.value,
      asset: resolvedAsset,
      rawAsset,
      quantity: quantityResult.value,
      priceUsd,
      fee,
      note: row.note || null,
      source,
      lineNumber,
    },
    issues: [],
    warnings,
  };
}

/* ── Main CSV Parser ──────────────────────────────────────────────────────── */

/**
 * Parses a CSV string/Buffer into validated records and flagged invalid records.
 *
 * Processing Pipeline:
 *   1. Stream CSV content through csv-parse (handles malformed rows gracefully)
 *   2. Validate each row via validateRow()
 *   3. Detect duplicate transaction IDs (first occurrence kept, duplicates flagged)
 *   4. Return structured result with valid records, invalid records, and duplicate IDs
 *
 * Memory Efficiency:
 *   Uses Node.js streams internally — suitable for large CSV files.
 *   The csv-parse library handles ragged rows (inconsistent column counts)
 *   without crashing.
 *
 * @param {string|Buffer}      csvContent - Raw CSV file content
 * @param {'user'|'exchange'}  source     - Data source identifier
 * @returns {Promise<{
 *   validRecords: object[],
 *   invalidRecords: object[],
 *   duplicateIds: string[]
 * }>}
 */
async function parseCSV(csvContent, source) {
  return new Promise((resolve, reject) => {
    const validRecords = [];
    const invalidRecords = [];
    const seenTransactionIds = new Map(); // transactionId → first seen line number
    const duplicateIds = [];
    let lineNumber = 1; // Header occupies line 1

    const parser = parse({
      columns: true,           // Use first row as column headers
      skip_empty_lines: true,  // Ignore blank lines in messy data
      trim: true,              // Strip whitespace from all values
      relax_column_count: true, // Don't crash on ragged rows (missing trailing columns)
    });

    parser.on('readable', () => {
      let row;
      while ((row = parser.read()) !== null) {
        lineNumber++;

        const result = validateRow(row, lineNumber, source);

        // Invalid rows are collected with their issues — never silently dropped
        if (!result.valid) {
          invalidRecords.push({
            ...result.record,
            dataQualityIssues: result.issues,
            warnings: result.warnings,
          });
          continue;
        }

        // ── Duplicate transaction ID detection ─────────────────────────────
        // Business Rule: Each transaction_id should appear exactly once per source.
        // The first occurrence is kept; subsequent duplicates are flagged as invalid.
        const { transactionId } = result.record;

        if (seenTransactionIds.has(transactionId)) {
          const firstSeenLine = seenTransactionIds.get(transactionId);

          logger.warn('Duplicate transaction_id detected', {
            source,
            transactionId,
            firstSeenLine,
            currentLine: lineNumber,
          });

          duplicateIds.push(transactionId);

          invalidRecords.push({
            ...result.record,
            dataQualityIssues: [
              `Duplicate transaction_id (first seen on line ${firstSeenLine})`,
            ],
            warnings: result.warnings,
          });
          continue;
        }

        seenTransactionIds.set(transactionId, lineNumber);

        // Log warnings for valid rows that had non-fatal issues
        if (result.warnings.length > 0) {
          logger.info('Row parsed with warnings', {
            source,
            lineNumber,
            transactionId,
            warnings: result.warnings,
          });
        }

        validRecords.push({ ...result.record, warnings: result.warnings });
      }
    });

    parser.on('error', (err) => {
      logger.error('CSV parse stream error', { source, error: err.message });
      reject(err);
    });

    parser.on('end', () => {
      logger.info('CSV ingestion complete', {
        source,
        validCount: validRecords.length,
        invalidCount: invalidRecords.length,
        duplicateCount: duplicateIds.length,
      });
      resolve({ validRecords, invalidRecords, duplicateIds });
    });

    // Pipe the CSV content into the streaming parser
    Readable.from(csvContent.toString()).pipe(parser);
  });
}

module.exports = { parseCSV, validateRow, canonicalAsset };
