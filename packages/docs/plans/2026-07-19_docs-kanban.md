---
id: plan-2026-07-19-docs-kanban
type: plan
status: in-progress
board: true
verification: human
disposition: active
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

- Add a Bun/Hono API and a React 19/Vite app using the latest shadcn CLI,
  Base UI, the compact `base-nova` style, Tailwind CSS v4, and shadcn/typeset.
- Show the current checkout and branch, provide the four-column board, filters,
  global document search, responsive document details, comments, status
  transitions, and guarded archival.
- Restrict writes to workflow frontmatter, append-only comments/audit entries,
  and safe archival. Use atomic writes and revision-based conflict detection.
- Watch external Markdown edits and refresh connected browsers.

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
- [ ] Capture browser-level screenshots of the board and document detail view.
- [x] Publish the branch and draft PR (#1573).

## Human Verification

- Launch `bun run docs:board` on macOS.
- Confirm the board highlights meaningful work and that document search covers
  the full docs corpus.
- Confirm comments and status transitions feel useful for delayed production
  signoff.

## Session Log - 2026-07-19

### Done

- Created an isolated `feature/docs-kanban` worktree from current `origin/main`.
- Installed the workspace, ran code generation, and armed repository hooks.
- Migrated and validated all 767 Markdown documents with an idempotent canonical
  model; archived 15 completed plans.
- Added `packages/docs-board` with the Bun/Hono store and API, React 19/Vite
  board, latest shadcn `base-nova` components, Tailwind CSS v4, comments,
  guarded transitions, archival, conflict detection, and external-edit refresh.
- Added six automated workflow tests and passed package typecheck, lint, test,
  build, Knip, Prettier, Markdownlint, and docs validation gates.
- Rebased onto current `origin/main`, passed full and affected verification
  (181/181 tasks each), pushed `feature/docs-kanban`, and opened draft PR #1573.

### Remaining

- Attach a Browser surface, capture the real board/detail screenshots, then add
  them to PR #1573.

### Caveats

- The user's main checkout contains separate uncommitted docs and dotfile work;
  this branch does not copy or modify those files.
- This Codex session reported no attached in-app Browser surface, so visual QA
  and screenshot capture are waiting on that UI attachment.
