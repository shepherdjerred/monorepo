# Monarch Accuracy Test: Black-Box Ground Truth Comparison

## Overview

A black-box accuracy test for the Monarch transaction classifier. Samples 500 random transactions, provides a web UI for manual labeling, runs the classifier, and compares results.

## File Structure

```
packages/monarch/scripts/accuracy/
  types.ts          # Shared types (SampledTransaction, GroundTruthLabel, Dataset, ComparisonResult)
  sample.ts         # Sample transactions from cache
  label-server.ts   # Bun HTTP server + labeling web UI
  compare.ts        # Compare ground truth vs tool output
```

Output data (gitignored): `dataset.json`, `tool-output.json`, `accuracy-report.json`.

## Workflow

```bash
# 1. Sample 500 transactions from ~/.monarch-cache/
MONARCH_TOKEN=... bun run scripts/accuracy/sample.ts [--count 500] [--seed 42]

# 2. Label via web UI at http://localhost:3847
bun run scripts/accuracy/label-server.ts

# 3. Run the classifier with JSON output
MONARCH_TOKEN=... ANTHROPIC_API_KEY=... bun run src/index.ts --output scripts/accuracy/tool-output.json

# 4. Compare and generate accuracy report
bun run scripts/accuracy/compare.ts
```

## Sampling (`sample.ts`)

- Reads all `transactions-*.json` files from `~/.monarch-cache/`
- Deduplicates by ID, filters out splits and pending transactions
- Tags each transaction's deep path using `separateDeepPaths()` from `src/lib/monarch/client.ts`
- Fisher-Yates shuffle with configurable `--seed` for reproducibility
- Fetches categories via Monarch API
- Writes `dataset.json` with transactions, empty labels array, and categories

## Labeling UI (`label-server.ts`)

Bun HTTP server serving a single-page labeling app optimized for speed (~500 transactions in under 30 minutes).

### Keyboard Shortcuts

| Key              | Action                                        |
| ---------------- | --------------------------------------------- |
| `Enter`          | Confirm current selection and advance to next |
| `Tab`            | Advance without labeling (skip)               |
| `k`              | Toggle "keep current category"                |
| `s`              | Toggle "needs split"                          |
| `/`              | Focus the category search box                 |
| `Escape`         | Clear search / unfocus                        |
| `Left` / `Right` | Previous / Next transaction                   |
| `u`              | Jump to next unlabeled transaction            |
| `1`-`9`          | Quick-assign the Nth quick-pick category      |

### Features

- **Quick picks**: Top 10 most common categories shown as buttons
- **Category search**: Fuzzy search grouped by category group
- **Resume support**: Labels persist to disk immediately; restart-safe
- **Dark mode**: Automatic via `prefers-color-scheme`
- **Minimap**: Visual progress dots for all 500 transactions
- **Filter toggles**: All / Unlabeled / Labeled views

### Server Endpoints

- `GET /` — serves the labeling UI
- `GET /api/dataset` — returns full dataset
- `POST /api/label` — saves one label
- `DELETE /api/label/:id` — removes a label

## Comparison (`compare.ts`)

Reads `dataset.json` (ground truth) and `tool-output.json` (classifier output). For each labeled transaction:

- If transaction ID is in tool output: tool's answer = proposed category
- If not in tool output: tool agrees with Monarch's current category

### Metrics

- **Overall accuracy**: correct / total
- **Monarch baseline**: how often Monarch's existing category was already correct
- **By confidence**: accuracy for high/medium/low/"agreed" buckets
- **By deep path**: accuracy for amazon/venmo/bilt/regular/etc.
- **Change precision**: when the tool proposes a change, how often is it correct?
- **Change recall**: when a change was needed, how often did the tool propose one?
- **Split detection**: binary accuracy of split identification
- **Confusion matrix**: top misclassification pairs

Output: ANSI-colored console summary + `accuracy-report.json`.

## Key Types

```typescript
type SampledTransaction = {
  id: string;
  date: string;
  amount: number;
  merchantName: string;
  plaidName: string;
  accountName: string;
  currentCategory: string;
  currentCategoryId: string;
  notes: string;
  isRecurring: boolean;
  deepPath:
    | "amazon"
    | "venmo"
    | "bilt"
    | "usaa"
    | "scl"
    | "apple"
    | "costco"
    | "regular";
};

type GroundTruthLabel = {
  transactionId: string;
  correctCategory: string;
  correctCategoryId: string;
  shouldSplit: boolean;
  labelNotes?: string;
  labeledAt: string;
};

type ComparisonResult = {
  transactionId: string;
  merchantName: string;
  amount: number;
  date: string;
  deepPath: string;
  groundTruthCategory: string;
  toolCategory: string;
  toolConfidence: "high" | "medium" | "low" | "agreed";
  isCorrect: boolean;
  monarchWasCorrect: boolean;
};
```

## Reused Code

- `MonarchTransactionSchema` from `src/lib/monarch/types.ts`
- `separateDeepPaths()` and `fetchCategories()` from `src/lib/monarch/client.ts`
- `ProposedChange` from `src/lib/classifier/types.ts`
- Cache file reading pattern from `scripts/analyze-txns.ts`
