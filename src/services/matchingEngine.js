'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Transaction Matching Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Core reconciliation algorithm that pairs user transactions with exchange
 * transactions using configurable tolerance thresholds.
 *
 * Algorithm: Greedy Best-First Matching
 * ──────────────────────────────────────
 *   1. For each user transaction, scan ALL unmatched exchange transactions
 *   2. Apply the soft-match filter (asset, type, timestamp, quantity)
 *   3. Score passing candidates by weighted normalized distance
 *   4. Greedily assign the best-scoring candidate (lowest score = best match)
 *   5. Mark assigned exchange transactions as consumed (no double-matching)
 *   6. Remaining unmatched rows on either side are classified accordingly
 *
 * Complexity: O(U × E) where U = user count, E = exchange count
 *   Acceptable for the expected data volumes (hundreds to low thousands).
 *   For larger scale, a bucket-based approach (group by asset + date window)
 *   would reduce to near-linear time.
 *
 * Scoring Rationale:
 *   score = (tsDiff / tsTolerance) × 1.0 + (qtyDiff / qtyTolerance) × 0.5
 *
 *   Timestamp accuracy is weighted 2× over quantity accuracy because:
 *   - Timestamp differences are more likely to indicate distinct transactions
 *   - Quantity differences are often due to rounding/fee adjustments
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { typesAreEquivalent } = require('../config/typeMapping');
const logger = require('../utils/logger');

/* ── Report Categories ────────────────────────────────────────────────────── */

const CATEGORY = Object.freeze({
  MATCHED: 'matched',
  CONFLICTING: 'conflicting',
  UNMATCHED_USER: 'unmatched_user',
  UNMATCHED_EXCHANGE: 'unmatched_exchange',
});

/* ── Pure Calculation Functions ────────────────────────────────────────────── */

/**
 * Calculates the absolute difference in seconds between two timestamps.
 *
 * @param {Date} dateA - First timestamp
 * @param {Date} dateB - Second timestamp
 * @returns {number} Absolute difference in seconds (always non-negative)
 */
function timestampDiffSeconds(dateA, dateB) {
  return Math.abs((dateA.getTime() - dateB.getTime()) / 1000);
}

/**
 * Calculates the percentage difference between two quantities.
 *
 * Formula: |a - b| / max(|a|, |b|) × 100
 *
 * Uses the LARGER value as the denominator to avoid:
 *   - Division by zero when one value is 0
 *   - Inflated percentages when the denominator is very small
 *
 * Edge case: Both values are 0 → returns 0 (identical quantities)
 *
 * @param {number} quantityA - First quantity
 * @param {number} quantityB - Second quantity
 * @returns {number} Percentage difference (0 = identical, 100 = completely different)
 */
function quantityDiffPct(quantityA, quantityB) {
  const denominator = Math.max(Math.abs(quantityA), Math.abs(quantityB));

  if (denominator === 0) {
    return 0; // Both quantities are zero — they're identical
  }

  return (Math.abs(quantityA - quantityB) / denominator) * 100;
}

/* ── Soft-Match Filter ────────────────────────────────────────────────────── */

/**
 * Determines whether two transactions are potential matches based on
 * all matching criteria (asset, type, timestamp, quantity).
 *
 * Matching Criteria (ALL must pass):
 *   1. Asset must match exactly (after canonicalization)
 *   2. Type must be equivalent (handles TRANSFER_OUT ↔ TRANSFER_IN flip)
 *   3. Timestamp difference must be within configured tolerance
 *   4. Quantity difference must be within configured tolerance
 *
 * The criteria are evaluated in order of computational cost (cheapest first)
 * to short-circuit early and avoid unnecessary calculations.
 *
 * @param {object} userTx      - User transaction (canonicalized)
 * @param {object} exchangeTx  - Exchange transaction (canonicalized)
 * @param {object} tolerance   - { timestampToleranceSeconds, quantityTolerancePct }
 * @returns {{ isMatch: boolean, tsDiff: number|null, qtyDiff: number|null }}
 */
