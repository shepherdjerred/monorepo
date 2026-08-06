---
id: pr-fleet-worktree-reuse-edit-tools-2026-08-03
type: plan
status: in-progress
board: false
---

# PR fleet controller — make workers able to make progress

A `bun run pr:fleet --model openai/gpt-5.6-luna` run stalled at
`open=5 green=1 active=0 paused=4` with no work advancing. Post-mortem of the
run bundle
(`~/.local/state/pr-fleet-controller/2026-08-03T23-23-53.638Z-410b59ec-…`)
found two independent root causes, both fleet-side (the model is Sonnet/Opus
class, so tool brittleness — not model capability — is the fault).

## Root cause 1 — worktree/branch conflict pauses workable PRs

PR #1981 (`feature/dpp-save-goals`) and #1983 (`feature/promote-beta-prod`)
paused immediately:

```
git worktree add …/stack-pr-1981 feature/dpp-save-goals failed (128):
fatal: 'feature/dpp-save-goals' is already used by worktree at '…/dpp-save-goals'
```

Both branches are already checked out in the operator's own worktrees. Git
forbids the same branch in two worktrees, so `provisionWorktree`
(`worktree.ts:245`) fails and the PR parks for the whole run. Both branches are
**native/unstacked** (not git-spice) and both operator worktrees are **clean**.

**Fix (operator chose "reuse operator worktree in place"):** let the fleet reuse
the operator's existing worktree for that branch rather than provisioning a
second one.

- `WorktreeManager.findWorktree` today filters to fleet-owned paths via
  `#isFleetWorktree` so a `reset --hard` cannot clobber operator edits. Relax it
  to also return a non-fleet worktree that has the branch checked out.
- Add a safety guard in `assignWorktreeBranch`: when the worktree is **not**
  fleet-owned **and** dirty, throw (→ clean pause with an actionable message)
  rather than `reset --hard`-ing the operator's uncommitted work. Clean operator
  worktrees are reused in place; the worker's commit publishes via the existing
  native force-push path (`git-operations.ts:283`).

## Root cause 2 — brittle `apply_patch` burns the whole cycle

For #1655 the worker issued 24 `apply_patch` calls, almost all rejected:

- `"Patch has no explicit repository paths"` (17× across #1655 + #1389) —
  `tools.ts:238-247` requires patch header lines to start with **exactly**
  `--- a/` / `+++ b/` and `.slice(6)`. A valid unified diff without `a/`/`b/`
  prefixes yields zero paths and is rejected.
- `"corrupt patch at <stdin>:15"` — `git apply --whitespace=error-all`
  (`tools.ts:253`) rejects on whitespace nits and slightly-off hunk counts.

A capable model produces correct-but-differently-formatted patches, gets
rejected, exhausts `maxSteps: 20`, and never emits a final result.

**Fix (operator chose "add an Edit-style tool"):** add reliable edit tools that
don't depend on hand-crafted unified-diff formatting.

- `str_replace` — `{ path, old_string, new_string, replace_all? }`. Reads the
  contained file, requires `old_string` to occur (uniquely unless
  `replace_all`), replaces, writes back.
- `write_file` — `{ path, content }`. Writes a full file (create or overwrite)
  within the worktree.
- Both gated on the stack-write lease exactly like `apply_patch`, both routed
  through `containedPath`. `apply_patch` stays as a fallback.
- Steer `WORKER_INSTRUCTIONS` toward the edit tools.

## Root cause 2b — cryptic crash when the model emits no structured result

When `apply_patch` thrashing consumes every step, `agent.generate` returns with
`result.object === undefined`, and `WorkerResultSchema.parse(undefined)`
(`agents.ts:171`) throws a raw Zod v4 `ZodError` whose `.message` is a JSON
issues array — surfaced to the operator as the unreadable
`expected object, received undefined` dump.

**Fix:** detect `undefined`/non-object before parsing and throw a clear,
actionable error including the model's final text, so the failure is legible.

## Verification

- `bunx turbo run typecheck test lint --filter=pr-fleet-controller`
- Unit coverage for: reuse of a clean non-fleet worktree; refusal on a dirty
  non-fleet worktree; `str_replace` unique/replace-all/miss; `write_file`
  create+overwrite + path containment; empty-structured-output error message.

## Workflow

- Worktree + draft PR via gh-stack (new work).
- Operator's current uncommitted `environment.ts` / `evidence-parsers.ts` /
  `worktree.ts` changes are related robustness fixes and the `worktree.ts` edits
  layer on them, so they are carried into the worktree as the base commit and
  noted in the PR. They remain untouched in the main checkout.
