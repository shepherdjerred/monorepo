# Monarch Architecture

## Overview

Monarch is an AI-powered transaction categorizer for [Monarch Money](https://www.monarchmoney.com/). It fetches transactions via the Monarch API, enriches them with data from external sources (Amazon orders, Venmo payments, Apple receipts, etc.), classifies them through the shared OpenRouter runtime, and optionally applies the changes back.

## Pipeline

```
1. Fetch transactions & categories from Monarch API
2. Separate transactions by merchant into deep paths
3. Deep classification (merchant-specific logic with external data)
4. Week-based classification (OpenRouter with temporal context + web search)
5. Display summary
6. Apply changes or save to file
```

### Phase 1: Fetch & Separate

`src/index.ts` fetches all transactions from the past 365 days (paginated, 4-hour cache) and all active categories from Monarch Money. Transactions are then separated by merchant name into **deep paths**:

| Deep Path | Merchant Patterns                        | Data Source                     |
| --------- | ---------------------------------------- | ------------------------------- |
| Amazon    | `amazon`, `amzn`, `amzn mktp`            | Playwright scraper + 1Password  |
| Venmo     | `venmo` (excludes credit card/cash back) | CSV export                      |
| Bilt      | `bilt` (excludes cash back)              | Conservice PDFs or API          |
| USAA      | `usaa`                                   | PDF statements                  |
| SCL       | `seattle city light`, `scl`              | CSV export                      |
| Apple     | `apple services`, `apple.com`            | MailMate email parsing          |
| Costco    | `costco`, `costco whse`                  | Hardcoded JSON / receipt parser |

Everything else goes to **regular transactions** for week-based classification.

### Phase 2: Deep Classification

Each deep path has its own classify/match/parse pipeline under `src/lib/<name>/`. Deep classifiers run sequentially in this order: Venmo, Bilt, USAA, SCL, Apple, Costco, Amazon.

Each produces `ProposedChange[]` -- either recategorizations, splits, or flags.

#### Matching

All matchers share a common pattern:

1. Filter out existing split transactions
2. Track used IDs to prevent double-matching
3. Match by date window + amount tolerance
4. Return `{ matched[], unmatchedTransactions[], unmatchedOrders[] }`

| Matcher | Date Window | Amount Tolerance           | Special Logic                  |
| ------- | ----------- | -------------------------- | ------------------------------ |
| Amazon  | +/-3 days   | $0.02 or single-item price | Flexible: total OR first item  |
| Venmo   | +/-2 days   | $0.02                      | Filters Transfer category      |
| Costco  | +/-5 days   | $1.00                      | Loose tolerance for tax        |
| Apple   | +/-3 days   | $0.01                      | Stricter for digital purchases |
| Bilt    | Same month  | $1.00                      | Groups charges by category     |

#### Classification Strategies

- **OpenRouter batch**: Amazon and Costco send item lists to the configured model for per-item classification. Batch size 20, Amazon uses 3 concurrent batches.
- **Rule-based**: Apple uses keyword matching (icloud -> Software, apple music -> Entertainment). Bilt uses Conservice charge type IDs. USAA and SCL use hardcoded split ratios.
- **OpenRouter single**: Venmo sends matched payments with notes to the configured model for classification.

### Phase 3: Resolved Map

After deep classification, `buildResolvedMap()` in `src/lib/enrichment.ts` creates a `Map<transactionId, ResolvedTransaction>` from all deep path results. This prevents double-classification -- resolved transactions appear as `[RESOLVED]` in week prompts so the model skips them.

### Phase 4: Week-Based Classification

All transactions (regular + deep path) are grouped into ISO 8601 weeks (Monday-Sunday), then classified using sliding windows:

```
+---------------+  +---------------+  +---------------+
| PREVIOUS WEEK |  | THIS WEEK     |  | NEXT WEEK     |
| [CONTEXT]     |  | [CLASSIFY]    |  | [CONTEXT]     |
+---------------+  +---------------+  +---------------+
```

- Context weeks provide temporal context (nearby transactions inform classification)
- Resolved transactions show as `[RESOLVED -> Category]` or `[RESOLVED -> SPLIT]`
- Only unresolved, non-split transactions in the current week get `[CLASSIFY #N]` tags
- 3 weeks classified concurrently
- Results cached per week in `~/.monarch-cache/week-classifications.json`
- Cache key: `weekKey:sortedTransactionIds` -- invalidated if transactions change

#### Web Search

When `--skip-research` is not set (default), the research pass uses OpenRouter's provider-defined web-search tool with at most 20 results. Its bounded evidence is passed to a tool-free Zod finalizer; semantic repair retries only the finalizer. Tier 3 combines three-result server search with the local merchant-history, nearby-transaction, and category-info AI SDK tools.

### Phase 5: Apply

Three output modes:

- **Dry run** (default): Display proposed changes
- **`--output <path>`**: Save changes as JSON
- **`--apply`**: Apply via Monarch API with optional `--interactive` per-transaction approval

Mutations use the local Monarch GraphQL client with cookie/CSRF session authentication, retry logic (3 attempts, exponential backoff), and a 500ms throttle between API calls.

## Enforced boundaries

The deep paths are horizontal, not layered: they run sequentially and share
nothing but the pipeline contracts in `classifier/`, `enrichment/` and
`monarch/`. Two rules are machine-enforced by `check-architecture` (part of
`bun run lint`), declared in `architecture.config.ts`:

| Rule                                             | What it forbids                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `vendor-adapters-are-self-contained`             | Any deep path under `src/lib/` importing another. Pull genuinely common code up into the shared pipeline instead.   |
| `monarch-client-does-not-depend-on-the-pipeline` | `lib/monarch/` — the Monarch Money API client — importing a deep path, the classifier, enrichment, or verification. |

The first is declared once as an isolation group and expands to one rule per
vendor, so adding an eighth deep path forbids it in both directions without a
hand-maintained matrix. Every rule has a committed negative fixture under
`architecture-fixtures/` that proves it can fail;
`src/architecture-boundaries.test.ts` fails if a rule ever loses one.

## Module Map

```
src/
├── index.ts                        # Main orchestrator
├── lib/
│   ├── config.ts                   # CLI arg parsing (parseArgs)
│   ├── enrichment.ts               # buildResolvedMap() for deep -> week handoff
│   ├── apply.ts                    # Mutation logic (apply, split, flag)
│   ├── display.ts                  # Terminal output with ANSI colors
│   ├── logger.ts                   # Leveled logging (debug/info/warn/error)
│   ├── usage.ts                    # Token/cost tracking
│   │
│   ├── monarch/                    # Monarch Money API layer
│   │   ├── client.ts              # GraphQL client, fetch, mutations, separateDeepPaths()
│   │   ├── types.ts               # MonarchTransaction, MonarchCategory (Zod schemas)
│   │   └── weeks.ts               # ISO week grouping + sliding windows
│   │
│   ├── classifier/                 # OpenRouter and AI SDK integration
│   │   ├── llm.ts                 # Shared runtime, bounded research, structured finalization
│   │   ├── prompt.ts              # Prompt construction (week, Amazon, Venmo)
│   │   ├── cache.ts               # Order + week classification cache
│   │   └── types.ts               # ProposedChange, response schemas, Confidence
│   │
│   ├── amazon/                     # Amazon deep path
│   │   ├── classify.ts            # Orchestrator: scrape -> match -> Claude batch -> splits
│   │   ├── matcher.ts             # Match transactions to orders by date/amount
│   │   ├── scraper.ts             # Playwright scraper with 1Password auth
│   │   └── types.ts               # AmazonOrder, AmazonItem
│   │
│   ├── venmo/                      # Venmo deep path
│   │   ├── classify.ts            # Orchestrator: parse CSV -> match -> Claude
│   │   ├── matcher.ts             # Match transactions to Venmo payments
│   │   └── parser.ts              # CSV parser
│   │
│   ├── conservice/                 # Bilt/Conservice deep path
│   │   ├── classify.ts            # Orchestrator: load charges -> match -> split
│   │   ├── matcher.ts             # Match Bilt transactions to monthly summaries
│   │   ├── client.ts              # Conservice HTTP API client
│   │   └── parser.ts              # PDF bill parser (pdfjs-dist)
│   │
│   ├── usaa/                       # USAA Insurance deep path
│   │   ├── classify.ts            # Orchestrator: parse PDF -> match -> split
│   │   ├── matcher.ts             # Match transactions to statements
│   │   ├── parser.ts              # PDF statement parser
│   │   └── data.ts                # Statement data types
│   │
│   ├── scl/                        # Seattle City Light deep path
│   │   ├── classify.ts            # Orchestrator: parse CSV -> match -> 50/50 split
│   │   ├── matcher.ts             # Match transactions to bills by due date
│   │   └── parser.ts              # CSV parser
│   │
│   ├── apple/                      # Apple deep path
│   │   ├── classify.ts            # Orchestrator: parse emails -> match -> rule-based
│   │   ├── matcher.ts             # Match transactions to receipts
│   │   └── parser.ts              # EML/MIME email parser
│   │
│   └── costco/                     # Costco deep path
│       ├── classify.ts            # Orchestrator: load orders -> match -> Claude batch
│       ├── matcher.ts             # Match transactions to orders
│       ├── scraper.ts             # Order data loader
│       └── receipt-parser.ts      # Receipt text parser
```

## Key Types

```typescript
// The universal change proposal -- all classifiers produce these
type ProposedChange = {
  transactionId: string;
  transactionDate: string;
  merchantName: string;
  amount: number;
  currentCategory: string;
  currentCategoryId: string;
  proposedCategory: string;
  proposedCategoryId: string;
  confidence: "high" | "medium" | "low";
  type: "recategorize" | "split" | "flag";
  splits?: ProposedSplit[];
  reason?: string;
};

type ProposedSplit = {
  itemName: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  date?: string; // Date override for sub-transactions (e.g., SCL bimonthly)
};

// Monarch API types (Zod-validated)
type MonarchTransaction = {
  id: string;
  amount: number; // Negative = expense, positive = income
  date: string; // YYYY-MM-DD
  plaidName: string; // Bank's raw merchant name
  isSplitTransaction: boolean;
  category: { id: string; name: string };
  merchant: { id: string; name: string; transactionsCount: number };
  account: { id: string; displayName: string };
  // ... plus pending, notes, tags, timestamps, review status
};
```

## Caching

All caches live in `~/.monarch-cache/`:

| File                              | Contents                                        | TTL                   |
| --------------------------------- | ----------------------------------------------- | --------------------- |
| `transactions-{start}-{end}.json` | Raw Monarch transactions                        | 4 hours               |
| `classifications.json`            | Amazon/Costco order classifications by orderId  | Permanent             |
| `week-classifications.json`       | Week classification results by `weekKey:txnIds` | Until txn set changes |
| `venmo.json`                      | Parsed Venmo CSV data                           | Permanent             |

## LLM Integration

Ordinary inference goes through `@shepherdjerred/llm-runtime` and `src/lib/classifier/llm.ts`:

- Model: stable catalog ID `claude-sonnet-5` by default (configurable via `--model`)
- Max tokens: 16,384
- Transport retries: two for retryable network, 429, and 5xx failures
- Semantic attempts: three total through strict `Output.object` and Zod validation
- Web search: optional OpenRouter server tool (20 batch results; 3 tier-3 results)
- Response handling: no prose or fenced-JSON parsing and no response healing
- Usage tracking: Records input/output tokens per call for cost estimation

### Prompt Structure

The week prompt sends transactions grouped by week with surrounding context:

```
[CLASSIFY #0] 2026-02-17 | -$45.20 | Whole Foods | bank: "WHOLE FOODS #123" | acct: Checking | current: Shopping
[RESOLVED -> Groceries] 2026-02-18 | -$12.00 | Trader Joe's | bank: "TRADER JOES"
[RESOLVED -> SPLIT] 2026-02-19 | -$89.99 | Amazon | USB Hub -> Electronics, Dog Food -> Pets
```

The finalizer returns schema-validated transaction indices, categories, and confidence levels.

## Data Flow

```
MonarchTransaction[]
        |
        v
separateDeepPaths()
        |
        +---> deep classifiers ---> ProposedChange[]
        |                                |
        |                        buildResolvedMap()
        |                                |
        v                                v
groupByWeek() ---> buildWeekWindows() ---> classifyWeek() ---> ProposedChange[]
                                               |
                                      OpenRouter research
                                      + Zod finalizer
                                               |
                                               v
                                    allChanges[] ---> applyChanges()
```

## Testing

15 test files using Vitest. Key coverage areas:

- **Matchers**: Date window/amount tolerance logic for all deep paths
- **Parsers**: Apple EML, Conservice .NET dates, Venmo CSV
- **Prompts**: Week/Amazon/Venmo prompt construction, transaction formatting
- **Splits**: `computeSplits()` proration and cent-level rounding
- **Display**: Summary statistics aggregation
- **Logger**: Level gating and progress formatting

Run with `bun run test`.
