# Monarch Classifier Package Check

## Status

Complete

## Summary

Confirmed that the monorepo has a Monarch classifier package at `packages/monarch`.

Evidence:

- `packages/monarch/package.json` declares `@shepherdjerred/monarch` with description `Monarch Money transaction classifier using Claude AI + Amazon order matching`.
- `packages/monarch/README.md` describes it as an AI-powered transaction categorizer for Monarch Money.
- `packages/docs/architecture/2026-02-23_monarch.md` documents the tiered classifier pipeline under `src/lib/classifier/`.
- `toolkit recall search "Monarch classifier package"` returned the Monarch architecture and accuracy-test docs as top results.

## Run Requirements

To run the classifier:

- Install repo tooling/dependencies with `mise trust && mise install` and `bun run scripts/setup.ts` if the checkout is not already set up.
- Run `bun run login` to create `.monarch-session.json`, then set `ANTHROPIC_API_KEY`.
- Run from `packages/monarch` with `bun run src/index.ts` for a dry run.
- Use `--apply` to write changes back to Monarch, optionally with `--interactive`.
- Optional enrichment inputs:
  - Amazon enrichment needs Playwright/browser access plus 1Password CLI item `Amazon` with username, password, and OTP unless cached or skipped with `--skip-amazon`.
  - Venmo enrichment needs `--venmo-csv <path>`.
  - Bilt/Conservice enrichment reads `packages/monarch/data/conservice/ConserviceBill*.pdf`.
  - USAA enrichment reads `packages/monarch/data/usaa/*_Auto_and_Property_Insurance_Statement.pdf`.
  - Seattle City Light enrichment needs `--scl-csv <path>`.
  - Apple enrichment auto-detects MailMate receipt email storage or accepts `--apple-mail-dir <path>`.
  - Costco enrichment reads `packages/monarch/src/lib/costco/costco-orders.json` if present.
- Local caches live under `~/.monarch-cache/`; Amazon also uses `~/.monarch-amazon-cache.json` and `~/.monarch-amazon-state.json`.

## 1Password Setup

There is no general automatic 1Password setup for Monarch runtime secrets in the current package. `ANTHROPIC_API_KEY` and optional `CONSERVICE_COOKIES` are read directly from environment variables.

Existing automation:

- `bun run login` / `bun run login:browser` opens the Monarch web login flow and captures cookies plus CSRF/client headers, then writes `.monarch-session.json`.
- Amazon enrichment uses `op item get Amazon --fields username --reveal`, `op item get Amazon --fields password --reveal`, and `op item get Amazon --otp` during scraper login.

Not present:

- No `op run` wrapper for `ANTHROPIC_API_KEY`.
- No `op://...` secret references for Monarch in repo config.
- No script that creates or populates a 1Password item for Monarch.

Practical current run options:

- Export the required env vars manually.
- Use `bun run login` or `bun run login:browser` to generate `.monarch-session.json`, then provide `ANTHROPIC_API_KEY` separately.
- If desired, add a small `op run --env-file`-style setup later, but that is not implemented today.

## Login Failure — 2026-05-17

`bun run login` currently failed after MFA with HTTP 403 and response body `{ "You": "Shall Not Pass" }`.

Local cause before this session's fix:

- `scripts/monarch-login.ts` posts credentials directly to `https://api.monarch.com/auth/login/`.
- It expects a `token` field in the response and writes that as `MONARCH_TOKEN`.
- The runtime client still uses `monarch-money-api` via `setToken(token)`, which implies the old `Authorization: Token ...` model.

External context checked on 2026-05-17:

- Recent Monarch community reports say Monarch changed GraphQL authentication from bearer token style to session cookies plus CSRF headers.
- The reported new request shape requires cookies, `X-Csrftoken`, `Origin`, `Referer`, `monarch-client`, and `monarch-client-version`; the old `Authorization: Token <token>` header is reported as no longer working.

Implication:

- `bun run login` is probably not enough anymore.
- `bun run login:browser` may also be insufficient because it still waits for an API `Authorization` token rather than saving cookies/CSRF session data.
- The package likely needs a Monarch auth/client refactor before it can fetch/apply transactions again.

Fix implemented:

- `bun run login` now opens the browser login flow and saves `.monarch-session.json` with Monarch cookies and CSRF/client headers.
- `src/lib/monarch/client.ts` now calls Monarch GraphQL directly with cookie/CSRF auth instead of `monarch-money-api`.
- Removed the unused `monarch-money-api` dependency and stale patch files.

## Session Log — 2026-05-16

### Done

- Checked the local recall index for `Monarch classifier package`.
- Confirmed repo files under `packages/monarch/`, including `package.json`, README, and classifier source files.
- Checked `packages/monarch/src/lib/config.ts`, `packages/monarch/src/index.ts`, and the enrichment modules to identify required credentials, optional data inputs, and cache locations.
- Checked the Monarch package and docs for 1Password integration; confirmed only Amazon scraper login uses `op` directly.
- Investigated `bun run login` HTTP 403 after MFA and documented the likely API-auth breakage.
- Replaced token-based Monarch API usage with cookie/CSRF GraphQL session support:
  - `packages/monarch/scripts/monarch-browser-login.ts` now captures `.monarch-session.json`.
  - `packages/monarch/src/lib/monarch/session.ts` stores and loads session cookies/headers.
  - `packages/monarch/src/lib/monarch/graphql.ts` sends CSRF-aware GraphQL requests.
  - `packages/monarch/src/lib/monarch/api.ts` defines the local GraphQL operations.
  - `packages/monarch/src/lib/monarch/client.ts` uses the local API module.
