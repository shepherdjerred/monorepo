---
app: mise
icon: wrench.and.screwdriver.fill
color: "#6C5CE7"
website: https://mise.jdx.dev
category: New Features
---

- Tasks with a `timeout` field are now actually killed if they exceed their configured duration
- Timeouts send SIGTERM with a 5-second grace period before SIGKILL
- Both per-task `timeout` settings and the global `task_timeout` / `--timeout` flag are respected
- Example: set `timeout = "5m"` on a deploy task to prevent runaway deployments from blocking CI
