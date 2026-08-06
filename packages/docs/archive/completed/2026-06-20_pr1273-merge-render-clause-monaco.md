---
id: reference-completed-2026-06-20-pr1273-merge-render-clause-monaco
type: reference
status: complete
board: false
---

# PR #1273 main-merge: RENDER clause ↔ Monaco query studio

## Context

PR #1273 (`feature/report-query-studio`) adds a Monaco-based report query studio to
scout-for-lol: a Chevrotain parser moved into `@scout-for-lol/data`, an in-browser editor with
autocomplete/hover, query docs, a help route, and a live preview. It branched at `be38f229f`.

Since then two scout PRs landed on main and both rewrote the same code:

- **#1277** "declarative RENDER clause" — replaced the standalone `outputFormat` column with a
  `RENDER <kind> [WITH (...)]` clause in the query language. It **dropped the `outputFormat` DB
  column** (migration `20260619000000_reports_render_clause`), added render-spec schemas to
  `data/model/report.ts`, and refactored every report code path.
- **#1271** scout web-app UX (names, pagination, inline management, OP.GG search).

`git merge origin/main` surfaced 8 conflicts, but the real scope was larger: because main dropped
`outputFormat` and `schema.prisma` was not in the conflict set, git silently took main's
dropped-column schema, leaving PR code that referenced `outputFormat`/the deleted parser broken.

**This was a feature integration, not a mechanical conflict resolution.** Direction (forced by the
dropped column): adopt main's RENDER-clause data model and re-home the PR's query studio on top.

### Owner decisions

1. **Preview = #1277's PNG path** (`renderReportOutput`, byte-exact to the Discord post), with the
   format driven by the RENDER clause parsed by the PR's new Chevrotain parser. Dropped the PR's SVG
   `renderReportPreview`.
2. **Monaco-only display.** Dropped main's form Display/Y-axis dropdowns; the format is typed into
   the RENDER clause (editor autocomplete/docs assist). Dropped the `outputFormat` field +
   `onColumns`/`metricOptions` plumbing.
3. **Dropped the format badge** from report list/detail/run-history (matched main).

## What landed

### `@scout-for-lol/data` — RENDER ported onto the Chevrotain parser

- `report-query-lexer.ts` — added `Render` + `With` keyword tokens.
- `report-query-parser.ts` — `locateClauses()` helper finds the `RENDER` token after GROUP BY;
  the clause tail is captured raw (case-preserved, whitespace-collapsed) into `ast.render`; the
  GROUP BY / ORDER BY / LIMIT section bounds stop at the render token.
- `report-query-spec.ts` — `render: ReportRenderSpecSchema.default(DEFAULT_RENDER_SPEC)` on the
  plan; `render?` on the AST (imports render schemas from `./report.ts`).
- `report-query-compile.ts` — ported main's `parseRenderClause` / `parseRenderWith` /
  `assertRenderColumn` (+ regex constants) verbatim; the compiler runs them on the captured tail.
- `report-query-lint.ts` — render diagnostics (validates the clause without throwing).
- `report-query-complete.ts` + `report-query-registry.ts` — RENDER/WITH keywords, render-kind
  completions, render-aware examples.
- `report-query.test.ts` — ported the 8 RENDER cases + a lint case (23 tests pass).

### Backend — took main's RENDER refactor, redirected the deleted parser

- `reports/output.ts`, `trpc/router/report.router.ts`, `reports/runner.ts`,
  `discord/commands/report/view.ts` — taken from main; `parseReportQuery` (from the deleted
  `query-language.ts`) redirected to `parseAndCompile` from `@scout-for-lol/data`.
- `query-language.ts` + `query-language.test.ts` deleted (logic re-homed in the data package).
- `create.ts`/`update.ts`/`system-reports.ts` auto-merged correctly to main's RENDER behavior.

### App — Monaco-only studio on the RENDER model

- `report-form-fields.tsx` — PR's Monaco editor + docs + "Full reference" link; no `outputFormat`
  field, no Display/Y-axis builder.
- `report-query-preview.tsx` — main's PNG preview (`imageBase64` + table); no `outputFormat`/
  `onColumns`.
- `report-form.tsx` — passes `queryHelpHref`; dropped `outputFormat`/`metricOptions`/`onColumns`.
- `app.tsx` — kept `ReportHelp` route, dropped the (main-removed) `AdminTools` import.
- `lib/render-clause.ts` + test deleted (Monaco-only made them dead).
- report-detail/list/run-history/onboarding-examples = main's version automatically (PR untouched).

## Verification (all green)

- `bun run typecheck` — all 7 scout packages clean.
- data: `bun test` 368 pass; `report-query.test.ts` 23 pass; eslint clean.
- backend: `report-render.integration.test.ts` **10 pass** (parse → execute → PNG → runner gate),
  reports suite 22 pass; eslint clean on changed files.
- app: eslint clean; `bun run build` succeeds (Monaco lazy chunk split out of the main bundle).
- `bun install --frozen-lockfile` consistent.
