'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Matching Engine — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests the core reconciliation algorithm including:
 *   - Pure helper functions (timestamp diff, quantity diff)
 *   - Soft-match filter logic (asset, type, timestamp, quantity criteria)
 *   - Full reconciliation flow (matching, unmatched detection, scoring)
 *   - Edge cases (perspective flips, multiple candidates, empty inputs)
 *
 * These tests run without a database — they validate pure algorithmic logic.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const {
  reconcile,
  softMatch,
  quantityDiffPct,
  timestampDiffSeconds,
  CATEGORY,
} = require('../src/services/matchingEngine');

/* ── Default Tolerance Configuration ──────────────────────────────────────── */

const DEFAULT_TOLERANCE = {
  timestampToleranceSeconds: 300,  // 5 minutes
  quantityTolerancePct: 0.01,      // 0.01%
};

/* ── Test Data Factory ────────────────────────────────────────────────────── */

/**
 * Creates a transaction object with sensible defaults.
 * Override any field by passing it in the overrides object.
 */
function createTransaction(overrides = {}) {
  return {
    transactionId: 'TX-001',
    timestamp: new Date('2024-03-01T09:00:00Z'),
    type: 'BUY',
    asset: 'BTC',
    quantity: 0.5,
    priceUsd: 62000,
    fee: 0.0005,
    note: '',
    source: 'user',
    warnings: [],
    ...overrides,
  };
}

/* ── Pure Helper Function Tests ───────────────────────────────────────────── */

describe('timestampDiffSeconds()', () => {
  it('returns 0 for identical timestamps', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    expect(timestampDiffSeconds(date, date)).toBe(0);
  });

  it('returns absolute difference regardless of argument order', () => {
    const earlier = new Date('2024-01-01T00:00:00Z');
    const later = new Date('2024-01-01T00:05:00Z');

    expect(timestampDiffSeconds(earlier, later)).toBe(300);
    expect(timestampDiffSeconds(later, earlier)).toBe(300);
  });
});

describe('quantityDiffPct()', () => {
  it('returns 0 for equal quantities', () => {
    expect(quantityDiffPct(0.5, 0.5)).toBe(0);
  });

  it('calculates percentage difference correctly for small deviations', () => {
    // 0.3 vs 0.3001 → diff = 0.0001, denominator = 0.3001 → ~0.0333%
    const result = quantityDiffPct(0.3, 0.3001);
    expect(result).toBeCloseTo(0.03332, 3);
  });

  it('returns 0 when both quantities are zero', () => {
    expect(quantityDiffPct(0, 0)).toBe(0);
  });
});

/* ── Soft-Match Filter Tests ──────────────────────────────────────────────── */

describe('softMatch()', () => {
  it('returns isMatch=true for identical transactions', () => {
    const userTx = createTransaction({ source: 'user' });
    const exchangeTx = createTransaction({ source: 'exchange', transactionId: 'EXC-1' });

    const result = softMatch(userTx, exchangeTx, DEFAULT_TOLERANCE);

    expect(result.isMatch).toBe(true);
    expect(result.tsDiff).toBe(0);
    expect(result.qtyDiff).toBe(0);
  });

  it('rejects when assets differ', () => {
    const userTx = createTransaction({ asset: 'BTC' });
    const exchangeTx = createTransaction({ asset: 'ETH', transactionId: 'EXC-2' });

    expect(softMatch(userTx, exchangeTx, DEFAULT_TOLERANCE).isMatch).toBe(false);
  });

  it('rejects when timestamp exceeds tolerance', () => {
    const userTx = createTransaction({ timestamp: new Date('2024-01-01T00:00:00Z') });
    const exchangeTx = createTransaction({
      transactionId: 'EXC-3',
      timestamp: new Date('2024-01-01T00:10:00Z'), // 600s apart (> 300s tolerance)
    });

    expect(softMatch(userTx, exchangeTx, DEFAULT_TOLERANCE).isMatch).toBe(false);
  });

  it('rejects when quantity exceeds tolerance', () => {
    const userTx = createTransaction({ quantity: 0.3 });
    const exchangeTx = createTransaction({
      transactionId: 'EXC-4',
      quantity: 0.3001, // 0.033% difference (> 0.01% tolerance)
    });

    expect(softMatch(userTx, exchangeTx, DEFAULT_TOLERANCE).isMatch).toBe(false);
  });

  it('handles TRANSFER_OUT ↔ TRANSFER_IN perspective flip as equivalent', () => {
    const userTx = createTransaction({ type: 'TRANSFER_OUT', source: 'user' });
    const exchangeTx = createTransaction({
      type: 'TRANSFER_IN',
      source: 'exchange',
      transactionId: 'EXC-5',
    });

    expect(softMatch(userTx, exchangeTx, DEFAULT_TOLERANCE).isMatch).toBe(true);
  });

  it('matches transactions within the timestamp tolerance window', () => {
    const userTx = createTransaction({ timestamp: new Date('2024-03-01T09:00:00Z') });
    const exchangeTx = createTransaction({
      transactionId: 'EXC-6',
      timestamp: new Date('2024-03-01T09:00:32Z'), // 32s apart (< 300s tolerance)
    });

    const result = softMatch(userTx, exchangeTx, DEFAULT_TOLERANCE);
    expect(result.isMatch).toBe(true);
    expect(result.tsDiff).toBe(32);
  });
});

