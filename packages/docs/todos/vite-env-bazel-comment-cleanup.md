---
id: vite-env-bazel-comment-cleanup
status: blocked
origin: packages/docs/logs/2026-07-12_rm-sccache-bazel-cache-buckets.md
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

## How to unblock

1. Fix the worktree setup gap (see the log's Workflow Friction): add
   `discord-stream-lifecycle` to the `setup.ts` shared-producer build list and
   make its export map / `moduleResolution` resolve nested subpaths, so
   dpp/mk64 typecheck cleanly in a fresh worktree.
2. Then delete the fallback block in both `vite-env.d.ts` files, confirm
   `bun run typecheck` is green in each frontend, and commit.

(Alternatively, land it on a checkout where dpp/mk64 already typecheck — the
edit itself is trivial and CI validates it.)
