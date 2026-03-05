# Monarch — Transaction Categorization Pipeline

## Overview

Monarch categorizes personal finance transactions from the Monarch Money app. It enriches transactions with data from external sources (Amazon orders, Venmo payments, bills, etc.) and classifies them using a tiered Claude-powered pipeline.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Monarch API │────▶│  Enrichment  │────▶│   Tiered     │
│  (fetch txns)│     │  Pipeline    │     │  Classifier  │
└──────────────┘     └──────────────┘     └──────────────┘
                           │                     │
                     ┌─────┴─────┐         ┌─────┴─────┐
                     │ Deep Path │         │ Merchant  │
                     │ Enrichers │         │ KB + Defs │
                     └───────────┘         └───────────┘
                                                 │
                                           ┌─────┴─────┐
                                           │Verification│
                                           │+ Suggestions│
                                           └───────────┘
```

## Pipeline Phases

### Phase 1: Enrichment (`src/lib/enrichment/`)

Deep path modules produce `TransactionEnrichment` data — structured metadata about a transaction from external sources. They do NOT classify transactions.

| Deep Path         | Source            | Enrichment Data                          |
| ----------------- | ----------------- | ---------------------------------------- |
| Amazon            | Order scraping    | Items with titles and prices             |
| Venmo             | CSV export        | Payment note, direction, counterparty    |
| Bilt (Conservice) | Bill parsing      | Service type breakdown (rent, utilities) |
| USAA              | Statement parsing | Insurance line items by policy type      |
| SCL               | CSV export        | Billing periods with amounts             |
| Apple             | Mail receipts     | Receipt items with subscription flags    |
| Costco            | Receipt matching  | Order items                              |

Key types:

- `TransactionEnrichment` — enrichment payload (items, notes, breakdowns, etc.)
- `EnrichedTransaction` — transaction + enrichment + assigned tier + deep path label

### Phase 2: Tier Routing (`src/lib/enrichment/router.ts`)

Each transaction is assigned a classification tier based on enrichment and KB data:

| Tier       | Criteria                                                    | Cost                         |
| ---------- | ----------------------------------------------------------- | ---------------------------- |
| **Tier 1** | Single-category KB merchant, high confidence, no enrichment | Free (KB lookup)             |
| **Tier 2** | Has enrichment data or KB entry                             | Batch Claude calls (~8/call) |
| **Tier 3** | Cryptic/unknown merchants (SQ _, TST_, etc.)                | Agentic per-txn with tools   |

### Phase 3: Classification (`src/lib/classifier/`)

- **Tier 1** (`tier1.ts`): Direct KB lookup. No API calls. Returns the stored default category.
- **Tier 2** (`tier2.ts`): Batches transactions into groups, includes enrichment context in prompts, uses Zod schema validation for responses. Supports split detection for multi-category transactions.
- **Tier 3** (`tier3.ts`): Per-transaction agentic loop with tool use. Tools: `merchant_history`, `nearby_transactions`, `category_info`, `web_search`. Up to 5 tool rounds per transaction.

### Phase 4: Verification (`src/lib/verification/verify.ts`)

- Cross-transaction consistency: same merchant should get same category
- Split validation: split amounts must sum to transaction total
- Enrichment suggestions: identifies merchants that would benefit from hints, KB entries, or better deep path data

## Knowledge Base (`src/lib/knowledge/`)

- **store.ts** — Load/save/lookup/learn from `~/.monarch-cache/merchant-kb.json`
- **definitions.ts** — Category definitions with descriptions, examples, and anti-examples for prompt context
- **history.ts** — Build merchant stats from transaction history, convert to KB entries
- **types.ts** — `MerchantKnowledge` (merchant type, not category), `CategoryDefinition`, `EnrichmentSuggestion`

The KB stores merchant _type_ and behavior (e.g., "grocery store", "multi-category"), not a direct merchant→category mapping. Hints from `hints.txt` are parsed into KB entries with `parseHintsToKB()`.

## Key Design Decisions

1. **Enrichment ≠ Classification**: Deep paths produce data, not decisions. The classifier uses enrichment as context.
2. **Tiered cost optimization**: Simple merchants use free KB lookup; only cryptic merchants trigger expensive agentic classification.
3. **Merchant type, not category**: KB stores what a merchant _is_, not what category to use. This handles multi-category merchants (e.g., Amazon sells groceries AND electronics).
4. **Suggestions over auto-learning**: The system suggests KB improvements rather than auto-creating entries from single classifications.

## File Structure

```
src/
├── index.ts                    # Main pipeline orchestration
├── lib/
│   ├── enrichment/
│   │   ├── types.ts            # TransactionEnrichment, EnrichedTransaction, Tier
│   │   ├── pipeline.ts         # Enrichment orchestrator (runs all deep paths)
│   │   └── router.ts           # Tier assignment logic
│   ├── knowledge/
│   │   ├── types.ts            # MerchantKnowledge, CategoryDefinition, EnrichmentSuggestion
│   │   ├── store.ts            # KB persistence, hint parsing, learning
│   │   ├── definitions.ts      # Category definitions and formatting
│   │   └── history.ts          # Build merchant stats from transaction history
│   ├── classifier/
│   │   ├── types.ts            # ProposedChange, Confidence (shared)
│   │   ├── claude.ts           # Shared Claude API client, retry, parsing
│   │   ├── tier1.ts            # KB lookup classifier
│   │   ├── tier2.ts            # Batch classifier with enrichment
│   │   ├── tier3.ts            # Agentic classifier with tool use
│   │   └── tools.ts            # Tool definitions and handlers for tier 3
│   ├── verification/
│   │   └── verify.ts           # Cross-check, split validation, suggestions
│   ├── amazon/enrich.ts        # Amazon order enrichment
│   ├── venmo/enrich.ts         # Venmo payment enrichment
│   ├── conservice/enrich.ts    # Bilt bill enrichment
│   ├── usaa/enrich.ts          # USAA insurance enrichment
│   ├── scl/enrich.ts           # SCL billing enrichment
│   ├── apple/enrich.ts         # Apple receipt enrichment
│   ├── costco/enrich.ts        # Costco receipt enrichment
│   ├── display.ts              # Terminal output formatting
│   ├── config.ts               # CLI argument parsing
│   └── monarch/                # Monarch API client and types
└── scripts/accuracy/compare.ts # Accuracy comparison with per-tier metrics
```

## CLI Flags

| Flag                                  | Description                                              |
| ------------------------------------- | -------------------------------------------------------- |
| `--rebuild-kb`                        | Rebuild knowledge base from transaction history          |
| `--skip-enrich`                       | Skip enrichment phase (classify with existing data only) |
| `--suggest`                           | Show enrichment improvement suggestions after run        |
| `--dry-run`                           | Preview changes without applying                         |
| `--skip-amazon`, `--skip-venmo`, etc. | Skip individual deep paths                               |
