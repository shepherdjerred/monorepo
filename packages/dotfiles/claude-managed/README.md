# Claude Code — managed settings (`claude-managed/`)

Durable Claude Code configuration that the runtime must **not** be able to
overwrite, split out of the churny user settings file.

## Why this exists

Claude Code rewrites session state — `model`, `effortLevel`, fast mode — straight
back into `~/.claude/settings.json` every time you run `/model` or `/effort`.
When that file was chezmoi-managed, every model switch produced drift and risked
`chezmoi re-add` snapshotting a transient model into the source of truth.

The **managed settings** tier is the one config layer the runtime never writes,
and it sits at the top of the precedence chain:

```
managed (this dir)  >  CLI args  >  project local  >  project  >  user (~/.claude/settings.json)
```

Managed permission rules are also **authoritative**: a `deny` here cannot be
overridden by any lower tier — not even in `bypassPermissions` mode. So the
destructive-command denylist becomes a hard floor rather than a soft default.

## The split

| Config                                                                                  | Lives in                              | Managed by                                                | Rationale                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions.deny` / `ask`                                                              | **managed** (`managed-settings.json`) | this dir + install script                                 | The enforcement policy — un-overridable safety rails. Rules merge across tiers; `deny` always wins.                                                                                                                                                                                                                                                        |
| `env`                                                                                   | **managed** (`managed-settings.json`) | this dir + install script                                 | Plain tool defaults for agent shells: `EDITOR=true`, `PAGER=cat`, and `GIT_CONFIG_GLOBAL` pointing at a curated agent gitconfig (`~/.config/agent/gitconfig`, no delta pager / difftastic external diff, but keeps identity, gh credentials, git-spice settings). Modern tools (bat, eza, fd, nvim) stay on `PATH` as opt-in; nothing here restricts them. |
| `enabledPlugins`                                                                        | **managed** (`managed-settings.json`) | this dir + install script                                 | Declarative plugin set. Managed **replaces** (does not merge) the user list, so `/plugin` UI toggles are intentionally inert — edit `managed-settings.json` + reinstall to change plugins.                                                                                                                                                                 |
| `permissions.defaultMode: bypassPermissions`                                            | user (`~/.claude/settings.json`)      | seeded from `settings.user-reference.json`                | `defaultMode` at managed scope is undocumented, so it's kept user-side; `deny` stays enforced regardless.                                                                                                                                                                                                                                                  |
| Prefs: `editorMode`, `theme`, `skip*`, `alwaysThinkingEnabled`, `agentPushNotifEnabled` | user                                  | seeded from `settings.user-reference.json`                | Personal, not policy; `/config` keeps working normally.                                                                                                                                                                                                                                                                                                    |
| `model`, `effortLevel`, fast mode                                                       | user (churned by the runtime)         | **untracked** — `.chezmoiignore`s `.claude/settings.json` | This is the whole point: these float freely and never pollute chezmoi again.                                                                                                                                                                                                                                                                               |

`~/.claude/settings.json` is intentionally **not** chezmoi-managed (see the
`.claude/settings.json` entry in `packages/dotfiles/.chezmoiignore`).
`settings.user-reference.json` is the versioned seed for a fresh machine and a
backup of the durable user-side keys — refresh it by hand if you change a pref
you want reproduced elsewhere.

**Boilerplate is intentionally omitted.** These files carry only settings that
deviate from Claude Code's defaults. Dropped: `hooks: {}` (already the default)
and `permissions.allow` (a no-op under `bypassPermissions` — the allow list is
never consulted when everything not denied/asked is already permitted).

## Files

- `managed-settings.json` — the authoritative policy (permissions + plugins).
- `settings.user-reference.json` — seed/backup for `~/.claude/settings.json`.
- `install-managed-settings.sh` — validates + installs the policy (needs sudo).

## Install / update the policy

Chezmoi installs the policy automatically on macOS through
`run_onchange_after_install-claude-managed-settings.sh.tmpl`. The hook runs on
the first apply and whenever `managed-settings.json` changes. Because the
destination is system-wide, `chezmoi apply` prompts for administrator access.

To install it directly without Chezmoi:

```bash
cd packages/dotfiles/claude-managed
./install-managed-settings.sh          # validates JSON, sudo-installs to the system path
# restart Claude Code, then run /status to confirm the managed source is active
```

Destination (macOS): `/Library/Application Support/ClaudeCode/managed-settings.json`
(root:wheel, mode 644). To change the policy, edit `managed-settings.json` and
re-run the script.

## New-machine bootstrap

1. `chezmoi apply` (installs the managed policy after prompting for sudo;
   `~/.claude/settings.json` remains ignored).
2. Seed user settings: `cp settings.user-reference.json ~/.claude/settings.json` (then `chmod 600`).
3. Start Claude Code; adjust `model` / `effortLevel` freely — they stay local.

## Recovery

A bad managed policy is fully recoverable — there is no secondary cache for a
local managed file. Claude Code re-reads it at launch:

```bash
sudo rm "/Library/Application Support/ClaudeCode/managed-settings.json"
```

## Precedence & merge reference

<https://code.claude.com/docs/en/settings> · permission-rule precedence:
`deny` → `ask` → `allow`, evaluated across all tiers together (unless
`allowManagedPermissionRulesOnly` is set — it is **not** set here, so user/project
rules still apply alongside these).
