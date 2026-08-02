---
id: pr-fleet-controller-sandbox-hardening
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/logs/2026-08-01_pr-fleet-controller-codex-round5-p1s.md
source_marker: false
---

# PR Fleet Controller — setup-sandbox and dispatch hardening

Three blocking Codex P1s from the #1855 review (rounds 6-7) were deferred by an
explicit owner **land-with-todos** decision: the underlying issue is a
design-level tension, not a quick correctness fix, so #1855 lands with the five
already-fixed P1s and these three tracked here for a follow-up.

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

To make `setup_worktree` actually run, the setup sandbox therefore had to re-open
the outer checkout (`file-read*` on `checkoutRoot`) and the shared git directory
(`file-write*` on `gitCommonDir`). Those two re-opens are exactly what findings 2
and 3 below exploit. Each round of tightening the sandbox surfaces the next
nested-worktree leak, so the durable fix is to remove the tension at its source —
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
- [ ] `sandbox.ts` setup writes the shared `.git` — the setup profile grants
      `file-write*` to `gitCommonDir` (the main checkout's shared `.git`), so a
      malicious PR lifecycle/generation script can replace hooks or git config for
      persistence. Narrow the write to `<gitCommonDir>/hooks` only (what
      `lefthook install` needs), or drop `lefthook install` from setup entirely
      (the controller already runs `bunx lefthook run pre-commit` explicitly in
      `publishFix`, so the installed hook is not required for publication).
      (`packages/pr-fleet-controller/src/sandbox.ts` setup write list)
- [ ] `sandbox.ts` setup reads the whole checkout — the setup profile re-allows
      `file-read*` on `checkoutRoot` (needed for turbo's workspace-root hashing),
      but the root `.gitignore` ignores `.env` / `.env.*`, so an untracked `.env`
      present in the operator's main checkout (and absent from the PR worktree) is
      readable and exfiltratable. Deny `.env*` (and other ignored-secret globs)
      reads under `checkoutRoot`, or eliminate the checkout re-open by resolving
      the root-cause worktree-layout tension above.
      (`packages/pr-fleet-controller/src/sandbox.ts` setup read list)

## Comment Log

- 2026-08-02 — Filed per owner **land-with-todos** decision on #1855. The five
  other round-6 P1s (api-key-env scrub, toolchain-store write narrowing,
  `findWorktree` scoping, `rg --pre` rejection, fork fail-fast) were fixed in the
  PR; these three are deferred because findings 2 and 3 are the same
  nested-worktree design tension (see Root Cause) and finding 1 is a pre-existing
  concurrency bug. Disposition `deferred`: not blocked on an operator, but
  intentionally not done in the landing PR.
