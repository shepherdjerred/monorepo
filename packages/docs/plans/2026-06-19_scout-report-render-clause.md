# Scout reports — declarative display layer (`RENDER` clause) + drop `outputFormat`

## Status

Complete (implemented on `feature/scout-render-clause`; pending PR + acceptance).

## Context

Scout's report DSL (`SELECT … FROM … WHERE … GROUP BY … ORDER BY … LIMIT …`) paired
each query with a separate stored `outputFormat` enum on two columns
(`Report.outputFormat`, `ReportRun.outputFormat`). Charts were dumb: `output.ts` always
plotted `label` on X and `metrics[0]` on Y regardless of intent — no way to declare which
metric to chart or to title/label it, and display lived in a column divorced from the query.

This change makes the **display** half of the DSL declarative and the **single source of
truth**: a trailing `RENDER` clause — modeled on **Kusto/KQL's `render` operator** (surface
syntax) and **Vega-Lite's grammar-of-graphics** (channel model). The `outputFormat` columns
were removed and existing report rows migrated so their `queryText` carries the clause. The
query (SELECT/WHERE/GROUP BY) half is being hardened by a separate effort and was left alone.

## Grammar

Append an **optional** clause after `LIMIT`:

```
RENDER <kind> [WITH ( <channel|option> = <value> [, …] )]
   <kind>    : bar_chart | line_chart | table | list | leaderboard
   channels  : x = <dimension col>   (optional, default `label`)
               y = <metric col>      (optional, default = first SELECTed metric)
   options   : title  = "<text>"     (optional, default = report title)
               y_axis = "<text>"     (optional, default = the y column name)
```

- Channel/option values reference columns the query **produces**: `label` (the GROUP BY
  dimension) and any SELECTed metric. Quoted strings allowed for text options.
- `x`/`y` optional-with-defaults → a bare `RENDER bar_chart` reproduces the prior behavior
  exactly (`x=label, y=metrics[0]`). Text kinds take no `WITH`.
- `parseReportQuery` always returns a fully-resolved `render` spec; no clause → `{ kind: TABLE }`.

Examples:

```
… GROUP BY player ORDER BY win_rate DESC LIMIT 10
RENDER bar_chart WITH (y = win_rate, title = "Win %")

… GROUP BY player RENDER leaderboard
```

## What shipped

- **Data model** (`packages/data/src/model/report.ts`): `ReportRenderChannelSchema`,
  `ReportChartOptionsSchema` (both `.strict()`), `ReportRenderSpecSchema` (discriminated
  union on `kind`), `DEFAULT_RENDER_SPEC`. Dropped `outputFormat` from `Report`/`ReportRun`
  types and `ReportCreateInputSchema`. Kept `ReportOutputFormatSchema` as the render `kind`.
- **Parser** (`backend/src/reports/query-language.ts`): `render` added to
  `ReportQueryPlanSchema`; `parseQueryGroups` splits the `render` tail before slicing
  (guards quoted keywords like `title = "no limit"`); `parseRenderClause`/`parseRenderWith`/
  `assertRenderColumn` validate channels against the SELECTed metrics — typos fail fast.
- **Render** (`backend/src/reports/output.ts`): drives off `result.plan.render`; resolves
  the Y metric/title/axis from the encoding (Y re-parsed to `ReportMetric`). `competition-chart.ts` untouched.
- **Migration** (`backend/prisma/migrations/20260619000000_reports_render_clause/`): backfills
  each `Report.queryText` with `RENDER <kind>` from its old `outputFormat` (inside the table
  rebuild's INSERT…SELECT — atomic, no DSL parsing in SQL), then drops both columns.
- **Runner/metrics**: `output_format` metric label now derived from `plan.render.kind`.
- **System reports** (`system-reports.ts`): emit `RENDER <kind>` in generated queries.
- **Router** (`report.router.ts`): create/update drop `outputFormat` I/O; `previewQuery`
  returns `renderKind` + a base64 chart PNG (WYSIWYG) via the real render pipeline.
- **Discord** (`commands/report/*`): removed the `output-format` option; query carries display.
- **Web form** (`app/.../report-form.tsx` + `report-query-preview.tsx`): removed the
  format dropdown; added a Display builder (kind + Y-metric from the live preview's columns)
  that upserts the `RENDER` clause into the query; preview renders the actual chart image.

## Verification (done)

- `bun run typecheck` clean across all scout packages.
- `bun test`: parser (12), data render-spec (16), backend reports + discord report (31),
  brand-prisma-types (4) — all green. Integration tests run against the migrated template DB
  (`system-reports.integration` asserts competition reports get `RENDER bar_chart`).
- `eslint --fix` clean on all changed files.
- Migration backfill SQL verified on sample rows (chart→`RENDER bar_chart`, leaderboard→
  `RENDER leaderboard`, rows with an existing clause untouched).

## Notes / caveats

- **`ReportRun.outputFormat` removal loses point-in-time audit** of the format a past run
  used (the run row doesn't store its own `queryText`). Per the explicit "remove columns"
  instruction; flag at review if undesired.
- Multi-series (`y = [a, b]` → grouped bars), a `series`/`color` channel, and `sort` are
  future work; the grammar accepts them later without breaking v1 queries.
- The web Display builder reads the clause via lightweight client-side regex (the real parser
  is backend-only); the textarea stays the source of truth and remains hand-editable.

## Session Log — 2026-06-19

### Done

- Implemented the full `RENDER` clause feature end-to-end (data model, parser, renderer,
  migration, runner/metrics, system reports, tRPC router + chart preview, Discord commands,
  web form Display builder) on `feature/scout-render-clause` (worktree
  `.claude/worktrees/scout-render-clause`). ~23 source files + 1 migration + regenerated
  `template.db`.
- Added tests: parser RENDER cases (`query-language.test.ts`), render-spec schema
  (`data/.../report.test.ts`); updated brand-prisma + integration fixtures.
- Verified: typecheck clean, all touched test suites green, lint clean, migration backfill
  proven on sample rows.

### Remaining

- Open the PR; attach before/after screenshots of the form's live chart preview (run
  `bun run --filter='./packages/scout-for-lol' dev:web`).
- Acceptance: apply the migration against a prod DB copy and confirm existing reports render
  identically before/after; confirm a scheduled run posts the same chart.

### Caveats

- `bun install --force` at the **outer** monorepo root disrupted the nested scout-for-lol
  `file:` workspace links; recover by running `bun install` inside `packages/scout-for-lol`
  (which re-copies the `file:`-linked `@scout-for-lol/data` into its `.bun` cache so source
  edits propagate to typecheck). Prefer the inner install over `--force` at root.
- `unicorn/prefer-array-index-of` auto-rewrites `findIndex(x => x === y)` → `indexOf(y)`; the
  Y-metric lookup in `output.ts` narrows the column to `ReportMetric` so `indexOf` typechecks.
