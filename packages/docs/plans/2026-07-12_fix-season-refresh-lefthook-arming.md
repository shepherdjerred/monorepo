---
id: plan-2026-07-12-fix-season-refresh-lefthook-arming
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Fix `scout-season-refresh-weekly`'s lefthook-arming failure

## Context

While verifying PR #1503 (the data-dragon shared-cache fix), I manually triggered the other two weekly workflows to check their health. `readme-refresh-weekly` passed and opened a real PR (#1506). `scout-season-refresh-weekly` **failed** — a genuinely new, currently-live production bug, unrelated to #1503's scope.

**Root cause chain (confirmed via 2 Explore agents + reading the actual source):**

1. `scout-season-refresh.ts`'s `run()` invokes an agentic `claude -p` session (`runClaude()`) to edit League of Legends season data — **before** `rootInstallWithoutHooks()` ever runs.
2. That Claude session has **unrestricted `Bash` + `Edit` access** (`scout-season-refresh-claude.ts:18`: `ALLOWED_TOOLS = "WebFetch,WebSearch,Read,Edit,Bash,Glob,Grep"`), unlike e.g. `homelab-audit.ts` which restricts Bash to no file-editing tools.
3. Its prompt instructs it to verify by running `bun test src/seasons.test.ts` (`scout-season-refresh-prompt.ts:65-67`).
4. `packages/scout-for-lol/CLAUDE.md:26` documents, correctly for a human dev checkout: _"after editing a shared package, run `bun install` at `packages/scout-for-lol/` to re-copy stale deps."_ An agentic Claude session reading this and hitting a stale-module test failure has every reason to follow that advice and run a **plain** `bun install` — which, if run at the repo root (or Claude generalizes/misremembers the scoped path), fires the root `prepare` script (`lefthook install`) and arms `.git/hooks/pre-commit` in that ephemeral clone.
5. `rootInstallWithoutHooks()` runs later (as designed) with `--ignore-scripts` — but this only prevents **its own** call from arming hooks. It does not un-arm hooks a prior, uncontrolled subprocess already installed.
6. The bot-style `git commit` in `openSeasonRefreshPr()` (`scout-season-refresh-git.ts:134`) then triggers the real armed pre-commit hook, which fails (`gitleaks: not found`, exit 127; then a `scout-for-lol-typecheck` step erroring on `prettier-plugin-astro`) — this is the exact production failure I observed (workflow `scout-season-refresh-weekly-workflow-2026-07-12T19:17:15Z`, `Command failed (git): exit 1`).

**`readme-refresh.ts` shares the same `openSeasonRefreshPr()` commit call site** and has a lower-probability latent version of the same risk (it runs `codex exec` for new-package summaries, which also has shell access) — currently masked because steady-state runs use cached `_summary.md` and skip Codex entirely. **`data-dragon.ts` is safe** — no agentic session runs before its own `git commit`.

**The existing CI safety net didn't catch this class of regression.** `rehearse-bot-clone.ts`'s `rehearseHookFreeCommit` canary tested `rootInstallWithoutHooks` in isolation — it never simulated something arming hooks _between_ the pre-install and the final commit, so it stayed green through this exact failure mode.

**Why the fix is structural, not prompt-tuning:** Claude's tool use is inherently non-deterministic — we can't reliably guarantee it never runs a plain `bun install` by editing its prompt, and restricting its tools isn't viable here (`Bash` and `Edit` are both required for its actual task: editing season files and verifying with `bun test`). The fix extends the same principle `rootInstallWithoutHooks` already embodies — "an ephemeral bot clone's commit must never run dev hooks" — to cover the one path it previously missed.

## Fix — disarm hooks immediately before every bot-style commit

Added `disarmGitHooks(repoDir)` to `packages/temporal/src/activities/bot-clone.ts`: `find .git/hooks -type f ! -name "*.sample" -delete`, wiping any hook files armed by anything, regardless of mechanism. Call sites:

- `packages/temporal/src/activities/scout-season-refresh-git.ts`'s `openSeasonRefreshPr()`, immediately before the `git commit` — covers both `scout-season-refresh-weekly` and `readme-refresh-weekly` (shared helper).
- `packages/temporal/src/activities/data-dragon.ts`, immediately before its own `git commit` — defense-in-depth/consistency, not currently at risk.

## CI coverage — extended the rehearsal canary

