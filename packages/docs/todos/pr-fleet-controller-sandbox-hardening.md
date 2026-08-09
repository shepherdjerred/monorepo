---
id: pr-fleet-controller-sandbox-hardening
type: todo
status: planned
board: true
verification: agent
disposition: active
source_marker: false
---

# PR Fleet Controller — setup-sandbox and dispatch hardening

Six blocking Codex P1s from the #1855 review (rounds 6-7) were deferred by an
explicit owner **land-with-todos** decision covering the full controller-
hardening scope: the underlying issues are design-level / robustness follow-ups,
not blockers for landing, so #1855 lands with the five already-fixed P1s and
these six tracked here. The first three are the nested-worktree sandbox tension
(see Root Cause); the last three are additional controller/CLI robustness
findings (heartbeat re-arm, EOF shutdown, native-stack restack).

## Root Cause

The fleet controller provisions its worktrees INSIDE the main checkout
(`<checkout>/.claude/worktrees/pr-fleet/stack-<id>`). Because those worktrees are
nested, the setup toolchain does not stay confined to a single worktree:

- `turbo` resolves the workspace root to the OUTER checkout (that is where the
  root `turbo.json` / lockfile live and where its cache is), so `turbo run
generate` must read the whole checkout tree to hash inputs and run tasks.
- `lefthook install` and every `git` invocation write/read the shared git store
  (`<checkout>/.git`), since a linked worktree's git directory lives there rather
  than inside the worktree.

The original `setup_worktree` implementation re-opened
the outer checkout (`file-read*` on `checkoutRoot`) and the shared git directory
(`file-write*` on `gitCommonDir`). Both created sandbox escape surfaces. Hook
installation has since been removed, so setup no
longer writes shared Git metadata; the broad checkout read remains. The durable
fix for that remaining tension is to remove it at its source —
either lay the fleet worktrees OUTSIDE the checkout (a sibling directory, so the
worktree is the workspace root and turbo/lefthook stay confined), or scope
turbo/lefthook explicitly to the worktree (e.g. run `turbo` with an explicit
worktree-local root/cache and drop or relocate `lefthook install`) so the sandbox
can return to a strict worktree-only allowlist.

Finding 1 is an independent, pre-existing dispatch concurrency bug (not caused by
the sandbox work) that was surfaced in the same review.

## Remaining

- [ ] `controller.ts` dispatch race — a heartbeat tick that is awaiting worktree
      provisioning/assignment can start a model worker AFTER `pause_pr` or `/stop`
      ran (they return without aborting because `activeWorkers` is not yet
      populated), so a paused or stopped PR's worker can still edit or publish.
      Re-check pause/stop (and `store.stopping`) immediately before dispatch, or
      register the abort controller before the awaited provisioning so pause/stop
      can cancel it. (`packages/pr-fleet-controller/src/controller.ts` ~L237)
- [ ] `sandbox.ts` setup reads the whole checkout — the setup profile re-allows
      `file-read*` on `checkoutRoot` (needed for turbo's workspace-root hashing),
      but the root `.gitignore` ignores `.env` / `.env.*`, so an untracked `.env`
      present in the operator's main checkout (and absent from the PR worktree) is
      readable and exfiltratable. Deny `.env*` (and other ignored-secret globs)
      reads under `checkoutRoot`, or eliminate the checkout re-open by resolving
      the root-cause worktree-layout tension above.
      (`packages/pr-fleet-controller/src/sandbox.ts` setup read list)
- [ ] **[capability gap]** `git-operations.ts` cannot restack a native-stack
      branch — a native (gh-stack) PR with a merge conflict is classified to the
      conflict-worker path, but `startRestack` rejects it (`owner !== "git-spice"`)
      and the worker has no other rebase op, so the fleet can only pause it and
      can never drive a conflicted native-stack PR green. Route this path through
      the owning tool (`gh stack rebase` / `--continue`). Requires live
      native-stack PRs to validate end-to-end.
      (`packages/pr-fleet-controller/src/git-operations.ts` ~L93)

## Comment Log

- 2026-08-02 — Filed per owner **land-with-todos** decision on #1855. The five
  other round-6 P1s (api-key-env scrub, toolchain-store write narrowing,
  `findWorktree` scoping, `rg --pre` rejection, fork fail-fast) were fixed in the
  PR; these three are deferred because findings 2 and 3 are the same
  nested-worktree design tension (see Root Cause) and finding 1 is a pre-existing
  concurrency bug. Disposition `deferred`: not blocked on an operator, but
  intentionally not done in the landing PR.
- 2026-08-02 — Owner extended the land-with-todos decision to cover the full
  controller-hardening scope after a later review round surfaced three more P1s
  (heartbeat re-arm, EOF shutdown, native-stack restack). Added them to
  `## Remaining` above rather than grind another fix round on #1855. The two
  `[priority — real correctness]` items (heartbeat, EOF) are small, testable
  fixes worth doing first; the `[capability gap]` item (native-stack restack)
  needs `gh stack` routing and live native-stack PRs to validate.
- 2026-08-08 — Removed `lefthook install` from worker setup and removed shared
  Git metadata writes from the setup sandbox. Mise now checks the pinned tools
  without installing them and writes cache/state/shims only to invocation-owned
  temporary directories. Verified the previously implemented heartbeat re-arm
  and terminal-EOF shutdown paths with their focused regression tests. The
  dispatch race, broad outer-checkout read, and native-stack restack remain.
