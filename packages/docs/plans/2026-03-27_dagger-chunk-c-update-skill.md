# Chunk C: Update dagger-helper Claude Skill

**Wave:** 1 (parallel with R, A, B)
**Agent type:** Code agent (no worktree needed)
**Touches:** `packages/dotfiles/dot_claude/skills/dagger-helper/SKILL.md`, `~/.claude/skills/dagger-helper/SKILL.md`
**Depends on:** Nothing
**Blocks:** Nothing (but informs all future Dagger work)

## Goal

Update the dagger-helper Claude skill with all findings from the research and code audit. When any agent loads this skill in the future, they should have everything they need to write correct Dagger TypeScript code without repeating audit issues.

## Context

Read these before starting:
- `~/.claude/research/dagger-best-practices.md` — audit findings
- Current skill: `packages/dotfiles/dot_claude/skills/dagger-helper/SKILL.md`

## Steps

### 1. Read current skill
Read `packages/dotfiles/dot_claude/skills/dagger-helper/SKILL.md` and `references/release-notes.md`.

### 2. Read research report
Read `~/.claude/research/dagger-best-practices.md` for findings to incorporate.

### 3. Update SKILL.md
Add or update these sections:

**Error Handling Best Practices:**
- Use `.stdout()` as the terminal call — triggers execution AND returns output for debugging
- `.sync()` is only for pass/fail side effects where you don't need output
- Catch `ExecError` explicitly — has `.cmd`, `.exitCode`, `.stdout`, `.stderr` properties
- Since v0.15.0, `ExecError.toString()` no longer includes stdout/stderr — access properties directly
- Never truncate error messages — full stderr is essential for debugging
- `Promise.allSettled` is fine for parallelism, but check results and throw on failures

**Caching Patterns:**
- Layer ordering: copy `package.json` + `bun.lock` → `bun install` → THEN mount source. Source changes won't invalidate install cache.
- Use `SOURCE_EXCLUDES` constant for all `withDirectory` calls: `node_modules`, `.eslintcache`, `dist`, `target`, `.git`, `.vscode`, `.idea`, `coverage`, `build`, `.next`, `.tsbuildinfo`, `__pycache__`, `.DS_Store`, `archive`
- Function caching (v0.19.4+): default 7-day TTL. Use `@func({ cache: "never" })` on deploy/push. Use `@func({ cache: "session" })` on orchestration functions.
- Cache volume names must be stable — never encode versions
- Module source changes invalidate ALL function caches

**CI Environment Variables:**
```bash
export DAGGER_PROGRESS=plain    # no TUI in CI
export DAGGER_NO_NAG=1          # suppress upgrade nags
export DAGGER_NO_UPDATE_CHECK=1 # suppress update checks
# Optional: DAGGER_LOG_STDERR=/tmp/dagger.log
```

**Debugging Workflow:**
- `dagger call -i <func>` — interactive mode, drops into shell on failure
- `.terminal()` — insert explicit breakpoint mid-pipeline
- `--debug` — max verbosity, all internal engine spans
- `-v` / `-vv` / `-vvv` — increasing verbosity tiers
- `--progress=plain` — no TUI, suitable for CI logs

**Anti-Patterns:**
- Floating image tags (`oven/bun:debian`, `swiftlint:latest`) — non-reproducible, pin with Renovate comments
- Source before deps in layer ordering — defeats caching, install runs on every source change
- Error swallowing with `.catch()` → string conversion — CI exits 0 on failure
- Version-keyed cache volume names — cold cache on every version bump
- Missing `.git` in excludes — `.git` changes every commit, invalidates everything
- Calling `curl | bash` without version — gets latest, breaks reproducibility

**Module Organization:**
- `@object()` class MUST stay in `index.ts` — TypeScript SDK constraint
- CAN import helper functions from other files
- Pattern: thin `@func()` wrappers in `index.ts` calling into `release.ts`, `quality.ts`, etc.

### 4. Update release notes
Add v0.20.x notes covering function caching, new error handling, any breaking changes found.

### 5. Remove stale references
- Remove references to `packages/dagger-utils/` (doesn't exist)
- Update any outdated API examples

### 6. Copy to live location
```bash
cp packages/dotfiles/dot_claude/skills/dagger-helper/SKILL.md ~/.claude/skills/dagger-helper/SKILL.md
cp packages/dotfiles/dot_claude/skills/dagger-helper/references/release-notes.md ~/.claude/skills/dagger-helper/references/release-notes.md
```

## Definition of Done

- [ ] Error handling section with `.stdout()` vs `.sync()` guidance and `ExecError` properties
- [ ] Caching section with deps-before-source pattern and function caching annotations
- [ ] CI environment variables section
- [ ] Debugging section with `dagger call -i`, `.terminal()`, `--debug`
- [ ] Anti-patterns section with all 6 patterns listed
- [ ] Module organization section
- [ ] No references to deleted code (`packages/dagger-utils/`)
- [ ] Release notes updated for v0.20.x
- [ ] Live copy at `~/.claude/skills/dagger-helper/` matches dotfiles source

## Success Criteria

Loading the `dagger-helper` skill gives an agent all the knowledge needed to write correct Dagger TypeScript code. The anti-patterns section prevents repeating every issue found in the audit.
