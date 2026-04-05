#set page(margin: (x: 2cm, y: 2cm), numbering: "1")
#set text(font: "New Computer Modern", size: 10.5pt)
#set par(justify: true, leading: 0.6em)
#set heading(numbering: "1.1")
#show link: it => text(fill: rgb("#2563eb"), it)
#show heading.where(level: 1): set text(size: 16pt)
#show heading.where(level: 2): set text(size: 13pt)
#show heading.where(level: 3): set text(size: 11pt)

#import "@preview/gentle-clues:1.3.1": *

#align(center)[
  #text(size: 20pt, weight: "bold")[Harden Trivy, Semgrep \& Knip in CI]
  #v(0.3em)
  #text(size: 11pt, fill: gray)[2026-04-05 --- Fix the code, don't suppress findings]
]

#v(1em)

= Context

All three quality tools are `softFail: true` in Buildkite CI --- they run but don't block merges. Goal: fix all findings and make them hard failures.

#memo(title: "Philosophy")[Only `archive/` and `practice/` may be excluded. Everything in `packages/` must be fixed, not suppressed.]

#info(title: "Ordering")[
  + Install trivy \& semgrep locally (`brew install trivy`, `pip install semgrep`)
  + Fix all findings for each tool
  + Verify each tool passes locally
  + Only after all three pass locally, remove `softFail: true` from CI
]

#table(
  columns: (auto, 1fr, auto, auto),
  table.header([*Tool*], [*Purpose*], [*Findings*], [*Effort*]),
  [Trivy], [CVE scanning (HIGH/CRITICAL)], [23 suppressions to audit], [Medium],
  [Semgrep], [Static analysis \& security], [Unknown (CI-only)], [Low],
  [Knip], [Unused code, deps, exports], [224 lines], [High],
)

= Phase 1: Trivy --- Audit \& Remove Suppressions

== Castle-casters CVEs (4)

The `.trivyignore` comment says "log4j 1.x EOL" but castle-casters actually uses *log4j 2.25.4* with a `log4j-1.2-api` compatibility bridge. These CVEs target log4j 1.x --- likely *false positives* against the 2.x compat module.

*Action:* Remove suppressions. If trivy still flags them, investigate whether `log4j-1.2-api` can be dropped or upgraded.

== Practice dir CVEs (19)

All in `practice/` which is legitimately non-production.

*Action:* Add `--skip-dirs practice` to the trivy command in `.buildkite/scripts/trivy-scan.sh`. Delete all 19 CVE lines. New practice CVEs won't need manual suppression.

== CI change

Remove `softFail: true` from `trivyScanStep()` at `quality.ts:134`.

= Phase 2: Semgrep --- Minimal Exclusions Only

Create `.semgrepignore` with *only* genuinely non-production dirs:

#block(fill: luma(245), inset: 8pt, radius: 4pt, width: 100%)[
  ```
  archive/
  practice/
  poc/
  node_modules/
  ```
]

Remove `softFail: true` from `semgrepScanStep()` at `quality.ts:158`. Push, see what semgrep finds, fix actual findings.

= Phase 3: Knip --- Proper Setup

== 3.1 Fix knip config --- stop ignoring config files

Root cause of many false positives: `knip.json` ignores `**/postcss.config.ts` and `**/eslint.config.ts`, preventing knip from seeing deps used in those files.

*Action:* Remove both from the `ignore` list. Also remove `vite: false, postcss: false` from the desktop workspace. Re-run knip after this change --- many "unused" PostCSS/Tailwind/ESLint deps should auto-resolve.

== 3.2 Fix unresolved imports (22)

#table(
  columns: (auto, auto, 1fr),
  table.header([*Package*], [*Count*], [*Fix*]),
  [astro-opengraph-images], [10], [`.ts` \u{2192} `.tsx` in `presets/index.ts`],
  [better-skill-capped], [3], [Dead component imports --- delete dead code],
  [discord-plays-pokemon], [5], [`\~icons/ph/\*` virtual imports --- knip plugin gap],
  [homelab + scout-for-lol], [4], [`bun-types` tsconfig refs --- legitimate ignore],
)

== 3.3 Delete 8 unused files

#block(fill: luma(245), inset: 8pt, radius: 4pt, width: 100%)[
  #set text(size: 9pt)
  #table(
    columns: (1fr,),
    stroke: none,
    [`.buildkite/scripts/update-versions.ts`],
    [`packages/astro-opengraph-images/src/presets/render-examples.ts`],
    [`packages/better-skill-capped/src/datastore/content-datastore.ts`],
    [`packages/clauderon/web/frontend/src/lib/uuid.ts`],
    [`packages/discord-plays-pokemon/packages/frontend/src/stories/loading-button.tsx`],
    [`packages/discord-plays-pokemon/packages/frontend/src/stories/loading-spinner.tsx`],
    [`packages/discord-plays-pokemon/packages/frontend/src/util.ts`],
    [`packages/monarch/src/lib/costco/receipt-parser.ts`],
  )
]

