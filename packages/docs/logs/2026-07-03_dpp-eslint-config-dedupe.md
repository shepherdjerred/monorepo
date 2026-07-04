# dpp `@shepherdjerred/eslint-config` file: dep dedupe — pkg-check EEXIST race fix

## Status

In Progress

## Problem

The `dagger-knife-pkg-check` job's **discord-plays-pokemon (dpp)** shard fails frequently
under CI load (red on `main`) with:

```
EEXIST: File exists: failed to link package: @shepherdjerred/eslint-config@../eslint-config (link)
```

This blocks the `ci-complete` gate (`waiting_failed`), keeping ~8 PRs and `main` red.

## Root cause

The dpp **nested** workspace (`packages/discord-plays-pokemon/`, with sub-workspaces
`packages/{common,backend,frontend}`) declared `@shepherdjerred/eslint-config` as a
`file:` dependency in **two** places with **different specifier strings** that both
resolve to the same physical `packages/eslint-config`:

| Location                                                       | Specifier                     |
| -------------------------------------------------------------- | ----------------------------- |
| `packages/discord-plays-pokemon/package.json` (root)           | `file:../eslint-config`       |
| `packages/discord-plays-pokemon/packages/backend/package.json` | `file:../../../eslint-config` |

Because the specifier strings differ, bun created **two separate package nodes** in
`packages/discord-plays-pokemon/bun.lock`:

- top-level `@shepherdjerred/eslint-config`
- `@discord-plays-pokemon/backend/@shepherdjerred/eslint-config`

Both hoist to the single symlink `node_modules/@shepherdjerred/eslint-config`. During
`bun install` under CI load the two link operations race; the loser hits `EEXIST`.

## Fix

Drop the redundant `backend` declaration. Backend now resolves the package via
**workspace hoisting** from the dpp root — exactly like the `frontend` and `common`
sub-packages, which import it in their `eslint.config.ts` but have **never** declared
it. The regenerated `bun.lock` has a **single** eslint-config node, so the double-link
is structurally impossible.

Diff: `packages/discord-plays-pokemon/packages/backend/package.json` (−1 line) +
`packages/discord-plays-pokemon/bun.lock` (−3 lines). No source, no `.dagger` changes.

## Validation (local)

- **10× cold `bun install --frozen-lockfile`** with `node_modules` cleared between every
  run → **0 EEXIST**, all succeed, frozen lockfile satisfied. (The race could not be
  reproduced locally pre-fix even at 5× — it is CI-load-dependent; the structural
  one-node-vs-two lockfile change is the real proof.)
- Lockfile: `@discord-plays-pokemon/backend/@shepherdjerred/eslint-config` node gone;
  exactly one top-level node remains.
- `require.resolve("@shepherdjerred/eslint-config")` from the backend cwd resolves via
  the hoisted root symlink; `bunx eslint .` runs in backend (config loads, rules
  execute). Frontend/common unaffected.

Unrelated pre-existing: backend has 2 `no-unsafe-*` lint errors in
`src/goal/pricing.ts`, byte-identical to `main`, untouched here and not part of
pkg-check.

## PR

- #1399 — https://github.com/shepherdjerred/monorepo/pull/1399
- Branch `fix/dpp-eslint-config-dedupe`, commit `2d37fce5b`.
