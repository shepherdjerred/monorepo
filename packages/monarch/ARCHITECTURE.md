# Monarch Architecture

## Overview

Monarch is an AI-powered transaction categorizer for [Monarch Money](https://www.monarchmoney.com/). It fetches transactions via the Monarch API, enriches them with data from external sources (Amazon orders, Venmo payments, Apple receipts, etc.), classifies them through the shared OpenRouter runtime, and optionally applies the changes back.

## Pipeline

```
1. Fetch transactions & categories from Monarch API
2. Separate transactions by merchant into deep paths
3. Deep-path enrichment (merchant-specific logic with external data)
4. Tiered classification (tier 1 rules, tier 2 batch, tier 3 research)
5. Verification and transfer guard
6. Display summary
7. Apply changes, write notes, or save to file
```

### Phase 1: Fetch & Separate

`src/index.ts` fetches transactions for the window given by `--since`/`--until` (default: the past 365 days; paginated, 4-hour cache) and all active categories from Monarch Money. Transactions are then separated by merchant name into **deep paths**:

| Deep Path | Merchant Patterns                                      | Data Source                     |
| --------- | ------------------------------------------------------ | ------------------------------- |
| Amazon    | `amazon`, `amzn`, `amzn mktp`                          | Playwright scraper + 1Password  |
| Venmo     | `venmo` (excludes credit card/cash back)               | CSV export                      |
| Bilt      | `bilt` (excludes cash back)                            | Conservice PDFs or API          |
| USAA      | `usaa`                                                 | PDF statements                  |
| SCL       | `seattle city light`, `scl`                            | CSV export                      |
| Apple     | `apple services`, `apple.com`                          | MailMate email parsing          |
| Costco    | `costco`, `costco whse`                                | Hardcoded JSON / receipt parser |
| Paystub   | `pinterest` **and a positive amount**                  | Workday payslip PDFs            |
| Equity    | `pinterest ... class a` **and $0.00**                  | Schwab Equity Award Center CSV  |
| Loan      | `upstart`, `audi`, `edfinancial` **and money leaving** | Servicer emails and statements  |
| Brokerage | `charles schwab` **and money arriving**                | Schwab CSV exports              |

The last four test the amount as well as the merchant, because the same
employer name appears on payroll deposits, on brokerage rows, and on the
occasional expense -- and a servicer's merchant also covers non-loan spending,
so Audi bills parts and a down payment under the name it bills the loan with.
An unmatched row on those paths is expected and is reported, not guessed at. Everything else goes to **regular transactions**.

### Phase 2: Deep-Path Enrichment

Each deep path has its own parse/match/enrich pipeline under `src/lib/<name>/`, and every one of them satisfies the same contract:

```typescript
enrich<Vendor>(transactions) => Promise<{
  enrichments: Map<transactionId, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
  changes?: ProposedChange[];
}>;
```

`changes` is for facts a vendor can state exactly rather than infer. A loan
statement prints the principal and interest of a payment; no model should be
asked to do that arithmetic. Those changes are merged with the tiers' proposals
and still pass through verification and the cross-group guard -- a better
producer, not a bypass. A transaction a vendor has decided is excluded from
tier routing, because nothing downstream merges two proposals for one
transaction: both would be applied.

`enrichment/pipeline.ts` holds them in a table (`deepPathSpecs`) rather than an if-chain, so adding a source is one entry. They run concurrently; each contributes facts about a transaction, and classification happens afterwards in one place.

Paystub and Equity are deliberately **enrichment-only**: they write notes and report discrepancies but never propose splits, because only net pay ever reaches the account and a vest moves no cash at all.

#### Matching

All matchers share a common pattern:

1. Filter out existing split transactions
2. Track used IDs to prevent double-matching
3. Match by date window + amount tolerance
4. Return `{ matched[], unmatchedTransactions[], unmatchedOrders[] }`

| Matcher   | Date Window  | Amount Tolerance           | Special Logic                          |
| --------- | ------------ | -------------------------- | -------------------------------------- |
| Amazon    | +/-3 days    | $0.02 or single-item price | Flexible: total OR first item          |
| Venmo     | +/-2 days    | $0.02                      | Filters Transfer category              |
| Costco    | +/-5 days    | $1.00                      | Loose tolerance for tax                |
| Apple     | +/-3 days    | $0.01                      | Stricter for digital purchases         |
| Bilt      | Same month   | $1.00                      | Groups charges by category             |
| Paystub   | +/-3 days    | $0.01 against net pay      | Second date-only pass reports drift    |
| Equity    | 0 to +7 days | None -- every row is $0.00 | Matched per vest date, not per row     |
| Loan      | +/-6 days    | To the cent                | Payment attributed to a loan first     |
| Brokerage | 0 to +3 days | To the cent                | Transfer linked to the sale funding it |

Three of these depart from the shared shape on purpose:

- **Paystub** runs a second pass that pairs a deposit to a same-day payslip whose net does _not_ equal it, and reports the pair instead of matching it. Surfacing a paycheck that differs from its payslip is the reason the vendor exists; it is not a fallback. Payslips that net to zero (an equity release, where withholding consumes the whole amount) are excluded, since no deposit can exist for them.
- **Equity** cannot use an amount at all, and rows sharing a vest date are indistinguishable -- same merchant, same account, same $0.00. So awards are aggregated per vest date and every row of that date receives the same summary. The window is one-sided because shares settle after the vest, never before.
- **Brokerage** matches the cash movement the bank saw, then reaches past it to the sale that funded it. A transfer empties the account, so it can exceed the sale's proceeds by whatever idle cash sat alongside them; a sweep of up to a dollar is attached and named in the note, and anything larger is left unexplained rather than attributed to a sale it does not match.

Loan splits carry an `origin`. Upstart states only a running balance, so its
splits are the difference between consecutive statements; Audi and Edfinancial
print principal and interest per payment, so theirs are read directly. The note
says `(derived)` for the first kind only -- a reconstruction and a reading
should not look alike.

#### When a vendor decides for itself

The rule is that a vendor returns facts and lets the tiers decide: a matcher
that also classifies is two things to replace instead of one. Five
`<vendor>/classify.ts` files predating the enrichment contract were deleted
once it turned out nothing imported them.

The exception is arithmetic the source document states outright. `lib/loan`
derives principal and interest from the servicer's own balance statements and
returns them through `changes`. That is not a classification judgement, and a
model asked to do it would be guessing at numbers that were published.

### Phase 3: Tiered Classification

`enrichment/router.ts` assigns each transaction a tier from what is now known about it, and each tier costs more than the last:

| Tier | What it is                                                    | Cost         |
| ---- | ------------------------------------------------------------- | ------------ |
| 1    | A merchant the knowledge base has seen decided consistently   | No model     |
| 2    | Everything ordinary -- batched with its enrichment as context | One batch    |
| 3    | Unknown merchants needing research -- web search plus tools   | Per merchant |

Enrichment is what moves work down the tiers: a transaction whose items, bill breakdown or payslip is already known is decided from facts rather than guesses. `classifier/tier2.ts` renders each enrichment field into the prompt through a table of small renderers, one per field.

Tier 2 batches are checkpointed in `~/.monarch-cache` under a key that hashes the **batch composition**, so changing which transactions are in a run invalidates every batch in it. Widening the date window and letting classification run therefore costs a full re-spend; `--notes-only` exists to avoid exactly that.

#### Web Search

When `--skip-research` is not set (default), the research pass uses OpenRouter's provider-defined web-search tool with at most 20 results. Its bounded evidence is passed to a tool-free Zod finalizer; semantic repair retries only the finalizer. Tier 3 combines three-result server search with the local merchant-history, nearby-transaction, and category-info AI SDK tools.

### Phase 4: Verification and the transfer guard

`verification/verify.ts` re-checks proposed changes before anything is written. `verification/transfer-guard.ts` then demotes any change that would move a transaction across group types -- expense to income, income to transfer -- to a review flag rather than applying it, because those are the changes that quietly corrupt a budget. `Uncategorized` is exempt as a source: leaving it is always an improvement.

### Phase 5: Apply

Output modes:

- **Dry run** (default): Display proposed changes
- **`--output <path>`**: Save changes as JSON
- **`--apply`**: Apply via Monarch API with optional `--interactive` per-transaction approval
- **`--notes-only`**: Write enrichment notes and stop before any tier runs. No model is called, so no model credential is needed and no category is touched -- the mode for documenting history without re-litigating its categories.

Notes written by the pipeline begin with a `🧾` marker and a space so a re-run refreshes its own notes and never overwrites one written by hand. Email-derived notes share that namespace and are deliberately replaced by vendor enrichment (a scraped item list beats a model's one-liner); the count of replacements is logged so a run stays auditable.

Mutations use the local Monarch GraphQL client with cookie/CSRF session authentication, retry logic (3 attempts, exponential backoff), and a 500ms throttle between API calls.

## Where derived data lives

Split by what it costs to recreate:

- **The finance vault** (`~/Sync/Sync/Finances/`) holds source documents and anything expensive enough that losing it hurts: the Amazon order cache (hours of headed scraping) and the email-match checkpoint (dollars of model judgments). It is synced by Syncthing with everything else in that folder.
- **`~/.monarch-cache/`** holds cheap regenerable scratch: the transaction cache, email index, merchant knowledge base, and tier-2 checkpoints.

Caches that moved to the vault keep a one-time read of their old location, so an existing cache survives the move. Nothing financial is ever committed to the repository.

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
vendor, so adding a deep path forbids it in both directions without a
hand-maintained matrix. `lib/mail/`, `lib/pdf/` and `lib/csv/` are shared
infrastructure rather than vendors and are deliberately outside the group, so
any vendor may use them. Every rule has a committed negative fixture under
`architecture-fixtures/` that proves it can fail;
`src/architecture-boundaries.test.ts` fails if a rule ever loses one.

## Module Map

```
src/
├── index.ts                        # Main orchestrator
├── lib/
│   ├── config.ts                   # CLI arg parsing (parseArgs), date range
│   ├── finance-vault.ts            # Vault paths; cache locations and migration
│   ├── apply.ts                    # Mutation logic (apply, split, flag)
│   ├── display.ts                  # Terminal output with ANSI colors
│   ├── logger.ts                   # Leveled logging (debug/info/warn/error)
│   ├── usage.ts                    # Token/cost tracking
│   │
│   ├── monarch/                    # Monarch Money API layer
│   │   ├── client.ts              # GraphQL client, fetch, mutations, separateDeepPaths()
│   │   ├── api.ts                 # Typed operations
│   │   ├── session.ts             # Cookie/CSRF session
│   │   └── types.ts               # MonarchTransaction, MonarchCategory (Zod schemas)
│   │
│   ├── enrichment/                 # The deep-path contract and what it produces
│   │   ├── pipeline.ts            # deepPathSpecs table; runs every vendor
│   │   ├── router.ts              # Tier assignment
│   │   ├── notes.ts               # Note rendering, plan and write
│   │   └── types.ts               # TransactionEnrichment
│   │
│   ├── classifier/                 # OpenRouter and AI SDK integration
│   │   ├── llm.ts                 # Shared runtime, bounded research, structured finalization
│   │   ├── tier1.ts / tier2.ts / tier3.ts
│   │   ├── tier2-checkpoint.ts    # Batch-composition keyed resume
│   │   └── types.ts               # ProposedChange, response schemas, Confidence
│   │
│   ├── verification/               # verify.ts, transfer-guard.ts
│   ├── knowledge/                  # Merchant knowledge base and category definitions
│   │
│   ├── mail/                       # Shared: email index, candidate shortlist, affinity
│   ├── pdf/                        # Shared: layout-aware text extraction, money parsing
│   ├── csv/                        # Shared: quoted-field row splitting
│   │
│   ├── amazon/                     # Playwright scraper, charge join, merge-on-save cache
│   ├── venmo/                      # CSV export
│   ├── conservice/                 # Bilt bills (PDF or API)
│   ├── usaa/                       # PDF statements
│   ├── scl/                        # Seattle City Light CSV
│   ├── apple/                      # Receipt emails
│   ├── costco/                     # Orders and receipts
│   ├── paystub/                    # Workday payslips: parse-payslip.ts, matcher.ts
│   ├── equity/                     # Schwab RSU vests: parser.ts, matcher.ts
│   ├── loan/                       # Servicer splits: audi.ts, edfinancial.ts, schedule.ts
│   └── brokerage/                  # Schwab share sales: parser.ts, matcher.ts
└── scripts/
    ├── build-payslips.ts           # Vault PDFs -> payslips.json
    ├── build-costco-orders.ts      # Vault PDFs -> costco-orders.json
    └── match-emails.ts             # Email shortlist and judging
```

The three shared directories exist because more than one vendor needed the same thing and vendors may not import each other. `scripts/build-*.ts` keep slow document parsing out of the pipeline: they write a small JSON next to the source documents in the vault, and the vendor only loads and validates it.

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
