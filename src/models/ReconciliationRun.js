'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Reconciliation Run Model (MongoDB/Mongoose)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * One document per reconciliation execution. Captures:
 *   - The configuration (tolerances) used for this specific run
 *   - Lifecycle state (pending → running → completed/failed)
 *   - Ingestion statistics (how many rows were valid/invalid per source)
 *   - Final summary counts (matched, conflicting, unmatched)
 *   - Timing information for performance monitoring
 *
 * Design Decision: UUID-based run IDs
 *   Using UUIDs instead of MongoDB ObjectIds makes runs:
 *   - Safe to generate before DB insertion (no round-trip needed)
 *   - Portable across systems (no MongoDB-specific format)
 *   - Safe for concurrent/parallel reconciliation runs
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

const reconciliationRunSchema = new mongoose.Schema(
  {
    /** Unique run identifier (UUID v4, generated at run start) */
    runId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    /* ── Lifecycle State ──────────────────────────────────────────────────── */

    /** Current run status */
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },

    /** When the run was initiated */
    startedAt: { type: Date, default: null },

    /** When the run finished (success or failure) */
    completedAt: { type: Date, default: null },

    /** Total execution time in milliseconds */
    durationMs: { type: Number, default: null },

    /* ── Configuration Snapshot ───────────────────────────────────────────── */

    /**
     * Tolerance values used for THIS run.
     * Stored as a snapshot so historical runs remain interpretable
     * even if global config changes later.
     */
    config: {
      timestampToleranceSeconds: { type: Number, required: true },
      quantityTolerancePct: { type: Number, required: true },
    },

    /* ── Ingestion Statistics ─────────────────────────────────────────────── */

    /** Row counts from the CSV ingestion phase */
    ingestion: {
      userTotal: { type: Number, default: 0 },
      userValid: { type: Number, default: 0 },
      userInvalid: { type: Number, default: 0 },
      userDuplicates: { type: Number, default: 0 },

      exchangeTotal: { type: Number, default: 0 },
      exchangeValid: { type: Number, default: 0 },
      exchangeInvalid: { type: Number, default: 0 },
      exchangeDuplicates: { type: Number, default: 0 },
    },

    /* ── Reconciliation Summary ───────────────────────────────────────────── */

    /** Aggregate counts from the matching engine output */
    summary: {
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
    },

    /* ── Error Tracking ───────────────────────────────────────────────────── */

    /** Error message if status === 'failed' (for debugging) */
    errorMessage: { type: String, default: null },
  },
  {
    timestamps: true,   // Adds createdAt / updatedAt
    versionKey: false,
  },
);

const ReconciliationRun = mongoose.model('ReconciliationRun', reconciliationRunSchema);
module.exports = ReconciliationRun;
