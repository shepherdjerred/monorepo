---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Define shell aliases in `mise.toml` using `[alias.shell]` and they work across bash, zsh, fish, and other supported shells
- Unlike tool aliases which map version names, shell aliases create actual shell function aliases usable in your terminal
- Use `mise shell-alias` command to manage shell aliases from the CLI
- This makes it easy to share project-specific shell shortcuts with your team through the same config file as your tools and tasks
