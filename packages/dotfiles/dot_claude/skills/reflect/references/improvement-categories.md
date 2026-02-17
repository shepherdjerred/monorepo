# Improvement Categories

Detailed guidance on each type of improvement that can be suggested.

## CLAUDE.md Improvements

### When to Suggest

- Claude made incorrect assumptions about the project
- User had to explain project-specific concepts
- Documentation is outdated or contradictory
- Missing information caused errors

### What to Add

**Architecture Section:**

```markdown
## Architecture

### Directory Structure

- `src/` - Application source code
- `lib/` - Shared utilities
- `tests/` - Test files mirror src/ structure

### Key Patterns

- Repository pattern for data access
- Service layer for business logic
- DTOs for API boundaries
```

**Style Guide Section:**

```markdown
## Code Style

### Naming

- Components: PascalCase
- Utilities: camelCase
- Constants: SCREAMING_SNAKE_CASE

### Imports

- Group: stdlib, external, internal
- Use absolute imports from `src/`
```

**Workflow Section:**

```markdown
## Common Workflows

### Running Tests

npm test # All tests
npm test -- --watch # Watch mode
npm test -- path/file # Specific file

### Building

npm run build # Production
npm run dev # Development with HMR
```

## Skill Suggestions

### When to Suggest

- User performed same multi-step workflow 2+ times
- Complex domain-specific task could be automated
- Repetitive code generation patterns
- Project-specific tooling needs

### Skill Structure

```markdown
---
name: skill-name
description: When to trigger this skill
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
---

# Skill Title

## Purpose

What this skill accomplishes.

## Steps

1. First step
2. Second step
3. Verification
```

### Example Suggestions

- Release workflow skill
- Database migration skill
- Component scaffolding skill
- Deploy preparation skill

## MCP Server Suggestions

### When to Suggest

- Need access to external service
- Database queries required
- API documentation lookup needed
- Integration with third-party tools

### Common MCP Patterns

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

### Placement

- Team tools: `.mcp.json` in repo root
- Personal tools: `~/.claude/.mcp.json`

## Hook Suggestions

### When to Suggest

- Need validation before tool execution
- Want to enforce safety rules
- Automatic formatting or cleanup needed
- Notification requirements

### Hook Types

**PreToolUse:**

```json
{
  "event": "PreToolUse",
  "hooks": [
    {
      "matcher": "Bash",
      "command": "validate-command.sh"
    }
  ]
}
```

**PostToolUse:**

```json
{
  "event": "PostToolUse",
  "hooks": [
    {
      "matcher": "Write",
      "command": "format-file.sh $FILE"
    }
  ]
}
```

**Stop:**

```json
{
  "event": "Stop",
  "hooks": [
    {
      "command": "notify-complete.sh"
    }
  ]
}
```

## Permission Suggestions

### Allow List Additions

Add commands that were:

- Approved 2+ times in session
- Standard project commands (test, build, lint)
- Safe read-only operations

**Format:**

```json
{
  "permissions": {
    "allow": ["Bash(npm test:*)", "Bash(npm run build:*)", "Bash(make:*)"]
  }
}
```

### Deny List Additions

Add commands that:

- User rejected during session
- Are destructive for this project
- Should never be auto-approved

**Format:**

```json
{
  "permissions": {
    "deny": ["Bash(rm -rf:*)", "Bash(git push --force:*)", "Bash(DROP:*)"]
  }
}
```

## Pre-commit Hook Suggestions

### When to Suggest

- Same linting issues fixed repeatedly
- Code quality problems in commits
- Missing test coverage patterns
- Security issues could be caught automatically

### Common Pre-commit Hooks

**Linting:**

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: eslint
        name: ESLint
        entry: npm run lint
        language: system
        types: [javascript, typescript]
```

**Testing:**

```yaml
- id: test
  name: Tests
  entry: npm test --passWithNoTests
  language: system
  pass_filenames: false
```

**Formatting:**

```yaml
- repo: https://github.com/pre-commit/mirrors-prettier
  rev: v3.0.0
  hooks:
    - id: prettier
```

### Husky Alternative

```bash
# .husky/pre-commit
#!/bin/sh
npm run lint-staged
npm test
```

## Architecture Documentation

### When to Suggest

- Claude asked about project structure
- User explained patterns that weren't documented
- Assumptions about architecture were wrong
- Design decisions need recording

### What to Document

**Design Patterns:**

````markdown
## Patterns

### Repository Pattern

Data access is abstracted through repository classes:

- `UserRepository` - User data operations
- `OrderRepository` - Order management

### Dependency Injection

Services receive dependencies via constructor:

```typescript
class OrderService {
  constructor(
    private userRepo: UserRepository,
    private notifier: NotificationService,
  ) {}
}
```
````

````

**Error Handling:**
```markdown
## Error Handling

### Custom Errors
- `ValidationError` - Input validation failures
- `NotFoundError` - Resource not found
- `AuthError` - Authentication/authorization failures

### Error Flow
1. Services throw typed errors
2. Controllers catch and transform
3. Middleware formats response
````

**State Management:**

```markdown
## State Management

### Client State

- React Query for server state
- Zustand for UI state
- URL params for navigation state

### Server State

- Database is source of truth
- Redis for session cache
- No in-memory state between requests
```
