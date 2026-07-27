---
id: bun-types-undici-phantom-dep
type: todo
status: planned
board: true
verification: agent
disposition: blocked
origin: packages/docs/archive/completed/2026-07-04_bun-workspace-migration.md
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

## Remaining

- [ ] File or locate an upstream issue for the skipLibCheck silent-degradation variant and record it here.
- [ ] Monitor Bun releases until `bun-types` declares `undici-types` directly.
- [ ] Remove the patch and root `patchedDependencies` entry, then prove the TaskNotes server canary and affected verification remain green.

Related watch: oven-sh/bun#12917 / #20142 (isolated-linker EEXIST races under
parallel installs) — irrelevant to local dev (one install root) but the reason
CI containers run isolated _without_ the experimental globalStore.

## Comment Log

### 2026-07-27 — Awaiting-human audit

The root patch still adds `undici-types` to `bun-types@1.3.14`. This is an
upstream-blocked mechanical check, not user acceptance.
