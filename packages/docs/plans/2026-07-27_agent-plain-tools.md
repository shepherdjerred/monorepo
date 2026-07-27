---
id: agent-plain-tools
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Plain Tool Defaults for AI Agents (Opt-In Modern Tools)

## Summary

Claude Code, Codex, and OpenCode should get **plain defaults** in their shell
environments. The nicer tools (bat, eza, fd, nvim, delta, difftastic, …) stay
installed and on `PATH` — agents may opt in — but nothing should _force_ or
_default_ them onto agents, because unfamiliar output formats and pagers
confuse them.

## Audit — forcing vectors found

| #   | Vector                                                                  | Source                                                                                              | How it reaches agents                                                                                                          |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `modern-cli-tools` skill pushes eza/bat/fd/sd                           | `packages/dotfiles/dot_agents/skills/modern-cli-tools/SKILL.md` (symlinked into `~/.claude/skills`) | Triggers whenever an agent is "about to use legacy tools (find, grep, ls, cat…)"                                               |
| 2   | `core.pager = delta`, `diff.external = difft`, `interactive.diffFilter` | `private_dot_gitconfig.tmpl`                                                                        | Every `git diff`/`log`; `diff.external` rewrites diff output **even when piped**                                               |
| 3   | `EDITOR=nvim` export                                                    | `config.fish.tmpl`, `dot_bashrc`                                                                    | Confirmed leak: Codex shell snapshots capture the full parent env (`~/.codex/shell_snapshots/*.sh` shows `export EDITOR=nvim`) |
| 4   | `dot_bashrc` exports + aliases                                          | `dot_bashrc`, sourced by `dot_bash_profile` for **all** login shells                                | Any `bash -l` spawned by an agent gets `EDITOR=nvim`, `SHELL=bash`                                                             |
| 5   | fish `abbr`s (ls→eza, cat→bat, …)                                       | `config.fish.tmpl`                                                                                  | **Not a leak** — abbreviations are interactive-only                                                                            |
| 6   | `FZF_DEFAULT_OPTS`, `DFT_*`, `COLORTERM`                                | parent env via snapshots                                                                            | Cosmetic; inert once `diff.external` is disabled — ignored                                                                     |
| 7   | CC's own snapshot shadows find/grep/rg with bundled bfs/ugrep           | `~/.claude/shell-snapshots/`                                                                        | CC-internal design, normalizes _away_ from user tools — left alone                                                             |

Explicitly audited and clean: `~/.agents/AGENTS.md`, monorepo `AGENTS.md`,
Codex `rules/`, cursor config, opencode commands, `dot_zshenv` (zsh
non-interactive reads only this). `RIPGREP_CONFIG_PATH` (ripgreprc:
`--hidden`, excludes `.git`/`node_modules`) — user decision: **keep** for
agents.

Side finding: Codex shell snapshots persist **plaintext API keys/tokens** in
`~/.codex/shell_snapshots/` → follow-up `packages/docs/todos/codex-snapshot-secrets.md`.

## Changes

### Shared env override set

```
GIT_CONFIG_GLOBAL=~/.config/agent/gitconfig   (absolute path in JSON/TOML; $HOME in fish)
GIT_PAGER=cat  PAGER=cat  EDITOR=true  VISUAL=true  GIT_EDITOR=true
```

`~/.config/agent/gitconfig` (new, `packages/dotfiles/dot_config/agent/gitconfig`)
is a curated subset of `~/.gitconfig`: identity, gh credential helper,
git-spice settings, fetch/push/pull behavior — but `pager = cat` and **no**
`diff.external`, so delta and difftastic never fire for agents.

Note: env-based git config injection (`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`)
was tried first and **rejected by experiment** — git cannot unset a key via
env, and an empty `diff.external` is an error (`cannot run : No such file or
directory`), not an unset. `PATH` untouched.

