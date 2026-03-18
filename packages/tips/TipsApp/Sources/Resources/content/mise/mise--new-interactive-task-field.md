---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Mark a task with `interactive = true` to give it exclusive terminal access (stdin/stdout/stderr) while other non-interactive tasks continue running in parallel
- This is more targeted than `raw = true`, which forces `jobs=1` globally; `interactive` only blocks concurrent tasks while the interactive task is actively running
- Use it for tasks that prompt for input, run a TUI, or need direct terminal control
- Example: `[tasks.deploy]` with `interactive = true` lets other build tasks keep running while the deploy script prompts for confirmation
