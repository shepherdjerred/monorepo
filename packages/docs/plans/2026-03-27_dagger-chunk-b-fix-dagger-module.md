# Chunk B: Fix Dagger Module

**Wave:** 1 (parallel with R, A, C)
**Agent type:** Code agent, git worktree
**Touches:** `.dagger/src/index.ts` only
**Depends on:** Nothing
**Blocks:** Wave 2 (D, E, F build on the fixed module)

## Goal

Fix all 4 critical and 4 high issues found in the code audit. The module must have correct caching, proper error handling, pinned images, and comprehensive excludes.

## Context: Research Findings

See `packages/docs/plans/2026-03-27_dagger-best-practices-audit.md` and `~/.claude/research/dagger-best-practices.md` for the full audit. Key rules:
- Use `.stdout()` not `.sync()` as terminal call
- Catch `ExecError` explicitly — it has `.cmd`, `.exitCode`, `.stdout`, `.stderr`
- Never truncate error messages
- Deps before source in layer ordering
- Pin all image tags with Renovate comments
- `@func({ cache: "never" })` on deploy functions, `@func({ cache: "session" })` on ciAll

## Steps

### 1. Define shared excludes constant
```typescript
const SOURCE_EXCLUDES = [
  "**/node_modules", "**/.eslintcache", "**/dist", "**/target", ".git",
  "**/.vscode", "**/.idea", "**/coverage", "**/build", "**/.next",
  "**/.tsbuildinfo", "**/__pycache__", "**/.DS_Store", "**/archive",
]
```

### 2. Pin image tags with Renovate comments
```typescript
// renovate: datasource=docker depName=oven/bun
const BUN_IMAGE = "oven/bun:1.2.17-debian"
// renovate: datasource=docker depName=rust
const RUST_IMAGE = "rust:1.88.0-bookworm"
// renovate: datasource=docker depName=golang
const GO_IMAGE = "golang:1.25.4-bookworm"
// renovate: datasource=docker depName=mcr.microsoft.com/playwright
const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.58.2-noble"
// renovate: datasource=docker depName=ghcr.io/realm/swiftlint
const SWIFTLINT_IMAGE = "ghcr.io/realm/swiftlint:0.58.2"
// renovate: datasource=npm depName=bun
const BUN_VERSION = "1.2.17"
```

### 3. Fix bunBase() layer ordering (CRITICAL — biggest caching win)
Rewrite so deps are installed before source is mounted:
```typescript
bunBase(source: Directory, pkg: string): Container {
  return dag.container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec(["apt-get", "install", "-y", "-qq", "--no-install-recommends", "zstd", "python3", "python3-setuptools"])
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    // Deps layer — cached unless lockfile changes
    .withFile("/workspace/package.json", source.file("package.json"))
    .withFile("/workspace/bun.lock", source.file("bun.lock"))
    .withDirectory("/workspace/patches", source.directory("patches"))
    .withExec(["bun", "install", "--frozen-lockfile"])
    // Source layer — only invalidated by actual source changes
    .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES })
    // Build workspace deps
    .withWorkdir("/workspace/packages/eslint-config")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/astro-opengraph-images")
    .withExec(["bun", "run", "build"])
    .withWorkdir("/workspace/packages/webring")
    .withExec(["bun", "run", "build"])
    .withWorkdir(`/workspace/packages/${pkg}`)
}
```

### 4. Fix ciAll() error handling (CRITICAL)
- Replace all `.sync()` with `.stdout()`
- Remove all `.slice(0, 80)` error truncation
- Remove `.catch()` that converts errors to pass strings — let them propagate as rejections
- After `Promise.allSettled`, collect all `rejected` results and throw with full details:
```typescript
const failures = results.filter(r => r.status === "rejected")
if (failures.length > 0) {
  throw new Error(`CI failed:\n${failures.map(f => f.reason).join("\n")}`)
}
```
- Add `@func({ cache: "session" })` decorator

### 5. Add function caching annotations
- `pushImage`: `@func({ cache: "never" })`
- `ciAll`: `@func({ cache: "session" })`

### 6. Fix Playwright containers
- Pin Bun install: `curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}`
- Use `SOURCE_EXCLUDES` constant instead of inline array

### 7. Fix swiftLint
- Use `SWIFTLINT_IMAGE` constant instead of hardcoded `"ghcr.io/realm/swiftlint:latest"`

### 8. Fix rustBase
- Add `.git` to excludes: `exclude: ["target", "node_modules", ".git"]`
- Add cargo git cache: `.withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))`

### 9. Fix goBase
- Add excludes: `source.directory("packages/terraform-provider-asuswrt"), { exclude: ["node_modules", ".git"] }`

### 10. Use SOURCE_EXCLUDES everywhere
Replace all inline exclude arrays in: `bunBase`, `playwrightTest`, `playwrightUpdate`, `prettier`, `shellcheck`

### 11. Verify
```bash
dagger functions                                    # all functions listed
dagger call lint --source=. --pkg=webring           # works
dagger call lint --source=. --pkg=webring           # 2nd run — should be fast (cache hit)
dagger call homelab-synth --source=.                # works
dagger call homelab-synth --source=.                # 2nd run — should be fast
# Intentionally break a package and verify ciAll fails:
dagger call ci-all --source=.                       # should exit non-zero if any package fails
```

## Definition of Done

- [ ] `bunBase()` copies lockfile before source (verified by reading code)
- [ ] `ciAll()` throws on any failure — no `.catch()` that swallows errors
- [ ] Zero `.slice(0, 80)` in the file
- [ ] Zero `.sync()` calls in `ciAll()` — all use `.stdout()`
- [ ] All image tags pinned to specific versions with Renovate comments
- [ ] `SOURCE_EXCLUDES` constant defined and used in ALL `withDirectory` calls
- [ ] `pushImage` has `@func({ cache: "never" })`
- [ ] `ciAll` has `@func({ cache: "session" })`
- [ ] Playwright Bun install pinned to specific version
- [ ] `swiftLint` uses pinned image constant
- [ ] `rustBase` has `.git` exclude and `~/.cargo/git/` cache mount
- [ ] `goBase` has excludes
- [ ] `dagger functions` lists all functions without error

## Success Criteria

- `dagger call lint --source=. --pkg=webring` works
- 2nd run is noticeably faster than 1st (cache hit on install layer)
- `dagger call ci-all --source=.` fails properly with full error output when a package has issues
- No truncated error messages — full stderr visible on failure
