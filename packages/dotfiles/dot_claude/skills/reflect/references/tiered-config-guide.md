# Tiered Configuration Guide

How to decide where to place Claude Code configuration and improvements.

## Configuration Tiers Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Global (~/.claude/)                      │
│  User-wide settings, personal preferences, universal rules  │
├─────────────────────────────────────────────────────────────┤
│                     Repository (./)                          │
│  Project-specific settings, team conventions, local rules   │
├─────────────────────────────────────────────────────────────┤
│                   Nested (**/CLAUDE.md)                      │
│  Module-specific overrides, directory-scoped rules          │
└─────────────────────────────────────────────────────────────┘
```

## Global Tier (~/.claude/)

### Files

- `~/.claude/CLAUDE.md` - Global instructions
- `~/.claude/settings.json` - Global settings and permissions
- `~/.claude/skills/` - Personal skills
- `~/.claude/.mcp.json` - Personal MCP servers

### Use For

**Personal Preferences:**

- Communication style ("be concise", "explain reasoning")
- Output format preferences
- Language preferences

**Universal Coding Style:**

- Your personal naming conventions
- Comment style preferences
- Documentation standards you always follow

**Personal Workflows:**

- Tools you use across all projects
- Personal automation scripts
- Development environment setup

**Universal Permissions:**

- Commands you always want allowed
- Commands you never want to run
- Personal safety rules

### Examples

```markdown
# ~/.claude/CLAUDE.md

## Communication

- Be direct and concise
- Skip pleasantries in responses
- Use technical terminology

## My Preferences

- I prefer functional programming patterns
- Always use TypeScript strict mode
- Include JSDoc comments on exports
```

```json
// ~/.claude/settings.json
{
  "permissions": {
    "allow": ["Bash(git status:*)", "Bash(git diff:*)", "Bash(ls:*)"],
    "deny": ["Bash(rm -rf /:*)", "Bash(sudo:*)"]
  }
}
```

## Repository Tier (./)

### Files

- `./CLAUDE.md` - Project instructions
- `./.claude/settings.local.json` - Project settings
- `./.claude/commands/` - Project commands
- `./.mcp.json` - Project MCP servers

### Use For

**Project Architecture:**

- Directory structure explanation
- Design patterns in use
- Module organization

**Build and Test Commands:**

- How to run tests
- How to build
- How to deploy

**Team Conventions:**

- Shared coding standards
- PR requirements
- Branch naming

**Project-Specific Permissions:**

- Dangerous commands for this project
- Required tooling permissions
- Project-specific safety rules

**Team MCP Servers:**

- Shared database access
- Project API integrations
- Team tooling

### Examples

```markdown
# ./CLAUDE.md

## Project Overview

E-commerce platform built with Next.js and PostgreSQL.

## Architecture

- `src/app/` - Next.js app router pages
- `src/components/` - React components
- `src/lib/` - Shared utilities
- `src/db/` - Database schema and queries

## Commands

- `npm run dev` - Development server
- `npm test` - Run tests
- `npm run db:migrate` - Run migrations
```

```json
// ./.claude/settings.local.json
{
  "permissions": {
    "deny": ["Bash(npm publish:*)", "Bash(prisma migrate reset:*)"]
  }
}
```

## Nested Tier (\*\*/CLAUDE.md)

### Files

- `src/components/CLAUDE.md`
- `packages/core/CLAUDE.md`
- `modules/auth/CLAUDE.md`

### Use For

**Module-Specific Patterns:**

- Component conventions in a UI folder
- API patterns in an API module
- Test conventions in a test directory

**Scoped Overrides:**

- Different rules for generated code
- Legacy module exceptions
- Third-party code handling

**Focused Documentation:**

- Complex module explanations
- Subsystem architecture
- Domain-specific context

### Examples

```markdown
# src/components/CLAUDE.md

## Component Conventions

- All components use forwardRef
- Props interfaces named [Component]Props
- Styles in colocated .module.css files

## Patterns

- Use compound components for complex UI
- Prefer composition over configuration
- Export both named and default
```

```markdown
# packages/legacy/CLAUDE.md

## Legacy Code Warning

This package uses deprecated patterns. Do not:

- Refactor to modern patterns
- Update dependencies
- Change API signatures

Only make minimal bug fixes.
```

## Decision Matrix

| Question                               | If Yes → Tier |
| -------------------------------------- | ------------- |
| Is this my personal preference?        | Global        |
| Would I want this in all projects?     | Global        |
| Is this specific to this project?      | Repo          |
| Should teammates follow this?          | Repo          |
| Does this only apply to one directory? | Nested        |
| Is this an override of a higher tier?  | Nested        |

## Permission Placement

| Permission Type            | Tier   | File                          |
| -------------------------- | ------ | ----------------------------- |
| Commands I always allow    | Global | `~/.claude/settings.json`     |
| Commands I never allow     | Global | `~/.claude/settings.json`     |
| Project-safe commands      | Repo   | `.claude/settings.local.json` |
| Project-dangerous commands | Repo   | `.claude/settings.local.json` |
| Team-required denials      | Repo   | `.claude/settings.local.json` |

## MCP Server Placement

| MCP Type                         | Tier   | File                  |
| -------------------------------- | ------ | --------------------- |
| Personal tools (notes, calendar) | Global | `~/.claude/.mcp.json` |
| Project database                 | Repo   | `.mcp.json`           |
| Team shared services             | Repo   | `.mcp.json`           |
| Personal API keys                | Global | `~/.claude/.mcp.json` |

## Hook Placement

| Hook Purpose       | Tier   | Location                      |
| ------------------ | ------ | ----------------------------- |
| Personal safety    | Global | `~/.claude/settings.json`     |
| Project validation | Repo   | `.claude/settings.local.json` |
| Team enforcement   | Repo   | `.claude/settings.local.json` |
| CI integration     | Repo   | `.claude/settings.local.json` |

## Conflict Resolution

When the same setting exists in multiple tiers:

1. **Nested overrides Repo overrides Global**
2. **Most specific wins**
3. **Deny lists are additive** (all tiers' denies apply)
4. **Allow lists are restrictive** (must be allowed at all levels)

## Migration Patterns

### Moving Global → Repo

When starting to share with a team:

```bash
# Copy personal settings to repo
cp ~/.claude/CLAUDE.md ./CLAUDE.md
# Edit to remove personal preferences
# Keep only project-relevant content
```

### Moving Repo → Nested

When a module needs different rules:

```bash
# Create module-specific file
touch src/module/CLAUDE.md
# Add only the differences
# Reference parent for shared rules
```
