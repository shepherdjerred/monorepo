---
id: log-2026-08-05-codex-user-skills-discovery
type: log
status: complete
board: false
---

# Codex user-skill discovery

## Question

Determine why Codex appears not to load skills from `~/.agents`.

## Findings

- The documented personal skill directory is `~/.agents/skills`, not
  `~/.agents` itself.
- This environment resolves that path to `/Users/jerred/.agents/skills` and
  discovers 65 skill directories there.
- Codex progressively discloses skills: it loads metadata for discovery and
  reads the full `SKILL.md` only when a skill is selected or explicitly
  invoked. Discovery does not mean every skill is active in every turn.
- `apple-hig-helper/SKILL.md` is missing the required `name` frontmatter field;
  the other 64 manifests have the expected `name` and `description` fields.
- The current session's available-skill catalog includes the personal skills,
  so the root itself is not the discovery failure.

## Session Log — 2026-08-05

### Done

- Inspected the current Codex manual and local configuration.
- Verified the personal skill directory and manifest structure.
- Identified progressive disclosure, stale-session refresh, and one malformed
  manifest as the relevant causes.

### Remaining

- None for diagnosis. Add `name: apple-hig-helper` to the HIG skill if that
  skill specifically fails to appear or trigger, then restart Codex if needed.

### Caveats

- A skill may be discovered but not selected automatically when its
  description does not match the request closely enough; explicit invocation
  is the reliable diagnostic.

## Follow-up — slash picker

The installed Codex CLI (`0.146.1`) was opened interactively. Typing `/` showed
the `/skills` command; selecting it and then “List skills” showed personal
skills from `~/.agents/skills`, including `git-helper`. The picker also reports
that `@` opens the skill list directly.

## Session Log — 2026-08-05

### Done

- Verified the slash-command menu and skill picker in the installed CLI.
- Confirmed personal skills are visible to the picker.

### Remaining

- None. Use `/skills` to browse skills; use `@` for the direct picker.

### Caveats

- Individual skill names are not top-level `/` commands. `/` exposes the
  built-in `/skills` command, which opens the separate skill picker.

## Clean CLI probe

A fresh CLI was spawned with `env -i` so the parent session's environment could
not affect discovery. The Homebrew CLI (`codex-cli 0.146.1`) loaded
`~/.codex/config.toml`, showed `/skills` in the slash menu, and its skill picker
returned the personal `git-helper` skill when searched. Selecting it inserted
`$git-helper` into the composer.

## Session Log — 2026-08-05

### Done

- Reproduced skill discovery in a clean, separately spawned CLI process.
- Confirmed there is no `~/.agents` path or environment configuration failure.
- Confirmed direct skill invocation uses the skill picker and `$skill-name`,
  not `/skill-name`.

### Remaining

- None in the local CLI. If another surface does not show `/skills`, compare
  that surface's binary/server against `/opt/homebrew/bin/codex` version
  `0.146.1`.

### Caveats

- The initial picker view shows a limited ranked subset. Searching for a
  specific personal skill is required when it is not in that first page.
