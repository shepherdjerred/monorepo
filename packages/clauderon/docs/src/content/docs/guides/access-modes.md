---
title: Access Modes
description: Control what operations AI agents can perform
---

Access modes control which HTTP methods the credential proxy allows.

## Modes

| Mode | Allowed Methods | Blocked Methods |
| --- | --- | --- |
| **Read-Write** (default) | All | None |
| **Read-Only** | GET, HEAD, OPTIONS | POST, PUT, DELETE, PATCH |

## Configuration

```bash
# Create in read-only mode
clauderon create --access-mode read-only --repo ~/project --prompt "Review the codebase"

# Change existing session
clauderon set-access-mode my-session read-only
clauderon set-access-mode my-session read-write
```

Via Web UI: click session dropdown > "Change Access Mode".

## Blocked Request Behavior

Read-only mode returns HTTP 403 with:

```json
{"error": "Write operations are blocked in read-only mode"}
```

Blocked requests are logged in the audit log:

```bash
jq 'select(.allowed == false)' ~/.clauderon/audit.jsonl
```

## Limitations

- **Not a security boundary** -- controls proxy behavior only. Use Docker for real isolation.
- **HTTP-level only** -- does not prevent local file modifications or git worktree operations.
- **POST-based reads blocked** -- GraphQL queries and some search APIs use POST and will be blocked in read-only mode. Use read-write mode with careful prompting for those cases.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Legitimate reads blocked | Check if API uses POST for reads (GraphQL). Switch to read-write. |
| Mode not changing | Verify with `clauderon list` |
