---
id: plan-2026-08-15-better-skill-capped-modernization
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Plan: Better Skill Capped — 2026 Modernization Rewrite

## Context

`packages/better-skill-capped` (a static Vite SPA rendering Skill Capped's LoL
video catalog from a daily-refreshed `/data/manifest.json`) was written ~2020:
class components, 9-prop drilling from a root `App` class, Bulma/Sass, axios +
hand-rolled localStorage caches, fuse.js with pre-search filter passes, unused
`react-redux`. Renovate kept deps current (React 19.2.8 exact, Vite 8, TS 7
native preview, Zod 4), leaving friction scars (two tracked
`no-type-assertions` suppressions for Sentry's class-typed ErrorBoundary).

Goals (user-confirmed): React 19 function components; TanStack Query +
**TanStack Router** (net-new to repo, sanctioned); Tailwind v4 + shadcn on
Base UI; **Orama** replacing fuse.js with significantly better search; drop
redux + axios; Zod at all boundaries; enrich UI with unused manifest data
(champions, staff, tags, badges, patch).

**Template**: `packages/docs-board` (Tailwind v4 via `@tailwindcss/vite`,
shadcn style `base-nova` on `@base-ui/react ^1.6.0`, `components.json` with
subpath-import aliases, strict house tsconfig, eslint
`recommended({projectService: true, react: true})`). Repo policy: vendor own
`src/components/ui/*`, no shared UI package.

**Live manifest facts** (fetched Aug 2026): 2,758 videos, 327 courses, 3,231
commentaries; 173 champions on commentaries; 21 staff with images/ranks; ~600
commentaries with rune/item IDs; 99 recommended courses; per-role tag
taxonomy; `thisWeekData` empty; `patch.patchUrl` stale (never link it).

**Verified bugs to fix**: `gameLengthInMinutes = parseInt("27m26s")` drops
seconds; parser returns `altTitle` against `CourseVideo.alternateTitle` (holes
through generic `.map` inference — alternate titles silently always
`undefined`); watch-status `lastUpdate` stored as string but typed `Date`;
corrupt watchStatus parse silently wipes history; cached-manifest strict
re-parse throws uncaught on schema drift; role title-case renders "Adc".

## Invariants (must survive)

- Deploy contract (`scripts/deploy-site.ts:147`): `bun run build` →
  `dist/index.html` (sync refuses without it) + hashed assets under
  `dist/assets/` (immutable prefix). Keep Vite `outDir` at default `dist`.
  Never write to bucket `data/` prefix (Temporal workflow owns it).
- `index.html` PostHog snippet — enforced by `scripts/check-analytics-sites.ts`.
- Default search behavior hides watched content (`watched=unwatched` default).
- React pinned exact `19.2.8` (`scripts/check-react-version-sync.ts`).
- Existing 16 manifest schema tests stay green; `src/parser/manifest.ts`
  (strict Zod schema) unchanged except a new `MANIFEST_SCHEMA_VERSION` export.
- CI wiring unchanged: Buildkite lane `site-better-skill-capped`,
  `scripts/ci-test-manifest.json` (bun runner auto-discovers new tests),
  turbo `outputs: ["dist/**"]`.

## Architecture

### Target structure (new/changed under `src/`)

```
main.tsx                    # Sentry.init → migrateStorage() → providers → RouterProvider
router.tsx                  # createRouter (code-based routes) + Register interface
routes/root.tsx             # layout, notFoundComponent, errorComponent (replaces Sentry.ErrorBoundary)
routes/search.tsx           # "/" — validateSearch (Zod), SearchPage
routes/course.tsx           # "/course/$courseUuid" detail route
components/layout/*         # header, footer, banner
components/search/*         # search-bar, filter-panel, pagination-controls, result-list
components/content/content-card.tsx   # ONE card switching on item.kind (kills 3 near-dupes, jscpd win)
components/content/{course-video-row,bookmark-button,watch-button,download-link}.tsx
components/ui/*             # vendored shadcn base-nova (button, input, badge, card, dialog, toggle-group, select, pagination, combobox/sheet as needed)
hooks/{use-manifest,use-content,use-bookmarks,use-watch-status,use-download-enabled}.ts
lib/{query-client,local-store,utils,sentry}.ts
model/{content,role}.ts     # discriminated union + Role string union
parser/{manifest,parser}.ts # schema kept; parser → pure parseManifest(), O(n) via Maps
parser/parser.test.ts       # NEW
storage/{keys,schemas,migrate}.ts + tests
search/{normalize,search-doc,index-builder,run-search,highlight,use-search}.ts + tests
features/commentaries/{matchup-line,coach-attribution,commentary-stats}.tsx
features/courses/course-badges.tsx
features/layout/patch-indicator.tsx
styles/globals.css          # @import "tailwindcss"; @import "shadcn/tailwind.css"; @theme inline
utils/{title-utilities,url-utilities}.ts  # keep; delete dead rawTitleToUrlTitle
```

Deleted: `index.tsx`, old `components/**`, `datastore/**`,
`manifest-loader.ts`, old `model/*` (video/course/commentary/type/…),
`bulma.sass`, all component `.css`/`.sass`, `styles.d.ts`, tips modal.

Config: `components.json` + expanded package.json `imports` (`#src/*`,
`#components/*`, `#hooks/*`, `#lib/*`, `#styles/*`); house strict tsconfig
copied verbatim from docs-board (keeps `allowImportingTsExtensions`, adds
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`,
`resolvePackageJsonImports`); vite `plugins: [react(), tailwindcss()]` + dev
proxy `"/data" → https://better-skill-capped.com` (dev currently has no
manifest source); eslint adds `projectService: true` +
`@tanstack/eslint-plugin-query`.

Deps add: `@tanstack/react-router`, `@tanstack/react-query` +
`react-query-persist-client` + `query-sync-storage-persister`,
`@base-ui/react`, `@orama/orama`, `tailwindcss` + `@tailwindcss/vite`,
`shadcn` (dev), `class-variance-authority`, `clsx`, `tailwind-merge`,
`lucide-react`. Remove: `react-redux`, `axios`, `react-router`, `fuse.js`,
`bulma`, `sass`, `@fortawesome/*` (4), `classnames`. Keep:
`react-highlight-words` (highlighting design uses it).

### Routing (code-based, not file-based codegen)

Codegen's `routeTree.gen.ts` ships a lint-suppression banner that collides
with `scripts/check-suppressions.ts` — code-based
`createRootRoute`/`createRoute` gives identical type safety for 3 routes.

- Root route: layout shell + `notFoundComponent` + `errorComponent` (captures
  to Sentry in `useEffect`, reset via router invalidate + query reset) —
  **eliminates both tracked type-assertion suppressions**.
- `/` search route: all state in typed search params, validated by Zod
  (Standard Schema passes directly to `validateSearch`), defaults stripped
  from URL via `stripSearchParams` middleware. Filter changes reset `page`;
  pagination pushes history (back walks pages).
- `/course/$courseUuid`: course detail from `useContent()` lookup; unknown
  uuid → notFound. (~50 lines; gives shareable course links.)
- "Bookmarks view" = header link to `/?bookmarked=bookmarked`, not a route.

**Search-param contract** (single source; search agent's facet set + tri-states):

| Param                        | Type                                                   | Default                             |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------- |
| `q`                          | string                                                 | `""`                                |
| `kind`                       | ("course"\|"video"\|"commentary")[]                    | all                                 |
| `role`                       | ("top"\|"jungle"\|"mid"\|"adc"\|"support"\|"all")[]    | none                                |
| `champion` / `staff` / `tag` | string[]                                               | none                                |
| `carry`                      | ("Light"\|"Medium"\|"Heavy")[]                         | none                                |
| `ctype`                      | ("Smurf"\|"High Elo"\|"Earpiece")[]                    | none                                |
| `watched`                    | "any"\|"watched"\|"unwatched"                          | **"unwatched"**                     |
| `bookmarked`                 | "any"\|"bookmarked"\|"unbookmarked"                    | "any"                               |
| `sort`                       | "relevance"\|"newest"\|"oldest"\|"shortest"\|"longest" | auto: relevance iff `q` else newest |
| `page`                       | number ≥1                                              | 1                                   |

### Data & state

- **Manifest**: TanStack Query. `queryKey: ["manifest", MANIFEST_SCHEMA_VERSION]`,
  `queryFn` = `fetch` + `ManifestSchema.parse`. `staleTime` 1 h, `gcTime` 24 h,
  `PersistQueryClientProvider` with localStorage persister
  (`bsc.query-cache.v1`), `buster: MANIFEST_SCHEMA_VERSION` — **schema drift
  cache-busts instead of crashing** (plus QueryCache onError purging persisted
  key on ZodError). `use-content.ts` = same query + module-level stable
  `select: parseManifest` (parser runs once per manifest identity) + memoized
  `Map<uuid, ContentItem>`.
- **User state** (bookmarks/watch/download): `useSyncExternalStore` over a
  generic `createLocalStore<T>(key, zodSchema, empty)` (`lib/local-store.ts`)
  with `storage`-event cross-tab sync. Read path never writes; per-element
  salvage on parse; corrupt reads return empty in memory only (never destroys
  stored data). Justification vs Query: synchronous, no loading states, free
  cross-tab sync.
- `use-download-enabled.ts` reads legacy `"download"` key (unchanged — hidden
  manual flag), kills the 7-level prop drill.
- **Dark mode: ONE mechanism** — pure CSS `prefers-color-scheme` (Tailwind v4
  default `dark:` variant; do NOT copy docs-board's `.dark` class
  `@custom-variant`). `color-scheme: light dark` on `:root`. Delete
  `setupTheme()`/`data-theme`.

### Storage v2 + migration (`storage/`)

Keys: `bsc.bookmarks.v2`, `bsc.watch-status.v2`. Strict schemas (no
`z.custom`/`catchall`/`z.unknown`):
`z.strictObject({uuid, kind, bookmarkedAt: z.iso.datetime()})` /
`{uuid, kind, watched: z.boolean(), updatedAt: z.iso.datetime()}`.

`migrateStorage()` (sync, in `main.tsx` before render):

1. Delete legacy `content`/`content-timestamp` (superseded caches).
2. Per store: skip if v2 exists; read legacy key; lenient legacy schema;
   infer `kind` by property sniffing one last time (matchLink→commentary,
   videos→course, else video); element-wise salvage (drop invalid elements,
   keep valid).
3. Delete legacy key **only after** v2 write succeeds. Outright-corrupt data →
   copy raw string to `bsc.*.legacy-backup`, write empty v2,
   `Sentry.captureMessage` — visible, recoverable, never silently wiped.
4. Tests: happy-path all kinds, corrupt→backup, partial→salvage, idempotence,
   v2-present no-op.

### Model refactor (`model/content.ts`, one file)

`kind`-discriminated union: `Video | Course | Commentary` (Commentary
flattened, no longer intersects Video), `Role` string union,
`ContentItem`, exhaustive `switch (item.kind)` narrowing with
`satisfies never` default. Delete Zod-probe guards + `type.tsx` + numeric
enum. `role.ts`: `parseRole` (throw on unknown, as today) +
`roleDisplayName` map (fixes "Adc"→"ADC").

Parser → pure `parseManifest(manifest): Content`: build
`videoUuidToCourseTitle` + `parsedVideoByUuid` Maps once (kills O(n²)
lookups); fix `parseGameTime("27m26s")` → total seconds, field renamed
`gameLengthInSeconds`; fix `alternateTitle` with `exactOptionalPropertyTypes`-
correct conditional spread; `chapters[0]` guards skip-with-breadcrumb instead
of throw. New `parser.test.ts`: dates, image URL rewrite, unmapped
partitioning, alternateTitle regression, gameTime cases, roles.

## Search (Orama)

### Index

**One unified index** (~6.3k docs; BM25 comparable across kinds; one `kind`
facet; builds in tens of ms). `SearchDoc`: id `${kind}:${uuid}`; searchable
`title`(boost 4), `champions`(3, display+normalized), `searchAux`(3,
normalized apostrophe-words from titles), `childTitles`(2, course child video
titles), `staffText`(2), `description`(1); enum facets `role`, `staff`,
`yourChampion`, `theirChampion`, `tags[]`, `carry`, `commentaryType`;
`recommended` bool; numbers `releaseDate`, `durationInSeconds`.

**Champion normalization** (no custom tokenizer): `normalizeName` = NFKD +
lowercase + strip `['’.\s&-]` (Kai'Sa→kaisa, K'Sante→ksante). Index both
forms; query passes through untouched (index contains both); alias map
(normalized→display, built from manifest) used for highlighting.
`tolerance: 1`, `threshold: 0` (AND); on 0 hits retry once `threshold: 1`.

**Browse mode** (empty q): always through Orama — no term, `sortBy
releaseDate DESC` — one code path, facet counts always present. With term:
BM25 order.

**Lifecycle**: index `useMemo`'d on stable Content identity (rebuilds only on
manifest refetch — never on filters/bookmarks/toggles). Watched/bookmarked +
tag OR-matching = **post-filter** on hits (localStorage state mutates too
often for index residency; ≤6.3k linear pass is trivial), then facet-count
correction (decrement per removed doc), then sort override, then paginate
(20/page). `runSearch(index, params, {watchedIds, bookmarkedIds})` is pure.

### UI

Sidebar (sheet on mobile): Kind toggle-group, Role icons, watched/bookmarked
segmented tri-states, collapsible sections with counts — Champion (combobox,
173 values), Coach (avatar + count), Tags (grouped by role prefix), Carry,
Type (commentary sections render only when kind includes commentary; Tags
only for courses). **Chips row** of active filters + "Clear all" replaces
fuse operator syntax; **tips modal deleted**. Search input → URL `q`
(`replace: true`) read through `useDeferredValue` (no debounce needed).
Sort select in results header.

### Highlighting

Keep `react-highlight-words`; skip `@orama/highlight` (v3 returns no
positions). `getHighlightTerms(query)` = tokens ≥2 chars + champion display
names whose normalized form matches a query token. Accepted limitation:
tolerance-corrected typos don't highlight.

## Enrichment (priority order)

Parser prereq: carry course `tags`/`recommended`/`marketingString`/
`seasonString` into `Course`; add `staffByName: Map<string, Staff>` + `patch`
to `Content` (schema already validates all of it).

1. Champion facet + "Kai'Sa vs K'Sante" matchup line on commentary cards;
   champion click → filter.
2. Coach facet + avatar attribution (guard `playerPeakRank: number|string`).
3. KDA / carry / type / duration chips on commentary cards; `gameTime` shown
   from parsed seconds; `matchLink` external link when non-empty.
4. Course tag chips + Recommended/Season/Beginner badges.
5. Patch indicator "Patch 26.16" + relative manifest timestamp (never link
   stale `patchUrl`).
6. Optional wave 2: "Recommended courses" rail (instead of fragile carousel
   join); Data Dragon champion square icons (name→id map from ddragon
   `champion.json` at runtime; irregulars: Kai'Sa→Kaisa, Wukong→MonkeyKing…).

7. Scout-for-LoL promo banner: **keep, and enrich it** — rebuild as a proper
   shadcn card in the results column (today a hard-coded Bulma notification);
   modest upgrade: link + one-line pitch + small screenshot/logo, styled to
   match the new UI. (User: "keep the banner, maybe even enrich it".)

**Not building**: thisWeekData (empty in prod), carousel hero, fuse operator
parity/tips modal, runes (18% coverage, deep join), item icons (marginal),
`groupingKey`/`override`/`overlay` UI, disjunctive facet counts (v1
conjunctive).

**Scope confirmations (user)**: course detail route `/course/$courseUuid` is
in scope; optional wave 2 (recommended rail + Data Dragon champion icons) is
**in scope** — PR 10 is not optional.

## Phasing — git-spice stack (each PR builds + app works)

Load `git-spice-helper` skill before branch work. Mirror this plan to
`packages/docs/plans/2026-08-15_better-skill-capped-modernization.md` at
implementation start (repo convention).

1. **`bsc/toolchain`** — house strict tsconfig + fix fallout in old code
   (type-only imports, bracket env access, index guards); vite tailwind plugin
   - inert `globals.css` + `components.json` + expanded `imports`; dev proxy
     for `/data`; add UI/query-lint deps; **remove react-redux**. No behavior
     change (globals.css not yet imported; Bulma untouched).
2. **`bsc/models`** — discriminated union + Role union + pure parser + both
   parser bug fixes + `parser.test.ts`; mechanical old-component updates.
3. **`bsc/data`** — TanStack Query + persister; `local-store.ts`; storage v2
   - migration + tests; five hooks; App class → thin function provider host;
     delete `datastore/**` + `manifest-loader.ts`; **remove axios**.
4. **`bsc/router`** — TanStack Router (code-based routes), typed search
   params (tri-states replace boolean pairs), root error/notFound components;
   container classes → function components (Bulma markup + fuse retained);
   **remove react-router**; delete both suppressions; **update
   `scripts/check-suppressions.ts` (remove the two better-skill-capped
   entries) — verified at lines ~46–47**.
5. **`bsc/ui`** — import globals.css; vendor shadcn ui/\*; rewrite
   presentational tree (single `content-card.tsx`); delete Bulma/Sass/
   FontAwesome/classnames + old CSS. PostHog snippet in index.html preserved
   (check-analytics-sites).
6. **`bsc/search-core`** — `src/search/*` pure functions + tests + richer
   fixture (`src/search/fixtures/search-manifest.json`, ~30 entries,
   schema-validated in test). Can develop in parallel with 4–5.
7. **`bsc/search-ui`** — swap engine behind search page (`use-search.ts`),
   chips row, kind/role facets, sort; **remove fuse.js**; delete tips modal.
8. **`bsc/facets`** — full sidebar (champion/coach/tag/carry/type) +
   highlighting.
9. **`bsc/enrichment`** — parser enrichment + features 1–5.
10. **`bsc/polish`** (optional) — wave 2 (recommended rail, ddragon icons);
    cleanup (dead `rawTitleToUrlTitle`, stale Sentry comments, README).

## Verification

Every PR: `bun install && bun run typecheck && bun run lint && bun test &&
bun run build`; confirm `dist/index.html` + `dist/assets/*` exist; run
`bun scripts/check-suppressions.ts` + `bun scripts/check-analytics-sites.ts`
from root; `bunx lefthook run pre-commit`. PR media rule: screenshots
(before/after) for UI PRs (5, 7, 8, 9, 10) via `toolkit pr asset`.

**Browser verification via PinchTab** (load `pinchtab-helper` skill first):
drive the dev server headed/headless to execute the manual checks —
capture before/after screenshots per scenario (light + dark, mobile
viewport), exercise URL round-trips (navigate to param-laden URLs, assert
rendered filters), toggle bookmarks/watch state and verify localStorage v2
shapes, and confirm the migration/corruption flows by seeding localStorage
before page load. Baseline "before" screenshots of the current Bulma UI
should be captured at PR 5 time from main.

Key manual checks: (3) seed legacy localStorage → v2 migrated, corrupt →
backup key + empty app; second load within 1 h → no manifest network request;
bump `MANIFEST_SCHEMA_VERSION` → cache-bust not crash; `download` flag shows
m3u8 links. (4) URL round-trips all filters; hard refresh reproduces state;
invalid params → defaults; garbage course uuid → 404; thrown render error →
Bugsink event. (5) light/dark via OS toggle; mobile viewport; jscpd <12%.
(6) search tests: "kaisa"/"ksante"/"kai sa" hit the right docs; "wave
control" ranks title > childTitles > description; typo "wave contrl"
non-empty; browse mode = all docs by recency; watched=unwatched default
excludes stubbed watched set with corrected facet counts; index built once
across filter changes (spy).

## Risks

- `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` churn (isolated
  to PRs 1–2); `verbatimModuleSyntax` type-import rewrites (lint autofix).
- TanStack Router net-new to repo — code-based routes avoid codegen's
  eslint-disable header colliding with check-suppressions.
- Migration is one-way (legacy keys deleted after successful v2 write);
  backup-key policy + PR description note mitigate.
- StrictMode + persister: use `PersistQueryClientProvider`, don't hand-roll.
- Search/UI PRs touch the same page — land 5 before 7 to avoid rebasing churn.

## Remaining

All implementation is complete and submitted as a git-spice stack; the
remaining work is human review and bottom-up merge.

- [x] PR 1 `bsc/toolchain` — strict tsconfig + Tailwind/shadcn scaffolding (#2188)
- [x] PR 2 `bsc/models` — discriminated union + pure parser + bug fixes (#2190)
- [x] PR 3 `bsc/data` — TanStack Query + storage v2 + hooks (#2193)
- [x] PR 4 `bsc/router` — TanStack Router + typed URL state (#2195)
- [x] PR 5 `bsc/ui` — Tailwind + shadcn presentational rewrite (#2197)
- [x] PR 6 `bsc/search-core` — Orama pure search functions + tests (#2199)
- [x] PR 7 `bsc/search-ui` — engine swap, chips, sort (#2201)
- [x] PR 8 `bsc/facets` — full facet sidebar with live counts (#2202)
- [x] PR 9 `bsc/enrichment` — enrichment + recommended rail + ddragon icons + cleanup (combined per user instruction)

## Human Verification

- [ ] Review and merge the stack bottom-up (#2188 → enrichment PR), running
      `git-spice repo sync --restack` between merges
- [ ] After the final deploy, spot-check https://better-skill-capped.com:
      commentaries visible again, search typo tolerance, facet counts, course
      pages, bookmarks/watch state migrated
