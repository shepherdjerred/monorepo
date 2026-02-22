# Monarch

AI-powered transaction categorizer for [Monarch Money](https://www.monarchmoney.com/). Uses Claude to classify merchants into correct categories, matches Amazon orders to transactions for item-level classification, integrates Venmo payment notes for P2P transaction categorization, and splits Bilt rent/utility payments via Conservice data.

## Setup

Set the following environment variables:

- `MONARCH_TOKEN` (required) -- Monarch Money API token
- `ANTHROPIC_API_KEY` (required) -- Anthropic API key

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

| Flag | Description |
|------|-------------|
| `--apply` | Apply changes to Monarch Money (default: dry run) |
| `--interactive` | Approve each change individually |
| `--limit <n>` | Limit transactions to process |
| `--batch-size <n>` | Batch size for Claude API calls (default: 25) |
| `--model <id>` | Claude model (default: `claude-sonnet-4-20250514`) |
| `--sample <n>` | Sample N merchant groups for testing |
| `--verbose` | Enable debug logging |
| `--skip-amazon` | Skip Amazon order processing |
| `--amazon-years <years>` | Comma-separated years to scrape (default: last 2 years) |
| `--force-scrape` | Re-scrape Amazon orders even if cached |
| `--force-fetch` | Re-fetch transactions even if cached |
| `--venmo-csv <path>` | Path to Venmo CSV statement |
| `--skip-venmo` | Skip Venmo processing |
| `--conservice-cookies <cookies>` | Conservice session cookies for Bilt integration |
| `--skip-bilt` | Skip Bilt processing |

## Data Sources

- **Monarch Money** -- Transaction data via API.
- **Amazon** -- Order history via Playwright scraper. Requires manual login for 2FA on first run; results are cached locally.
- **Venmo** -- CSV export from `https://account.venmo.com/api/statement/download?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&csv=true`.
- **Conservice** -- Utility charge data for Bilt rent/utility splits.

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