- Changed `bun run login` to use browser-session login and kept `login:password` as a disabled legacy command.
- Removed unused `monarch-money-api` dependency, type shim, and patch files.
- Updated README, architecture docs, and accuracy-test guide for `.monarch-session.json`.
- Added session unit tests.
- Verified `bunx eslint .`, `bun run typecheck`, `bun test`, browser-login script bundling, and disabled legacy password-login behavior in `packages/monarch`.
- Completed a live browser login and saved `packages/monarch/.monarch-session.json`.
- Verified the saved Monarch session with read-only GraphQL requests:
  - `getCategories()` returned 67 categories.
  - `getTransactions({ limit: 1 })` returned 1 transaction from 9,345 total accessible transactions.
- Fixed live category parsing for Monarch categories whose `systemCategory` is `null`.
- Fixed a race in `scripts/monarch-browser-login.ts` that could print the save message repeatedly when multiple GraphQL requests fired at login time.
- Ran a minimal read-only classifier pass with `--limit 1` and `--output /private/tmp/monarch-proposed-changes.json`; it fetched 3,848 transactions for the last year, classified 1 transaction, proposed 0 changes, and did not write to Monarch.
- Re-verified `bunx eslint .`, `bun run typecheck`, and `bun test` in `packages/monarch` after the live-login fixes.
- Created this session log at `packages/docs/logs/2026-05-16_monarch-classifier-package-check.md`.

### Remaining

- Rotate the Monarch password because it was pasted into the terminal/chat transcript before this session.
- Decide whether to add an `op run` or `.env`-loading flow for `ANTHROPIC_API_KEY`; the package currently reads the key from the process environment.
- If Monarch changes operation names or response schemas again, adjust the local GraphQL operation documents based on live responses.

### Caveats

- The first recall search failed inside the sandbox because the local SQLite index attempted to write stats to a read-only database; rerunning with approved local access succeeded.
- `--skip-enrich` is parsed and documented in architecture docs, but the current `src/index.ts` still always calls `runEnrichmentPipeline()`.
- The old password login script echoed the entered password in the observed terminal run; it has been disabled in favor of browser login.
- No package-local `.env` file exists under `packages/monarch`; `ANTHROPIC_API_KEY` was present in the current shell environment during verification.
- `bun run login` hit local `mise` trust enforcement inside the Codex sandbox, so live login verification used the installed Bun binary directly with a sanitized `PATH`.
- Initial `bun run typecheck` failed until `packages/eslint-config` dependencies were installed locally; after that, typecheck passed.
- Initial sandboxed `bun test` failed because existing Venmo parser tests write to `~/.monarch-cache`; rerunning with approved access passed.

## Session Log — 2026-05-23

### Done

- Implemented Tier 2 classification recovery checkpoints for Monarch previews.
- Added automatic checkpoint path derivation from `--output`, plus explicit `--checkpoint-file`.
- Added a Zod-validated Tier 2 checkpoint module that stores completed batch changes, prompt hash, transaction IDs, model, batch size, and usage.
- Changed Tier 2 classification to skip checkpointed batches, save successful batches as they complete, and preserve fulfilled sibling batches before rethrowing failures.
- Added recovered-call accounting to the API usage summary.
- Added checkpoint and Tier 2 resume tests for missing/malformed checkpoints, strict key invalidation, prompt-change re-spend, skip-on-resume, and partial concurrent failure recovery.
- Addressed PR review findings by reporting every failed Tier 2 batch in a concurrent chunk and ensuring the Monarch browser-login script always closes Chromium when session saving fails.
- Isolated Venmo parser tests to temporary cache files so package tests no longer write to the real `~/.monarch-cache`.
- Updated the Monarch README with `--checkpoint-file`, corrected the default model string, and documented automatic checkpoint behavior.
- Verified in `packages/monarch`:
  - `bun test src/lib/classifier`
  - `bun run typecheck`
  - `bunx eslint . --fix`
  - `bun test`
  - `bunx eslint . --fix` after the PR review fixes

### Remaining

- Run a small paid API preview with `--output` and confirm the checkpoint file is produced during real Tier 2 classification.
- Tier 3 is intentionally not checkpointed in this implementation.

### Caveats

- Checkpoint reuse is intentionally strict: prompt, transaction IDs/order, model, batch size, or web-search setting changes cause reclassification and therefore re-spend.
- The `mise` verification commands emitted a sandbox warning about tracking config symlink creation, but the commands completed successfully after trusting the worktree.

### Written Summary

This session completed Tier 2 checkpoint recovery for paid Monarch classification previews, including strict checkpoint keys, atomic checkpoint persistence, resume logging, usage accounting, and focused tests. Follow-up PR review fixes tightened concurrent checkpoint writes, request/session timeouts, CLI path normalization, and cache-write failure behavior. Remaining work is limited to a small paid API preview to validate checkpoint creation against live Tier 2 classification; Tier 3 checkpointing remains intentionally deferred.
