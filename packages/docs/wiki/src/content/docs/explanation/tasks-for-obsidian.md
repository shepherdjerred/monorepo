---
title: About Tasks for Obsidian
description: Why a native mobile app sits over a markdown vault, and where its boundary currently is.
sidebar:
  order: 6
---

Tasks for Obsidian is a React Native app over the TaskNotes markdown vault. The
durable data stays as markdown files on the server; the app is a fast surface
over them.

The tension it manages: markdown files are the right storage for tasks you want
to own forever, and completely the wrong storage for a phone that is
occasionally offline and needs to feel instant.

## Why the vault stays authoritative

Task data lives in the vault, not in an app database that syncs to it. There is
no second source of truth to reconcile.

That constrains the app — every write eventually has to become a file edit — but
it means the tasks remain readable, greppable, and portable without the app
existing. A task app that outlives its vendor is the whole point of storing
tasks in Obsidian.

Offline writes queue and replay rather than being applied locally and merged
later.

## The current boundary

- **Quick Add** does contextual capture, natural-language dates, and
  save-and-add-another.
- **Task detail** organizes a task across projects, tags, and contexts. List
  actions do bulk completion, deletion, scheduling, and priority changes.
- **Saved views** are device-local definitions. They can be created, renamed,
  reordered, favorited, styled, and deleted without touching task files.

Saved views being device-local is a deliberate split: a view is a preference
about how you look at your tasks, not data about the tasks, so it has no
business writing into the vault.

## How the boundary is defended

The simulator E2E suite checks the **authoritative markdown files** after UI
flows — not just the UI state.

That is the only assertion that actually proves the app and the vault agree.
Coverage includes offline replay, recurring completion, saved-view lifecycle,
and uncomplete persistence, each of which is a place where a UI could plausibly
look right while the file was wrong.

## Related

- [The React Native app](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasks-for-obsidian)
- [TaskNotes server](https://github.com/shepherdjerred/monorepo/tree/main/packages/tasknotes-server)
- [Product comparison and remaining gaps](/working/guides/2026-07-22_todoist-feature-comparison/)
