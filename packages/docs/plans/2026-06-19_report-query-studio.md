# Report Query Studio (scout-for-lol web UI)

## Status

Partially Complete (all code shipped in PR #1273; manual e2e + screenshots pending)

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

## Session Log — 2026-06-19

### Done

- **Phase 1** (`7b41da762`): moved report-query enums to `@scout-for-lol/data` (`report-query-spec.ts`) + added `report-query-registry.ts` (friendly names, queue values, examples); backend imports enums from data.
- **Phase 2** (`ecd718043`): `output.ts` extracts `buildReportChartProps`; adds `renderReportPreview` ({text|chart}); `previewQuery` takes `outputFormat`, returns server-exact `output`; friendly column headers in `formatTable`.
- **Phase 3** (`09976bbf1`): format-aware preview (text `<pre>` / chart `<img>` data URI), fixed the duplicate-`LABEL`/blank-column table (now `columnLabels`-driven + collapsible), `report-query-docs.tsx`, `/reports/help` route, fixed `ranked_solo`→`solo` example.
- **Phase 4** (`62db9d5fa`): Chevrotain lexer + hand-written parser + AST/spans + `compileReportQuery`/`parseAndCompile` + `lintReportQuery` + `completeReportQuery` in data; swapped executor + Discord/web validators to `parseAndCompile`; deleted legacy `query-language.ts` after a 33-query differential test proved byte-identical plans.
- **Phase 5** (`4810761b6` + `ad10bc349`): lazy-loaded Monaco editor with Monarch highlighting + parser-driven completion/hover/diagnostics; Monaco bundled locally via `editor.api` + base worker; `worker-src 'self' blob:` added to scout CSP (homelab).
- Plan mirrored (`c100ae9a2`). PR: #1273. Verified: `bun run typecheck` (7 packages clean), `bun run test` (green), `vite build` (Monaco in a lazy chunk, same-origin worker, no CDN/blob).

### Post-inspection fixes (2026-06-19, verified in a real browser)

Two editor bugs found by driving the live editor in headless Chromium (a throwaway
unauthenticated `/_dev/query-studio` harness mounting `ReportQueryEditor` + docs,
since the real form is auth-gated) and fixed:

- `fix(scout-for-lol)` `c18f50e46` — Monaco imported via bare `editor.api` (core +
  tokenization only) → highlighting worked but autocomplete/hover/`triggerSuggest`
  were missing. Switched to importing `edcore.main` for its contributions side
  effects + typed namespace from `editor.api`.
- `fix(scout-for-lol)` `541fcf213` — suggest/hover popups clipped by the small
  `overflow-hidden` editor container → enabled `fixedOverflowWidgets`.

Verified end-to-end in Chromium, **including under the exact production CSP**
(served the built `dist` behind `default-src/script-src/connect-src 'self'` +
`worker-src 'self' blob:`): worker loads, autocomplete (13 items), positioned
error+warning diagnostics, hover docs, all 6 sources after FROM, queue values
inside `queue in (` — **zero CSP violations**. Bundle confirmed: main `index.js`
1.48 MB (no Monaco), Monaco isolated in the lazy `report-query-editor` chunk
(~830 KB gzip). Screenshots posted to PR #1273. CI hard gates green
(lint/typecheck/test/build); Greptile review pending.

### Remaining

- **Live-preview visual e2e** (the one unverified UX): the actual `/reports/new`
  form's server-exact preview (chart SVG / markdown by output format) — covered by
  backend tests + typed tRPC, but not yet _seen_ in the running app (needs
  `dev:web` → `op signin`, disconnects beta bot).
- Greptile automated review (auto-completes; may post comments to address).
- Human review + merge PR #1273; then `git mv` this plan to
  `packages/docs/archive/completed/`.

### Caveats

- **`file:` dep copies**: editing `@scout-for-lol/data` requires `bun install` at `packages/scout-for-lol/` to propagate into the backend/app `node_modules` copies (bun materializes `file:` deps, not symlinks) — otherwise typecheck/tests see stale exports.
- **lefthook prettier**: a failing prettier step is colored green but still aborts the commit; prettier all touched files before committing.
- **CSP delta is defensive**: same-origin Monaco worker is already allowed by `default-src 'self'`; `worker-src 'self' blob:` is explicit + covers blob-wrapped worker paths. Verify on beta before prod (shared CSP).
- Queue-value linting is a **warning** (executor accepts any string but unknown queues match nothing); parser stays permissive for executor equivalence.
