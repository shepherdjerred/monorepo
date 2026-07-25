---
id: plan-2026-07-12-scout-reporting-editor-improvements
type: plan
status: complete
board: true
verification: agent
disposition: active
---

# Scout Reporting Editor Improvements

## Summary

Unify and improve Scout's reporting workflow: correct preview tables, add readable formatting, expose complete AI quotas and inline previews, make ScoutQL more human-readable, add a data explorer, consolidate presets, support safe cron schedules, and move lookback and result limits into SQL.

## Implementation Changes

### Preview Rendering and Formatting

- Use one column schema for headers and row cells so renderers never inject a duplicate `label` column.
- Update Most Played Games to display `Player`, `Games`, and `Win rate` with aligned values.
- Centralize semantic display rules. Render rate fields such as `win_rate` as one-decimal percentages, counts as localized integers, and other decimals compactly. Preserve raw numeric values for sorting and execution.

### AI Editor

- Return every enforced quota window as structured data with remaining credits and `resetsAt`.
- Show explicit text such as `29 of 30 remaining` for each active window.
- Reuse Scout's existing owner/admin capability to bypass quota checks and credit consumption server-side. Exempt accounts display `Unlimited (admin)`; no personal user ID is hard-coded.
- Render the validated AI draft inside the AI editor using the normal report renderer.
- Include loading, empty, error, row-count, and scanned-fact states. Enable `Apply draft` only after successful validation and preview.

### ScoutQL

- Add `champion('Lux')` as an expression that compiles to the numeric champion ID.
- Require a string literal and validate it against Scout's canonical champion catalog during semantic validation, with location-aware errors and close-name suggestions.
- Keep numeric IDs compatible, but update AI instructions, examples, and presets to use champion names.
- Replace lookback and max-row controls with `WHERE <timestamp> >= CURRENT_TIMESTAMP - INTERVAL '...'` and outer `LIMIT`.
- Retain a fixed server safety cap on rendered result rows.

### Data Explorer and Presets

- Add a report-editor Data Explorer backed strictly by the ScoutQL table and column allowlist.
- Support typed filters, single-column sorting, cursor pagination, bounded page sizes, column metadata, and identifier copy/insert actions.
- Validate the allowlist and all browse parameters again on the server.
- Replace the separate examples and presets sections with one `Presets` collection and one source of truth for name, description, query, and rendering mode.

### Scheduling

- Provide daily, weekly, and monthly presets plus an advanced five-field cron input, timezone selector, and upcoming-run preview.
- Accept arbitrary calendar cadence but require exactly one minute and hour per eligible local date.
- Enforce one execution per report and local date server-side.
- Allow the spring DST occurrence even when only 23 elapsed hours have passed.

### Migration

- Rewrite existing reports at ScoutQL clause boundaries, combining lookback with an existing `WHERE` via `AND` and retaining the stricter existing or configured `LIMIT`.
- Use schema metadata to select the report's time column and fail loudly on unconvertible reports.
- Remove the legacy lookback and max-row fields from persistence, APIs, and UI after migration.
- Preserve current defaults by inserting equivalent SQL into migrated and newly created reports.

## Interfaces

- Extend report columns with a stable key, display label, scalar type, and semantic format so every preview uses the same header and value contract.
- Represent AI quota status as `{ exempt, windows[] }`, where each window carries its name, limit, remaining credits, and reset timestamp.
- Add typed schema-browse and row-browse operations using table, selected columns, filters, sort, cursor, and bounded page size.
- Persist schedules as validated `cron + timezone`; add execution idempotency based on report ID and scheduled local date.

## Test Plan

- Verify Most Played Games has exactly three aligned columns and formats `0.54296875` as `54.3%`.
- Cover duplicate-label prevention, nulls, large counts, percentages, decimals, empty results, and all renderer variants.
- Test admin AI bypass, ordinary quota consumption, every quota window and reset, and boundary exhaustion.
- Test inline AI preview success, stale-request cancellation, validation failure, preview failure, and apply gating.
- Test valid and invalid champion names, punctuation-heavy champion names, suggestions, and numeric-ID compatibility.
- Test explorer allowlisting, typed filters, sorting, cursor pagination, page caps, and attempts to request hidden identifiers.
- Test builder and cron equivalence, multiple-runs-per-day rejection, timezone behavior, spring DST allowance, and execution idempotency.
- Test AST migration with existing `WHERE` and `LIMIT`, joins, aliases, and invalid legacy reports.
- Run Scout's scoped typecheck, tests, and ESLint.
- Capture PR screenshots for the fixed table, AI quota and preview, data explorer, unified presets, and schedule editor.

## Assumptions

- Scout's existing owner/admin or `MY_SERVER` capability is the sole exemption authority.
- Max rows means rendered result rows and maps to outer `LIMIT`, not scanned fact rows.
- Existing report defaults are preserved by inserting equivalent SQL during migration.
- Implementation starts in an isolated Scout worktree and runs `bun run scripts/setup.ts --group=scout` before verification.

## Session Log - 2026-07-12

### Done

- Created and initialized the `feature/scout-reporting-editor` worktree with the scoped Scout setup.
- Added one shared result-column contract across web previews, AI previews, Discord text output, and chart metadata. Fixed duplicate headers and formatted rates as one-decimal percentages.
- Added `champion('Display Name')`, SQL lookback predicates, query-owned `LIMIT`, updated presets/system reports/AI guidance, and a guarded migration that drops the legacy fields.
- Added the operator AI quota exemption, complete quota-window/reset display, and a validated inline AI draft preview.
- Added the allowlisted, guild-scoped raw data explorer with filters, sorting, bounded pagination, and identifier copy/insert actions.
- Unified presets/examples and added custom daily-or-less-frequent cron schedules with IANA timezones, upcoming runs, DST coverage, and local-date idempotency.
- Regenerated Prisma and `src/testing/template.db` through the complete migration chain.
- Verified `data`, `backend`, and `app` typechecks and changed-file ESLint gates.
- Verified 447 data tests, 1,132 backend tests with 0 failures, 12 app tests, focused migration/explorer/render tests, and the production Vite build.
- Pinned all ten AI quota windows and reset intervals in a backend contract test.
- Fixed scheduler idempotency to use the scheduled occurrence date, preventing a delayed run across local midnight from consuming the following day's slot.
- Started the local Vite app at `http://127.0.0.1:5180/app/` without connecting the beta Discord bot.
- Rebased onto current `origin/main`, resolved the system-report conflicts against the retired Common Denominator bootstrap, and reverified the full Scout workspace.
- Published implementation commit `9d250f7c9` and opened draft PR [#1513](https://github.com/shepherdjerred/monorepo/pull/1513).
- Verified the report editor in PinchTab against a deterministic local backend, including the corrected preset preview, all quota windows, operator exemption, AI draft preview, data explorer, and schedule controls.
- Uploaded five after screenshots to `public.sjer.red`, verified each asset returned HTTP 200, and attached them to PR #1513 alongside the supplied before screenshot.

### Remaining

- None.

### Caveats

- Screenshots use a deterministic local mock backend so no live Discord bot or OpenAI request was needed.
- The app workspace has no `test` package script; its discovered test was run directly with `bun test`.
