# Dagger Best Practices & Anti-Pattern Audit

## Research Sources
- Official Dagger docs (107 pages crawled from docs.dagger.io)
- Dagger GitHub issues (#3705, #9033, #10320, #10350, #11434, #11851, #12828)
- Hacker News threads (Dec 2024, Feb 2025 discussions)
- Production blog posts from teams using Dagger
- Code audit of current `.dagger/src/index.ts` (580 lines)

---

## 1. Error Handling

### Rules
- **Use `.stdout()` as the terminal call, not `.sync()`**. Both trigger execution, but `.stdout()` returns the output string — useful for debugging. `.sync()` returns the Container object, which discards stdout/stderr.
- **`.sync()` is acceptable for pass/fail side effects** — when you don't need output and just want to verify success. But `.stdout()` is always safe and gives better debugging.
- **Catch `ExecError` explicitly** — it has `.cmd`, `.exitCode`, `.stdout`, `.stderr` properties. Since v0.15.0, `.toString()` no longer includes stdout/stderr, so you must access them as properties.
- **Never truncate error messages** — the current code slices to 80 chars, which destroys debugging info.
- **`Promise.all` for parallel, not `Promise.allSettled` with `.catch()`** — the current `ciAll()` catches every error into a string, so nothing ever rejects. Use `Promise.all` and let failures propagate, OR use `Promise.allSettled` but actually check for failures and throw at the end.

### Current Code Issues (index.ts)
- Lines 491-500: `.sync().then().catch()` pattern swallows errors into strings
- Lines 504-506: `results.push()` never distinguishes pass from fail programmatically
- Lines 493: `.slice(0, 80)` truncates error messages
- `ciAll()` always exits 0 — CI never fails

### Fix
```typescript
// Instead of:
container.withExec(["bun", "run", "lint"]).sync()
  .then(() => `${pkg}: lint=PASS`)
  .catch((e: Error) => `${pkg}: lint=FAIL (${e.message.slice(0, 80)})`)

// Use:
container.withExec(["bun", "run", "lint"]).stdout()
  .then(() => `${pkg}: lint=PASS`)
  .catch((e: unknown) => {
    if (e instanceof ExecError) {
      throw new Error(`${pkg}: lint=FAIL\n${e.stderr}`)
    }
    throw e
  })
```

---

## 2. Caching

### Three Cache Layers
1. **Layer caching** (automatic) — BuildKit content-addressed DAG. Identical inputs = cache hit. Free.
2. **Volume caching** (`dag.cacheVolume()`) — Persistent mutable state. Use for package manager caches (bun, cargo, go mod). Survives across sessions.
3. **Function caching** (v0.19.4+) — Caches the return value of `@func()` calls. Default TTL: 7 days. Module source changes invalidate ALL function caches.

### Rules
- **Deps before source** — Copy `package.json` + `bun.lock` and run `bun install` BEFORE mounting source code. Otherwise, any source change invalidates the install layer.
- **Stable volume names** — Never encode versions in volume names. Already correct in current code.
- **Comprehensive excludes** — Exclude `.git`, `node_modules`, `dist`, `target`, but also: `.vscode`, `.idea`, `coverage`, `build`, `.next`, `.tsbuildinfo`, `.DS_Store`
- **Narrow source context** — For Rust/Go (non-workspace), pass only the package directory. For Bun workspaces, the full monorepo minus excludes is acceptable since bun needs root `package.json` + `bun.lock`.
- **`cache: "never"` for deploy functions** — Functions that push images, sync ArgoCD, or deploy sites should use `@func({ cache: "never" })` since their side effects must always execute.
- **`cache: "session"` for CI orchestration** — `ciAll()` should not be cached across sessions.

### Current Code Issues
- `bunBase()` mounts source BEFORE `bun install` (line 47 vs 48) — any source change invalidates the install cache
- Missing excludes: `.vscode`, `.idea`, `coverage`, `build`, `.next`, `.tsbuildinfo`, `__pycache__`, `.DS_Store`
- ESLint cache volume mounted per-package path — correct behavior
- No function caching annotations on any `@func()` — all use default 7-day TTL

### Fix: Layer Ordering in bunBase()
```typescript
bunBase(source: Directory, pkg: string): Container {
  return dag.container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec(["apt-get", "install", "-y", "-qq", "--no-install-recommends", "zstd", "python3", "python3-setuptools"])
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    // Deps layer (cached unless lockfile changes)
    .withFile("/workspace/package.json", source.file("package.json"))
    .withFile("/workspace/bun.lock", source.file("bun.lock"))
    .withDirectory("/workspace/patches", source.directory("patches"))
    .withExec(["bun", "install", "--frozen-lockfile"])
    // Source layer (only invalidated by actual source changes)
    .withDirectory("/workspace", source, { exclude: EXCLUDES })
    // Build workspace deps
    .withWorkdir("/workspace/packages/eslint-config")
    .withExec(["bun", "run", "build"])
    // ... more workspace deps ...
    .withWorkdir(`/workspace/packages/${pkg}`)
}
```

---

## 3. Logging & Debugging

### Rules
- **Use `--progress=plain -v` in CI** — no TUI available, plain mode shows all output. `-v` keeps completed spans visible.
- **Set `DAGGER_NO_NAG=1` and `DAGGER_NO_UPDATE_CHECK=1` in CI** — suppresses noise.
- **Use `dagger call -i <func>` for interactive debugging** — drops into `/bin/sh` on failure.
- **Use `.terminal()` for explicit breakpoints** — inserts a shell session mid-pipeline.
- **Use `--debug` for max verbosity** — shows all internal engine spans.
- **In Buildkite steps, capture stderr** — `DAGGER_LOG_STDERR=/tmp/dagger.log` tees logs to a file for artifact upload.

### CI Environment Variables
```bash
export DAGGER_NO_NAG=1
export DAGGER_NO_UPDATE_CHECK=1
export DAGGER_PROGRESS=plain
# Optional: DAGGER_LOG_STDERR=/tmp/dagger.log
```

---

## 4. Module Organization

### Rules
- **TypeScript SDK cannot split the main `@object()` class across files** — the decorated class must be in `index.ts`. But you can import helper functions from other files.
- **Keep `index.ts` thin** — define the class and `@func()` decorators, delegate implementation to imported helpers.
- **Pattern**: `index.ts` has the class with `@func()` methods that call into `release.ts`, `quality.ts`, etc.
- **Don't use constructors for configuration** — use function arguments instead. Constructors add state that complicates caching.

### Current Code
The current single-file approach (580 lines) is manageable. When adding Phase 3 functions, split helpers:
```
.dagger/src/
  index.ts       # @object() class with all @func() methods (thin wrappers)
  ci.ts          # bunBase(), ciAll() implementation
  release.ts     # helm, tofu, npm, site deploy helpers
  quality.ts     # prettier, shellcheck, compliance helpers
```

---

## 5. Performance

### Rules
- **Persistent engine is critical for CI** — cold Dagger starts are 2-5x slower. The K8s StatefulSet engine is already in place.
- **Minimize context transfer** — the monorepo minus excludes is acceptable, but adding more excludes (IDE dirs, build artifacts) saves time.
- **No throttling built-in** — large DAGs (25+ packages) can freeze the engine. Use `--oci-max-parallelism` if needed, or batch work.
- **Avoid `withMountedDirectory` for cacheable work** — mounts have weaker caching than `withDirectory`. Use `withDirectory` for source, `withMountedCache` for volumes.

### Current Code Issues
- `oven/bun:debian` is a floating tag — pins to latest, breaks reproducibility
- `swiftlint:latest` — same problem
- Bun installed via `curl | bash` in Playwright containers without version pinning

### Fix: Pin Image Versions
```typescript
const BUN_IMAGE = "oven/bun:1.2.3-debian"  // pin to specific version
const RUST_IMAGE = "rust:1.88.0-bookworm"
const GO_IMAGE = "golang:1.25.4-bookworm"
// swiftlint: pin to specific release tag
```

---

## 6. Parallelism

### Rules
- **Use `Promise.all()` for parallel execution** — official docs recommend this pattern for the "all" function.
- **`.sync()` inside Promise.all() is fine** — it triggers execution. But `.stdout()` is better since it gives output.
- **Each promise branch must have a terminal call** — `.stdout()`, `.sync()`, `.publish()`, etc. Without one, the operation is silently skipped (lazy evaluation).

### Current Code Issues
- `ciAll()` uses `Promise.allSettled` but catches all errors → nothing rejects → no failure signal
- The `.sync()` calls do trigger parallel execution correctly (BuildKit DAG handles parallelism), but `.stdout()` would be better for debugging

---

## 7. Function Caching Annotations

### New in v0.20+
```typescript
@func()                           // default: cached 7 days
@func({ cache: "never" })         // always runs (deploy, publish, sync)
@func({ cache: "session" })       // cached per session only
@func({ cache: "10m" })           // cached for 10 minutes
```

### Recommendations for our module
- `lint`, `typecheck`, `test`: default (7-day cache) — correct, inputs determine cache key
- `buildImage`: default — correct
- `pushImage`: `cache: "never"` — always push
- `deploySite`: `cache: "never"` — always deploy
- `argoCdSync`: `cache: "never"` — always sync
- `tofuApply`: `cache: "never"` — always apply
- `ciAll`: `cache: "session"` — run once per session
- `helmPackage`: `cache: "never"` — always push chart

---

## 8. Complete Audit Summary

### Critical Issues (must fix)
1. **ciAll() swallows errors** — always exits 0
2. **bunBase() layer ordering** — source before install defeats caching
3. **Error message truncation** — .slice(0, 80) destroys debugging info
4. **Floating image tags** — `oven/bun:debian`, `swiftlint:latest` break reproducibility

### High Issues (should fix)
5. **Missing excludes** — IDE dirs, build artifacts, language caches transfer unnecessarily
6. **No function caching annotations** — deploy functions need `cache: "never"`
7. **Hardcoded package list** — `tsPackages` array in ciAll() must be updated manually
8. **Hardcoded workspace deps** — eslint-config, astro-opengraph-images, webring built in bunBase()
9. **Unversioned Bun install in Playwright** — `curl | bash` without version

### Medium Issues (nice to fix)
10. **Inconsistent return types** — some functions return Container, some Directory, some string
11. **No input validation** — pkg parameter not validated
12. **scout/homelab special handling** — creates new containers instead of reusing base
13. **Cargo cache incomplete** — missing `~/.cargo/git/`
14. **Rust/Go excludes incomplete** — missing `.git/` in rustBase

### Low Issues
15. **tsconfig.json minimal** — missing noUnusedLocals, noImplicitReturns
16. **Inconsistent parameter ordering** — (source, pkg) vs (source) varies
