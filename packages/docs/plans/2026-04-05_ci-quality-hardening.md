# Harden Trivy, Semgrep, and Knip in CI

## Status

Active / Not Started. Knip, Trivy, and Semgrep are still soft-failing in CI.

## Context

All three quality tools are `softFail: true` in Buildkite CI. Goal: fix all findings and make them hard failures. Philosophy: **fix the code, don't suppress findings**. Only `archive/` and `practice/` may be excluded (genuinely non-production).

## Ordering

1. Install trivy + semgrep locally (`brew install trivy`, `pip install semgrep`)
2. Fix all findings for each tool
3. Verify each tool passes locally
4. Only after all three pass locally, remove `softFail: true` from CI

## Phase 1: Trivy

### Audit .trivyignore — remove unjustified suppressions

**Castle-casters (4 CVEs)** — CVE-2019-17571, CVE-2021-4104, CVE-2022-23302, CVE-2022-23305

- Comment says "log4j 1.x EOL" but castle-casters uses **log4j 2.25.4** with `log4j-1.2-api` compat bridge
- These CVEs target log4j 1.x — likely false positives against the 2.x compat module
- **Action:** Remove suppressions. If trivy still flags them, investigate whether the `log4j-1.2-api` dep can be dropped or upgraded.

**Practice dir (19 CVEs)** — All in `practice/` which is legitimately non-production.

- **Action:** Add `--skip-dirs practice` to trivy command. Delete all 19 CVE lines. New practice CVEs won't need manual suppression.

**Remove `softFail: true`** from `trivyScanStep()` at `quality.ts:134`.

### Files

- `.buildkite/scripts/trivy-scan.sh` — add `--skip-dirs practice`
- `.trivyignore` — remove all entries
- `scripts/ci/src/steps/quality.ts:134` — remove softFail

## Phase 2: Semgrep

### Create minimal `.semgrepignore`

Only genuinely non-production dirs:

```
archive/
practice/
poc/
node_modules/
```

**Remove `softFail: true`** from `semgrepScanStep()` at `quality.ts:158`.

Push, see what semgrep finds, fix actual findings.

### Files

- `.semgrepignore` — create
- `scripts/ci/src/steps/quality.ts:158` — remove softFail

## Phase 3: Knip

### 3a. Fix knip config — stop ignoring config files

Root cause of many false positives: `knip.json` ignores `**/postcss.config.ts` and `**/eslint.config.ts`, preventing knip from seeing deps used in those files.

**Action:** Remove both from the `ignore` list. This resolves false positives for `tailwindcss`, `@tailwindcss/postcss`, `autoprefixer`, `@tailwindcss/forms`, `@tailwindcss/typography`, `postcss`, and eslint deps used in config files.

Also remove `vite: false, postcss: false` from the desktop workspace config so knip analyzes its vite.config.ts.

### 3b. Fix unresolved imports (22)

- **astro-opengraph-images (10):** `presets/index.ts` imports `./foo.ts` but files are `.tsx`. Fix extensions.
- **better-skill-capped (3):** Dead component imports. Investigate and delete dead code.
- **discord-plays-pokemon (5):** `~icons/ph/*` virtual imports from unplugin-icons/Vite plugin. Knip plugin gap — need to handle.
- **bun-types in tsconfig (4):** Knip can't detect tsconfig `types` references. Legitimate `ignoreDependencies` case.

### 3c. Delete 8 unused files

All verified dead:

- `.buildkite/scripts/update-versions.ts`
- `packages/astro-opengraph-images/src/presets/render-examples.ts`
- `packages/better-skill-capped/src/datastore/content-datastore.ts`
- `packages/clauderon/web/frontend/src/lib/uuid.ts`
- `packages/discord-plays-pokemon/packages/frontend/src/stories/loading-button.tsx`
- `packages/discord-plays-pokemon/packages/frontend/src/stories/loading-spinner.tsx`
- `packages/discord-plays-pokemon/packages/frontend/src/util.ts`
- `packages/monarch/src/lib/costco/receipt-parser.ts`

### 3d. Remove unused dependencies (110 total)

**All genuinely unused — remove from package.json:**

