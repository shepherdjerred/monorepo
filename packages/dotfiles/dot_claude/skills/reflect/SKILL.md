---
name: reflect
description: This skill should be used when the user asks to "reflect on this conversation", "optimize my Claude setup", "improve Claude instructions", "analyze chat patterns", "audit CLAUDE.md", "suggest Claude improvements", "fix Claude misunderstandings", or mentions "prompt optimization", "instruction tuning", or "Claude configuration audit". Analyzes chat history and configuration to identify improvements for CLAUDE.md files, skills, MCPs, hooks, and permissions.
user-invocable: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Edit
  - Write
---

# Reflect: Claude Configuration Analyzer

Analyze chat history and Claude configuration to suggest targeted improvements for CLAUDE.md files, skills, MCPs, hooks, and permissions.

## Overview

This skill performs a comprehensive audit of your Claude Code setup by:

1. Discovering all configuration files across tiers (global, repo, nested)
2. Analyzing the current conversation for friction patterns
3. Generating prioritized improvement recommendations
4. Interactively implementing approved changes

## Phase 1: Discovery & Analysis

### Configuration Discovery

Scan for and read all relevant configuration files:

**Global Configuration (~/.claude/):**

- `~/.claude/CLAUDE.md` - Global instructions
- `~/.claude/settings.json` - Global settings, permissions, allow/deny lists
- `~/.claude/skills/` - User skills directory

**Repository Configuration (./):**

- `./CLAUDE.md` - Repo-level instructions
- `./.claude/settings.local.json` - Repo-specific settings
- `./.claude/commands/` - Custom commands
- `./.mcp.json` - MCP server configuration

**Nested Configuration:**

- `**/CLAUDE.md` - Module-specific instructions (limit depth to 3)

### Chat History Analysis

Examine the conversation for these friction patterns:

| Pattern                        | Indicators                                     | Improvement Type      |
| ------------------------------ | ---------------------------------------------- | --------------------- |
| **Repeated corrections**       | "No, I meant...", "Actually...", "Not that..." | CLAUDE.md clarity     |
| **Permission requests**        | Bash commands approved 2+ times                | Allow list addition   |
| **Permission denials**         | Commands user rejected/canceled                | Deny list addition    |
| **Context requests**           | "Where is...", "How does X work here?"         | Architecture docs     |
| **Style corrections**          | Formatting, naming, pattern fixes              | Style guide addition  |
| **Repetitive workflows**       | Same multi-step sequence 2+ times              | Skill candidate       |
| **Tool limitations**           | Workarounds, manual steps needed               | MCP candidate         |
| **Code quality issues**        | Linting, formatting corrections                | Pre-commit hooks      |
| **Architectural explanations** | Design pattern clarifications                  | Pattern documentation |

See `references/analysis-patterns.md` for detailed pattern recognition guidance.

## Phase 2: Structured Report

Generate a comprehensive report using this exact format:

```markdown
<analysis>
## Configuration Audit

### Files Discovered

| Tier   | File                    | Status        |
| ------ | ----------------------- | ------------- |
| Global | ~/.claude/CLAUDE.md     | Found/Missing |
| Global | ~/.claude/settings.json | Found/Missing |
| Repo   | ./CLAUDE.md             | Found/Missing |
| ...    | ...                     | ...           |

### Chat Patterns Detected

- [List specific patterns found with examples]
- [Quote relevant user corrections or requests]

### Current Configuration Issues

- [Gaps between what Claude needs and what's documented]
- [Outdated or contradictory instructions]
- [Missing permissions that caused friction]
  </analysis>

<improvements>
## Recommended Improvements

### Priority 1: Critical

[Improvements that caused significant friction or errors]

### Priority 2: High Value

[Improvements that would meaningfully improve workflow]

### Priority 3: Nice to Have

[Minor enhancements and polish]

---

Each improvement follows this format:

#### [Descriptive Title]

- **Type:** CLAUDE.md | Skill | MCP | Hook | Permission | Allow-List | Deny-List | Pre-commit | Architecture
- **Tier:** Global | Repo | Nested
- **File:** [exact path to modify]
- **Rationale:** [why this improvement matters, with evidence from chat]
- **Change:**
```

