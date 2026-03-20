---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Run `mise upgrade --local` to restrict upgrades to tools defined in project-local config files (e.g., `mise.toml`), skipping global config tools
- Run `mise outdated --local` to show only outdated tools from the local config
- Useful when you have separate workflows for managing global developer tools versus project-pinned versions
- Prevents accidentally upgrading global tools when you only want to update a specific project
