---
title: Zellij Backend
description: Running sessions in Zellij terminal panes
---

## How It Works

1. Creates a git worktree in `~/.clauderon/worktrees/<session-name>/`
2. Creates a new Zellij session
3. Configures proxy environment variables
4. Starts the chosen agent with your prompt

## Creating Sessions

Zellij is the default backend:

```bash
clauderon create --repo ~/project --prompt "Explore the codebase"

# Explicitly
clauderon create --backend zellij --repo ~/project --prompt "Task"
```

## Attaching to Sessions

```bash
clauderon attach <session-name>

# Or directly via Zellij
zellij attach clauderon-<session-name>
```

## Environment Variables

| Variable              | Purpose                   |
| --------------------- | ------------------------- |
| `HTTP_PROXY`          | Points to clauderon proxy |
| `HTTPS_PROXY`         | Points to clauderon proxy |
| `SSL_CERT_FILE`       | CA certificate path       |
| `NODE_EXTRA_CA_CERTS` | CA for Node.js            |
| `REQUESTS_CA_BUNDLE`  | CA for Python             |

## Key Bindings

- `Ctrl+p` - Zellij mode selection
- `Ctrl+p` then `d` - Detach
- `Ctrl+p` then `q` - Quit

## Troubleshooting

| Problem           | Fix                                                               |
| ----------------- | ----------------------------------------------------------------- |
| Session not found | `zellij list-sessions` to check; `clauderon reconcile` to sync DB |
| Proxy env not set | Session may have started without daemon. Delete and recreate.     |
| Zellij not found  | `brew install zellij` (macOS) or `cargo install zellij` (Linux)   |
