'use strict';

/**
 * API integration tests.
 * We mock both mongoose and the service layer so no real DB is required to run tests.
 */

jest.mock('../src/db', () => ({
  connectDB: jest.fn().mockResolvedValue(undefined),
  disconnectDB: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/reconciliationService', () => ({
  runReconciliation: jest.fn(),
  runWithSampleData: jest.fn(),
}));

jest.mock('../src/services/reportService', () => ({
  getReport: jest.fn(),
  getSummary: jest.fn(),
  getUnmatched: jest.fn(),
}));

const request = require('supertest');
const createApp = require('../src/app');
const { runWithSampleData } = require('../src/services/reconciliationService');
const { getReport, getSummary, getUnmatched } = require('../src/services/reportService');

const app = createApp();
const API = '/api/v1';

/* ── POST /reconcile ─────────────────────────────────────────────────────── */

describe('POST /reconcile', () => {
  const mockResult = {
    runId: 'test-run-id',
    summary: { matched: 10, conflicting: 1, unmatchedUser: 2, unmatchedExchange: 2 },
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns 202 with runId when useSampleData=true', async () => {
    runWithSampleData.mockResolvedValue(mockResult);

    const res = await request(app)
      .post(`${API}/reconcile`)
      .send({ useSampleData: true });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.runId).toBe('test-run-id');
    expect(runWithSampleData).toHaveBeenCalledTimes(1);
  });

  it('accepts tolerance overrides', async () => {
    runWithSampleData.mockResolvedValue(mockResult);

    await request(app)
      .post(`${API}/reconcile`)
      .send({ useSampleData: true, timestampToleranceSeconds: 60, quantityTolerancePct: 0.05 });

    expect(runWithSampleData).toHaveBeenCalledWith({
      timestampToleranceSeconds: 60,
      quantityTolerancePct: 0.05,
    });
  });

  it('returns 400 when neither useSampleData nor CSV strings are provided', async () => {
    const res = await request(app).post(`${API}/reconcile`).send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for invalid timestampToleranceSeconds', async () => {
    const res = await request(app)
      .post(`${API}/reconcile`)
      .send({ useSampleData: true, timestampToleranceSeconds: -1 });
    expect(res.status).toBe(400);
  });
});

/* ── GET /report/:runId ──────────────────────────────────────────────────── */

describe('GET /report/:runId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns report entries for a valid runId', async () => {
    getReport.mockResolvedValue({
      runId: 'run-123',
      page: 1,
      limit: 100,
      total: 2,
      entries: [
        { category: 'matched', reason: 'Direct match' },
        { category: 'unmatched_user', reason: 'No counterpart' },
      ],
    });

    const res = await request(app).get(`${API}/report/run-123`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.entries).toHaveLength(2);
  });

  it('returns 404 for unknown runId', async () => {
    const ApiError = require('../src/utils/ApiError');
    getReport.mockRejectedValue(ApiError.notFound('Run not found'));

    const res = await request(app).get(`${API}/report/nonexistent`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

/* ── GET /report/:runId/summary ──────────────────────────────────────────── */

describe('GET /report/:runId/summary', () => {
  it('returns summary counts', async () => {
    getSummary.mockResolvedValue({
      runId: 'run-123',
      status: 'completed',
      summary: { matched: 5, conflicting: 1, unmatchedUser: 2, unmatchedExchange: 1 },
    });

    const res = await request(app).get(`${API}/report/run-123/summary`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.matched).toBe(5);
  });
});

/* ── GET /report/:runId/unmatched ────────────────────────────────────────── */

describe('GET /report/:runId/unmatched', () => {
  it('returns unmatched entries with reasons', async () => {
    getUnmatched.mockResolvedValue({
      runId: 'run-123',
      page: 1,
      limit: 100,
      total: 3,
      entries: [
        { category: 'unmatched_user', reason: 'No matching exchange transaction' },
        { category: 'unmatched_exchange', reason: 'No matching user transaction' },
      ],
    });

    const res = await request(app).get(`${API}/report/run-123/unmatched`);
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(2);
  });
});

/* ── GET /health ─────────────────────────────────────────────────────────── */

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

/* ── 404 for unknown route ───────────────────────────────────────────────── */

describe('Unknown routes', () => {
  it('returns 404', async () => {
    const res = await request(app).get(`${API}/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
