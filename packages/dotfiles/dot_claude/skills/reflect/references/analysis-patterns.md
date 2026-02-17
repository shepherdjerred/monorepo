# Chat Friction Analysis Patterns

This reference documents patterns to look for when analyzing conversation history to identify improvement opportunities.

## Correction Patterns

### Explicit Corrections

Look for phrases indicating Claude misunderstood:

- "No, I meant..."
- "Actually, I wanted..."
- "Not that, the other..."
- "That's not what I asked for"
- "Wrong file/function/approach"
- "I said X, not Y"

**Improvement:** Add clarity to CLAUDE.md about the misunderstood concept.

### Implicit Corrections

User providing the same instruction multiple times:

- Rephrasing the same request
- Adding more detail to a previous request
- Breaking down a request into smaller steps

**Improvement:** Document the pattern or terminology in CLAUDE.md.

## Permission Patterns

### Approved Commands

Track Bash commands that were approved during the session:

- Count approvals per command pattern
- Commands approved 2+ times are candidates for allow list
- Group similar commands (e.g., `npm test`, `npm run test`)

**Examples:**

```
npm test           → Bash(npm test:*)
npm run build      → Bash(npm run build:*)
docker compose up  → Bash(docker compose:*)
make              → Bash(make:*)
```

### Denied Commands

Track commands user rejected or canceled:

- Dangerous commands user didn't want to run
- Commands that shouldn't be suggested for this project
- Commands that caused unintended side effects

**Examples:**

```
rm -rf           → Add to deny list
git push --force → Add to deny list with warning
DROP TABLE       → Add to deny list
```

## Context Gap Patterns

### Missing Architecture Knowledge

Questions or confusion indicating Claude doesn't understand the codebase:

- "Where is the X module?"
- "How does Y work in this project?"
- "What's the pattern for Z here?"
- Claude making incorrect assumptions about structure

**Improvement:** Add architecture documentation to CLAUDE.md.

### Missing Domain Knowledge

Claude not understanding project-specific terminology:

- Asking for clarification on domain terms
- Using wrong terminology
- Misunderstanding business logic

**Improvement:** Add glossary or domain context to CLAUDE.md.

## Style and Convention Patterns

### Formatting Corrections

User correcting Claude's output style:

- "Use X format instead"
- "That's not how we name things"
- "We use tabs/spaces/quotes differently"

**Improvement:** Add style guide to CLAUDE.md.

### Pattern Violations

Claude not following project patterns:

- Wrong error handling approach
- Incorrect import style
- Missing standard boilerplate
- Wrong file organization

**Improvement:** Document patterns in CLAUDE.md or create pre-commit hooks.

## Workflow Patterns

### Repetitive Sequences

Same multi-step workflow appearing 2+ times:

- Build → test → lint sequence
- Deploy process
- Database migration steps
- Release preparation

**Improvement:** Create a skill to automate the workflow.

### Manual Steps Required

Claude asking user to do something manually:

- "Please run this command"
- "You'll need to manually..."
- "I can't access X directly"

**Improvement:** Consider MCP server or hook to automate.

## Tool Limitation Patterns

### External Service Access

Claude needing information from external services:

- API documentation lookups
- Database queries
- Service status checks
- Third-party integrations

**Improvement:** Consider MCP server for the service.

### File System Limitations

Workarounds for file access:

- Binary file handling
- Large file processing
- Specific file format parsing

**Improvement:** Consider MCP tool or Bash wrapper.

## Code Quality Patterns

### Repeated Linting Issues

Same type of issue corrected multiple times:

- Unused imports removed
- Console.log statements cleaned up
- Formatting inconsistencies fixed

**Improvement:** Add pre-commit hooks or linting rules.

### Test Coverage Gaps

Code added without corresponding tests:

- Features without test files
- Bug fixes without regression tests
- Refactors without test updates

**Improvement:** Add pre-commit test coverage check.

## Detection Techniques

### Keyword Scanning

Look for these signal words in user messages:

- Corrections: "no", "not", "wrong", "actually", "instead"
- Confusion: "wait", "what", "how", "where", "why"
- Repetition: Same nouns/verbs across messages
- Frustration: "again", "still", "keep", "always"

### Pattern Counting

Track frequencies of:

- Command types approved/denied
- File paths accessed repeatedly
- Error types encountered
- Topics revisited

### Sequence Analysis

Identify repeated sequences:

- Same tool calls in same order
- Similar error → fix cycles
- Repetitive exploration patterns

## Priority Assessment

Rate patterns by impact:

**Critical (Priority 1):**

- Caused errors or incorrect output
- Required significant rework
- Blocked progress

**High Value (Priority 2):**

- Caused noticeable friction
- Required multiple clarifications
- Slowed down workflow

**Nice to Have (Priority 3):**

- Minor inconvenience
- Style preferences
- Optimization opportunities
