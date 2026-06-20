# Report Query Studio (scout-for-lol web UI)

## Status

In Progress

> Mirror of the approved harness plan (`~/.claude/plans/ok-i-want-to-refactored-flame.md`). See that file for the full rationale; this is the repo-tracked copy.

## Context

The scout-for-lol web app (`packages/scout-for-lol/packages/app`, a Vite + React Router SPA) has a "Reports" feature where users write a bespoke SQL-like query in a plain `<Textarea>`, pick an output format, and see a debounced live preview. Four asks:

1. **Monaco editor** for the bespoke SQL with best-in-class language features (semantic highlighting, autocomplete, hover, live typecheck).
2. **In-app documentation** of the syntax (tables, columns, operators).
3. **Fix the live preview** — duplicate `LABEL` header + a trailing blank column.
4. **Format-aware preview** — render the chart/list/leaderboard the report will actually produce.

The query syntax is expected to grow (joins, expressions, functions), so the language foundation is built to extend.

## Foundation decisions

- **Real lexer → parser → typed AST (spans) + error recovery** as a pure, editor-agnostic core in `@scout-for-lol/data` — the single backbone for execution, diagnostics, completion, hover.
- **Chevrotain lexer + hand-written recursive-descent parser** (not `CstParser` — the repo hit ambiguity issues with it in `cooklang-for-obsidian/src/cook-parser.ts` and fell back to lexer+hand-written, which is also lint-clean and more extensible).
- **Monaco native providers** (not an LSP server) — the quality ceiling for a single editor; the pure core keeps a future LSP server a thin wrapper away.
- **Preview = server-side exact**: reuse the real renderer — text → markdown string in `<pre>`, charts → SVG via `<img>` data URI.
- **Docs = both**: inline collapsible panel + dedicated `/g/:guildId/reports/help` route, registry-driven.
- **One PR/worktree** (`feature/report-query-studio`).

## Root cause of the preview bug (#3)

`report-query-preview.tsx` renders a hardcoded `<TableHead>Label</TableHead>` **and** maps over `result.columns`, which already includes `"label"` as `columns[0]` (`query-aggregates.ts` → `["label", ...metrics]`). Headers = N+1, body cells = N → duplicate `LABEL` + off-by-one blank column.

## De-risking findings

- **Prod CSP blocks Monaco**: app served from S3 via Caddy with `script-src 'self'` + `connect-src 'self'`, no `worker-src` (`homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`). CDN loader blocked → bundle Monaco locally (`loader.config({ monaco })`); add CSP delta `worker-src 'self' blob:` (+ `blob:` in `script-src` only if required). Validated empirically when Monaco is built (Phase 5/6).
- **Chart preview is CSP-safe**: `img-src ... data: blob:` already allows the SVG `<img>` data URI.
- **Placeholder `ranked_solo` is wrong**: real value is `solo` (Prisma `queue: { in: [...] }` vs `QueueTypeSchema`). Validate queue values in the linter; fix the example.
- **tRPC type-only import**: app imports `AppRouter` as `type`, so adding `outputFormat`/`output` is compile-time-checked.

## Phases

- **Phase 0 — de-risk** (done via investigation): CSP delta pinned, CstParser avoided, queue bug found, parser-equivalence differential folded into Phase 4.
- **Phase 1 — enums + registry → data** (low risk): `report-query-spec.ts` (enums) + `report-query-registry.ts` (metadata + friendly names). Backend imports enums from data.
- **Phase 2 — backend** (low risk): `output.ts` extracts `buildReportChartProps` + adds `renderReportPreview` ({text|chart}); `previewQuery` takes `outputFormat`, returns `{columns, rows, rowsScanned, output}`. Registry friendly names in `formatTable`.
- **Phase 3 — app preview + docs** (med, high value): server-exact preview (text `<pre>` / chart `<img>`), fixed collapsible raw table, registry-driven docs panel + `/reports/help`, fix `EXAMPLE_QUERY`. After this, #2/#3/#4 done.
- **Phase 4 — rigorous parser core → data** (higher, isolated): lexer/parser/compile/lint/complete; differential test vs old parser; swap executor; delete backend `query-language.ts` after green.
- **Phase 5 — Monaco + CSP** (highest infra, last): `scoutql-language.ts` (semantic tokens, completion, hover, diagnostics), `report-query-editor.tsx`, replace `Textarea`; CSP change in homelab.
- **Phase 6 — verify e2e + PR**.

## Verification

`bun run typecheck`, `bun run lint`, `bun test` (differential + parser), then `bun run --filter='./packages/scout-for-lol' dev:web` for manual checks (highlighting, autocomplete, hover, multi-error squiggles incl. invalid queue, format-aware preview, raw table correctness, `/reports/help`, XSS check on a `</text><script>` alias). PR with screenshots per the PR-media convention.
