# TaskNotes Server

Hono HTTP server (Bun runtime) that reads/writes task markdown files and exposes the TaskNotes API. Designed to run alongside the obsidian-sync-client as a K8s sidecar sharing a vault volume.

## NOT a workspace member

This package has its own `node_modules` — always `cd packages/tasknotes-server` before running commands.

## Quick Reference

```bash
bun install                          # Install deps
bun run typecheck                    # Type check
bun test                             # Run tests
bunx eslint . --max-warnings=0       # Lint
bun run build                        # Compile to binary (dist/tasknotes-server)
bun run dev                          # Dev mode (auto-reload)
bun run start                        # Run directly
```

## Architecture

```
src/
  domain/types.ts          # Task, branded types (mirrors mobile app)
  domain/schemas.ts        # Zod request validation schemas
  middleware/auth.ts        # Bearer token auth (skips /api/health)
  middleware/envelope.ts    # Wraps responses in { success, data }
  routes/                  # 23 Hono route handlers
  store/task-store.ts      # In-memory Map<string, Task> from vault scan
  store/time-store.ts      # Time entries in _tasknotes/time-tracking.json
  store/pomodoro-store.ts  # Ephemeral pomodoro state
  vault/reader.ts          # Walk vault dir, parse .md → Task
  vault/writer.ts          # Atomic writes (temp → rename), slugified filenames
  vault/frontmatter.ts     # gray-matter parse/serialize
  vault/task-mapper.ts     # Frontmatter ↔ Task bidirectional mapping
  vault/watcher.ts         # fs.watch with 200ms debounce
  nlp/parser.ts            # NLP: @context, p:project, #tag, !priority, dates
```

## API Endpoints

All responses use envelope: `{ success: boolean, data: T, error?: string }`

- Task CRUD: `GET/POST/PUT/DELETE /api/tasks[/:id]`
- Status/Archive: `POST /api/tasks/:id/status`, `/archive`, `/complete-recurring`
- Query/Stats: `POST /api/tasks/query`, `GET /api/tasks/stats`, `/filters`
- NLP: `POST /api/nlp/parse`, `/create`
- Time: `POST /api/time/:id/start`, `/stop`, `GET /api/time/:id`, `/summary`
- Pomodoro: `POST /api/pomodoro/start`, `/stop`, `/pause`, `GET /api/pomodoro/status`
- Calendar: `GET /api/calendar/events`
- Health: `GET /api/health`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VAULT_PATH` | Yes | — | Path to synced vault directory |
| `TASKS_DIR` | No | `""` | Subfolder within vault for task files |
| `AUTH_TOKEN` | Yes | — | Bearer token for API auth |
| `PORT` | No | `3000` | Server port |

## Domain Compatibility

Types and schemas mirror the mobile app (`packages/tasks-for-obsidian/src/domain/`). Changes to the mobile app's API contract should be reflected here.
