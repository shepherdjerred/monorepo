---
title: Backends
description: Choose the right backend for your session isolation needs
---

![Backend Selection in TUI](../../../assets/screenshots/tui/create-dialog.png)

## Comparison

| Feature            | Zellij  | Docker    |
| ------------------ | ------- | --------- |
| Isolation          | Process | Container |
| Startup            | ~100ms  | ~2-5s     |
| Host tools         | Full    | Limited   |
| Custom image       | No      | Yes       |
| Resource limits    | No      | Yes       |
| Network isolation  | No      | Yes       |
| Persistent storage | Host FS | Volumes   |

## Zellij (Default)

Lightweight sessions running directly on the host.

```bash
clauderon create --repo ~/project --prompt "Explore the codebase"
```

Details: [Zellij Backend Guide](/guides/zellij/)

## Docker

Full container isolation with configurable images and resource limits.

```bash
clauderon create --backend docker --repo ~/project --prompt "Build the project"
```

Details: [Docker Backend Guide](/guides/docker/)

## Choosing a Backend

| Scenario                     | Recommended |
| ---------------------------- | ----------- |
| Quick tasks, exploration     | Zellij      |
| Need specific tools/versions | Docker      |
| Untrusted code               | Docker      |
| Isolation required           | Docker      |

## Specifying a Backend

```bash
clauderon create --backend docker --repo ~/project --prompt "Task"
```

Default is Zellij. No config file setting exists; pass `--backend` per invocation.
