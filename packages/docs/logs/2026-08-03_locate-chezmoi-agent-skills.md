---
id: log-locate-chezmoi-agent-skills-2026-08-03
type: log
status: complete
board: false
---

# Locate Chezmoi Agent Skills

Confirmed with `chezmoi source-path ~/.agents/skills` that the managed source
directory is `packages/dotfiles/dot_agents/skills`.

Of the 65 top-level managed skills, 32 (49.2%) contain a `What's New` section.
These sections are static snapshots, commonly labeled 2024–2026, rather than
automatically refreshed release feeds.

## Session Log — 2026-08-03

### Done

- Located the chezmoi-managed agent skills directory at
  `packages/dotfiles/dot_agents/skills`.
- Confirmed the mapping with the live `chezmoi source-path` command.
- Measured the release-oriented content: 32 of 65 skills contain a
  `What's New` section.

### Remaining

- None.

### Caveats

- `bun run check-todos` is currently blocked by the invalid frontmatter ID in
  the existing untracked file
  `packages/docs/logs/2026-08-03_scout-evals-populate-100-case-dataset.md`.
- Release/version claims in skills are static Markdown and can become stale.
