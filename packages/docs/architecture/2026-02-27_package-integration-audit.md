# Package Integration Audit

Integration status of newer packages into monorepo infrastructure. Audited 2026-02-27.

## Packages Audited

- **sentinel** — Autonomous agent system (web dashboard + API)
- **tasks-for-obsidian** — React Native task management app
- **obsidian-headless** — Official Obsidian Headless CLI Docker image (no source package)
- **tasknotes-server** — TaskNotes HTTP API server

## Integration Matrix

| Area                                        | sentinel     | tasks-for-obsidian | obsidian-headless | tasknotes-server |
| ------------------------------------------- | ------------ | ------------------ | ----------------- | ---------------- |
| Workspace member                            | Yes          | No (by design)     | N/A (no source)   | No (by design)   |
| CLAUDE.md                                   | Yes          | Yes                | N/A               | Yes              |
| Package scripts (build/test/lint/typecheck) | Yes          | Yes                | N/A               | Yes              |
| ESLint shared config                        | Yes          | Yes (reactNative)  | N/A               | Yes              |
| tsconfig extends base                       | Yes          | Yes                | N/A               | No (standalone)  |
| Dagger CI                                   | Yes (tier 0) | **Missing**        | Build only        | Yes (tier 0)     |
| Docker/GHCR publish                         | Yes          | N/A (RN app)       | Yes               | Yes              |
| Lefthook pre-commit                         | **Missing**  | **Missing**        | N/A               | **Missing**      |
| Knip unused-code                            | Unclear      | Ignored            | N/A               | **Missing**      |

## Gaps

1. **tasks-for-obsidian has no Dagger CI** — `clauderon/mobile` has `runMobileCi()` as precedent for React Native CI
2. **All 4 packages missing from lefthook pre-commit hooks** — lint/typecheck not triggered on commit
3. **tasknotes-server missing from knip** — no unused-code analysis
4. **tasknotes-server tsconfig doesn't extend shared base** — minor, standalone config works fine

## Well Integrated

- ESLint shared config used by all 4 packages
- All have required package.json scripts (build, test, lint, typecheck)
- sentinel and tasknotes-server have excellent Dagger CI with parallel checks, Docker builds, smoke tests, and GHCR publishing
- obsidian-headless uses the official Obsidian CLI (no custom source code); Dagger builds and publishes the Docker image
- All have comprehensive CLAUDE.md with project-specific instructions
