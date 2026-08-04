---
name: zellij-helper
description: Current Zellij session, pane, tab, layout, KDL, CLI automation, plugin, resurrection, and web-client guidance. Use when configuring Zellij, scripting sessions, building layouts/plugins, or diagnosing Zellij CLI behavior.
---

# Zellij Helper

Use layouts for declarative session structure and explicit session-targeted CLI actions for automation. Keep CLI subcommands separate from KDL keybinding actions, and treat resurrection, web access, plugins, and screen dumps as security boundaries.

## Current baseline

Verified against Zellij 0.44.3 on 2026-08-03:

```bash
zellij --version
```

Zellij 0.44 added native Windows support, Layout Manager, remote HTTPS attachment, read-only sharing tokens, richer automation and subscription APIs, and a new Wasm runtime. 0.44.1 added layout strings and more pane targeting; 0.44.2 added automatic light/dark themes; 0.44.3 fixed host-query forwarding regressions.

Read [references/releases.md](references/releases.md) for the 57-page research ledger. Read [references/cli-and-layouts.md](references/cli-and-layouts.md) for current CLI automation and KDL. Read [references/configuration-and-resurrection.md](references/configuration-and-resurrection.md) for keybindings, serialization, themes, and recovery. Read [references/plugins-and-web-security.md](references/plugins-and-web-security.md) for Wasm permissions, pipes, web sharing, tokens, TLS, and sensitive output.

## Sessions

List machine-readable names instead of parsing decorated output:

```bash
zellij list-sessions --short --no-formatting
```

Use exact fixed-string matching for user-selected session names. Regex interpolation makes metacharacters meaningful and can select the wrong session.

Create a detached/background session for automation:

```bash
zellij attach --create-background development
```

Target every scripted action explicitly:

```bash
zellij --session development action new-pane --cwd "$PWD"
```

Bare actions outside a session can be ambiguous when several sessions exist. Prefer returned pane/tab IDs and JSON from `list-panes` / `list-tabs` when subsequent steps depend on created resources.

## Current CLI syntax

```bash
zellij action move-pane left
zellij action resize increase left
zellij action dump-screen --path /private/output/screen.txt
zellij action write-chars 'echo hello'
zellij action send-keys 'ENTER'
zellij action stack-panes -- terminal_1 plugin_2 3
```

- Direction for `move-pane` is positional.
- Resize takes increase/decrease and an optional direction, not a numeric amount.
- `dump-screen` requires `--path` and can target panes/full scrollback/ANSI.
- `write` accepts integer bytes; use `write-chars` or `send-keys` for readable input.
- `stack-panes` takes explicit pane IDs and is not directional.

Actions such as `Quit`, `ToggleTab`, and some break-pane forms exist in KDL keybindings but are not automatically `zellij action` CLI subcommands. Check the CLI reference before translating between APIs.

## Run and edit panes

`--in-place` suspends and temporarily replaces the current pane. Add `--close-replaced-pane` only when permanent replacement is intended.

For automation, use blocking run modes or returned pane IDs instead of starting an attached client in the background and sleeping. Avoid timing races and untargeted actions.

## Layouts

Percentage KDL coordinates are strings:

```kdl
floating_pane x="10%" y="10%" width="80%" height="80%"
```

Session options belong at the document root, not in a `session` node:

```kdl
session_name "development"
attach_to_session true

layout {
    tab name="editor" {
        pane command="nvim"
    }
}
```

Relative `cwd` values compose through pane, tab, global layout, and invocation directory. Loading a layout from inside a session adds tabs; use the current new-session-with-layout option when a separate session is required.

`zellij setup --dump-config` prints the shipped default config, not the current effective configuration. Zellij 0.44.3 has no layout `--dry-run` flag.

## Configuration and keybindings

Do not combine `clear-defaults=true` with an incomplete map. It removes omitted bindings across modes and can trap users in rename/search/move/tmux modes. Retain defaults and selectively unbind, or define every used mode and escape path.

`mirror_session` controls whether clients attached to one session share cursor/view state; it does not synchronize pane input. Pane input synchronization is the active-sync-tab action.

Current nested session-name hiding:

```kdl
ui {
    pane_frames {
        hide_session_name true
    }
}
```

Theme names include `iceberg-dark` and `iceberg-light`. Current options also include dark/light theme selection, serialization interval, metadata controls, default CWD, OSC 8 hyperlinks, mouse behavior, session attach/name, and web sharing.

## Resurrection

Resurrection serializes layouts and commands, but restored commands are suspended behind an Enter prompt by default. This prevents automatic destructive replay. Strongly discourage `--force-run-commands` outside a reviewed recovery.

Keep pane viewport serialization off unless required. Cached layouts are human-readable and can record commands, arguments, paths, and—when viewport/scrollback serialization is enabled—terminal secrets.

`post_command_discovery_hook` runs in the user's shell. Treat `$RESURRECT_COMMAND` as data and do not re-evaluate it unsafely.

## Web access

Default web address is loopback host `127.0.0.1` on port `8082`. Binding to a non-loopback address requires certificate/key configuration. The server has no built-in rate limiting; use a secured reverse proxy or tunnel for an untrusted network.

Create tokens explicitly:

```bash
zellij web --create-token
```

Tokens are shown once. Distinguish full-control and 0.44 read-only tokens, record revocation procedures, and treat every authenticated full user as having terminal-level authority. `web_server` starts the server; `web_sharing` separately controls whether new sessions are shared. `--insecure` disables TLS validation and is development-only.

## Plugins

Plugins are Wasm but can request powerful permissions such as command execution, full host-disk access, input interception, pane contents, web-server start, and reconfiguration. Review each request; `/host`, `/data`, and `/tmp` mappings already expose meaningful state.

`file:` plugin URLs require absolute paths. HTTPS URLs can be mutable remote code; prefer reviewed versioned artifacts. Compiled plugins are runtime-backward-compatible within documented bounds, while plugin source may need recompilation for API changes.

## Sensitive output and destructive commands

`dump-layout`, `dump-screen --full`, `subscribe --scrollback`, and `list-panes --json` can expose commands and terminal content. Write them only to private targets with an intentional retention policy.

`kill-all-sessions` terminates work. `delete-all-sessions` removes recovery state. Forced delete can do both. Resolve exact targets and require explicit authorization before these destructive operations.

## Review checklist

- Verify Zellij 0.44.3 CLI syntax with `--help` and current docs.
- Use machine-readable session/pane/tab output and exact name matching.
- Target every automated action to a session and capture returned IDs.
- Separate CLI actions from KDL keybinding actions.
- Use current KDL percentage strings and root configuration keys.
- Keep default keybindings unless a complete replacement is defined.
- Keep viewport serialization off and preserve suspended resurrection commands.
- Bind web access to localhost unless TLS/proxy/rate limiting are configured.
- Review plugin permissions and use stable artifacts.
- Protect screen/layout/subscription output and recovery caches as sensitive data.
