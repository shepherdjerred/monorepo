# Monarch

AI-powered transaction categorizer for [Monarch Money](https://www.monarchmoney.com/). Fetches transactions via the Monarch API, enriches them with data from external sources (Amazon, Venmo, Bilt/Conservice, USAA, Seattle City Light, Apple receipts, Costco), classifies them with stable catalog models through OpenRouter, and optionally applies the changes back. The full pipeline design lives in [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Set the following environment variables:

- `OPENROUTER_API_KEY` (required) -- service-specific OpenRouter API key
- `CONSERVICE_COOKIES` (optional) -- fallback for `--conservice-cookies`

Authenticate to Monarch with a browser session:

```bash
bun run login           # browser login (alias of login:browser)
bun run login:password  # password-based login
```

This writes `.monarch-session.json` after login. The session file contains cookies and is ignored by git.

## Usage

```bash
# Basic dry run
bun run src/index.ts

# With verbose output and sampling
bun run src/index.ts --verbose --sample 20

# Skip Amazon, with Venmo CSV
bun run src/index.ts --skip-amazon --venmo-csv ~/Downloads/VenmoStatement.csv

# With Bilt/Conservice integration
bun run src/index.ts --conservice-cookies "session=abc123"

# Apply changes (with confirmation prompt)
bun run src/index.ts --apply

# Interactive mode (approve each change)
bun run src/index.ts --apply --interactive
```

## CLI Flags

General:

| Flag                       | Description                                          |
| -------------------------- | ---------------------------------------------------- |
| `--apply`                  | Apply changes to Monarch Money (default: dry run)    |
| `--interactive`            | Approve each change individually                     |
| `--limit <n>`              | Limit transactions to process                        |
| `--batch-size <n>`         | Batch size for LLM calls (default: 25)               |
| `--model <id>`             | Stable catalog model ID (default: `claude-sonnet-5`) |
| `--sample <n>`             | Sample N merchant groups for testing                 |
| `--verbose`                | Enable debug logging                                 |
| `--output <path>`          | Save proposed changes to JSON                        |
| `--checkpoint-file <path>` | Override Tier 2 recovery checkpoint path             |
| `--force-fetch`            | Re-fetch transactions even if cached                 |
| `--skip-research`          | Disable OpenRouter web search for merchants          |
| `--rebuild-kb`             | Rebuild the merchant knowledge base from scratch     |
| `--skip-enrich`            | Skip the enrichment pipeline                         |
| `--suggest`                | Print verification suggestions (default: true)       |

Per data source:

| Flag                             | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `--skip-amazon`                  | Skip Amazon order processing                            |
| `--amazon-years <years>`         | Comma-separated years to scrape (default: last 2 years) |
| `--force-scrape`                 | Re-scrape Amazon orders even if cached                  |
| `--venmo-csv <path>`             | Path to Venmo CSV statement                             |
| `--skip-venmo`                   | Skip Venmo processing                                   |
| `--conservice-cookies <cookies>` | Conservice session cookies for Bilt integration         |
| `--skip-bilt`                    | Skip Bilt processing                                    |
| `--skip-usaa`                    | Skip USAA processing                                    |
| `--scl-csv <path>`               | Path to Seattle City Light CSV export                   |
| `--skip-scl`                     | Skip Seattle City Light processing                      |
| `--apple-mail-dir <path>`        | MailMate messages directory (auto-detected if omitted)  |
| `--skip-apple`                   | Skip Apple receipt processing                           |
| `--skip-costco`                  | Skip Costco processing                                  |

When `--output` is set, Tier 2 batch classifications are checkpointed next to
the output file using `.checkpoint.json`. Re-running the same command resumes
completed Tier 2 batches unless the prompt inputs, transaction IDs, model, web
search setting, or batch size changed.

Structured classifications use the shared Zod finalizer. Invalid output is
repaired without replaying web searches or local tier-3 tools. Research is
enabled by default through OpenRouter and can be disabled with
`--skip-research`.

## Data Sources

- **Monarch Money** -- Transaction data via API.
- **Amazon** -- Order history via Playwright scraper. Requires manual login for 2FA on first run; results are cached locally.
- **Venmo** -- CSV export from `https://account.venmo.com/api/statement/download?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&csv=true`.
- **Conservice** -- Utility charge data for Bilt rent/utility splits.
- **USAA** -- Insurance PDF statements.
- **Seattle City Light** -- CSV export (bimonthly bill splits).
- **Apple** -- Receipt emails parsed from a local MailMate archive.
- **Costco** -- Receipt parsing with per-item Claude classification.

Each deep source has its own classify/match/parse pipeline under `src/lib/<name>/`.

## Pipeline stages

Beyond fetch and classification, three stages persist context across runs: a merchant **knowledge base** (`src/lib/knowledge/`, rebuilt with `--rebuild-kb`), an **enrichment** pipeline that routes transactions to deep sources (`src/lib/enrichment/`, skipped with `--skip-enrich`), and a **verification** pass that checks classifications and emits suggestions (`src/lib/verification/`). See [ARCHITECTURE.md](ARCHITECTURE.md) for phases, matching tolerances, and caching.

## hints.txt

User-provided hints to override default categorization. Place the file at the package root. One hint per line, starting with `-`. Blank lines and `#` comments are supported.

Example:

```
# Coffee Shops
- Starbucks is a coffee shop -- always Coffee Shops, never Restaurants & Bars.
- Victrola is a coffee shop.

# Software
- Anthropic is an AI software subscription -- categorize as Software.
```