| File                                                                                    | Change                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dotfiles/dot_agents/skills/modern-cli-tools/SKILL.md`                         | Opt-in rewrite: triggers only when user explicitly mentions eza/bat/fd/sd/zoxide; strip agent-directed "use X instead of Y" advocacy.          |
| `packages/dotfiles/claude-managed/managed-settings.json`                                | Add `env` block (managed tier: runtime never writes it, top precedence). Update `README.md` split table. Re-run `install-managed-settings.sh`. |
| `packages/dotfiles/private_dot_codex/private_config.toml` + live `~/.codex/config.toml` | Add env vars to existing `[shell_environment_policy.set]`.                                                                                     |
| `packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl`                    | Extend existing `opencode()` wrapper (already strips API keys) to set the same env vars.                                                       |
| `packages/dotfiles/dot_bashrc`                                                          | `[[ $- == *i* ]] \|\| return` guard at top — stops exports leaking into non-interactive `bash -l`.                                             |
| `packages/docs/todos/codex-snapshot-secrets.md`                                         | Follow-up TODO for plaintext secrets in codex snapshots.                                                                                       |

## Verification

1. Scratch git repo with overrides: `git diff` → plain unified diff;
   `git config core.pager` → `cat`; `git commit` opens no editor. Confirm
   empty `diff.external` actually disables difft.
2. `claude -p` (fresh process — managed settings load at launch):
   `echo $EDITOR` → `true`; `git config core.pager` → `cat`;
   `command -v bat eza rg` → all resolve (opt-in intact).
3. `codex exec` same probes. Known risk: codex snapshots re-export the full
   login env and may be sourced after policy vars — iterate if `$EDITOR`
   still shows `nvim`.
4. `opencode run` via fish wrapper: same probes.
5. `bash -lc 'echo $EDITOR'` → empty (bashrc guard works).

## Process

- Worktree `.claude/worktrees/agent-plain-tools`, branch `feature/agent-plain-tools`, draft PR via git-spice.
- Live copies updated in the same pass: managed-settings install (sudo), `chezmoi apply` for fish, live `~/.codex/config.toml`.
- Caveat: managed-settings install needs sudo + CC restart; existing sessions keep old env.

## Human Verification

1. Run `packages/dotfiles/claude-managed/install-managed-settings.sh` (needs sudo) to install the managed policy including the new `env` block, then restart Claude Code; `/status` shows the managed source.
2. In a fresh CC session: `git diff` in any repo shows plain unified diff (no difftastic), `git config core.pager` → `cat`, `git config diff.external` is empty, and `bat`/`eza`/`nvim` still resolve on `PATH` (opt-in intact). If the weekly quota is still exhausted (resets Jul 29 5pm PT), run this after the reset.

## Session Log — 2026-07-27

### Done

- Audited every forcing vector (skill triggers, gitconfig pager/external-diff, exported `EDITOR`, shell rc leaks, CC/Codex shell snapshots, fish abbrs) — findings in the audit table above.
- Experiment-driven design change: env-based git config injection (`GIT_CONFIG_KEY_n`) **cannot unset** `diff.external` (empty value → `error: cannot run : No such file or directory`), so the design moved to a curated `~/.config/agent/gitconfig` + `GIT_CONFIG_GLOBAL`.
- `packages/dotfiles/dot_agents/skills/modern-cli-tools/SKILL.md` — rewritten to opt-in (loads only when the user names the tools); "ALWAYS prefer modern tools" section removed.
- `packages/dotfiles/claude-managed/managed-settings.json` + `README.md` — `env` block added to the managed tier.
- `packages/dotfiles/private_dot_codex/private_config.toml` **and live `~/.codex/config.toml`** — env vars in `[shell_environment_policy.set]`.
- `packages/dotfiles/private_dot_config/private_fish/config.fish.tmpl` — `opencode()` wrapper extended with the same env (applied live via `chezmoi apply`).
- `packages/dotfiles/dot_bashrc` — `[[ $- == *i* ]] || return 0` guard (applied live); verified non-interactive `bash -l` no longer exports `EDITOR=nvim`/aliases while PATH setup still runs.
- `packages/dotfiles/private_dot_config/agent/gitconfig` — new curated gitconfig (applied live).
- `packages/docs/todos/codex-snapshot-secrets.md` — follow-up for plaintext secrets in codex snapshots.
- Verified end-to-end: scratch-repo git (plain diff with agent gitconfig vs difft without; identity/credentials/spice intact), **Codex** `codex exec` probe (`EDITOR=true`, `core.pager=cat`, empty `diff.external`, nice tools still resolvable), **OpenCode** `opencode run` probe (same results), bashrc guard both directions.
- Commit `077d01ebd` (+ restack), draft PR: <https://github.com/shepherdjerred/monorepo/pull/1734>

### Remaining

- User runs the managed-settings installer (sudo; denied to agents) + restarts CC — the CC `env` block is inert until then. Note the managed policy was **not installed at all** on this machine before this change.
- `claude -p` verification probe — blocked by weekly quota (resets Jul 29 5pm PT); codex/opencode probes passed with identical config.
- After merge: `git-spice repo sync`, remove worktree, `chezmoi apply` from the main-checkout source to re-anchor live files to main.

### Caveats

- The pre-existing fish wrapper runs `(command -s opencode) --auto $argv`, which puts `--auto` **before** subcommands — `opencode run "..."` from fish prints usage instead of running. Pre-existing; not changed in this PR.
- OpenCode launches that bypass fish (Raycast, scripts, desktop) don't get the env overrides — accepted tradeoff (fish-only coverage).
- `RIPGREP_CONFIG_PATH` (ripgreprc: `--hidden`, excludes `.git`/`node_modules`) intentionally kept for agents per user decision.
- Codex snapshots re-export the login env, but `shell_environment_policy.set` was verified to win over them.
