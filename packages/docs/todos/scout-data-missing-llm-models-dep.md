---
id: scout-data-missing-llm-models-dep
status: active
origin: packages/docs/plans/2026-07-03_tasknotes-first-in-class.md
source_marker: false
---

# scout-for-lol: `@scout-for-lol/data` imports `@shepherdjerred/llm-models` without declaring it — breaks every fresh install

## Symptom

On any fresh checkout/worktree, `bun run scripts/setup.ts` fails at
`[DAG] scout-for-lol generate`:

```
error: Cannot find module '@shepherdjerred/llm-models' from
'…/node_modules/.bun/@scout-for-lol+data@file+packages+data…/node_modules/@scout-for-lol/data/src/review/models.ts'
```

`packages/scout-for-lol/packages/data/src/review/models.ts` imports
`@shepherdjerred/llm-models`, but only the scout **root** `package.json`
declares it (`file:../llm-models`). Because scout's sub-packages are wired as
`file:` deps, bun copies `@scout-for-lol/data` into the isolated
`node_modules/.bun/` store where the root's hoisted dep is not visible.
Existing (older, hoisted) `node_modules` state on the main checkout masks the
bug — it only bites fresh installs.

## The obvious fix hits a bun 1.3.14 lockfile bug

Adding `"@shepherdjerred/llm-models": "file:../../../llm-models"` to
`packages/data/package.json` (mirroring how `packages/backend` declares
`@shepherdjerred/llm-observability`) fixes resolution, **but** the lockfile
cannot be updated cleanly:

- **Incremental** `bun install` writes a minimal, correct-looking lockfile
  delta (llm-models entries only, byte-identical in form to a from-scratch
  resolve) — yet `bun install --frozen-lockfile` then reports
  "lockfile had changes" forever, even from a clean `node_modules`.
- **From-scratch** regen (`rm bun.lock && bun install`) passes the frozen
  check but is uncommittable: it floats every `^` range (e.g.
  `@anthropic-ai/claude-agent-sdk` 0.3.150 → 0.3.200, ~1250 changed lines)
  and **silently drops the `patchedDependencies` entry for
  `twisted@1.73.0`** (root `package.json:59` still declares it; the patch
  lives at `packages/scout-for-lol/patches/twisted@1.73.0.patch`).

The trigger appears to be the combination of `patchedDependencies` + an
incremental `file:`-dep insert in a workspace member (bun 1.3.14, mise-pinned).

## Suggested resolution paths (pick one)

1. Bump bun (mise) and retry the incremental update — check bun changelog for
   frozen-lockfile/patchedDependencies fixes first.
2. Deliberate full-regen PR: add the dep, regenerate the lockfile, re-key the
   twisted patch to the newly resolved twisted version (or re-pin twisted),
   accept the version float, and run scout's full check suite.
3. Verify whether Buildkite's scout steps run `generate` on fresh containers —
   if so, main CI should already be red for scout and this is more urgent
   than it looks.

## Context

Found 2026-07-03 while setting up the `tasknotes-p0` worktree (the failure
blocks `scripts/setup.ts` from completing in every new worktree, though
per-package installs for other packages complete fine).
