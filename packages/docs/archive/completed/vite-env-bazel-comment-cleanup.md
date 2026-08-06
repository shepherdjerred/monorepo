---
id: vite-env-bazel-comment-cleanup
type: todo
status: complete
board: false
source_marker: false
---

# Remove the stale Bazel vite-env fallback in dpp / mk64 frontends

## What

`packages/discord-plays-pokemon/packages/frontend/types/vite-env.d.ts` and
`packages/discord-plays-mario-kart/packages/frontend/types/vite-env.d.ts` still
reference Bazel:

```ts
/// <reference types="vite/client" />

// Fallback declarations for environments where vite/client types may not resolve
// (e.g. Bazel sandbox where Vite is not a direct dependency)
type ImportMetaEnv = { ... };
type ImportMeta = { readonly env: ImportMetaEnv };
```

The whole fallback block is **dead code** now: `vite` is a direct devDependency
of both frontends (`"vite": "^8.0.11"`), so `/// <reference types="vite/client" />`
resolves and `vite/client` already provides `ImportMetaEnv` (with a `[key: string]`
index signature) and `ImportMeta.env`. Delete the fallback and keep only the
`vite/client` reference (verify frontend typecheck stays green first — the block
declares globals that could duplicate/shadow vite/client's).

## Why deferred / blocked

Editing either file fires the `discord-plays-{pokemon,mario-kart}-typecheck`
pre-commit hook, which typechecks the **whole package including the backend**.
In a fresh worktree the backend already fails on `main` (independent of this
change and of Bazel):

```
src/stream/game-streamer.ts: Cannot find module
'@shepherdjerred/discord-stream-lifecycle/debug/transition-logger'
```

`discord-stream-lifecycle` is a shared workspace package that `scripts/setup.ts`
does not build, and even after `bun run build` in it, the nested `./*` subpath
export (`.../debug/transition-logger`) does not resolve locally (single-segment
subpaths like `/types` do). So the hook can't go green in a worktree, and we
won't `--no-verify`.

## Closure

Commit `9e6ed261d` / PR #1507 removed both fallback blocks. Each target file now
contains only `/// <reference types="vite/client" />`; the obsolete
`scripts/setup.ts` blocker was subsequently removed with the workspace migration.

## Comment Log

- 2026-07-27 — Board audit verified both current `vite-env.d.ts` files contain
  only the Vite client reference. Closed and archived as implemented.
