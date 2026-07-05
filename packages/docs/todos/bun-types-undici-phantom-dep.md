---
id: bun-types-undici-phantom-dep
status: waiting-on-verification
origin: packages/docs/plans/2026-07-04_bun-workspace-migration.md
---

# Drop the bun-types patch once upstream declares undici-types

## What

`patches/bun-types@1.3.14.patch` (wired via root `patchedDependencies`) adds
`"undici-types": "*"` to bun-types' dependencies. Without it, under the
isolated linker + skipLibCheck, `bun-types/fetch.d.ts`'s conditional
`import("undici-types")` fallback silently fails to resolve (undici-types
lives in @types/node's store entry, invisible from bun-types' files) and the
global `Response`/`Request`/`Headers` degrade to near-empty interfaces
(first symptom: `Property 'status' does not exist on type 'Response'`).

## Done when

- Upstream issue filed on oven-sh/bun (silent-degradation variant; closed
  #19300 covers only the loud no-skipLibCheck variant), AND
- a bun release ships bun-types with `undici-types` declared (verify:
  `bun info bun-types@<ver> dependencies`), AND
- the patch + `patchedDependencies` entry are removed and typecheck stays
  green (canary: `cd packages/tasknotes-server && bun run typecheck`).

Related watch: oven-sh/bun#12917 / #20142 (isolated-linker EEXIST races under
parallel installs) — irrelevant to local dev (one install root) but the reason
CI containers run isolated _without_ the experimental globalStore.
