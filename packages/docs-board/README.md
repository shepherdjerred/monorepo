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

## Verification

```bash
bun run --cwd packages/docs-board typecheck
bun run --cwd packages/docs-board test
bun run --cwd packages/docs-board lint
bun run --cwd packages/docs-board build
bun run check-todos
```