[exact content to add/modify]

```

---

## Allow List Additions
| Command Pattern | Times Approved | Suggested Entry |
|-----------------|----------------|-----------------|
| `npm test` | 5x | `Bash(npm test:*)` |
| `docker build` | 3x | `Bash(docker build:*)` |

## Deny List Additions
| Command Pattern | Reason | Suggested Entry |
|-----------------|--------|-----------------|
| `rm -rf /` | Destructive | `Bash(rm -rf /:*)` |

## Pre-commit Hook Suggestions
| Pattern Detected | Suggested Hook | Rationale |
|------------------|----------------|-----------|
| console.log left in code | lint-staged + eslint | Debug code detected |
| Missing test coverage | pre-commit test | Features without tests |

## Architecture Documentation
| Pattern Observed | Suggested Addition | Location |
|------------------|-------------------|----------|
| Repository pattern | Data access layer docs | CLAUDE.md → Architecture |
| Custom errors | Error handling strategy | CLAUDE.md → Patterns |
</improvements>

<final_instructions>
## Ready to Apply Changes

I'll walk through each improvement for your approval.

For each change, you can:
- **Accept** - Apply the change as proposed
- **Modify** - Adjust the change before applying
- **Skip** - Move to the next improvement

Shall I begin with Priority 1 improvements?
</final_instructions>
```

## Phase 3: Interactive Implementation

After presenting the report, implement changes interactively:

1. **Present each improvement individually:**
   - Show the improvement details
   - Display a preview diff of the change
   - Ask: "Accept / Modify / Skip?"

2. **For Accept:**
   - Apply the change using Edit or Write
   - Confirm success
   - Move to next improvement

3. **For Modify:**
   - Ask what changes the user wants
   - Show updated diff
   - Apply modified version

4. **For Skip:**
   - Note that it was skipped
   - Move to next improvement

5. **Summarize at end:**
   - List all changes made
   - List skipped improvements
   - Suggest next steps

## Tier Placement Guide

Use this decision matrix for placing improvements:

| Pattern                     | Tier                     | Rationale                   |
| --------------------------- | ------------------------ | --------------------------- |
| Communication preferences   | Global                   | Applies to all interactions |
| Personal coding style       | Global                   | Consistent across projects  |
| Project build/test commands | Repo                     | Project-specific            |
| Architecture descriptions   | Repo                     | Project-specific            |
| Module-specific patterns    | Nested                   | Scoped to module            |
| Personal tool permissions   | Global settings.json     | User workflow               |
| Project tool permissions    | Repo settings.local.json | Team safety                 |
| Team MCP servers            | Repo .mcp.json           | Shared tooling              |
| Personal MCP servers        | Global                   | Personal tools              |
| Project pre-commit          | Repo .husky/             | Team standards              |
| Universal allow/deny        | Global settings.json     | Always applies              |
| Project-dangerous commands  | Repo settings.local.json | Project safety              |

See `references/tiered-config-guide.md` for detailed placement logic.

## Reference Files

For detailed guidance on specific aspects:

- **`references/analysis-patterns.md`** - Comprehensive list of chat friction patterns and how to detect them
- **`references/improvement-categories.md`** - Deep dive on each improvement type
- **`references/tiered-config-guide.md`** - When to use global vs repo vs nested
- **`references/automation-options.md`** - Skills, MCPs, hooks patterns and examples

## Example Output

See `examples/sample-analysis-output.md` for a complete example of the analysis output format.

## Important Notes

- Always show diffs before making changes
- Never modify files without explicit approval
- Group related improvements when practical
- Explain the reasoning behind tier placement
- Consider team vs personal preferences for shared repos
