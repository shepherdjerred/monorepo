# rules_bun2 Performance Benchmarks

Measured 2026-03-20 on macOS (Apple Silicon), Bazel 8.5.1, Bun 1.3.9.

## Webring (test + typecheck + lint, 3 targets)

Real package with npm imports (express, vitest, rss-parser, zod) and workspace dep (eslint-config).

| Scenario | Time | Notes |
|----------|------|-------|
| Cold (after `--expunge`) | 70.6s | Server restart + repo fetch + source dir scan + test execution |
| After `bazel clean` | 33.2s | Disk cache hits, source dir rescan |
| Warm (second run) | 42.7s | Source directory rescan (first time this server) |
| Hot (third+ run) | **1.4s** | Everything cached |

### Per-target execution times (hot)

| Target | Time |
|--------|------|
| `test2` (bun test) | 1.4s |
| `typecheck2` (tsc --noEmit) | 1.0s |
| `lint2` (eslint) | 2.6s |

## Comparison: rules_bun v1 vs rules_bun2

| Metric | rules_bun v1 | rules_bun2 |
|--------|-------------|------------|
| Targets configured | ~2,784+ | 3,215 (includes skylib deps) |
| Cold build | ~10 min | 70s |
| Hot build | unknown | **1.4s** |
| Lockfile parsing | Starlark, per-package | None |
| Materialization | Per-package copy/link | None (source directory) |
| node_modules strategy | Per-package TreeArtifacts | Single source directory |

## Key architectural decisions

1. **Flat install**: Strip `workspaces` from package.json, merge all deps, `bun install` produces one flat `node_modules/`
2. **Source directory**: `BAZEL_TRACK_SOURCE_DIRECTORIES=1` + `exports_files(["node_modules"])` — Bazel treats node_modules as a single artifact
3. **No materialization**: No Starlark lockfile parsing, no per-package copy/link
4. **Direct bin paths**: Run `bun ./node_modules/<pkg>/bin/<cmd>.js` to bypass missing `node` in sandbox

## Cost model

| Event | Cost | Frequency |
|-------|------|-----------|
| `bun install` (repo rule) | ~9s | Lockfile change only |
| Source directory scan | ~30-40s | After `bazel clean` or server restart |
| Hot build (no changes) | 1.4s | Every build |
| Source file change | ~3-5s | Each edit |

## Native baseline

| Command | Time |
|---------|------|
| `bun install` (warm cache) | 236ms |
| `bun test` (webring) | ~1.5s |
| `bunx tsc --noEmit` (webring) | ~1.0s |
| `bunx eslint .` (webring) | ~2.5s |
