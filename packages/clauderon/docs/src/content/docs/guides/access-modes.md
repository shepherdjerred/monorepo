---
title: Access Modes
description: Control what operations AI agents can perform
---

Access modes control which HTTP methods the credential proxy allows, providing a safety mechanism for AI agent sessions.

## Modes

### Read-Write (Default)

Allows all HTTP methods:
- GET, HEAD, OPTIONS (read operations)
- POST, PUT, DELETE, PATCH (write operations)

The agent can read and modify resources.

### Read-Only

Allows only safe HTTP methods:
- GET, HEAD, OPTIONS

Blocks:
- POST, PUT, DELETE, PATCH

The agent can read resources but cannot modify them.

## Use Cases

### Read-Only Mode

Use read-only mode when:

- **Exploring codebases** - Safe to let the agent browse without risk of changes
- **Code review** - Agent can read PRs and code but can't approve/merge
- **Documentation lookup** - Query APIs without modifying data
- **Learning sessions** - Understand code without risk of breaking things
- **Untrusted prompts** - Limit damage from potentially harmful instructions

### Read-Write Mode

Use read-write mode when:

- **Active development** - Agent needs to commit, push, create PRs
- **Deployment tasks** - Agent needs to trigger deployments
- **Issue management** - Agent needs to create/close issues
- **Data operations** - Agent needs to write to databases or APIs

## Configuration

### Per-Session (CLI)

Create a session in read-only mode:

```bash
clauderon create --access-mode read-only \
  --repo ~/project \
  --prompt "Review the codebase architecture"
```

Create a session in read-write mode (default):

```bash
clauderon create --access-mode read-write \
  --repo ~/project \
  --prompt "Fix the bug and submit a PR"
```

### Changing Mode

Change an existing session's mode:

```bash
# Restrict to read-only
clauderon set-access-mode my-session read-only

# Re-enable writes
clauderon set-access-mode my-session read-write
```

### Via Web UI

Click the session dropdown menu and select "Change Access Mode".

## Blocked Request Behavior

When a write request is blocked in read-only mode:

1. The proxy returns HTTP 403 Forbidden
2. The response includes a message explaining the block
3. The request is logged in the audit log

The agent sees:

```
HTTP 403 Forbidden
{"error": "Write operations are blocked in read-only mode"}
```

## Audit Logging

Access mode decisions are logged:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "session_id": "abc123",
  "method": "POST",
  "path": "/repos/owner/repo/pulls",
  "access_mode": "read-only",
  "allowed": false,
  "reason": "Write method blocked in read-only mode"
}
```

View blocked requests:

```bash
jq 'select(.allowed == false)' ~/.clauderon/audit.jsonl
```

## Best Practices

### Start Read-Only

For exploration tasks, start in read-only mode:

```bash
clauderon create --access-mode read-only \
  --repo ~/project \
  --prompt "Understand the authentication flow"
```

Then switch to read-write when ready:

```bash
clauderon set-access-mode my-session read-write
```

### Separate Sessions

Create separate sessions for different access levels:

```bash
# Read-only for exploration
clauderon create --access-mode read-only \
  --repo ~/project \
  --prompt "Analyze the codebase"

# Read-write for development
clauderon create --access-mode read-write \
  --repo ~/project \
  --prompt "Implement the new feature"
```

### Production Safety

For sessions that interact with production systems:

1. Start in read-only mode
2. Review the agent's plan
3. Switch to read-write only when confident
4. Monitor the audit log

## API Methods Reference

### Allowed in Read-Only

| Method | Description |
|--------|-------------|
| GET | Retrieve resources |
| HEAD | Retrieve headers only |
| OPTIONS | Get allowed methods |

### Blocked in Read-Only

| Method | Description |
|--------|-------------|
| POST | Create resources |
| PUT | Replace resources |
| PATCH | Modify resources |
| DELETE | Remove resources |

## Limitations

### Not a Security Boundary

Access modes are a safety feature, not a security boundary:

- They control proxy behavior, not agent behavior
- A malicious agent could try to bypass the proxy
- Use proper isolation (Docker, Kubernetes) for security

### API-Level Only

Access modes work at the HTTP level:

- They don't prevent local file modifications
- They don't control git operations on the worktree
- They only affect requests going through the proxy

### Service-Specific Semantics

Some APIs use POST for read operations:

- GraphQL APIs use POST for queries
- Some search APIs use POST

These legitimate read operations will be blocked. Consider:
- Using read-write mode with careful prompting
- Asking the agent to use alternative read methods

## Troubleshooting

### Unexpected Blocks

If legitimate read operations are blocked:

```bash
# Check the audit log
jq 'select(.allowed == false)' ~/.clauderon/audit.jsonl | tail -5
```

Consider if the API uses POST for reads (GraphQL, etc.).

### Mode Not Changing

Verify the mode changed:

```bash
clauderon list
```

Check the Access Mode column.

### Agent Confused

If the agent doesn't understand why operations fail, you can:

1. Include access mode in the prompt
2. Switch to read-write if needed
3. Use separate sessions for different tasks

## See Also

- [Credential Proxy](/guides/proxy/) - How the proxy works
- [Configuration Reference](/reference/configuration/) - All settings
- [CLI Reference](/reference/cli/) - set-access-mode command
