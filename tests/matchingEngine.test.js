'use strict';

const {
  reconcile,
  softMatch,
  quantityDiffPct,
  timestampDiffSeconds,
  CATEGORY,
} = require('../src/services/matchingEngine');

const TOLERANCE = {
  timestampToleranceSeconds: 300,
  quantityTolerancePct: 0.01,
};

/* ── Helper builders ──────────────────────────────────────────────────────── */

function makeTx(overrides = {}) {
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

/* ── Pure helper tests ───────────────────────────────────────────────────── */

describe('timestampDiffSeconds', () => {
  it('returns 0 for identical timestamps', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    expect(timestampDiffSeconds(d, d)).toBe(0);
  });

  it('returns absolute value regardless of order', () => {
    const a = new Date('2024-01-01T00:00:00Z');
    const b = new Date('2024-01-01T00:05:00Z');
    expect(timestampDiffSeconds(a, b)).toBe(300);
    expect(timestampDiffSeconds(b, a)).toBe(300);
  });
});

describe('quantityDiffPct', () => {
  it('returns 0 for equal quantities', () => {
    expect(quantityDiffPct(0.5, 0.5)).toBe(0);
  });

  it('calculates correctly for small difference', () => {
    // 0.3 vs 0.3001 → diff = 0.0001, base = 0.3001 → 0.0333%
    const pct = quantityDiffPct(0.3, 0.3001);
    expect(pct).toBeCloseTo(0.03332, 3);
  });

  it('returns 0 when both are 0', () => {
    expect(quantityDiffPct(0, 0)).toBe(0);
  });
});

/* ── softMatch tests ─────────────────────────────────────────────────────── */

describe('softMatch', () => {
  it('returns isMatch=true for an exact match', () => {
    const u = makeTx({ source: 'user' });
    const e = makeTx({ source: 'exchange', transactionId: 'EXC-1' });
    const result = softMatch(u, e, TOLERANCE);
    expect(result.isMatch).toBe(true);
    expect(result.tsDiff).toBe(0);
    expect(result.qtyDiff).toBe(0);
  });

  it('returns isMatch=false when assets differ', () => {
    const u = makeTx({ asset: 'BTC' });
    const e = makeTx({ asset: 'ETH', transactionId: 'EXC-2' });
    expect(softMatch(u, e, TOLERANCE).isMatch).toBe(false);
  });

  it('returns isMatch=false when timestamp exceeds tolerance', () => {
    const u = makeTx({ timestamp: new Date('2024-01-01T00:00:00Z') });
    const e = makeTx({
      transactionId: 'EXC-3',
      timestamp: new Date('2024-01-01T00:10:00Z'), // 600s apart
    });
    expect(softMatch(u, e, TOLERANCE).isMatch).toBe(false);
  });

  it('returns isMatch=false when quantity exceeds tolerance', () => {
    const u = makeTx({ quantity: 0.3 });
    const e = makeTx({
      transactionId: 'EXC-4',
      quantity: 0.3001, // 0.033% > 0.01% tolerance
    });
    expect(softMatch(u, e, TOLERANCE).isMatch).toBe(false);
  });

  it('handles TRANSFER_OUT ↔ TRANSFER_IN perspective flip', () => {
    const u = makeTx({ type: 'TRANSFER_OUT', source: 'user' });
    const e = makeTx({ type: 'TRANSFER_IN', source: 'exchange', transactionId: 'EXC-5' });
    expect(softMatch(u, e, TOLERANCE).isMatch).toBe(true);
  });

  it('matches within timestamp window', () => {
    const u = makeTx({ timestamp: new Date('2024-03-01T09:00:00Z') });
    const e = makeTx({
      transactionId: 'EXC-6',
      timestamp: new Date('2024-03-01T09:00:32Z'), // 32s
    });
    const result = softMatch(u, e, TOLERANCE);
    expect(result.isMatch).toBe(true);
    expect(result.tsDiff).toBe(32);
  });
});

/* ── reconcile integration tests ─────────────────────────────────────────── */

describe('reconcile', () => {
  it('produces a matched entry for identical transactions', () => {
    const u = [makeTx({ transactionId: 'U-1', source: 'user' })];
    const e = [makeTx({ transactionId: 'E-1', source: 'exchange' })];
    const results = reconcile(u, e, TOLERANCE);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe(CATEGORY.MATCHED);
    expect(results[0].userTransaction.transactionId).toBe('U-1');
    expect(results[0].exchangeTransaction.transactionId).toBe('E-1');
  });

  it('produces unmatched_user when no exchange counterpart exists', () => {
    const u = [makeTx({ transactionId: 'U-2', source: 'user' })];
    const results = reconcile(u, [], TOLERANCE);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe(CATEGORY.UNMATCHED_USER);
    expect(results[0].exchangeTransaction).toBeNull();
  });

  it('produces unmatched_exchange when no user counterpart exists', () => {
    const e = [makeTx({ transactionId: 'E-2', source: 'exchange' })];
    const results = reconcile([], e, TOLERANCE);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe(CATEGORY.UNMATCHED_EXCHANGE);
    expect(results[0].userTransaction).toBeNull();
  });

  it('does not double-assign an exchange transaction to two user transactions', () => {
    const u1 = makeTx({ transactionId: 'U-3', source: 'user' });
    const u2 = makeTx({ transactionId: 'U-4', source: 'user' }); // identical
    const e = [makeTx({ transactionId: 'E-3', source: 'exchange' })];

    const results = reconcile([u1, u2], e, TOLERANCE);

    // One should be matched, one should be unmatched_user
    const matched = results.filter((r) => r.category === CATEGORY.MATCHED);
    const unmatchedUser = results.filter((r) => r.category === CATEGORY.UNMATCHED_USER);
    expect(matched).toHaveLength(1);
    expect(unmatchedUser).toHaveLength(1);
  });

  it('handles TRANSFER_OUT ↔ TRANSFER_IN flip and marks as matched', () => {
    const u = [makeTx({ transactionId: 'U-5', type: 'TRANSFER_OUT', source: 'user' })];
    const e = [makeTx({ transactionId: 'E-5', type: 'TRANSFER_IN', source: 'exchange' })];

    const results = reconcile(u, e, TOLERANCE);
    expect(results[0].category).toBe(CATEGORY.MATCHED);
    expect(results[0].reason).toContain('perspective flip');
  });

  it('picks the best (closest) match when multiple candidates exist', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const u = [makeTx({ transactionId: 'U-6', timestamp: base, source: 'user' })];
    const e = [
      makeTx({
        transactionId: 'E-near',
        timestamp: new Date(base.getTime() + 10_000), // 10s
        source: 'exchange',
      }),
      makeTx({
        transactionId: 'E-far',
        timestamp: new Date(base.getTime() + 240_000), // 240s
        source: 'exchange',
      }),
    ];

    const results = reconcile(u, e, TOLERANCE);
    const matched = results.find((r) => r.category === CATEGORY.MATCHED);
    expect(matched.exchangeTransaction.transactionId).toBe('E-near');
  });

  it('handles empty inputs gracefully', () => {
    expect(reconcile([], [], TOLERANCE)).toEqual([]);
  });
});