function softMatch(userTx, exchangeTx, tolerance) {
  // Criterion 1: Asset must match (cheapest check — string comparison)
  if (userTx.asset !== exchangeTx.asset) {
    return { isMatch: false, tsDiff: null, qtyDiff: null };
  }

  // Criterion 2: Type must be equivalent (handles perspective flips)
  if (!typesAreEquivalent(userTx.type, exchangeTx.type)) {
    return { isMatch: false, tsDiff: null, qtyDiff: null };
  }

  // Criterion 3: Timestamp within tolerance window
  const tsDiff = timestampDiffSeconds(userTx.timestamp, exchangeTx.timestamp);
  if (tsDiff > tolerance.timestampToleranceSeconds) {
    return { isMatch: false, tsDiff, qtyDiff: null };
  }

  // Criterion 4: Quantity within tolerance percentage
  const qtyDiff = quantityDiffPct(userTx.quantity, exchangeTx.quantity);
  if (qtyDiff > tolerance.quantityTolerancePct) {
    return { isMatch: false, tsDiff, qtyDiff };
  }

  // All criteria passed — this is a valid match candidate
  return { isMatch: true, tsDiff, qtyDiff };
}

/* ── Candidate Scoring ────────────────────────────────────────────────────── */

/**
 * Assigns a numeric quality score to a match candidate.
 * Lower score = better (closer) match.
 *
 * The score is a weighted sum of normalized distances:
 *   - Timestamp distance normalized by tolerance (weight: 1.0)
 *   - Quantity distance normalized by tolerance (weight: 0.5)
 *
 * This ensures that when multiple exchange transactions could match
 * a single user transaction, we pick the one that's closest overall.
 *
 * @param {number} tsDiffSec       - Timestamp difference in seconds
 * @param {number} qtyDiffPercent  - Quantity difference as percentage
 * @param {number} toleranceSec    - Configured timestamp tolerance
 * @param {number} tolerancePct    - Configured quantity tolerance
 * @returns {number} Match quality score (lower = better)
 */
function calculateMatchScore(tsDiffSec, qtyDiffPercent, toleranceSec, tolerancePct) {
  const normalizedTimestamp = toleranceSec > 0 ? tsDiffSec / toleranceSec : 0;
  const normalizedQuantity = tolerancePct > 0 ? qtyDiffPercent / tolerancePct : 0;

  return (normalizedTimestamp * 1.0) + (normalizedQuantity * 0.5);
}

/* ── Core Reconciliation Algorithm ────────────────────────────────────────── */

/**
 * Executes the full reconciliation matching process.
 *
 * Algorithm Flow:
 *   Pass 1 — Match user transactions:
 *     For each user transaction:
 *       a) Find all exchange candidates that pass softMatch
 *       b) Score each candidate
 *       c) Pick the best (lowest score) that hasn't been consumed
 *       d) Classify as MATCHED or CONFLICTING based on tolerance
 *       e) If no candidates found → UNMATCHED_USER
 *
 *   Pass 2 — Identify unmatched exchange transactions:
 *     Any exchange transaction not consumed in Pass 1 → UNMATCHED_EXCHANGE
 *
 * @param {object[]} userTransactions     - Valid, canonicalized user transactions
 * @param {object[]} exchangeTransactions - Valid, canonicalized exchange transactions
 * @param {object}   tolerance            - { timestampToleranceSeconds, quantityTolerancePct }
 * @returns {object[]} Array of report entries (category, reason, both sides, metrics)
 */