- **jiti** — not used anywhere. Remove from eslint-config, cooklang-rich-preview, homelab, cdk8s, deps-email, helm-types
- **@astrojs/tailwind** — replaced by `@tailwindcss/postcss` in scout-for-lol frontend
- **Old eslint deps** — leftovers from shared eslint-config migration: `@eslint/js`, `typescript-eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint-config-prettier`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `eslint-plugin-react`, `eslint-plugin-astro`, `eslint-plugin-unicorn`, `@eslint/eslintrc`, `@types/eslint__js`, `@tanstack/eslint-plugin-query`, `@shepherdjerred/eslint-config`
- **better-skill-capped:** `@fortawesome/fontawesome-free`, `bulma`, `react-redux`, `@types/react-router-dom`
- **birmel:** `youtubei.js`
- **clauderon/web/frontend:** `@radix-ui/react-dropdown-menu`, `shiki`, `autoprefixer`
- **discord-plays-pokemon:** `lodash`, `ts-pattern`, `keyboardjs`, `@types/lodash`, `@iconify-json/carbon`, `@iconify/json`, `@svgr/plugin-jsx`, `@tailwindcss/forms`, `tailwindcss`
- **homelab:** `openai`, `simple-git`, `remeda` (cdk8s + ha)
- **scout-for-lol:** `prism-media`, `sodium-native` (verify voice still works), `@types/uuid`, `glob`, `@vitejs/plugin-react` (desktop), `vite-tsconfig-paths` (desktop), `@tailwindcss/postcss` (desktop), `autoprefixer` (desktop), `postcss` (desktop)
- **sjer.red:** `sass`, old eslint deps, `@types/react`
- **starlight-karma-bot:** `@commitlint/types`, `@total-typescript/ts-reset`
- **tasknotes-server:** `yaml`
- **webring:** `globals`, `vitest`
- **astro-opengraph-images:** `@fontsource/roboto` (only used in render-examples.ts which we're deleting)

After removing `**/postcss.config.ts` and `**/eslint.config.ts` from knip ignores (step 3a), many PostCSS/Tailwind/ESLint deps should be auto-detected. Re-run knip after that change to get the true remaining list.

### 3e. Fix unlisted dependencies (9)

- `@google/generative-ai` — used in scout-for-lol/data. **Add to package.json.**
- `react-scripts` — CRA artifact in better-skill-capped. **Remove the triple-slash reference.**
- `@total-typescript/ts-reset` — imported in reset.d.ts files. **Add as devDep** where missing.
- `react` in tsconfig.base.json — tsconfig `jsx` setting, not a dep reference. Knip misreads it. Legitimate ignore case.

### 3f. Fix unlisted binaries (8)

System tools, not package deps. Add to root `knip.json`:

```json
"ignoreBinaries": ["lefthook", "tsc", "kubectl", "velero", "prettier", "HEAD", "gh"]
```

### 3g. Delete all 42 unused exports + types

All verified dead via grep — remove all 29 unused exports, 13 unused types, and 1 unused enum member.

### 3h. Fix duplicate exports (11)

- birmel: backwards-compat aliases — collapse to one name
- eslint-config: `recommended|default` — intentional, configure knip
- homelab: `escapeGoTemplate|escapeAlertmanagerTemplate` — collapse
- scout-for-lol schemas (7 pairs): investigate and deduplicate

## Phase 4: Local verification (before any CI changes)

1. `trivy fs --exit-code 1 --severity HIGH,CRITICAL --ignorefile .trivyignore --skip-dirs archive --skip-dirs practice .` exits 0
2. `semgrep scan --config auto .` exits 0
3. `bunx knip --no-config-hints` exits 0
4. `bun run typecheck` passes
5. `bun run test` passes

## Phase 5: Remove softFail (only after Phase 4 passes)

Remove `softFail: true` from all three steps in `scripts/ci/src/steps/quality.ts`:

- `knipCheckStep()` line 99
- `trivyScanStep()` line 134
- `semgrepScanStep()` line 158

## Critical Files

- `scripts/ci/src/steps/quality.ts` — remove softFail from 3 steps
- `knip.json` — fix ignore list, add ignoreBinaries, minimal ignoreDependencies (only bun-types, react tsconfig)
- `.buildkite/scripts/trivy-scan.sh` — add `--skip-dirs practice`
- `.trivyignore` — gut it
- `.semgrepignore` — create (minimal)
- `packages/astro-opengraph-images/src/presets/index.ts` — fix imports
- ~20 package.json files — remove unused deps
- ~30 source files — delete dead exports/types
- 8 files to delete entirely
