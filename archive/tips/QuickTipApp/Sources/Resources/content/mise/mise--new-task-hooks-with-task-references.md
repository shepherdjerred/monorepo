---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Hooks and `watch_files` can now reference mise tasks using `{ task = "name" }` syntax instead of inline shell scripts
- Task refs gain access to the full task system: deps, env, templating, and Tera variables like `{{tools.ripgrep.path}}`
- Mixed arrays of inline scripts and task references are supported in the same hook
- Respects `MISE_NO_HOOKS=1` so hooks can be disabled without touching config files
- Example: `[hooks]` with `enter = { task = "setup" }` runs the `setup` task when entering the project directory
