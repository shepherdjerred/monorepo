---
name: review
description: This skill should be used when the user asks to "review implementation", "compare to plan", "check what was missed", "audit the implementation", "verify completeness", "quality check", or mentions "plan vs implementation", "did we miss anything", "stretch goals", "code quality audit". Reviews completed work against the original plan for completeness, quality, and thoroughness.
user-invocable: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - Edit
  - Write
  - WebFetch
  - WebSearch
  - AskUserQuestion
---

# Review Skill

Review an implementation against its plan, checking for completeness, quality, and thoroughness.

## Instructions

When this skill is invoked, perform a comprehensive review of the implementation against its original plan.

### 1. Completeness Check

- **Missed requirements** - Was anything from the plan missed?
- **Skipped items** - Were any items skipped or marked as "stretch"? (We want everything, including stretches)
- **TODOs/FIXMEs** - Are there any TODOs or FIXMEs left behind in the code?

### 2. Quality Check

- **Shortcuts** - Did we take shortcuts or the "easy way out" anywhere?
- **Code structure** - Is the code well-structured and maintainable?
- **Edge cases** - Are edge cases handled properly?
- **Error handling** - Is error handling robust?

### 3. Infrastructure Check

- **Automated testing** - Is there automated testing?
- **Linting** - Is linting configured and passing?
- **Pre-commit hooks** - Are pre-commit hooks in place?
- **CI/CD** - Is CI/CD configured?

### 4. Documentation Check

- **Docs updates** - Do any docs need updating?
- **CLAUDE.md updates** - Does the project CLAUDE.md need updates?
- **Pattern documentation** - Are there new patterns that should be documented?

### 5. Skills/Tooling Check

- **Existing skills** - Do any existing skills need updating?
- **New skills** - Should new skills be created for new workflows?
- **Automation opportunities** - Are there repetitive tasks that could be automated?

## Workflow

1. Ask the user for the plan location if not provided
2. Read the original plan
3. Identify all implemented files and changes
4. Go through each checklist item systematically
5. Report findings with specific file references and line numbers
6. Suggest concrete next steps for any gaps found
