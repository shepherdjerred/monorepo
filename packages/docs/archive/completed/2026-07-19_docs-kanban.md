---
id: plan-2026-07-19-docs-kanban
type: plan
status: complete
board: false
---

# Markdown-Backed Documentation Kanban

## Summary

Build a local browser app that treats `packages/docs/**/*.md` as its only
durable datastore. Groom the documentation corpus into a consistent, validated
model and expose meaningful tracked work in four columns:

`PLANNED` -> `IN PROGRESS` -> `COMPLETED (AWAITING HUMAN CONFIRMATION)` -> `COMPLETE`

All other documentation remains searchable without cluttering the board.

## Markdown Model and Grooming

- Add canonical YAML frontmatter to every Markdown document: globally unique
  `id`, `type`, `status`, and `board`.
- Require `verification` and `disposition` for board items while retaining TODO
  `origin` and `source_marker` metadata.
- Make frontmatter the sole workflow state, normalize semantic H1 headings, and
  use `## Remaining`, `## Human Verification`, and append-only
  `## Comment Log` sections for workflow data.
- Archive eligible completed plans and TODOs while preserving their IDs and
  history.
- Expand the TODO checker into a complete docs-model validator.

## Local Application

- Add a Bun/Hono host with an end-to-end typed tRPC API and a React 19/Vite app
  using the latest shadcn CLI, Base UI, the compact `base-nova` style, Tailwind
  CSS v4, and shadcn/typeset.
- Show the current checkout and branch, provide the four-column board, filters,
  global document search, responsive document details, comments, status
  transitions, and guarded archival.
- Restrict writes to workflow frontmatter, append-only comments/audit entries,
  and safe archival. Use atomic writes and revision-based conflict detection.
- Watch external Markdown edits and refresh connected browsers.
- Use TanStack React Query for cached board/detail reads, detail prefetching,
  mutation cache updates, optimistic board moves, and typed SSE invalidation.
- Open documents on dedicated, deep-linkable pages that prioritize the relevant
  human-verification or remaining-work section, with full Markdown as a
  secondary tab.

## Verification and Delivery

- Test the schema, migration, TODO-marker invariants, document store, API,
  status/comment flows, and UI behavior.
- Verify the running app in the browser and attach screenshots to the PR.
- Run package gates, docs gates, affected verification, and full repository
  verification.

## Remaining

- [x] Implement and validate the canonical Markdown model.
- [x] Groom the existing documentation corpus.
- [x] Build the local API and shadcn board interface.
- [x] Add automated schema, store, API, comment, transition, and archival verification.
- [x] Capture browser-level screenshots of the board and document detail view.
- [x] Publish the branch and draft PR (#1573).

## Human Verification

- **Action:** Open the local board on macOS, find one real task through the board and one through global search, add a comment, request changes on a test item, and return to the board.
- **Expected behavior:** The important work is easy to distinguish from reference documents; search finds the intended document; the detail view makes the next human decision obvious; comments and status changes feel predictable and preserve context.
- **Acceptance decision:** Accept if the workflow is clear enough to use for delayed signoff without consulting Markdown source. Otherwise request changes and name the confusing navigation, prioritization, or transition.

## Comment Log

### 2026-08-03T05:46:45.315Z - Jerred Shepherd

Moved `awaiting-human` -> `complete`.