Extended `rehearseHookFreeCommit` in `packages/temporal/scripts/rehearse-bot-clone.ts` to simulate the exact regression: after `rootInstallWithoutHooks` confirms hooks are NOT armed, deliberately run a **plain** `bun install` (no `--ignore-scripts`) to simulate what an agentic session did, confirm hooks ARE now armed, call `disarmGitHooks`, confirm they're gone, then proceed with the existing bot-style commit + lefthook-didn't-run assertion.

## Prompt hardening (nice-to-have, not load-bearing)

Added a line to `scout-season-refresh-prompt.ts`'s prompt instructing Claude to always pass `--ignore-scripts` if it needs to run `bun install` in this ephemeral CI clone. Cheap defense-in-depth; the structural fix above is what actually guarantees correctness.

## Human Verification

- `cd packages/temporal && bun run typecheck && bun test` — pass (same 3 pre-existing `localhost:7233` integration-test failures as before, unrelated).
- `bunx eslint` on all 5 touched files — 0 errors (pre-existing duplication warnings only).
- Ran the extended rehearsal against a genuinely clean clone (not the dev worktree, which already has hooks armed from `scripts/setup.ts`). First run gave a **false-positive** failure: the clone's checked-out branch name (`fix/season-refresh-lefthook-arming`, inherited from this session's own feature branch) contains the substring "lefthook", which git's normal commit summary line echoes back, coincidentally matching the existing `/lefthook/i.test(commitOutput)` regex check — not an actual hook run (no lefthook banner/tier-1/tier-2 output in the log, unlike the real production failure trace). Re-ran on a differently-named branch (`rehearsal-verify`) and confirmed clean: hooks armed by the simulated plain install → `disarmGitHooks` removes them → bot-style commit succeeds with zero lefthook output. `cog` canary still fails locally only because that binary isn't installed on this Mac (same pre-existing environment gap as PR #1503's verification).
- Not yet done: real production confirmation (manually re-trigger `scout-season-refresh-weekly` via the Temporal UI / `kubectl exec` after merge and deploy).

## Files touched

- `packages/temporal/src/activities/bot-clone.ts` (add `disarmGitHooks`)
- `packages/temporal/src/activities/scout-season-refresh-git.ts` (call it before commit — covers season-refresh + readme-refresh)
- `packages/temporal/src/activities/data-dragon.ts` (call it before its own commit, defense-in-depth)
- `packages/temporal/scripts/rehearse-bot-clone.ts` (extend `rehearseHookFreeCommit` to simulate + prove the fix)
- `packages/temporal/src/activities/scout-season-refresh-prompt.ts` (prompt hardening line)

## Session Log — 2026-07-12

### Done

- Diagnosed a new, live production failure in `scout-season-refresh-weekly` (triggered manually this session while checking on the other weekly workflows) via 2 Explore agents + reading the actual source: Claude's agentic session (unrestricted Bash+Edit) can run a plain `bun install` on its own initiative, arming lefthook hooks that `rootInstallWithoutHooks` alone can't undo.
- Implemented `disarmGitHooks` in `bot-clone.ts`, wired into both shared-commit call sites.
- Extended the `rehearse-bot-clone.ts` rehearsal canary to simulate and prove the exact regression class.
- Added a prompt-hardening line as cheap defense-in-depth.
- Verified: typecheck, tests, lint all pass; extended rehearsal canary passes end-to-end against a genuinely clean clone (after working around a branch-naming false positive in my own test methodology).
- Work done in worktree `.claude/worktrees/fix-season-refresh-hooks` on branch `fix/season-refresh-lefthook-arming`, off `origin/main` (predates PR #1503's merge, so this branch doesn't yet include that fix — expected, since #1503 hasn't merged).

### Remaining

- Not yet committed or opened as a PR — user has not asked for that yet in this sub-task.
- Real end-to-end proof is manually re-triggering `scout-season-refresh-weekly` after this merges and deploys.

### Caveats

- This worktree/branch is based on `origin/main`, which does NOT include PR #1503 (data-dragon shared-cache fix) — the two PRs are independent and can merge in either order; neither touches the other's files.
- Testing rehearsal canaries against a clone whose branch name happens to contain a keyword the canary regex-matches on (here: "lefthook") produces a false-positive failure. Use a neutral branch name when locally verifying hook-related canaries.