function reconcile(userTransactions, exchangeTransactions, tolerance) {
  logger.info('Matching engine started', {
    userCount: userTransactions.length,
    exchangeCount: exchangeTransactions.length,
    tolerance,
  });

  const reportEntries = [];

  // Track which exchange transactions have been consumed (prevents double-matching)
  const consumedExchangeIds = new Set();

  /* ── Pass 1: Find best match for each user transaction ──────────────── */

  for (const userTx of userTransactions) {
    const candidates = [];

    // Scan all unconsumed exchange transactions for potential matches
    for (const exchangeTx of exchangeTransactions) {
      if (consumedExchangeIds.has(exchangeTx.transactionId)) {
        continue; // Already matched to another user transaction
      }

      const { isMatch, tsDiff, qtyDiff } = softMatch(userTx, exchangeTx, tolerance);

      if (isMatch) {
        const score = calculateMatchScore(
          tsDiff,
          qtyDiff,
          tolerance.timestampToleranceSeconds,
          tolerance.quantityTolerancePct,
        );
        candidates.push({ exchangeTx, tsDiff, qtyDiff, score });
      }
    }

    // No candidates found — this user transaction has no exchange counterpart
    if (candidates.length === 0) {
      reportEntries.push({
        category: CATEGORY.UNMATCHED_USER,
        reason: 'No matching exchange transaction found within tolerance window',
        userTransaction: userTx,
        exchangeTransaction: null,
        timestampDiffSeconds: null,
        quantityDiffPct: null,
      });
      continue;
    }

    // Sort candidates by score (ascending — best match first)
    candidates.sort((a, b) => a.score - b.score);
    const bestMatch = candidates[0];

    // Mark this exchange transaction as consumed
    consumedExchangeIds.add(bestMatch.exchangeTx.transactionId);

    // ── Classify: MATCHED vs CONFLICTING ─────────────────────────────────
    // Note: With the current single-pass approach, softMatch already enforces
    // strict tolerances, so conflicts won't occur. This classification hook
    // exists for a future two-pass approach (strict + relaxed tolerance)
    // where proximity matches exceeding strict tolerance become CONFLICTING.
    const timestampExceedsTolerance = bestMatch.tsDiff > tolerance.timestampToleranceSeconds;
    const quantityExceedsTolerance = bestMatch.qtyDiff > tolerance.quantityTolerancePct;

    if (timestampExceedsTolerance || quantityExceedsTolerance) {
      const conflictReasons = [];

      if (timestampExceedsTolerance) {
        conflictReasons.push(
          `Timestamp difference ${bestMatch.tsDiff.toFixed(1)}s exceeds ` +
          `tolerance ${tolerance.timestampToleranceSeconds}s`,
        );
      }
      if (quantityExceedsTolerance) {
        conflictReasons.push(
          `Quantity difference ${bestMatch.qtyDiff.toFixed(4)}% exceeds ` +
          `tolerance ${tolerance.quantityTolerancePct}%`,
        );
      }

      reportEntries.push({
        category: CATEGORY.CONFLICTING,
        reason: conflictReasons.join('; '),
        userTransaction: userTx,
        exchangeTransaction: bestMatch.exchangeTx,
        timestampDiffSeconds: bestMatch.tsDiff,
        quantityDiffPct: bestMatch.qtyDiff,
      });
    } else {
      // Build descriptive match reason for audit trail
      const matchDescription = [
        `Asset: ${userTx.asset}`,
        `Type: ${userTx.type}` + (
          userTx.type !== bestMatch.exchangeTx.type
            ? ` ↔ ${bestMatch.exchangeTx.type} (perspective flip)`
            : ''
        ),
        `Timestamp diff: ${bestMatch.tsDiff.toFixed(1)}s`,
        `Quantity diff: ${bestMatch.qtyDiff.toFixed(6)}%`,
      ];

      reportEntries.push({
        category: CATEGORY.MATCHED,
        reason: matchDescription.join(' | '),
        userTransaction: userTx,
        exchangeTransaction: bestMatch.exchangeTx,
        timestampDiffSeconds: bestMatch.tsDiff,
        quantityDiffPct: bestMatch.qtyDiff,
      });
    }
  }

  /* ── Pass 2: Identify unmatched exchange transactions ───────────────── */

  for (const exchangeTx of exchangeTransactions) {
    if (!consumedExchangeIds.has(exchangeTx.transactionId)) {
      reportEntries.push({
        category: CATEGORY.UNMATCHED_EXCHANGE,
        reason: 'No matching user transaction found within tolerance window',
        userTransaction: null,
        exchangeTransaction: exchangeTx,
        timestampDiffSeconds: null,
        quantityDiffPct: null,
      });
    }
  }

  /* ── Log summary ────────────────────────────────────────────────────── */

  const categoryCounts = reportEntries.reduce((acc, entry) => {
    acc[entry.category] = (acc[entry.category] || 0) + 1;
    return acc;
  }, {});

  logger.info('Matching engine complete', { summary: categoryCounts });

  return reportEntries;
}

module.exports = {
  reconcile,
  CATEGORY,
  softMatch,
  quantityDiffPct,
  timestampDiffSeconds,
};
