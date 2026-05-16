# Bun Container Caveats in Dagger

## Hardlink Behavior Across Filesystem Boundaries

On Linux, Bun hardlinks from its global cache (`~/.bun/install/cache`) into `node_modules`. When the cache is a Dagger CacheVolume (mounted as a separate filesystem) and `node_modules` is in the container layer, hardlinks fail silently — Bun falls back to copying.

This means the dual cache volume pattern (both cache and node_modules as CacheVolumes on mounted filesystems) works correctly, but mixing a mounted cache with a non-mounted node_modules incurs copy overhead rather than instant hardlinks.

To force copy behavior explicitly, set `BUN_INSTALL_LINKS=copyfile` as an environment variable in the container.

## .d.ts File Skip Bug

Bun issue #27095 (February 2026): Bun can silently skip `.d.ts` files when linking from cache to `node_modules` on Linux. This affects packages like `typescript` and `hono` that ship `.d.ts` alongside `.js` files.

If TypeScript type checking fails in Dagger containers but works locally (macOS uses `clonefile` instead of hardlinks), this bug may be the cause. Workaround: set `BUN_INSTALL_LINKS=copyfile`.

## Install Backend Options

Bun supports multiple install backends controlled by `BUN_INSTALL_LINKS`:

| Backend     | Platform Default | Behavior                                                          |
| ----------- | ---------------- | ----------------------------------------------------------------- |
| `hardlink`  | Linux            | Creates hardlinks from cache; fails silently across FS boundaries |
| `clonefile` | macOS            | Uses copy-on-write clone; efficient on APFS                       |
| `copyfile`  | Fallback         | Full copy; always works, uses more disk                           |
| `symlink`   | None             | Symlinks; may cause issues with bundlers                          |

For Dagger containers (always Linux), the default is `hardlink`. If experiencing cache-related issues, override with:

```typescript
.withEnvVariable("BUN_INSTALL_LINKS", "copyfile")
```

## bun.lock (Text) vs bun.lockb (Binary)

Since Bun v1.2, the default lockfile is `bun.lock` (text-based JSONC format), replacing the binary `bun.lockb`.

| Aspect               | bun.lock (text)               | bun.lockb (binary) |
| -------------------- | ----------------------------- | ------------------ |
| Format               | JSONC (human-readable)        | Binary             |
| Diffable in PRs      | Yes                           | No                 |
| Hashable by CI tools | `hashFiles('bun.lock')` works | Need `bun pm hash` |
| Merge conflicts      | Resolvable                    | Difficult          |
| Install speed        | Optimized in v1.1.39+         | Baseline           |

Migration: `bun install --save-text-lockfile --frozen-lockfile --lockfile-only` then delete `bun.lockb`.

## SDK Runtime vs Container Runtime

Important distinction for Dagger users:

| Aspect         | Bun as Dagger SDK Runtime                               | Bun Inside Containers                  |
| -------------- | ------------------------------------------------------- | -------------------------------------- |
| Stability      | Experimental                                            | Stable, production-ready               |
| Known issues   | 5-minute timeout (issue #10091)                         | Hardlink/cache bugs above              |
| Configuration  | `"dagger": { "runtime": "bun" }` in dagger package.json | `dag.container().from("oven/bun:1.2")` |
| Recommendation | Use Node.js for the SDK runtime                         | Use Bun for builds/tests               |
| Auto-detection | From `bun.lock`/`bun.lockb` in dagger dir               | N/A                                    |

## Workspace Hoisting vs Isolated Mode

Bun defaults to hoisted `node_modules`, lifting dependencies to the root. This can cause phantom dependencies (packages usable without being declared in that package's `package.json`).

For monorepos in Dagger, consider `--install.strategy=isolated` for deterministic builds. Caching implications:

| Mode              | node_modules Layout        | Cache Strategy                                                      |
| ----------------- | -------------------------- | ------------------------------------------------------------------- |
| Hoisted (default) | Single root `node_modules` | One CacheVolume for root `node_modules` works                       |
| Isolated          | Per-package `node_modules` | Prefer caching `~/.bun/install/cache` (global) over individual dirs |

With isolated mode, caching the global Bun cache is preferred — it's a single directory regardless of how many packages exist.
