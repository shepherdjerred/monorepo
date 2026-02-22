# packages/docs

AI-maintained documentation for the monorepo. This is a knowledge base primarily written and consumed by AI agents working on this codebase.

## Purpose

- Capture architectural decisions, patterns, and conventions
- Document non-obvious behaviors and gotchas
- Provide context that helps AI agents work more effectively across sessions

## Structure

```
docs/
├── CLAUDE.md          # This file
├── index.md           # Table of contents / overview
├── architecture/      # High-level architecture docs
├── patterns/          # Reusable patterns and conventions
├── decisions/         # Architectural decision records
└── guides/            # How-to guides for common tasks
```

## Conventions

- Keep docs concise and factual — no filler
- Use markdown with code examples where helpful
- Name files with kebab-case (e.g., `ci-pipeline.md`)
- Update `index.md` when adding new docs
- Prefer updating existing docs over creating new ones
- Delete docs that become outdated rather than leaving stale content