== 3.4 Remove 110 unused dependencies

*All genuinely unused --- remove from `package.json`:*

#table(
  columns: (auto, 1fr),
  table.header([*Category*], [*Packages to Remove*]),
  [jiti], [Not used anywhere. Remove from 6 packages.],
  [\@astrojs/tailwind], [Replaced by `\@tailwindcss/postcss` in scout-for-lol frontend],
  [Old eslint deps], [14+ packages --- leftovers from shared eslint-config migration],
  [better-skill-capped], [`\@fortawesome/fontawesome-free`, `bulma`, `react-redux`],
  [birmel], [`youtubei.js`],
  [clauderon], [`\@radix-ui/react-dropdown-menu`, `shiki`],
  [discord-plays-pokemon], [`lodash`, `ts-pattern`, `keyboardjs`, icon/tailwind deps],
  [homelab], [`openai`, `simple-git`, `remeda`],
  [scout-for-lol], [`prism-media`, `sodium-native`, desktop build deps],
  [sjer.red], [`sass`, old eslint deps, `\@types/react`],
  [others], [`yaml`, `globals`, `vitest`, `\@commitlint/types`, etc.],
)

#warning[After fixing knip config (step 3.1), re-run knip. Many PostCSS/Tailwind/ESLint deps may auto-resolve, reducing the actual removal list.]

== 3.5 Fix unlisted dependencies (9)

- `\@google/generative-ai` --- used in scout-for-lol/data. *Add to package.json.*
- `react-scripts` --- CRA artifact. *Remove the triple-slash reference.*
- `\@total-typescript/ts-reset` --- *Add as devDep* where missing.
- `react` in tsconfig.base.json --- Knip misreads `jsx` config. Legitimate ignore.

== 3.6 System binaries (8)

Add `"ignoreBinaries"` to root `knip.json` --- these are OS tools, not package deps:

#block(fill: luma(245), inset: 8pt, radius: 4pt, width: 100%)[
  ```json
  "ignoreBinaries": ["lefthook", "tsc", "kubectl", "velero", "prettier", "HEAD", "gh"]
  ```
]

== 3.7 Delete 42 dead exports \& types

All 29 unused exports, 13 unused types, and 1 unused enum member verified dead via grep. Delete them all across: better-skill-capped, clauderon, discord-plays-pokemon, eslint-config, hn-enhancer, homelab/deps-email, monarch, scout-for-lol, tasknotes-server.

== 3.8 Fix 11 duplicate exports

- birmel: collapse backwards-compat aliases to one name
- eslint-config: `recommended|default` --- intentional, configure knip
- homelab: collapse `escapeGoTemplate|escapeAlertmanagerTemplate`
- scout-for-lol schemas (7 pairs): investigate and deduplicate

= Phase 4: Local Verification (before any CI changes)

All three tools must pass locally before removing `softFail`:

#table(
  columns: (auto, 1fr),
  table.header([*Check*], [*Command*]),
  [Trivy clean], [`trivy fs --exit-code 1 --severity HIGH,CRITICAL --ignorefile .trivyignore --skip-dirs archive --skip-dirs practice .`],
  [Semgrep clean], [`semgrep scan --config auto .`],
  [Knip clean], [`bunx knip --no-config-hints`],
  [Types pass], [`bun run typecheck`],
  [Tests pass], [`bun run test`],
)

= Phase 5: Remove softFail (only after Phase 4 passes)

Remove `softFail: true` from all three steps in `scripts/ci/src/steps/quality.ts`:
- `knipCheckStep()` line 99
- `trivyScanStep()` line 134
- `semgrepScanStep()` line 158

= Critical Files

#block(fill: luma(245), inset: 8pt, radius: 4pt, width: 100%)[
  #set text(size: 9pt)
  - `scripts/ci/src/steps/quality.ts` --- remove softFail from 3 steps
  - `knip.json` --- fix ignore list, add ignoreBinaries, minimal ignoreDependencies
  - `.buildkite/scripts/trivy-scan.sh` --- add `--skip-dirs practice`
  - `.trivyignore` --- gut it (remove all entries)
  - `.semgrepignore` --- create (minimal: archive, practice, poc, node\_modules)
  - `packages/astro-opengraph-images/src/presets/index.ts` --- fix imports
  - \~20 `package.json` files --- remove unused deps
  - \~30 source files --- delete dead exports/types
  - 8 files to delete entirely
]
