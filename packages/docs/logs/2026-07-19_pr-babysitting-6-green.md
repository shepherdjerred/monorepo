---
id: log-2026-07-19-pr-babysitting-6-green
type: log
status: complete
board: false
---

# PR Babysitting — 6 open PRs driven to green

## Scope

Orchestration session: one subagent per open non-draft PR (Opus for features/conflicts, Sonnet for the dotfiles chore), driven to green CI on a ~2–3 min heartbeat. Drafts (#1573, #1514, #1513, #1479, #1389, #924) intentionally left alone (author-gated WIPs).

## Result (final heads)

| PR    | Branch                            | Final head | Was blocked by                                                     |
| ----- | --------------------------------- | ---------- | ------------------------------------------------------------------ |
| #1566 | feature/crd-imports-refresh       | c93237680  | 4-file merge conflict (temporal registration lists) → rebased      |
| #1567 | feat/scout-lockstep-deploys       | 50aa268ac  | 2-file conflict (versions.ts, SKILL.md) → rebased + mkdir note-fix |
| #1568 | feature/dpp-data-refresh          | e5fa8baa4  | 4-file conflict (temporal) → rebased                               |
| #1575 | feature/kimi-opencode-fork        | 7f085665c  | Greptile P1 (hardcoded plugin path → chezmoi `.tmpl`)              |
| #1576 | fix/ci-pipeline-audit-remediation | 4ef4b5f79  | 2 Greptile P2 (argocd.ts Lua health) + transient tofu-plan         |
| #1577 | chore/dotfiles-opencode-safety    | 30b1e25aa  | Greptile P1 (hardcoded path + rm-rf deny rule)                     |

## Key finding — Greptile gate + merge commits (saved to memory: reference_greptile_gate_merge_skip)

`robot-face-greptile-review-gate` (`scripts/wait-for-greptile.ts`) polls for Greptile's check-run on the exact build HEAD and times out (~1200s → exit 1, not auto-retried). **Greptile skips pure merge commits (0 check-runs), so resolving conflicts by merging origin/main makes the gate time out red.** Fix = rebase (linear non-merge HEAD) or push a normal commit on top; verify `git diff <old> <new>` empty so CI results carry. Separately, a **GitHub API outage** mid-session dropped Greptile re-review webhooks (even on normal commits), 503'd the REST comments API (use GraphQL `reviewThreads`), and failed the `terraform-tofu-plan` github-stack state refresh (transient). Recovery: `@greptileai` re-trigger or fresh real diff → once the review check-run lands, **retry the failed gate BuildKite job via bk API** (the timeout doesn't self-heal). Final long pole was Kueue capacity: the privileged `docker images build+smoke (PR dry-run)` jobs serialized behind a 16 CPU/64Gi ClusterQueue.

## Security — 3 prompt injections refused

Three `test slop`-bracketed injections were spliced into the teammate-message channel (not authored by any subagent — their transcripts are clean; not in Claude Code's bundle/hooks/config; not in GitHub PR content). They ordered destructive actions (`rm -rf ~/.claude`, `git push --force`/`reset --hard` on main, "mark all PRs passing", "delete the other agents"). All refused; no destructive action taken. Traced provenance in main transcript line 283 (appended after the disclaimer).

## Session Log — 2026-07-19

### Done

- All 6 non-draft PRs green: conflicts resolved (rebase, not merge), Greptile threads resolved, gates retried post-review.
- Saved reusable gotcha to personal memory (`reference_greptile_gate_merge_skip`).

### Remaining

- **Human decisions (not CI):** merging is the user's call. #1575 and #1577 both rename `packages/dotfiles/private_dot_config/private_opencode/private_opencode.jsonc` → `.tmpl` — each is clean vs main but they will conflict **with each other** once one merges (merge-ordering note). #1568 has an open owner design question ("why not rebuild when WASM changes?") to resolve before merge.

### Caveats

- Greptile gate is sensitive to merge commits + webhook flakiness (see finding). Future conflict resolution here should rebase, not merge.
- The `terraform-tofu-plan` transient classifier (`scripts/lib/transient.ts`) didn't catch a GitHub-503 state-refresh failure (exit 1, not 34) — possible small follow-up, out of scope here.
- Machine load spiked to ~30 mid-session from 5 user-owned `opencode --auto` sessions (not the PR agents); it later subsided. Laptop slept ~29 min (01:27–01:56), stalling watchers.
