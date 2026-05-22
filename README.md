# Crypto Reconciliation Engine

A production-grade Node.js backend service that ingests crypto transaction data from two sources (user export + exchange export), matches transactions using a configurable tolerance-based algorithm, and produces structured reconciliation reports with full audit trails.

Built as a real-world demonstration of scalable backend engineering — clean architecture, proper separation of concerns, comprehensive error handling, and production-ready infrastructure.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Quick Start](#quick-start)
5. [Configuration](#configuration)
6. [API Reference](#api-reference)
7. [Matching Algorithm](#matching-algorithm)
8. [Data Quality Handling](#data-quality-handling)
9. [Key Design Decisions](#key-design-decisions)
10. [Running Tests](#running-tests)
11. [Commit Convention](#commit-convention)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REST API Layer                                │
│  POST /reconcile  │  GET /report/:id  │  GET /summary  │  GET /unmatched │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                      Controller Layer                                 │
│  Input validation  │  Request parsing  │  Response formatting         │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                       Service Layer                                   │
│  ReconciliationService (orchestrator)  │  ReportService (queries)     │
└──────────┬─────────────────────────────────────────┬────────────────┘
           │                                         │
┌──────────▼──────────┐                   ┌──────────▼──────────┐
│   CSV Parser        │                   │   Matching Engine    │
│   (ingestion +      │                   │   (greedy best-first │
│    validation)      │                   │    algorithm)        │
└──────────┬──────────┘                   └──────────┬──────────┘
           │                                         │
┌──────────▼─────────────────────────────────────────▼────────────────┐
│                        Data Layer (MongoDB)                           │
│  Transaction  │  ReconciliationRun  │  ReportEntry                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js 18+ | Async I/O ideal for CSV streaming + concurrent DB writes |
| Framework | Express 4 | Minimal, battle-tested, production-proven |
| Database | MongoDB (Mongoose) | Flexible schema for varying transaction shapes; embedded sub-docs for self-contained reports |
| CSV Processing | `csv-parse` / `csv-stringify` | Streaming parser, handles malformed/ragged rows gracefully |
| Logging | Winston + daily-rotate-file | Structured JSON logs in production, colorized in development |
| Testing | Jest + Supertest | Fast unit + integration tests, no real DB required |
| Security | Helmet, CORS, express-rate-limit | Standard production hardening |

---

## Project Structure

```
crypto-reconciliation-engine/
├── data/
│   └── samples/                          # Bundled sample CSV files for demo/testing
│       ├── user_transactions.csv
│       └── exchange_transactions.csv
├── logs/                                 # Rotated log files (git-ignored)
├── src/
│   ├── config/
│   │   ├── index.js                      # Centralized env-var configuration
│   │   ├── assetAliases.js              # Asset alias resolution map (BTC ↔ Bitcoin)
│   │   └── typeMapping.js              # Transaction type equivalence (TRANSFER_OUT ↔ TRANSFER_IN)
│   ├── controllers/
│   │   └── reconciliationController.js  # HTTP request handlers (thin layer)
│   ├── middlewares/
│   │   ├── errorHandler.js              # Global error handler (structured JSON responses)
│   │   └── requestLogger.js            # Morgan → Winston bridge
│   ├── models/
│   │   ├── Transaction.js               # All ingested rows (valid + invalid)
│   │   ├── ReconciliationRun.js        # Per-run metadata, config snapshot, summary
│   │   └── ReportEntry.js             # One doc per reconciled pair / unmatched row
│   ├── routes/
│   │   ├── index.js                     # Root router + health check
│   │   └── reconciliation.js          # Reconciliation endpoint definitions
│   ├── services/
│   │   ├── matchingEngine.js            # Core reconciliation algorithm
│   │   ├── reconciliationService.js    # Orchestrator (parse → match → persist)
│   │   └── reportService.js           # Read-only report queries
│   ├── utils/
│   │   ├── ApiError.js                  # Structured error class with HTTP codes
│   │   ├── csvExporter.js             # Report entries → CSV string conversion
│   │   ├── csvParser.js               # CSV ingestion + row-level validation
│   │   └── logger.js                  # Winston logger configuration
│   ├── app.js                           # Express app factory (testable without server)
│   ├── db.js                            # MongoDB connection with retry logic
│   └── server.js                        # Entry point + graceful shutdown
├── tests/
│   ├── api.test.js                      # REST endpoint integration tests
│   ├── csvParser.test.js              # CSV validation unit tests
│   └── matchingEngine.test.js         # Matching algorithm unit tests
├── .env.example                         # Environment variable template
├── .eslintrc.js                         # ESLint configuration
├── .gitignore
├── package.json
└── README.md
```

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **MongoDB** running locally (or a MongoDB Atlas URI)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd crypto-reconciliation-engine

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — set MONGODB_URI if not using default localhost

# Start the server
npm run dev        # Development mode (auto-restart on changes)
npm start          # Production mode
```

The server starts on `http://localhost:3000` by default.

### Quick Test

```bash
# Trigger reconciliation with bundled sample data
curl -X POST http://localhost:3000/api/v1/reconcile \
  -H "Content-Type: application/json" \
  -d '{"useSampleData": true}'

# Fetch the report (use the runId from the response above)
curl http://localhost:3000/api/v1/report/<runId>/summary
```

---

## Configuration

All matching tolerances are configurable **without code changes** — via environment variables or per-request body overrides.

| Variable | Default | Description |
|----------|---------|-------------|
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Max seconds between timestamps to still match (5 min) |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Max % quantity difference to still match (0.01%) |
| `MONGODB_URI` | `mongodb://localhost:27017/crypto_reconciliation` | MongoDB connection string |
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `info` | Winston log level (error/warn/info/http/verbose/debug) |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 minutes) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |

**Per-request overrides** (in the POST `/reconcile` body) take precedence over environment variables, enabling A/B testing of different tolerance values without redeployment.

---

## API Reference

### `POST /api/v1/reconcile`

Triggers a new reconciliation run.

**Request Body:**
```json
{
  "useSampleData": true,
  "timestampToleranceSeconds": 300,
  "quantityTolerancePct": 0.01
}
```

Or with raw CSV content:
```json
{
  "userCsv": "<raw CSV string>",
  "exchangeCsv": "<raw CSV string>"
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Reconciliation completed",
  "data": {
    "runId": "550e8400-e29b-41d4-a716-446655440000",
    "summary": {
      "matched": 18,
      "conflicting": 0,
      "unmatchedUser": 3,
      "unmatchedExchange": 2
    }
  }
}
```

---

### `GET /api/v1/report/:runId`

Full reconciliation report with pagination and filtering.

**Query Parameters:**
| Param | Default | Description |
|-------|---------|-------------|
| `page` | 1 | Page number |
| `limit` | 100 | Results per page |
| `category` | — | Filter: `matched`, `conflicting`, `unmatched_user`, `unmatched_exchange` |
| `format` | json | Set to `csv` for downloadable CSV file |

---

### `GET /api/v1/report/:runId/summary`

Lightweight summary — counts and metadata only.

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

Unmatched entries only (user-only + exchange-only) with reasons.

**Query Parameters:** `page`, `limit`, `format=csv`

---

### `GET /api/v1/health`

Health check for monitoring and container orchestration.

```json
{ "status": "ok", "service": "crypto-reconciliation-engine", "timestamp": "..." }
```

---

## Matching Algorithm

The engine uses a **Greedy Best-First** matching strategy:

### Step 1: Canonicalization
- Asset aliases resolved (`bitcoin` → `BTC`, `xbt` → `BTC`)
- Types uppercased and normalized

### Step 2: Candidate Scanning
For each user transaction, find all exchange transactions passing the soft-match filter:
- **Asset** must match exactly (post-canonicalization)
- **Type** must be equivalent (handles `TRANSFER_OUT` ↔ `TRANSFER_IN` perspective flip)
- **|Timestamp diff|** ≤ `TIMESTAMP_TOLERANCE_SECONDS`
- **Quantity diff %** ≤ `QUANTITY_TOLERANCE_PCT`

### Step 3: Scoring & Ranking
Candidates are scored by weighted normalized distance:
```
score = (tsDiff / tsTolerance) × 1.0 + (qtyDiff / qtyTolerance) × 0.5
```
Timestamp accuracy is weighted 2× over quantity because timestamp differences are a stronger signal of distinct transactions.

### Step 4: Greedy Assignment
The best-scoring (lowest) candidate is assigned. Exchange transactions cannot be reused (prevents double-matching).

### Step 5: Classification
- **Matched** — pair found within all tolerances
- **Conflicting** — pair found but fields exceed strict tolerance (future two-pass hook)
- **Unmatched (User)** — no exchange counterpart found
- **Unmatched (Exchange)** — remaining exchange rows after all user rows processed

**Complexity:** O(U × E) — sufficient for thousands of rows. At larger scale, bucket-based grouping by `(asset, date)` would reduce to near-linear.

---

## Data Quality Handling

Every row is validated on ingestion. **No rows are silently dropped.** Invalid rows are persisted with `isValid: false` and a `dataQualityIssues` array explaining the problem.

| Issue | Example | Handling |
|-------|---------|----------|
| Duplicate transaction ID | `USR-001` appears twice | First kept, second flagged as invalid |
| Malformed timestamp | `2024-03-09T` (truncated) | Flagged as invalid, excluded from matching |
| Missing timestamp | Empty field | Flagged as invalid |
| Negative quantity | `-0.1` | Flagged as invalid (direction encoded in type) |
| Asset alias | `bitcoin` | Resolved to `BTC`, warning attached |
| TRANSFER_OUT ↔ TRANSFER_IN | Perspective flip | Treated as equivalent during matching |
| Missing required fields | No `transaction_id` | Flagged as invalid |
| Unknown transaction type | `SWAP` | Warning attached, row remains valid |

---

## Key Design Decisions

### 1. Nothing is silently dropped
Invalid rows are stored with `isValid: false` and detailed reasons. The reconciliation only runs on valid rows, but auditors can always inspect what was rejected and why.

### 2. Configurable tolerance without code changes
All matching thresholds live in environment variables (or request body). Adding a new tolerance type requires only adding an env var and reading it in `src/config/index.js`.

### 3. Embedded report snapshots
`ReportEntry` embeds transaction snapshots rather than foreign-key references. Reports are self-contained — modifying or deleting transactions doesn't corrupt historical reports.

### 4. UUID-based run IDs
Each run gets a UUID v4. This makes runs stateless, safe for concurrent execution, and portable across systems.

### 5. Asset aliases in a single file
`src/config/assetAliases.js` is the single source of truth. Adding a new alias (e.g., `XBT → BTC`) requires editing one line in one file.

### 6. Perspective-flip type mapping
`TRANSFER_OUT` (user) and `TRANSFER_IN` (exchange) represent the same economic event. The engine treats them as equivalent during matching but preserves both original types in the report for auditability.

### 7. Fee differences are not match-breaking
Fees may differ due to exchange rounding or timing. They are stored and visible in reports but do not affect match categorization. This is an intentional interpretation of the ambiguous spec.

### 8. Two-pass conflicting hook
The code has a `conflicting` classification path. Currently, `softMatch` uses strict tolerances so conflicts won't appear. A future two-pass approach (strict + relaxed) would classify proximity matches exceeding strict tolerance as `conflicting` — the scaffolding is already in place.

### 9. App factory pattern
The Express app is created via a factory function (`createApp()`), allowing tests to instantiate the app without starting the HTTP server or connecting to MongoDB.

---

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run linter
npm run lint

# Run lint + tests together
npm run validate
```

**Test coverage includes:**
- CSV parsing with all edge cases (aliases, malformed timestamps, negatives, duplicates)
- Matching engine: exact match, asset mismatch, timestamp window, quantity tolerance, perspective flip, best-candidate selection, greedy non-reuse
- All REST endpoints with mocked service layer (no real DB required)
- 404 and error handler behavior

---

## Commit Convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add matching engine with greedy best-first algorithm
fix: handle truncated ISO timestamp as malformed
refactor: extract transaction document builder into helper
test: add integration tests for report endpoints
docs: document matching algorithm and design decisions
chore: configure winston daily-rotate-file transport
```

---

## License

MIT
