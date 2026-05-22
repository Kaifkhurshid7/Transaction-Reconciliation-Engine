'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CSV Report Exporter
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Transforms nested reconciliation report entries into flat CSV format
 * suitable for download and analysis in spreadsheet tools.
 *
 * Output Schema:
 *   Each row contains the category, reason, both sides of the transaction
 *   (user + exchange), and conflict metrics. Null/missing values are
 *   represented as empty strings for clean CSV output.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { stringify } = require('csv-stringify/sync');

/**
 * Flattens a nested report entry into a single-level object for CSV serialization.
 *
 * The report entry has nested userTransaction and exchangeTransaction objects.
 * CSV requires flat rows, so we prefix each field with its source (user_ / exchange_).
 *
 * @param {object} entry - A reconciliation report entry from the database
 * @returns {object} Flat key-value object ready for CSV row generation
 */
function flattenReportEntry(entry) {
  const userTx = entry.userTransaction || {};
  const exchangeTx = entry.exchangeTransaction || {};

  return {
    // ── Classification ─────────────────────────────────────────────────────
    category: entry.category,
    reason: entry.reason,

    // ── User-side transaction data ─────────────────────────────────────────
    user_transaction_id: userTx.transactionId || '',
    user_timestamp: userTx.rawTimestamp || '',
    user_type: userTx.type || '',
    user_asset: userTx.asset || '',
    user_quantity: userTx.quantity ?? '',
    user_price_usd: userTx.priceUsd ?? '',
    user_fee: userTx.fee ?? '',
    user_note: userTx.note || '',

    // ── Exchange-side transaction data ─────────────────────────────────────
    exchange_transaction_id: exchangeTx.transactionId || '',
    exchange_timestamp: exchangeTx.rawTimestamp || '',
    exchange_type: exchangeTx.type || '',
    exchange_asset: exchangeTx.asset || '',
    exchange_quantity: exchangeTx.quantity ?? '',
    exchange_price_usd: exchangeTx.priceUsd ?? '',
    exchange_fee: exchangeTx.fee ?? '',
    exchange_note: exchangeTx.note || '',

    // ── Conflict metrics (populated for matched/conflicting entries) ───────
    timestamp_diff_seconds: entry.timestampDiffSeconds ?? '',
    quantity_diff_pct: entry.quantityDiffPct ?? '',
  };
}

/**
 * Converts an array of report entries to a CSV string with headers.
 *
 * @param {object[]} entries - Array of report entries from the database
 * @returns {string} Complete CSV string (empty string if no entries)
 */
function entriesToCSV(entries) {
  if (!entries || entries.length === 0) {
    return '';
  }

  const flatRows = entries.map(flattenReportEntry);

  return stringify(flatRows, {
    header: true,
    cast: {
      number: (value) => (value === null || value === undefined ? '' : String(value)),
    },
  });
}

module.exports = { entriesToCSV, flattenReportEntry };
