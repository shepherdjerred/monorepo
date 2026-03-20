---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Nine flat `task_*` settings have been consolidated into a nested `task.*` namespace for cleaner config organization
- For example, `task_output` is now `task.output`, and `task_run_auto_install` is now `task.run_auto_install`
- The old flat names still work with no breaking changes, giving you time to migrate
- This change makes `mise.toml` settings more consistent and easier to discover with autocomplete
