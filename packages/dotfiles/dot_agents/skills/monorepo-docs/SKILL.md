---
name: monorepo-docs
description: Author and maintain documentation in shepherdjerred/monorepo. Use for session logs, implementation plans, architecture notes, decisions, guides, TODO records, docs-board workflow changes, or the human-focused Starlight wiki in packages/docs/wiki. Also use when code or infrastructure changes should update durable AI or human documentation.
---

# Monorepo Docs

Keep two documentation layers distinct:

- `packages/docs/` is AI working memory and workflow state.
- `packages/docs/wiki/` is a public, human-first explanation layer authored for
  Jerred.

Read the root `AGENTS.md`, `packages/docs/AGENTS.md`, and the nearest nested
instructions before writing.

## Choose the destination

Use `packages/docs/wiki/src/content/docs/` when the reader needs a durable,
terse answer about what exists, how systems connect, or why a choice was made.

Use the parent workflow taxonomy for agent-operational artifacts:

- `architecture/`: detailed system design and package relationships
- `patterns/`: reusable engineering conventions
- `decisions/`: decisions, audits, and tradeoff records
- `guides/`: procedures, runbooks, and research
- `plans/`: substantive multi-step design and future work
- `logs/`: the default session record
- `todos/`: deferred work and source-marker records

Do not copy a workflow document into the wiki. Parent docs are private by
default; the site renders only exact paths listed in
`packages/docs/wiki/src/lib/wiki-publication.ts` under `/working/`. To publish a
workflow document, first review it for public-data safety, then add its
`packages/docs/`-relative path to that explicit allowlist.

## Author the human wiki

Follow `packages/docs/wiki/AGENTS.md`.

1. Inspect the live implementation and nearby wiki pages.
2. Update the nearest existing page when possible.
3. Lead with the answer and current system shape.
4. Prefer a small Mermaid diagram for relationships, flow, ownership, or
   lifecycle. Include `accTitle` and `accDescr`.
5. Use real screenshots for visual or operational surfaces. Add useful alt text
   and store durable images in `src/assets/`.
6. Explain intent and tradeoffs; do not narrate a directory tree.
7. Keep public-data hygiene: omit secrets, private host details, personal data,
   and sensitive incident evidence.

Human pages require `title` and `description` frontmatter and no Markdown H1.
Use absolute wiki routes. One focused page is better than a broad encyclopedia
entry.

When implementation changes a meaningful boundary, operator workflow, or
architectural reason, update the human page in the same change. Routine
refactors and ephemeral fixes do not need forced wiki churn.

## Author workflow documents

Follow the canonical frontmatter, workflow, board, archival, TODO, and session
log rules in the `AGENTS.md` hierarchy. Wiki files are not docs-board inputs and
must not receive workflow frontmatter.

Before finishing a session, append the required `Session Log` with exact Done,
Remaining, and Caveats. Preserve evidence and unfinished handoff context in the
workflow document even when a curated wiki page is also updated.

## Verify

For workflow-document changes, run the relevant root docs checks:

```bash
bun run check-todos
```

For wiki changes, run from `packages/docs/wiki/`:

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

Inspect visible changes at desktop and mobile widths and attach the rendered
result to the pull request.
