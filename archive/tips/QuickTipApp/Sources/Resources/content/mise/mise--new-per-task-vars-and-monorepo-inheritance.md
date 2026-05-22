---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Tasks can define task-local `vars` that override config-level vars for that specific task only
- Monorepo subdirectory vars are now properly inherited when running tasks from the project root, matching how `env` already works
- Define `vars = { greeting = "hi" }` inside a `[tasks.test]` block to override the config-level `greeting` var just for that task
- This makes it easy to have parameterized tasks without needing environment variables or separate config files
