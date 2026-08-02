---
id: log-2026-08-01-pr-fleet-controller-codex-round5-p1s
type: log
status: complete
board: false
---

# PR Fleet Controller — fifth-round Codex P1 fixes (PR #1855)

## Summary

One focused round to resolve the six unresolved blocking Codex findings on
`feat(pr-fleet-controller)` (PR #1855): five P1s plus one P2 that the review gate
also treats as blocking. Each was a real correctness or security issue in the
controller's own logic; all were fixed with production code plus tests.

## Findings fixed

1. **`tools.ts` sandbox setup before executing PR-controlled scripts.**
   `setup_worktree` ran `mise install`, `bun install`, `turbo run generate`, and
   `lefthook install` (all of which execute PR-controlled code) with the
   controller's full environment and no sandbox. Now each runs under a new
   `setupSandboxProfile` via `sandbox-exec` with `setupEnvironment()` — credential
   env vars scrubbed and the operator's global/system git config neutralized
   (`GIT_CONFIG_GLOBAL=/dev/null`). The profile allows network and the system
   toolchain but denies all of `$HOME` (where `~/.aws`, `~/.ssh`, `~/.config/gh`
   live) plus the local password-hash store, re-allowing only the toolchain
   caches, the checkout, the worktree's git dirs, and metadata/listing of the
   worktree's ancestors. The full profile was validated empirically: `git`,
   `bun install`, `mise install`, `turbo run generate`, `lefthook install`, and
   network all succeed under it while every credential path is denied.

2. **`git-operations.ts` select the stack's owning tool before submission.**
   `#submitBranch` unconditionally ran `git-spice branch submit`, which fails or
   mixes tools on a native-stack or fork branch. Added `#stackOwner` (fork →
   native; a `branches/<name>` entry in `refs/spice/data` → git-spice; otherwise
   native) and routed submission: git-spice branches submit via git-spice,
   everything else publishes via a plain-gh `git push --force-with-lease` to the
   existing PR head. `startRestack` now refuses a non-git-spice branch instead of
   corrupting its stack state.

3. **`evidence-parsers.ts` derive soft failures from Buildkite job metadata.**
   Replaced the `/trivy|knip/i` check-name regex with
   `checksWithBuildkiteSoftFailure`, which correlates each check to its Buildkite
   job by the job id embedded in the check URL and reads the authoritative
   `soft_failed` field. This fixes both misclassifications the regex caused: a
   hard Trivy scanner/infra failure is no longer ignored, and a normal Semgrep
   finding (soft, exit 1) no longer dispatches a repair worker. `environment.ts`
   now fetches the full build once and correlates before computing hard failures.

4. **`worktree.ts` preserve local commits when resuming publication.**
   `assignWorktreeBranch` hard-reset a reused branch to the fetched remote head,
   silently deleting a completed fix whose `git commit` succeeded but whose push
   failed. It now detects when the local branch is strictly ahead of the
   unchanged remote head (`merge-base --is-ancestor`) and resets to the local head
   instead, keeping the commit while dropping only uncommitted edits.

5. **`command-policy.ts` require check mode for `cargo fmt` / `tofu fmt`.**
   Both rewrite tracked files by default; validation now requires `--check` /
   `-check`, so a model-controlled command cannot mutate the shared worktree
   outside the explicit publication paths. (Extracted the worker command policy
   from `tools.ts` into `command-policy.ts` to stay under the file-length limit.)

6. **`agents.ts` / `cli.ts` abort and await the master turn on shutdown (P2).**
   `MastraMaster` now threads an abort signal into its streamed turn and exposes
   `stop()`, which aborts and awaits the in-flight turn. `cli.ts` awaits both
   `controller.stop()` and `master.stop()` before closing the terminal, so a
   remote model turn cannot keep emitting output or invoking tools after shutdown.

## Session Log — 2026-08-01

### Done

- Fixed all six unresolved blocking Codex findings on PR #1855 with real code and
  tests. Changed: `src/{tools,git-operations,evidence-parsers,worktree,agents,cli,
environment,schemas,sandbox}.ts`; new `src/command-policy.ts`. New tests:
  `test/{agents,git-operations,worktree}.test.ts`; extended `test/{parsers,
state-and-policy}.test.ts` (35 tests pass, up from 22).
- Verified locally: `typecheck test lint` pass for `@shepherdjerred/pr-fleet-
controller` and `@shepherdjerred/code-review`; `markdownlint` = 0;
  `bun install --frozen-lockfile --dry-run` clean (no `bun.lock` churn).
- Empirically validated the setup sandbox profile end-to-end under `sandbox-exec`.
- Follow-up: fixed a real CI verify failure the scoped filter missed — the new
  package was never migrated by the #1843 TS7-native rollout, failing the root
  `//:compliance-check`. Declared `@typescript/native` as `npm:typescript@7.0.2`
  and switched `typecheck` to `PATH=node_modules/@typescript/native/bin:$PATH tsc`
  in `packages/pr-fleet-controller/package.json` (matching siblings); updated
  `bun.lock`. `bun run compliance-check` now exits 0 and the frozen dry-run is
  clean (commit `3e3b2149f`).

### Remaining

- CI (Buildkite) result for the pushed head is not yet observed (one cycle, no
  polling per the task). Re-run `probe-review-signal.ts 1855` to confirm whether
  Codex converged to zero unresolved findings.

### Caveats

- The setup sandbox is macOS `sandbox-exec` only and was tuned to how the fleet
  worktrees nest inside the checkout (turbo resolves the workspace root to the
  outer checkout, so its cache dirs there are writable). A non-macOS or
  differently-laid-out checkout would need a revisit.
- `startRestack` refuses (fails fast) on a non-git-spice branch rather than
  driving `gh stack` itself; the controller only implements git-spice's
  stack-aware restack. Submission of a non-git-spice branch uses a plain push,
  which is safe for fix-in-place (it does not re-parent the stack).
