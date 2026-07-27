---
id: agent-plain-tools
type: plan
status: in-progress
board: true
verification: agent
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

## Remaining

- [ ] User: run `packages/dotfiles/claude-managed/install-managed-settings.sh` (needs sudo) to install the managed policy including the new `env` block, then restart Claude Code
- [ ] After install (and weekly-quota reset Jul 29): run the `claude -p` probe — expect `EDITOR=true`, `core.pager=cat`, empty `diff.external`, plain `git diff`, and `bat`/`eza`/`nvim` still on `PATH`
