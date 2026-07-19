# Docs Workboard

Local macOS workboard for `packages/docs/**/*.md`. Markdown is the only durable
datastore: the app scans the current checkout, renders canonical workflow
metadata, and writes status transitions, comments, and archival moves back to
the same files.

From the repository root:

```bash
bun run docs:board
```

The command builds the Vite client, starts a loopback-only Hono server at
`http://127.0.0.1:7331`, and opens it in the default browser. Use
`bun run --cwd packages/docs-board dev` for Vite development mode.

The board lives at `/`. Selecting a card opens a deep-linkable
`/documents/:id` page that leads with the relevant human-verification or
remaining-work section. The complete rendered Markdown remains available in
the Full Document tab.

The client and server share an inferred tRPC `AppRouter`; Zod still validates
every procedure input and output at runtime. TanStack React Query caches board
and detail reads, prefetches card details, updates successful mutations from
their responses, and invalidates active data from a typed SSE subscription.

## Workflow Model

The board columns map directly to canonical frontmatter statuses:

| Column                                  | Frontmatter status |
| --------------------------------------- | ------------------ |
| Planned                                 | `planned`          |
| In Progress                             | `in-progress`      |
| Completed (Awaiting Human Confirmation) | `awaiting-human`   |
| Complete                                | `complete`         |

Board documents use `## Remaining`, `## Human Verification`, and append-only
`## Comment Log` sections. Writes use content revisions and atomic replacement
so an external edit produces a visible conflict instead of being overwritten.
Awaiting-human pages expose explicit **Confirm complete** and **Request
changes** actions; requesting changes requires a reason and moves the document
back to `in-progress` in the same audited Markdown update.

## Verification

```bash
bun run --cwd packages/docs-board typecheck
bun run --cwd packages/docs-board test
bun run --cwd packages/docs-board lint
bun run --cwd packages/docs-board build
bun run check-todos
```
