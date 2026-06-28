# Make agents actually create worktrees: reword AGENTS.md + SessionStart nudge

## Status

Complete — shipped (.claude/hooks/worktree-reminder.sh + Codex wiring).

## Context

Agents (Claude Code **and** Codex) routinely skip the monorepo's "use a git worktree" rule. Root causes, confirmed by reading the instruction surfaces and both CLI binaries:

1. **Unenforced** — the rule is pure prose; no hook, lefthook job, or CI check gates on the working directory (contrast: Dagger hygiene _is_ enforced via `scripts/check-dagger-hygiene.ts`).
2. **Conditional + self-judged trigger** — "_When starting parallel feature work … or running multiple agents concurrently_" lets a single agent on a single task conclude "doesn't apply to me."
3. **Broad escape hatch** — "_Trivial single-file edits don't need a worktree_"; agents under-estimate scope at t=0 and rationalize into the exception.
4. **Low salience + wrong ordering** — the rule sat ~line 230 of a ~352-line doc and never said "do this _before_ your first edit."

We deliberately chose a **nudge, not a hard block** (the repo _wants_ trivial edits to stay in main, so a blanket `PreToolUse` deny would fight the intended workflow). The fix targets the two cheapest, highest-leverage causes: **wording** and **salience** (a `SessionStart` reminder that fires in both tools).

Hard-enforcement escalation, documented but intentionally **not built**: `PreToolUse`-deny on Claude's `ExitPlanMode` (the planning→implementation boundary) and on Codex's `apply_patch` (first edit) — both tools support `permissionDecision: "deny"`.

## What shipped

| File                                           | Change                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (`CLAUDE.md` symlinks to it)       | Reworded the worktree section: imperative bright-line with **observable** triggers (PR-bound / >1 file / multi-step), explicit "before your first edit" ordering, narrowed escape hatch, plus `claude -w` / `codex -C` launch tips                                                                                                              |
| `.claude/hooks/worktree-reminder.sh` (new, +x) | Shared SessionStart hook. Silent unless cwd is the **main checkout** (detects a linked worktree via git-dir ≠ common-dir, mirroring `trust-mise.sh`). Skips `resume`/`compact`. Claude path prints plain stdout (injected as context); `--tool=codex` emits a `hookSpecificOutput.additionalContext` JSON envelope. Always `exit 0` (fail-open) |
| `.claude/settings.json`                        | Added a third `SessionStart` command hook (alongside `trust-mise.sh` / `install-git-hooks.sh`)                                                                                                                                                                                                                                                  |
| `.codex/config.toml` (new)                     | Minimal, hooks-only project layer: inline `[[hooks.SessionStart]]` → command handler running the shared script with `--tool=codex`                                                                                                                                                                                                              |

### Codex specifics (verified against docs + installed binary)

- Codex 0.139.0 `features list` → `hooks` is **stable + enabled by default** (no feature flag needed). `codex doctor` loads clean. The older startup-crash (#19199, 0.124.0) and repo-local-not-firing (#17532) bugs predate this version.
- Config format (per https://developers.openai.com/codex/config-advanced): event-keyed `{matcher, hooks:[{type,command,timeout,statusMessage}]}`, Claude-compatible. Codex auto-discovers `.codex/hooks.json` **or** an inline `[hooks]` table — having **both in one layer triggers a warning**, so we use a single inline `[hooks]` table in `.codex/config.toml`.
- Project-local hooks load only when the `.codex/` layer is **trusted** (Codex prompts once per machine).
- Codex's `external_agent_config` is a one-time **migration prompt** (detects Claude's `settings.json`/`hooks.json`/`CLAUDE.md`), **not** a live import — so a separate Codex hook is required.

## Caveats / honest limits

- **Nudge, not enforcement.** Raises salience; an agent can still ignore it. Strictly better than buried prose; does not _guarantee_ worktrees.
- **SessionStart fires before the task is known**, so the reminder is generic and persists for the session. A per-task `UserPromptSubmit` hook (both tools have it) is the future option if needed.
- **Codex live-firing** was validated only via config load (`codex doctor`) + format docs, not an end-to-end interactive run; first run will surface the one-time `.codex/` trust prompt.
- **No chezmoi sync** — all files are monorepo-committed, not `~/` dotfiles.

## Verification

1. **Script unit check:** run `worktree-reminder.sh` with a startup payload from (a) the main checkout → reminder; (b) inside `.claude/worktrees/<x>` → silent. Both `--tool` paths produce valid output (JSON validated with `jq`).
2. **Config validity:** `.claude/settings.json` parses as JSON; `.codex/config.toml` parses as TOML and `codex doctor` loads it clean.
3. **Claude Code (manual):** fresh session in the main checkout → reminder lands in context; session inside a worktree → silent.
4. **Codex (manual):** `codex` in the monorepo (accept the `.codex/` trust prompt) → SessionStart reminder; silent inside a worktree.

## Session Log — 2026-06-13

### Done

- Diagnosed why agents skip worktrees (unenforced + conditional + escape hatch + low salience); verified hook surfaces directly from the `claude` (2.1.176) and `codex` (0.139.0) binaries.
- Reworded `AGENTS.md` worktree section; added shared `.claude/hooks/worktree-reminder.sh`; wired it into `.claude/settings.json` (Claude) and a new `.codex/config.toml` (Codex).
- Worked in worktree `feature/worktree-nudge` (dogfooding the rule) rather than the user's dirty main checkout.

### Remaining

- Manual end-to-end confirmation of both hooks firing in real Claude Code / Codex sessions.
- Open PR (not yet requested). Commit pending user go-ahead.

### Caveats

- Nudge-only by design; hard enforcement deferred (documented above).
- Codex hook firing verified by config-load + docs, not a live interactive session.
