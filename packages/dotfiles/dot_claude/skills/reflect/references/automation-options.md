# Automation Options Reference

Comprehensive guide to Claude Code automation capabilities: skills, MCPs, hooks, and permissions.

## Skills

### What Skills Do
- Encapsulate multi-step workflows
- Provide domain-specific instructions
- Bundle related tools and permissions
- Enable user-invocable commands via `/skill-name`

### Skill Structure
```
skill-name/
├── SKILL.md           # Main instructions
├── references/        # Supporting documentation
│   ├── patterns.md
│   └── examples.md
└── examples/          # Example outputs
    └── sample.md
```

### SKILL.md Format
```markdown
---
name: skill-name
description: Trigger conditions and purpose
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# Skill Title

## Overview
What this skill does.

## Steps
1. First step
2. Second step
3. Verification

## Examples
How to use this skill.
```

### When to Suggest a Skill
- Multi-step workflow repeated 2+ times
- Complex domain knowledge needed
- Project-specific automation
- Standardized process enforcement

### Skill Examples
| Workflow | Skill Suggestion |
|----------|-----------------|
| Release process | `/release` skill with version bump, changelog, tag |
| Component scaffolding | `/component` skill with templates |
| Database migration | `/migrate` skill with safety checks |
| Deploy preparation | `/deploy-prep` skill with checklists |

## MCP Servers

### What MCPs Do
- Provide access to external services
- Enable database queries
- Integrate third-party APIs
- Extend Claude's capabilities

### MCP Configuration
```json
// .mcp.json or ~/.claude/.mcp.json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "package-name"],
      "env": {
        "API_KEY": "${ENV_VAR}"
      }
    }
  }
}
```

### Common MCP Servers

**Database Access:**
```json
{
  "postgres": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-postgres"],
    "env": { "DATABASE_URL": "${DATABASE_URL}" }
  },
  "sqlite": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-sqlite", "path/to/db.sqlite"]
  }
}
```

**File System:**
```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
  }
}
```

**GitHub:**
```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
  }
}
```

**Fetch/HTTP:**
```json
{
  "fetch": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-fetch"]
  }
}
```

### When to Suggest an MCP
- Need to query databases
- External API access required
- File system operations outside project
- Service integration needed

## Hooks

### What Hooks Do
- Execute before/after tool use
- Validate operations
- Transform inputs/outputs
- Enforce safety rules

### Hook Events

| Event | Trigger | Use Case |
|-------|---------|----------|
| `PreToolUse` | Before tool execution | Validation, blocking |
| `PostToolUse` | After tool execution | Formatting, logging |
| `Stop` | When Claude stops | Notification, cleanup |
| `SubagentStop` | When subagent stops | Aggregation |
| `SessionStart` | Session begins | Setup, context loading |
| `SessionEnd` | Session ends | Cleanup, saving |

### Hook Configuration
```json
// In settings.json or settings.local.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "command": "validate-bash.sh",
      "timeout": 5000
    }],
    "PostToolUse": [{
      "matcher": "Write",
      "command": "format-file.sh"
    }],
    "Stop": [{
      "command": "notify-complete.sh"
    }]
  }
}
```

### Hook Matchers
```json
// Match specific tool
{ "matcher": "Bash" }

// Match with pattern
{ "matcher": "Bash(npm:*)" }

// Match any
{ "matcher": "*" }
```

### When to Suggest Hooks
- Need pre-execution validation
- Want automatic formatting
- Require notifications
- Enforce safety rules

### Hook Examples

**Prevent Dangerous Commands:**
```bash
#!/bin/bash
# validate-bash.sh
if echo "$1" | grep -qE "(rm -rf|drop table|--force)"; then
  echo "Blocked dangerous command"
  exit 1
fi
```

**Auto-Format on Write:**
```bash
#!/bin/bash
# format-file.sh
prettier --write "$FILE" 2>/dev/null || true
```

**Notify on Complete:**
```bash
#!/bin/bash
# notify-complete.sh
osascript -e 'display notification "Claude task complete" with title "Claude Code"'
```

## Permissions

### Permission Types

**Allow List:**
Commands that can run without prompting.
```json
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(npm run:*)",
      "Bash(git status:*)",
      "Bash(make:*)"
    ]
  }
}
```

**Deny List:**
Commands that are always blocked.
```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(sudo:*)",
      "Bash(chmod 777:*)",
      "Bash(> /dev:*)"
    ]
  }
}
```

### Permission Patterns

| Pattern | Matches |
|---------|---------|
| `Bash(npm test:*)` | Any npm test command |
| `Bash(git:*)` | Any git command |
| `Bash(docker compose:*)` | Docker compose commands |
| `Bash(**/node_modules/**)` | Commands in node_modules |

### When to Suggest Permissions

**Allow List Additions:**
- Command approved 2+ times
- Standard development commands
- Read-only operations
- Project build/test scripts

**Deny List Additions:**
- Command rejected by user
- Destructive operations
- Commands with side effects
- Security-sensitive operations

### Permission Examples

**Development Workflow:**
```json
{
  "allow": [
    "Bash(npm:*)",
    "Bash(yarn:*)",
    "Bash(pnpm:*)",
    "Bash(bun:*)"
  ]
}
```

**Git Operations:**
```json
{
  "allow": [
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git branch:*)"
  ],
  "deny": [
    "Bash(git push --force:*)",
    "Bash(git reset --hard:*)"
  ]
}
```

**Docker:**
```json
{
  "allow": [
    "Bash(docker compose up:*)",
    "Bash(docker compose down:*)",
    "Bash(docker ps:*)"
  ],
  "deny": [
    "Bash(docker system prune:*)"
  ]
}
```

## Choosing the Right Automation

| Need | Solution |
|------|----------|
| Multi-step workflow | Skill |
| External service access | MCP |
| Pre/post validation | Hook |
| Speed up approvals | Allow list |
| Block dangerous ops | Deny list |
| Documentation | CLAUDE.md |

## Combining Automations

Skills can reference other automations:
```markdown
---
name: deploy
allowed-tools:
  - Bash
---

# Deploy Skill

Uses MCP for database access, hooks for validation,
and allowed Bash commands for speed.
```

Hooks can enforce skill behavior:
```json
{
  "PreToolUse": [{
    "matcher": "Bash(npm publish:*)",
    "command": "check-version-bump.sh"
  }]
}
```
