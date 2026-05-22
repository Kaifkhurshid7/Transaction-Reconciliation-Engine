'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CSV Parser — Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Tests the CSV ingestion pipeline including:
 *   - Valid row parsing and field extraction
 *   - Asset alias resolution (e.g., "bitcoin" → "BTC")
 *   - Data quality issue detection (malformed timestamps, negative quantities)
 *   - Duplicate transaction ID detection
 *   - Source label assignment
 *
 * These tests run without a database connection — they validate pure
 * parsing and validation logic only.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { parseCSV } = require('../src/utils/csvParser');

/* ── Test Fixtures ────────────────────────────────────────────────────────── */

const VALID_CSV = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
USR-001,2024-03-01T09:00:00Z,BUY,BTC,0.5,62000.00,0.0005,Monthly DCA
USR-002,2024-03-01T11:30:00Z,BUY,ETH,2.0,3400.00,0.002,`;

const ALIAS_CSV = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
USR-005,2024-03-03T10:00:00Z,BUY,bitcoin,0.25,61800.00,0.00025,alias test`;

const MALFORMED_TIMESTAMP_CSV = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
USR-018,2024-03-09T,SELL,ETH,0.3,3510.00,0.0003,Malformed timestamp`;

const MISSING_TIMESTAMP_CSV = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
USR-024,2024-03-12T,,BTC,0.4,62800.00,0.0004,Missing timestamp`;

const NEGATIVE_QUANTITY_CSV = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
USR-019,2024-03-10T08:00:00Z,BUY,BTC,-0.1,62000.00,0.0001,Negative quantity`;

const DUPLICATE_ID_CSV = `transaction_id,timestamp,type,asset,quantity,price_usd,fee,note
USR-001,2024-03-01T09:00:00Z,BUY,BTC,0.5,62000.00,0.0005,First
USR-001,2024-03-01T09:00:00Z,BUY,BTC,0.5,62000.00,0.0005,Duplicate`;

/* ── Test Suites ──────────────────────────────────────────────────────────── */

describe('CSV Parser — parseCSV()', () => {
  describe('Valid Row Parsing', () => {
    it('parses well-formed rows into structured records', async () => {
      const result = await parseCSV(VALID_CSV, 'user');

      expect(result.validRecords).toHaveLength(2);
      expect(result.invalidRecords).toHaveLength(0);
      expect(result.validRecords[0].transactionId).toBe('USR-001');
      expect(result.validRecords[0].quantity).toBe(0.5);
      expect(result.validRecords[0].timestamp).toBeInstanceOf(Date);
    });

    it('assigns the correct source label to parsed records', async () => {
      const result = await parseCSV(VALID_CSV, 'exchange');
      expect(result.validRecords[0].source).toBe('exchange');
    });
  });

  describe('Asset Alias Resolution', () => {
    it('resolves known aliases to canonical ticker symbols', async () => {
      const result = await parseCSV(ALIAS_CSV, 'user');

      expect(result.validRecords[0].asset).toBe('BTC');
      expect(result.validRecords[0].rawAsset).toBe('bitcoin');
    });

    it('attaches a warning when an alias is resolved', async () => {
      const result = await parseCSV(ALIAS_CSV, 'user');
      const hasAliasWarning = result.validRecords[0].warnings.some(
        (w) => w.includes('bitcoin'),
      );
      expect(hasAliasWarning).toBe(true);
    });
  });

  describe('Data Quality Issue Detection', () => {
    it('flags rows with malformed timestamps as invalid', async () => {
      const result = await parseCSV(MALFORMED_TIMESTAMP_CSV, 'user');

      expect(result.validRecords).toHaveLength(0);
      expect(result.invalidRecords).toHaveLength(1);
      expect(result.invalidRecords[0].dataQualityIssues[0]).toMatch(/Malformed timestamp/i);
    });

    it('flags rows with missing timestamps as invalid', async () => {
      const result = await parseCSV(MISSING_TIMESTAMP_CSV, 'user');

      expect(result.validRecords).toHaveLength(0);
      expect(result.invalidRecords).toHaveLength(1);

      const issue = result.invalidRecords[0].dataQualityIssues[0];
      expect(issue).toMatch(/timestamp/i);
    });

    it('flags rows with negative quantities as invalid', async () => {
      const result = await parseCSV(NEGATIVE_QUANTITY_CSV, 'user');

      expect(result.validRecords).toHaveLength(0);
      expect(result.invalidRecords).toHaveLength(1);
      expect(result.invalidRecords[0].dataQualityIssues[0]).toMatch(/Negative quantity/i);
    });
  });

  describe('Duplicate Transaction ID Detection', () => {
    it('keeps the first occurrence and flags subsequent duplicates', async () => {
      const result = await parseCSV(DUPLICATE_ID_CSV, 'user');

      expect(result.validRecords).toHaveLength(1);
      expect(result.invalidRecords).toHaveLength(1);
      expect(result.duplicateIds).toContain('USR-001');
      expect(result.invalidRecords[0].dataQualityIssues[0]).toMatch(/Duplicate/i);
    });
  });
});
