# Bundle working-tree changes into one PR

## Status

Complete

## Context

The working tree on `main` held a large, multi-theme set of uncommitted changes
(plus a brand-new package and several untracked docs). Asked to "make a PR for
all of my changes," so everything was branched, committed in scoped groups, and
opened as a single PR.

## What shipped

Branch `feature/stream-lifecycle-xstate` → **PR #1146**. Seven scoped commits:

1. `feat(discord-stream-lifecycle)` — new shared XState v5 Go-Live lifecycle package.
2. `refactor(discord-plays-pokemon)` — migrate to shared package; delete local `stream-machine.ts` / `orchestrator-machine.ts`.
3. `feat(streambot)` — adopt shared topology/health events; detach/kick/guild-removal/channel-deletion/producer-failure/shutdown handling; `session-move` re-keying on admin voice moves.
4. `refactor(discord-plays-mario-kart)` — backend `GameStreamer` to shared actor.
5. `feat(discord-plays-mario-kart)` — skeuomorphic N64 controller UI (frontend, _In Progress_).
6. `fix(homelab)` — `ApplyOutOfSyncOnly=true` on argo apps + drop empty `group` on modded-minecraft ignoreDifferences.
7. `docs(docs)` — plans + session logs.

## Verification (all local, green)

| Package                                       | typecheck | tests    |
| --------------------------------------------- | --------- | -------- |
| discord-stream-lifecycle                      | ✓         | 10 ✓     |
| streambot                                     | ✓         | 22 ✓     |
| discord-plays-pokemon (backend)               | ✓         | 11 ✓     |
| discord-plays-mario-kart (backend / frontend) | ✓ / ✓     | — / 16 ✓ |
| homelab                                       | ✓         | —        |

Controller-UI screenshots (idle + live pressed-state) captured from the local
Vite app via a headed browser and attached as a PR comment.

## Session Log — 2026-06-13

### Done

- Created branch `feature/stream-lifecycle-xstate`, 7 scoped commits, pushed, opened PR #1146.
- Verified typecheck + tests across all five affected packages + homelab typecheck.
- Captured and attached desktop + active-state controller screenshots to the PR.

### Remaining

- Mario Kart controller UI is still **In Progress** pending design feedback.
- The new `discord-stream-lifecycle` package likely needs CI/Dagger wiring (no `eslint-<pkg>` pre-commit hook entry; possibly `deps.ts` / quality-ratchet / knip lists) — CI on the PR will surface anything missing.

### Caveats

- One PR intentionally bundles unrelated themes (stream lifecycle, controller UI, homelab ArgoCD, docs) per the explicit request; reviewers should treat the commits as independent.
- A mobile-width screenshot wasn't captured — headed-window resize is restricted in this environment.
