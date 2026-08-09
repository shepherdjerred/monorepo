---
title: Tasks for Obsidian
description: Native task capture and organization over the markdown-backed TaskNotes service.
---

Tasks for Obsidian is the native mobile surface over the TaskNotes markdown
vault. It keeps durable task data in the server-backed vault while giving the
iOS app fast capture, offline queueing, task organization, and saved views.

## Current product boundary

- Quick Add supports contextual capture, natural-language dates, and a
  save-and-add-another flow.
- Task detail can organize a task across projects, tags, and contexts, and
  list actions support bulk completion, deletion, scheduling, and priority
  changes.
- Saved views are device-local definitions that can be created, renamed,
  reordered, favorited, styled, and deleted without changing task files.
- The simulator E2E suite checks authoritative markdown files after UI flows,
  including offline replay, recurring completion, saved-view lifecycle, and
  uncomplete persistence.

## Where to look

- [The React Native app](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasks-for-obsidian)
- [TaskNotes server](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-server)
- [Product comparison and remaining gaps](/working/guides/2026-07-22_todoist-feature-comparison/)
