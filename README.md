# KoinX — Transaction Reconciliation Engine

A production-grade Node.js service that ingests crypto transaction data from two sources (user export + exchange export), matches them using a configurable tolerance engine, and produces a structured reconciliation report.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Quick Start](#quick-start)
4. [Configuration](#configuration)
5. [API Reference](#api-reference)
6. [Matching Algorithm](#matching-algorithm)
7. [Data Quality Handling](#data-quality-handling)
8. [Key Design Decisions](#key-design-decisions)
9. [Running Tests](#running-tests)

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 18+ | Async I/O ideal for CSV streaming + DB writes |
| Framework | Express 4 | Minimal, well-understood, production-proven |
| Database | MongoDB (Mongoose) | Flexible schema — transaction rows vary in shape; embedded sub-docs for report entries |
| CSV | `csv-parse` / `csv-stringify` | Streaming, battle-tested, handles ragged/malformed rows |
| Logging | Winston + daily-rotate-file | Structured JSON logs in prod, colorised in dev |
| Testing | Jest + Supertest | Fast unit + integration tests, no real DB required |
| Security | Helmet, CORS, express-rate-limit | Standard production hardening |

---

## Project Structure

```
koinx-reconciliation/
├── data/
│   └── samples/                  # Bundled sample CSV files
│       ├── user_transactions.csv
│       └── exchange_transactions.csv
├── logs/                         # Rotated log files (git-ignored)
├── src/
│   ├── config/
│   │   ├── index.js              # Centralised env-var config
│   │   ├── assetAliases.js       # BTC ↔ Bitcoin alias map
│   │   └── typeMapping.js        # TRANSFER_OUT ↔ TRANSFER_IN perspective map
│   ├── controllers/
│   │   └── reconciliationController.js
│   ├── middlewares/
│   │   ├── errorHandler.js       # Global error handler
│   │   └── requestLogger.js      # Morgan → Winston bridge
│   ├── models/
│   │   ├── Transaction.js        # All ingested rows (valid + invalid)
│   │   ├── ReconciliationRun.js  # Per-run metadata, config, summary
│   │   └── ReportEntry.js        # One doc per reconciled pair / unmatched row
│   ├── routes/
│   │   ├── index.js
│   │   └── reconciliation.js
│   ├── services/
│   │   ├── matchingEngine.js     # Core reconciliation algorithm
│   │   ├── reconciliationService.js  # Orchestrator (parse → match → persist)
│   │   └── reportService.js      # DB queries for report endpoints
│   ├── utils/
│   │   ├── ApiError.js           # Structured error class
│   │   ├── csvExporter.js        # Report entries → CSV string
│   │   ├── csvParser.js          # CSV parsing + row-level validation
│   │   └── logger.js             # Winston logger instance
│   ├── app.js                    # Express app factory
│   ├── db.js                     # MongoDB connection with retry
│   └── server.js                 # Entry point + graceful shutdown
├── tests/
│   ├── api.test.js               # REST endpoint integration tests
│   ├── csvParser.test.js         # CSV validation unit tests
│   └── matchingEngine.test.js    # Matching algorithm unit tests
├── .env.example
├── .eslintrc.js
├── .gitignore
└── package.json
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- MongoDB running locally (or a MongoDB Atlas URI)

### Steps

```bash
# 1. Clone and install
git clone <your-repo-url>
cd koinx-reconciliation
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set MONGODB_URI if needed

# 3. Start the server
npm run dev        # development (nodemon)
npm start          # production

# Server starts on http://localhost:3000
```

---

## Configuration

All tolerances are configurable **without code changes** — via environment variables or per-request body overrides.

| Variable | Default | Description |
|---|---|---|
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max seconds between timestamps to still match |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Max % quantity difference to still match (0.01 = 0.01%) |
| `MONGODB_URI` | `mongodb://localhost:27017/koinx_reconciliation` | MongoDB connection string |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | Winston log level |

Per-request overrides (in the POST `/reconcile` body) take precedence over env vars.

---

## API Reference

### `POST /api/v1/reconcile`

Trigger a reconciliation run.

**Body (JSON):**
```json
{
  "useSampleData": true,
  "timestampToleranceSeconds": 300,
  "quantityTolerancePct": 0.01
}
```

Or with raw CSV strings:
```json
{
  "userCsv": "<raw CSV content>",
  "exchangeCsv": "<raw CSV content>",
  "timestampToleranceSeconds": 60
}
```

**Response `202`:**
```json
{
  "success": true,
  "message": "Reconciliation completed",
  "data": {
    "runId": "550e8400-e29b-41d4-a716-446655440000",
    "summary": {
      "matched": 18,
      "conflicting": 0,
      "unmatchedUser": 5,
      "unmatchedExchange": 2
    }
  }
}
```

---

### `GET /api/v1/report/:runId`

Full reconciliation report for a run.

**Query params:**
- `page` (default: 1), `limit` (default: 100)
- `category` — filter: `matched` | `conflicting` | `unmatched_user` | `unmatched_exchange`
- `format=csv` — download as CSV file

---

### `GET /api/v1/report/:runId/summary`

Summary counts only.

```json
{
  "success": true,
  "data": {
    "runId": "...",
    "status": "completed",
    "config": { "timestampToleranceSeconds": 300, "quantityTolerancePct": 0.01 },
    "ingestion": {
      "userTotal": 25, "userValid": 21, "userInvalid": 4, "userDuplicates": 1,
      "exchangeTotal": 25, "exchangeValid": 25, "exchangeInvalid": 0, "exchangeDuplicates": 0
    },
    "summary": { "matched": 18, "conflicting": 0, "unmatchedUser": 3, "unmatchedExchange": 2 },
    "durationMs": 312
  }
}
```

---

### `GET /api/v1/report/:runId/unmatched`

Unmatched rows only (user-only + exchange-only), with reasons.

**Query params:** `page`, `limit`, `format=csv`

---

### `GET /api/v1/health`

Returns `{ "status": "ok" }` — useful for uptime monitors.

---

## Matching Algorithm

The engine uses a **greedy best-first** approach:

1. **Canonicalize** — asset aliases resolved (`bitcoin` → `BTC`), types uppercased
2. **Candidate scan** — for each user transaction, find all exchange transactions that pass the soft-match filter:
   - `asset` must match exactly (post-canonicalization)
   - `type` must be equivalent (handles `TRANSFER_OUT` ↔ `TRANSFER_IN` perspective flip)
   - `|timestampDiff|` ≤ `TIMESTAMP_TOLERANCE_SECONDS`
   - `quantityDiffPct` ≤ `QUANTITY_TOLERANCE_PCT`
3. **Score & rank** — candidates scored by weighted normalised distance:
   ```
   score = (tsDiff / tsTolerance) × 1.0 + (qtyDiff / qtyTolerance) × 0.5
   ```
   Timestamp accuracy weighted 2× over quantity accuracy.
4. **Greedy assignment** — best-scoring unmatched exchange row is assigned. Exchange rows cannot be reused.
5. **Classify**:
   - **Matched** — pair found within all tolerances
   - **Conflicting** — pair found but at least one field exceeds tolerance (two-pass hook)
   - **Unmatched (User)** — no exchange counterpart found
   - **Unmatched (Exchange)** — no user counterpart found (second pass over unused exchange rows)

**Complexity:** O(U × E) — sufficient for thousands of rows. At larger scale, grouping by `(asset, date)` as a bucket key would reduce to near-linear.

---

## Data Quality Handling

Every row is validated on ingestion. **No rows are silently dropped.** Invalid rows are persisted to the `transactions` collection with `isValid: false` and a `dataQualityIssues` array explaining the problem.

Issues detected and handled:

| Issue | Example | Handling |
|---|---|---|
| Duplicate transaction ID | `USR-001` appears twice | Second occurrence flagged, first kept |
| Malformed timestamp | `2024-03-09T` (no time) | Flagged as invalid, excluded from matching |
| Missing timestamp | Empty timestamp field | Flagged as invalid |
| Negative quantity | `-0.1` | Flagged as invalid |
| Asset alias | `bitcoin` | Resolved to `BTC`, warning attached |
| TRANSFER_OUT ↔ TRANSFER_IN | Perspective flip | Handled as equivalent match |
| Missing required fields | No `transaction_id` | Flagged as invalid |

---

## Key Design Decisions

### 1. Nothing is silently dropped
Invalid rows are stored with `isValid: false` and a `dataQualityIssues` array. The reconciliation only runs on valid rows, but auditors can always inspect what was rejected and why.

### 2. Configurable tolerance without code changes
All matching thresholds live in environment variables (or request body). Adding a new tolerance type requires only adding an env var to `.env.example` and reading it in `src/config/index.js`.

### 3. Embedded report snapshots
`ReportEntry` embeds a snapshot of both transaction sides rather than storing foreign-key references. This means the report is self-contained — changing or deleting transactions from the `Transaction` collection doesn't corrupt historical reports.

### 4. UUID-based run IDs
Each reconciliation run gets a UUID. This makes runs stateless and safe to trigger concurrently or replay without collision.

### 5. Asset aliases in a single file
`src/config/assetAliases.js` is the single source of truth for all alias mappings. Adding a new alias (e.g., `XBT → BTC`) requires editing one line in one file.

### 6. Perspective-flip type mapping
`TRANSFER_OUT` on the user side and `TRANSFER_IN` on the exchange side represent the same economic event from opposite perspectives. The engine treats them as equivalent during matching, but records both original types in the report for full auditability.

### 7. Fee differences are not a match-breaking field
Fees may differ due to exchange rounding rules or timing. They are stored and visible in the report but do not affect match categorization. This was an intentional interpretation of the ambiguous spec.

### 8. Two-pass hook for conflicting entries
The code has a `conflicting` classification hook. Currently, `softMatch` uses strict tolerances so conflicts won't appear in normal operation. A future two-pass approach (strict + relaxed tolerance) would classify proximity matches that exceed strict tolerance as `conflicting` — the scaffolding is already in place.

---

## Running Tests

```bash
npm test                 # Run all tests
npm run test:coverage    # With coverage report
```

**Test suite covers:**
- CSV parsing with all edge cases (aliases, malformed timestamps, negatives, duplicates)
- Matching engine: exact match, asset mismatch, timestamp window, quantity tolerance, perspective flip, best-candidate selection, greedy non-reuse
- All four REST endpoints with mocked service layer (no real DB required)
- 404 and error handler behaviour

---

## Commit Convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add matching engine with greedy best-first algorithm
fix: handle 2024-03-12T truncated timestamp as malformed
chore: add winston daily-rotate-file transport
test: add api integration tests with mocked service layer
docs: document key design decisions in README
```
