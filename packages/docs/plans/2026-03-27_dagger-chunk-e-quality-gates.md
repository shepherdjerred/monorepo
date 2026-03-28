# Chunk E: Quality Gate Dagger Functions

**Wave:** 2 (parallel with D, F)
**Agent type:** Code agent, git worktree
**Touches:** `.dagger/src/quality.ts` (NEW), `.dagger/src/index.ts` (add `@func()` wrappers)
**Depends on:** Chunks A + B merged
**Blocks:** Chunk G (pipeline generator needs these functions)

## Goal

Implement Dagger functions for all repo-wide quality gates: quality ratchet, compliance check, knip, gitleaks, suppression check.

## Context

- Load the `dagger-helper` skill before starting
- These functions use default caching (7-day TTL) — they're deterministic on source inputs
- Use `.stdout()` not `.sync()` for terminal calls
- Use `SOURCE_EXCLUDES` constant from the fixed `index.ts`
- Pin all container image tags with Renovate comments

## Steps

### 1. Create `.dagger/src/quality.ts`

Export helper functions:

1. **`qualityRatchetHelper(source)`**
   - Use `bunBase(source, ".")` or similar to get container with bun
   - Run `bun scripts/quality-ratchet.ts`
   - Returns stdout with ratchet report

2. **`complianceCheckHelper(source)`**
   - Use `bunBase(source, ".")`
   - Run `bash scripts/compliance-check.sh`
   - Returns stdout with compliance report

3. **`knipCheckHelper(source)`**
   - Use `bunBase(source, ".")`
   - Run `bunx knip --no-exit-code`
   - Returns stdout with unused code report

4. **`gitleaksCheckHelper(source)`**
   - Container from pinned `zricethezav/gitleaks` image (e.g., `zricethezav/gitleaks:v8.22.1`)
   - Mount source with excludes
   - Run `gitleaks detect --source /workspace --no-git`
   - Returns stdout

5. **`suppressionCheckHelper(source)`**
   - Use `bunBase(source, ".")`
   - Run `bun scripts/check-suppressions.ts`
   - Returns stdout

### 2. Add `@func()` wrappers to `index.ts`

Import helpers from `quality.ts`. Add methods with default caching:

```typescript
import { qualityRatchetHelper, complianceCheckHelper, ... } from "./quality"

@func()
async qualityRatchet(source: Directory): Promise<string> {
  return qualityRatchetHelper(source)
}
// ... etc
```

### 3. Verify

```bash
dagger functions  # all new functions listed

# Each should run successfully on current repo:
dagger call quality-ratchet --source=.
dagger call compliance-check --source=.
dagger call knip-check --source=.
dagger call gitleaks-check --source=.
dagger call suppression-check --source=.
```

## Definition of Done

- [ ] `quality.ts` exists with all 5 helper functions
- [ ] `index.ts` has `@func()` wrappers for each
- [ ] `dagger functions` lists all 5 new functions
- [ ] Each function runs successfully on the current repo state
- [ ] gitleaks image tag pinned (not `latest`) with Renovate comment
- [ ] No `.sync()` used — all use `.stdout()`
- [ ] Output is human-readable (not raw JSON or binary)

## Success Criteria

All 5 quality checks pass on current repo state. Output clearly shows what was checked and whether it passed. Any existing quality issues in the repo are surfaced (not hidden).
