---
title: Hooks
description: Execute custom commands on session lifecycle events
---

:::caution
Hooks are **not yet implemented**. This page documents the planned design.
:::

## Planned Hook Types

| Hook        | Trigger                     |
| ----------- | --------------------------- |
| `on_create` | After session creation      |
| `on_delete` | Before session deletion     |
| `on_start`  | When session starts running |
| `on_stop`   | When session stops          |

## Planned Environment Variables

| Variable        | Description                         |
| --------------- | ----------------------------------- |
| `SESSION_NAME`  | Name of the session                 |
| `SESSION_ID`    | Unique session ID                   |
| `BACKEND`       | Backend type (zellij, docker, etc.) |
| `AGENT`         | Agent type (claude, codex, gemini)  |
| `REPO_PATH`     | Path to the git repository          |
| `WORKTREE_PATH` | Path to the worktree                |

## Workarounds

Wrap clauderon commands in shell scripts:

```bash
#!/bin/bash
# Desktop notification on create
clauderon create "$@"
osascript -e "display notification \"Session created\" with title \"clauderon\""
```

```bash
#!/bin/bash
# Archive worktree before deletion
SESSION_NAME="$1"
WORKTREE="$HOME/.clauderon/worktrees/$SESSION_NAME"
[ -d "$WORKTREE" ] && tar -czf "$HOME/archives/$SESSION_NAME.tar.gz" "$WORKTREE"
clauderon delete "$SESSION_NAME"
```

## Debugging Lifecycle Events

```bash
RUST_LOG=clauderon=debug clauderon daemon
```
