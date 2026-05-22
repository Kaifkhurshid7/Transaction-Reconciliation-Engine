'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Report Entry Model (MongoDB/Mongoose)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * One document per reconciled pair (or unmatched single) in a run.
 *
 * Categories:
 *   - matched:            Paired successfully across both sources within tolerance
 *   - conflicting:        Identified as a pair but key fields differ beyond tolerance
 *   - unmatched_user:     Present in user file only — no exchange counterpart found
 *   - unmatched_exchange: Present in exchange file only — no user counterpart found
 *
 * Design Decision: Embedded Transaction Snapshots
 *   Rather than storing foreign-key references to the Transaction collection,
 *   we embed a snapshot of both sides directly in the report entry. This means:
 *   - Reports are self-contained and immutable
 *   - Deleting/modifying transactions doesn't corrupt historical reports
 *   - Single query retrieves complete report data (no joins/lookups)
 *   - Trade-off: slightly more storage, but reports are read-heavy workloads
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

/**
 * Embedded sub-schema for transaction snapshots.
 * Contains all fields needed to reconstruct the original transaction
 * without querying the Transaction collection.
 */
const transactionSnapshotSchema = new mongoose.Schema(
  {
    transactionId: String,
    timestamp: Date,
    rawTimestamp: String,
    type: String,
    asset: String,
    rawAsset: String,
    quantity: Number,
    priceUsd: Number,
    fee: Number,
    note: String,
    source: String,
    warnings: [String],
  },
  { _id: false }, // No separate _id for embedded documents
);

const reportEntrySchema = new mongoose.Schema(
  {
    /** UUID of the reconciliation run this entry belongs to */
    runId: {
      type: String,
      required: true,
      index: true,
    },

    /** Classification category for this entry */
    category: {
      type: String,
      enum: ['matched', 'conflicting', 'unmatched_user', 'unmatched_exchange'],
      required: true,
      index: true,
    },

    /** Human-readable explanation of why this categorization was assigned */
    reason: {
      type: String,
      required: true,
    },

    /** User-side transaction snapshot (null for unmatched_exchange entries) */
    userTransaction: {
      type: transactionSnapshotSchema,
      default: null,
    },

    /** Exchange-side transaction snapshot (null for unmatched_user entries) */
    exchangeTransaction: {
      type: transactionSnapshotSchema,
      default: null,
    },

    /** Timestamp difference in seconds between the paired transactions */
    timestampDiffSeconds: { type: Number, default: null },

    /** Quantity difference as a percentage between the paired transactions */
    quantityDiffPct: { type: Number, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/* Compound index for filtered queries (e.g., GET /report/:runId/unmatched) */
reportEntrySchema.index({ runId: 1, category: 1 });

const ReportEntry = mongoose.model('ReportEntry', reportEntrySchema);
module.exports = ReportEntry;
