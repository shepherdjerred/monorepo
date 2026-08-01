---
id: log-pr-fleet-controller-claude-code-prompt-2026-07-30
type: log
status: in-progress
board: false
---

# PR Fleet Controller — Claude Code Prompt Refinement

Refined the PR fleet controller prompt to be Claude Code-specific, building on
the 2026-07-29 prompt review (which was Codex-focused). Prompt design only; no
controller, subagent, or CI action was executed.

Key changes from the draft:

- Removed the Codex branch entirely; the prompt now targets Claude Code's
  Agent / SendMessage / TaskStop / ScheduleWakeup tools by name.
- Framed the prompt as a `/loop` dynamic payload: subagent completions
  re-invoke the controller automatically, so the ScheduleWakeup timer is a
  CI-churn poll and fallback heartbeat, not the primary driver.
- Fleet state persists to a JSON file in the scratchpad each tick so context
  compaction cannot lose the PR→agent map.
- Fixed the merge-conflict truth check: `git merge-tree --write-tree
origin/main <head>` (exit 1 = conflict), replacing the incorrect
  `merge-base --is-ancestor` ancestry test (detects behind-ness, not
  conflicts) — same defect the 2026-07-29 review flagged.
- Stagger rule made concrete: at most 2 new worker spawns per tick, because
  bun's isolated linker has a parallel-install race (pkg-check EEXIST flake).
- Workers must load `git-spice-helper` before branch ops, and carry the known
  worktree gotchas: stale-trunk restack workaround, silent Bash cwd reset,
  unpiped commits, no `--no-verify`.
- Added known-benign/known-red cases: review-gate hang on fast-forward push of
  a clean PR (`bun scripts/probe-review-signal.ts <PR>`), gate "fail" on a
  merged PR (merge cancels the build), helm-types-drift regen, talos/kube
  notify-only pins.

## Five-subagent review (v2)

Fanned out 5 reviewers (harness fact-check via claude-code-guide, Claude Code
purity, repo-truth, control-flow logic, worker-prompt) over the v1 draft.
Consolidated v2 applies:

- **Repo-truth corrections:** `helm-types-drift-check` no longer exists as a
  standalone Buildkite step — the drift regen runs inside `pr-dryrun`
  (`:microscope: pr dry-run (deploy paths + drift)`); root CLAUDE.md still uses
  the stale name. Soft-fail steps are Trivy + Semgrep only — **Knip is required**
  (inside the `verify` graph), so "ignore Knip" was harmful. The two required
  GitHub contexts are `buildkite/monorepo/pr` and `ci/merge-conflict`
  (Temporal-posted).
- **Control-flow P0s:** tick overlap guard (tickInProgress + TaskList as
  liveness truth, persist spawns immediately); per-PR respawn ceiling (3
  attempts → synthetic escalation); three-state worker lifecycle
  (live/returned/stopped) with redispatch-via-SendMessage distinct from prods;
  progress redefined (new SHA with pending checks or redCount drop; bare rebase
  SHA churn is not progress; never prod a worker <8 min active or mid-build).
- **Worker blockers:** unified single-object return contract with a defined
  `state` enum (escalation is a field, not a separate string shape);
  deterministic reuse-or-create worktree at `.claude/worktrees/pr-<n>` (kill →
  respawn previously infinite-looped on `worktree add` failing);
  `reset --hard origin/<branch>` before edits; health-check-before-setup early
  exit; branch-type detection (git-spice stack vs Renovate plain rebase vs fork
  → blocked); no-commit path (`ci_retried_no_commit`); explicit on-resume
  behavior; workers write no session logs; path guard uses trailing slash
  (pr-1 vs pr-12).
- **Rejected finding:** harness reviewer claimed the Agent tool `model` param
  needs full model IDs — false; the tool schema takes the shorthand enum
  (sonnet/opus/haiku/fable).

Final prompt: scratchpad `pr-fleet-controller-prompt.md` (session
e7ca717e), reproduced in the chat transcript.

## Session Log — 2026-07-30

### Done

- Refined the PR fleet controller prompt to Claude Code-only (v1), verified
  `toolkit pr health --json` and `bk build view` against the live repo.
- Ran a 5-subagent review panel and consolidated all confirmed findings into
  v2 (summarized above).

### Remaining

- User to dry-run the v2 prompt via `/loop` and confirm the first tick
  enumerates, spawns ≤2 workers, and reschedules correctly.
- Consider fixing the stale `helm-types-drift-check` step name in root
  CLAUDE.md (separate change; not done this session).

### Caveats

- "The gate skips merge commits" is history/memory-derived; the repo-truth
  reviewer confirmed the gate step and headPushedAt mechanism but did not
  pinpoint a merge-commit-skip code branch.
- The prompt lives in session scratchpad only; it is not stored in the repo.
