'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Transaction Model (MongoDB/Mongoose)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Stores EVERY ingested row from both CSV sources — valid AND invalid.
 *
 * Design Decision: Nothing is silently dropped.
 *   Invalid rows are persisted with `isValid: false` and a `dataQualityIssues`
 *   array explaining why they failed validation. This provides a complete
 *   audit trail and allows operators to inspect rejected data.
 *
 * Schema Design:
 *   - `runId` ties each transaction to a specific reconciliation run
 *   - `source` distinguishes user-reported vs exchange-reported data
 *   - `rawTimestamp` and `rawAsset` preserve original values before normalization
 *   - Compound indexes optimize the most common query patterns
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    /* ── Identity ─────────────────────────────────────────────────────────── */

    /** Original transaction ID from the CSV source */
    transactionId: {
      type: String,
      required: true,
      trim: true,
    },

    /** Data source: 'user' (user-reported) or 'exchange' (exchange export) */
    source: {
      type: String,
      enum: ['user', 'exchange'],
      required: true,
    },

    /** UUID of the reconciliation run that ingested this record */
    runId: {
      type: String,
      required: true,
      index: true,
    },

    /* ── Core Transaction Fields ──────────────────────────────────────────── */

    /** Parsed timestamp (null if unparseable — row will be marked invalid) */
    timestamp: {
      type: Date,
      default: null,
    },

    /** Original timestamp string before parsing (preserved for audit) */
    rawTimestamp: {
      type: String,
      default: '',
    },

    /** Normalized transaction type (BUY, SELL, TRANSFER_IN, TRANSFER_OUT) */
    type: {
      type: String,
      default: '',
      uppercase: true,
      trim: true,
    },

    /** Canonical asset ticker symbol after alias resolution (e.g., "BTC") */
    asset: {
      type: String,
      default: '',
      uppercase: true,
      trim: true,
    },

    /** Original asset string before alias resolution (e.g., "bitcoin") */
    rawAsset: {
      type: String,
      default: '',
    },

    /** Transaction quantity (always non-negative for valid rows) */
    quantity: {
      type: Number,
      default: null,
    },

    /** Price in USD at time of transaction (optional — may be null for transfers) */
    priceUsd: {
      type: Number,
      default: null,
    },

    /** Transaction fee (optional) */
    fee: {
      type: Number,
      default: null,
    },

    /** Free-text note from the CSV */
    note: {
      type: String,
      default: '',
    },

    /* ── Data Quality Metadata ────────────────────────────────────────────── */

    /** Whether this row passed all validation checks */
    isValid: {
      type: Boolean,
      required: true,
      index: true,
    },

    /** List of validation failures (populated only for invalid rows) */
    dataQualityIssues: {
      type: [String],
      default: [],
    },

    /** Non-fatal warnings (e.g., alias resolution, unknown type) */
    warnings: {
      type: [String],
      default: [],
    },

    /** 1-based line number in the source CSV (header = line 1) */
    lineNumber: {
      type: Number,
    },
  },
  {
    timestamps: true,   // Adds createdAt / updatedAt automatically
    versionKey: false,  // Disable __v field (not needed for this use case)
  },
);

/* ── Indexes ──────────────────────────────────────────────────────────────── */

// Primary query pattern: fetch valid transactions for a run by source
transactionSchema.index({ runId: 1, source: 1, isValid: 1 });

// Secondary: lookup specific transaction within a run
transactionSchema.index({ runId: 1, transactionId: 1, source: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;