/* ── Full Reconciliation Algorithm Tests ──────────────────────────────────── */

describe('reconcile()', () => {
  it('produces a MATCHED entry for identical transactions', () => {
    const userTxs = [createTransaction({ transactionId: 'U-1', source: 'user' })];
    const exchangeTxs = [createTransaction({ transactionId: 'E-1', source: 'exchange' })];

    const results = reconcile(userTxs, exchangeTxs, DEFAULT_TOLERANCE);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe(CATEGORY.MATCHED);
    expect(results[0].userTransaction.transactionId).toBe('U-1');
    expect(results[0].exchangeTransaction.transactionId).toBe('E-1');
  });

  it('produces UNMATCHED_USER when no exchange counterpart exists', () => {
    const userTxs = [createTransaction({ transactionId: 'U-2', source: 'user' })];

    const results = reconcile(userTxs, [], DEFAULT_TOLERANCE);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe(CATEGORY.UNMATCHED_USER);
    expect(results[0].exchangeTransaction).toBeNull();
  });

  it('produces UNMATCHED_EXCHANGE when no user counterpart exists', () => {
    const exchangeTxs = [createTransaction({ transactionId: 'E-2', source: 'exchange' })];

    const results = reconcile([], exchangeTxs, DEFAULT_TOLERANCE);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe(CATEGORY.UNMATCHED_EXCHANGE);
    expect(results[0].userTransaction).toBeNull();
  });

  it('prevents double-assignment of exchange transactions', () => {
    // Two identical user transactions competing for one exchange transaction
    const userTx1 = createTransaction({ transactionId: 'U-3', source: 'user' });
    const userTx2 = createTransaction({ transactionId: 'U-4', source: 'user' });
    const exchangeTxs = [createTransaction({ transactionId: 'E-3', source: 'exchange' })];

    const results = reconcile([userTx1, userTx2], exchangeTxs, DEFAULT_TOLERANCE);

    const matched = results.filter((r) => r.category === CATEGORY.MATCHED);
    const unmatchedUser = results.filter((r) => r.category === CATEGORY.UNMATCHED_USER);

    expect(matched).toHaveLength(1);
    expect(unmatchedUser).toHaveLength(1);
  });

  it('handles TRANSFER_OUT ↔ TRANSFER_IN and marks as matched with perspective flip note', () => {
    const userTxs = [createTransaction({ transactionId: 'U-5', type: 'TRANSFER_OUT', source: 'user' })];
    const exchangeTxs = [createTransaction({ transactionId: 'E-5', type: 'TRANSFER_IN', source: 'exchange' })];

    const results = reconcile(userTxs, exchangeTxs, DEFAULT_TOLERANCE);

    expect(results[0].category).toBe(CATEGORY.MATCHED);
    expect(results[0].reason).toContain('perspective flip');
  });

  it('selects the closest match when multiple candidates exist', () => {
    const baseTime = new Date('2024-01-01T00:00:00Z');

    const userTxs = [createTransaction({ transactionId: 'U-6', timestamp: baseTime, source: 'user' })];
    const exchangeTxs = [
      createTransaction({
        transactionId: 'E-near',
        timestamp: new Date(baseTime.getTime() + 10_000), // 10s away
        source: 'exchange',
      }),
      createTransaction({
        transactionId: 'E-far',
        timestamp: new Date(baseTime.getTime() + 240_000), // 240s away
        source: 'exchange',
      }),
    ];

    const results = reconcile(userTxs, exchangeTxs, DEFAULT_TOLERANCE);
    const matched = results.find((r) => r.category === CATEGORY.MATCHED);

    expect(matched.exchangeTransaction.transactionId).toBe('E-near');
  });

  it('handles empty inputs gracefully', () => {
    expect(reconcile([], [], DEFAULT_TOLERANCE)).toEqual([]);
  });
});
