---
id: log-2026-06-13-new-todos-batch
type: log
status: complete
board: false
title: New TODO batch — cross-package backlog capture
date: 2026-06-13
---

# New TODO batch — cross-package backlog capture

## Context

The user dictated a batch of backlog items spanning many packages. This session
captured each as a tracked doc under `packages/docs/todos/`, with light
codebase exploration first so every TODO references real files and reflects the
current state (not a guess). All docs below take `origin:` this log.

## TODOs created

| id                               | area                                            | status                  | note                                                                        |
| -------------------------------- | ----------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `discord-plays-discord-oauth`    | MK64 + Pokémon web controllers                  | deferred                | umbrella; MK64 half also tracked by source-marker doc `mario-kart-web-auth` |
| `scout-app-launch`               | Scout for LoL                                   | active                  | go-to-market: advertise the already-built web app                           |
| `scout-report-backends-verify`   | Scout for LoL                                   | waiting-on-verification | confirm render + delivery backends e2e                                      |
| `scout-marketing-image-regen`    | Scout for LoL                                   | active                  | use new showcase generator; coordinate w/ `large-file-cleanup`              |
| `pokemon-docs-site`              | discord-plays-pokemon                           | active                  | no docs site exists today                                                   |
| `discord-packages-npm-publish`   | discord-video-stream + discord-stream-lifecycle | blocked                 | lifecycle pkg not on main yet                                               |
| `tasks-for-obsidian-e2e`         | iOS/RN app                                      | active                  | no simulator automation harness                                             |
| `streambot-subtitles-midstream`  | streambot                                       | deferred                | architecturally hard (Go-Live single track)                                 |
| `streambot-play-history-stats`   | streambot                                       | active                  | no persistent play history today                                            |
| `streambot-sports-streaming`     | streambot                                       | deferred                | new source/provider needed                                                  |
| `temporal-grafana-observability` | temporal/homelab                                | active                  | dashboard + alerts already exist; expand to golden signals                  |
| `homekit-secure-video`           | homelab Scrypted + HA                           | active                  | HKSV not configured today                                                   |
| `pagerduty-migration`            | homelab/toolkit/temporal/trmnl                  | active                  | 8 integration points                                                        |
| `birmel-tests-polish`            | birmel                                          | active                  | delegation/tool-exec untested                                               |
| `karma-bot-rich-leaderboards`    | starlight-karma-bot                             | active                  | reuse scout report satori stack                                             |

## Key findings during exploration

- **discord-stream-lifecycle is NOT on main** — only a stale `node_modules/`
  exists in the working tree; its source lives on
  `feature/stream-lifecycle-xstate`. The NPM-publish TODO is blocked on it
  landing.
- **Temporal already has a Grafana dashboard and alert rules** (and
  ServiceMonitors). The user's "create grafana dashboard, alerts" item was
  reframed to _expand_ existing coverage to Temporal server/SDK golden signals.
- **Pokémon has no docs site** (only `README.md` + `ROADMAP.md`). The
  `docs/docs/.../demo.mp4` path referenced in `large-file-cleanup.md` is not
  tracked on main.
- **MK64 + Pokémon share the same placeholder login pattern**
  (`{ discordId: "id", discordUsername: "username" }`). MK64's is already tagged
  with source marker `TODO(todo:mario-kart-web-auth)` at
  `dispatch.ts:75`; Pokémon's is a plain `// TODO: perform auth here` at
  `index.ts:125`.

## Session Log — 2026-06-13

### Done

- Created session log `packages/docs/logs/2026-06-13_new-todos-batch.md`.
- Created 15 TODO docs in `packages/docs/todos/` (see table above).
- Verified each TODO against the current codebase (paths, line numbers, current
  state) via parallel Explore agents + direct checks.

### Remaining

- None — this session was scoped to capturing the backlog, not implementing it.
  Each TODO carries its own "Done when" criteria for a future session.

### Caveats

- `discord-packages-npm-publish` is `blocked`: `discord-stream-lifecycle` must
  merge to `main` before it can be published.
- `scout-app-launch` (renamed from `scout-app-dashboard`): the user clarified
  the Vite `app/` SPA management dashboard is already **built** — "launch" means
  advertising/go-to-market for it, not building a dashboard page. Reframed as a
  marketing task tied to `scout-marketing-image-regen`.
