# Monarch

AI-powered transaction categorizer for [Monarch Money](https://www.monarchmoney.com/). Fetches transactions via the Monarch API, enriches them with data from external sources (Amazon, Venmo, Bilt/Conservice, USAA, Seattle City Light, Apple receipts, Costco, Workday payslips, Schwab equity awards), classifies them with stable catalog models called directly on their provider, and optionally applies the changes back. The full pipeline design lives in [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Set the following environment variables:

- Credentials for the provider your `--model` routes to (required, except for `--notes-only` and `--derived-only`): `OPENAI_API_KEY` for GPT models, `ANTHROPIC_API_KEY` for Claude
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
| `--since <YYYY-MM-DD>`     | Start of the window (default: 365 days ago)          |
| `--until <YYYY-MM-DD>`     | End of the window (default: today)                   |
| `--notes-only`             | Write enrichment notes only; no model, no categories |
| `--derived-only`           | Apply only what vendors derived from documents       |
| `--limit <n>`              | Limit transactions to process                        |
| `--batch-size <n>`         | Batch size for LLM calls (default: 25)               |
| `--model <id>`             | Stable catalog model ID (default: `gpt-6-luna`)      |
| `--sample <n>`             | Sample N merchant groups for testing                 |
| `--verbose`                | Enable debug logging                                 |
| `--output <path>`          | Save proposed changes to JSON                        |
| `--checkpoint-file <path>` | Override Tier 2 recovery checkpoint path             |
| `--force-fetch`            | Re-fetch transactions even if cached                 |
| `--skip-research`          | Disable provider web search for merchants            |
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
| `--skip-apple`                   | Skip Apple receipt processing                           |
| `--skip-costco`                  | Skip Costco processing                                  |
| `--skip-paystub`                 | Skip payslip matching                                   |
| `--skip-equity`                  | Skip RSU vest matching                                  |
| `--skip-loan`                    | Skip loan principal/interest splits                     |
| `--skip-brokerage`               | Skip Schwab share-sale documentation                    |
| `--skip-brokerage`               | Skip the Schwab brokerage path                          |

When `--output` is set, Tier 2 batch classifications are checkpointed next to
the output file using `.checkpoint.json`. Re-running the same command resumes
completed Tier 2 batches unless the prompt inputs, transaction IDs, model, web
search setting, or batch size changed.

Structured classifications use the shared Zod finalizer. Invalid output is
repaired without replaying web searches or local tier-3 tools. Research is
enabled by default through the model provider's own web search and can be disabled with
`--skip-research`.

## Data Sources

Statement and receipt files live in the finance vault
(`~/Sync/Sync/Finances`, see `src/lib/finance-vault.ts`); the repo
keeps no copies. Parsers read straight from these folders:

- **Monarch Money** -- Transaction data via API.
- **Amazon** -- Order history via Playwright scraper. Requires manual login for 2FA on first run; results are cached locally.
- **Venmo** -- CSV export from `https://account.venmo.com/api/statement/download?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&csv=true`, saved to `Venmo/`. The newest export is used unless `--venmo-csv` overrides it.
- **Conservice** -- Statement PDFs (`*Conservice*.pdf`) in `The Victor/`, for Bilt rent/utility splits.
- **USAA** -- Insurance statement PDFs (`*_Auto_and_Property_Insurance_Statement.pdf`) in `USAA/`.
- **Seattle City Light** -- CSV export in `The Victor/` (bimonthly bill splits). The newest export is used unless `--scl-csv` overrides it.
- **Apple** -- Receipt emails found via the shared MailMate email index (`src/lib/mail/`, all accounts and mailboxes, cached at `~/.monarch-cache/email-index.jsonl`).
- **Costco** -- Receipt PDFs in `Costco/`, pre-parsed into `Costco/costco-orders.json` by `bun run scripts/build-costco-orders.ts`; the pipeline classifies per-item from that file. Rerun the script after adding receipts.
- **Payroll** -- Workday payslip PDFs in `Payroll/` (Workday: Pay > Payslips > Print; a multi-payslip bundle is fine, one per page), pre-parsed into `Payroll/payslips.json` by `bun run scripts/build-payslips.ts`. Rerun the script after adding payslips. Only period and amount fields are extracted -- no name, address, employee ID or account number.
- **Loans** -- Read from the servicer's own emails, with no file to supply.
  Upstart states an outstanding principal in each monthly reminder and names
  every payment in a confirmation; the drop between two balances is the
  principal that payment retired. Audi, Edfinancial, Hyundai and PenFed state
  neither, so those lenders need statements before they can be split.
- **Equity** -- Schwab Equity Award Center transaction export in `Equity/` (Equity Awards > Transactions > Export). The newest export is used. Covers RSU vests; share _sales_ need a separate brokerage history export.

Each deep source has its own classify/match/parse pipeline under `src/lib/<name>/`.

### Refreshing downloaded documents before a run

Amazon, Apple, loans, Monarch itself, and the merchant KB refresh
automatically. Everything below is a manual download, and only the period
after the newest file already in the folder needs fetching — overlapping
exports are safe (Venmo merges by transaction ID, brokerage dedupes by
date/amount, Costco and payroll rebuild from every PDF present).

| Source                    | Where to get it                                                                                                                                              | Save to (in `~/Sync/Sync/Finances/`)                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| USAA insurance statements | [usaa.com documents](https://www.usaa.com/my/documents?0&wa_ref=pri_global_tools_addlservices_viewdocs)                                                      | `USAA/YYYY-MM-DD_Auto_and_Property_Insurance_Statement.pdf`                                                                                                         |
| Costco receipts           | [Costco orders & purchases](https://www.costco.com/myaccount/#/app/4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf/ordersandpurchases) — save/print each receipt as PDF | `Costco/YYYY-MM-DD_Costco_<location>_Warehouse_Receipt_<total>.pdf` (online orders: `_Online_Order_..._<total>.pdf`), then `bun run scripts/build-costco-orders.ts` |
| Venmo statement           | `https://account.venmo.com/api/statement/download?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&csv=true` while logged in                                          | `Venmo/*Venmo*.csv`                                                                                                                                                 |
| Schwab brokerage history  | [Schwab transaction history](https://client.schwab.com/retail/accounts/history/#/) with the account dropdown set to **Individual (...284)**                  | `Schwab/*.csv` (any name; the parser sniffs history vs gain/loss)                                                                                                   |
| Schwab equity awards      | Same history page with the account dropdown set to **Equity Award Center**                                                                                   | `Equity/EquityAwardsCenter_Transactions_*.csv` (newest wins)                                                                                                        |
| Workday payslips          | Workday: Pay > Payslips > Print (a multi-payslip bundle is fine)                                                                                             | `Payroll/*.pdf`, then `bun run scripts/build-payslips.ts`                                                                                                           |

Credentials for a run: Monarch via `bun run login`, Amazon auto-login from
the `Amazon` item in 1Password (manual login in the headed browser also
works and is saved), and the model key from the `OpenAI API Key` item in
1Password injected with `op run` — never pasted or written to disk.

## Full grooming run

A grooming run means all of this, in order — classification alone is not
the whole job:

1. Refresh the downloaded documents above (only periods after the newest
   vault file per source).
2. `bun run login` if the Monarch session is missing or expired.
3. Classify: dry run with `--output` using a model that supports web
   search (e.g. `--model gpt-6.1-terra`; the `gpt-6-luna` default cannot
   do web search, so it needs `--skip-research`). Review proposals by
   dollar impact first, encode merchant policies in `hints.txt` instead of
   re-litigating them, and apply a curated subset — never blanket-apply:
   no Uncategorized moves over reviewed categories, no
   inconsistent-merchant flags (only cross-group flags are real signal).
4. Vendor notes: `bun run src/index.ts --notes-only --apply` (Amazon,
   Apple, Costco, loan and other document-derived breakdowns).
5. Email notes: `OPENAI_API_KEY='op://Private/OpenAI API Key/credential'
op run -- bun run scripts/match-emails.ts --apply --notes-only`.
   Judgments checkpoint to the vault, so re-runs only judge new or
   changed shortlists. `--notes-only` keeps email-suggested category
   changes out; review those separately before ever applying them.
6. Verify against a fresh fetch: category spot-checks on the largest
   applied changes, split children present, `needsReview` count, and
   note coverage. Report what was _not_ enriched (no describing
   email/document) rather than inventing descriptions.

## Pipeline stages

Beyond fetch and classification, three stages persist context across runs: a merchant **knowledge base** (`src/lib/knowledge/`, rebuilt with `--rebuild-kb`), an **enrichment** pipeline that routes transactions to deep sources (`src/lib/enrichment/`, skipped with `--skip-enrich`), and a **verification** pass that checks classifications and emits suggestions (`src/lib/verification/`). See [ARCHITECTURE.md](ARCHITECTURE.md) for phases, matching tolerances, and caching.

## Where derived data lives

Source documents live in the vault, and so does anything expensive enough that
losing it hurts: `Amazon/amazon-orders.json` (hours of headed scraping) and
`cache/email-match-checkpoint.json` (dollars of model judgments). Cheap,
regenerable scratch -- the transaction cache, email index, merchant knowledge
base, and Tier 2 checkpoints -- stays in `~/.monarch-cache/`. A cache that
moved keeps a one-time read of its old location so nothing is lost in the move.

`--notes-only` is the safe way to document history. It enriches and writes
notes without reaching a tier, so it calls no model, needs no API key, and
cannot disturb categories that were decided by hand. Classification over a
wide window is a different matter: Tier 2 checkpoints are keyed on batch
composition, so widening the window invalidates every batch and re-spends the
whole run. Classify history in fixed date slices if at all, and never pass
`--rebuild-kb` on a wide run -- it would promote years-old categorizations
into tier-1 defaults.

## Maintenance scripts

- `bun run scripts/build-costco-orders.ts` -- rebuild the Costco order cache
  from the receipt PDFs in the finance vault.
- `bun run scripts/build-payslips.ts [--dry-run]` -- parse the Workday payslip
  PDFs in the vault into `Payroll/payslips.json`. Every page must reconcile
  against its own printed section totals; a page that does not fails the run
  rather than shipping a partly-read payslip.
- `bun run scripts/dedupe-transactions.ts [--apply]` -- find and (with
  `--apply`, after writing a vault backup) delete duplicate transactions
  created when an account re-link backfills history an earlier connection
  already synced.
- `OPENAI_API_KEY=... bun run scripts/match-emails.ts [--apply] [--limit N]
[--rebuild-index]` -- match MailMate emails to transactions via the shared
  email index (`src/lib/mail/`): a DuckDB date-window join plus token-affinity
  scoring shortlists candidate emails per transaction, the model judges each
  match, and `--apply` writes `🧾 Email:` notes and guard-checked category
  changes back to Monarch. Judgments checkpoint to
  `Finances/cache/email-match-checkpoint.json` in the vault and resume across
  runs; the key includes a fingerprint of the candidate shortlist, so only
  transactions whose shortlist actually changed are re-judged. `--candidates-only`
  prints the shortlist size and score histogram and exits before spending
  anything.

## hints.txt

User-provided hints to override default categorization. Lives at the root of the finance vault (`~/Sync/Sync/Finances/hints.txt`). One hint per line, starting with `-`. Blank lines and `#` comments are supported.

Example:

```
# Coffee Shops
- Starbucks is a coffee shop -- always Coffee Shops, never Restaurants & Bars.
- Victrola is a coffee shop.

# Software
- Anthropic is an AI software subscription -- categorize as Software.
```
