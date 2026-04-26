# Chunk F: Java + LaTeX + Security Functions

**Wave:** 2 (parallel with D, E)
**Agent type:** Code agent, git worktree
**Touches:** `.dagger/src/security.ts` (NEW), `.dagger/src/index.ts` (add `@func()` wrappers)
**Depends on:** Chunks A + B merged
**Blocks:** Chunk G (pipeline generator needs these functions)

## Goal

Implement Dagger functions for: security scanning (trivy, semgrep), Java/Gradle builds (castle-casters), and LaTeX builds (resume).

## Context

- Load the `dagger-helper` skill before starting
- Security scans are intended to `soft_fail` in the pipeline — they report but don't block
- Castle-casters is a Java/Gradle project that needs build + test + release
- Resume is a LaTeX project that needs build + deploy to SeaweedFS
- Pin all container image tags with Renovate comments
- Use `.stdout()` not `.sync()` for terminal calls

## Steps

### 1. Create `.dagger/src/security.ts`

1. **`trivyScanHelper(source)`**
   - Container from pinned `aquasec/trivy` image (e.g., `aquasec/trivy:0.58.2`)
   - Mount source with excludes
   - Run `trivy fs --exit-code 1 --severity HIGH,CRITICAL /workspace`
   - Returns stdout with scan results

2. **`semgrepScanHelper(source)`**
   - Container from pinned `semgrep/semgrep` image (e.g., `semgrep/semgrep:1.103.0`)
   - Mount source with excludes
   - Run `semgrep scan --config auto /workspace`
   - Returns stdout with scan results

### 2. Add Java/Gradle functions

Either in `index.ts` directly or a new `java.ts` helper:

1. **`gradleBuildHelper(source)`**
   - Container from pinned Gradle image (e.g., `gradle:8.12-jdk21`)
   - Mount `packages/castle-casters` with excludes: `[".gradle", "build", ".git"]`
   - Run `gradle build`
   - Returns stdout

2. **`gradleTestHelper(source)`**
   - Same container setup
   - Run `gradle test`
   - Returns stdout

### 3. Add LaTeX function

1. **`latexBuildHelper(source)`**
   - Container from pinned texlive image (e.g., `texlive/texlive:TL2024-historic` or `danteev/texlive:latest` pinned)
   - Mount `packages/resume` with excludes
   - Run `latexmk -pdf` or equivalent (check what build tool resume uses)
   - Return the output Directory containing the built PDF

### 4. Add `@func()` wrappers to `index.ts`

```typescript
import { trivyScanHelper, semgrepScanHelper } from "./security"

// Security — default cache, soft_fail in pipeline
@func()
async trivyScan(source: Directory): Promise<string> {
  return trivyScanHelper(source)
}

@func()
async semgrepScan(source: Directory): Promise<string> {
  return semgrepScanHelper(source)
}

// Java — default cache
@func()
async gradleBuild(source: Directory): Promise<string> {
  return gradleBuildHelper(source)
}

@func()
async gradleTest(source: Directory): Promise<string> {
  return gradleTestHelper(source)
}

// LaTeX — default cache
@func()
latexBuild(source: Directory): Directory {
  return latexBuildHelper(source)
}
```

### 5. Verify

```bash
dagger functions  # all new functions listed

# Security scans (may find issues — that's fine, they're informational):
dagger call trivy-scan --source=.
dagger call semgrep-scan --source=.

# Java (check castle-casters actually has Gradle build files first):
dagger call gradle-build --source=.
dagger call gradle-test --source=.

# LaTeX (check resume has LaTeX source first):
dagger call latex-build --source=.
```

## Definition of Done

- [ ] `security.ts` exists with trivy + semgrep helpers
- [ ] Gradle build/test functions compile castle-casters successfully
- [ ] LaTeX build function produces output for resume
- [ ] All container image tags pinned with Renovate comments
- [ ] `dagger functions` lists all new functions without error
- [ ] No `.sync()` — all use `.stdout()` or return Directory
- [ ] Security scans run without crashing (findings are expected)

## Success Criteria

- `trivy-scan` and `semgrep-scan` run and produce human-readable output (findings OK — they're informational)
- `gradle-build` compiles castle-casters without error
- `gradle-test` runs castle-casters tests
- `latex-build` produces a PDF for resume
