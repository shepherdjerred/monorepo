# TaskNotes Server

Hono HTTP server (Bun runtime) that reads/writes task markdown files and exposes the TaskNotes API. Designed to run alongside obsidian-headless (official Obsidian CLI) as a K8s sidecar sharing a vault volume.

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

## Architecture (P3 — @tasknotes/model engine)

The vault layer is `@tasknotes/model` (the upstream plugin's own engine
library, pinned exact in `tasknotes-types`). Task IDs are vault-relative
paths (URL-encoded in routes). Reads are tolerant; every task-like file
that fails to parse is counted, logged, and surfaced at
`GET /api/engine-status` — never silently dropped. Writes are
read-modify-write from disk through the model's plan builders +
`applyFrontmatterPatch`, so concurrent Obsidian edits and unknown
frontmatter keys survive byte-for-byte.

```
src/
  engine/model-config.ts    # Load plugin data.json → TaskNotesModelConfig
  engine/vault-files.ts     # Byte-level IO: walk, atomic write (root errors throw)
  engine/task-repository.ts # THE store: parse/detect, plan-based mutations
  engine/watcher.ts         # Debounce + max-wait, error re-arm, safety rescan
  engine/query.ts           # Upstream FilterQuery tree evaluator
  engine/stats.ts           # Config-driven stats + filter-options
  engine/time-reports.ts    # /api/time summary + active (frontmatter entries)
  engine/filename.ts        # Title-as-filename + " 1" dedup
  v2/routes.ts              # Upstream plugin API surface (/api/*)
  legacy/routes.ts          # Old camelCase contract for the P2 app (/legacy/api/*)
  migration/migrate.ts      # Pure per-file legacy→plugin-format migration
  middleware/               # auth, envelope, idempotency, logger, metrics
  store/pomodoro-store.ts   # Ephemeral pomodoro state (both surfaces)
  nlp/parser.ts             # NLP: @context, p:project, #tag, !priority, dates
scripts/
  migrate-vault.ts          # P4: tag legacy files, fold time side-store, drop ids
  vault-audit.ts            # P4 gate: parse-skips + round-trip byte-diffs must be 0
```

## API Surfaces

All responses use envelope: `{ success: boolean, data: T, error?: string }`

**`/api/*` — the upstream TaskNotes plugin contract (v2, P5 app target):**

- Task CRUD: `GET/POST/PUT/DELETE /api/tasks[/:id]` (TaskInfo, snake_case
  recurrence fields, pagination default 50 / cap 200, `DELETE → {message}`)
- Status/Archive: `POST /api/tasks/:id/toggle-status` (no body; cycles the
  configured workflow), `/archive` (returns the task), `/complete-instance`
  (`{date?, completed?}` — `completed` = idempotent set-semantics)
- Query: `POST /api/tasks/query` (upstream FilterQuery TREE; unknown
  property/operator → 400); `GET /api/stats`, `/filter-options` (config
  OBJECTS for statuses/priorities)
- NLP: `POST /api/nlp/parse → {parsed, taskData}`, `/create → {task, parsed}`
- Time: `POST /api/tasks/:id/time/start|stop`, `GET /api/time/active`,
  `/summary` (upstream TimeSummaryResult)
- Calendars: `GET /api/calendars/events` (task events + recurring expansion)
- `GET /api/engine-status` (parse skips, config provenance), `/api/health`

**`/legacy/api/*` — the old camelCase contract (P2 app; deleted at P6):**
same endpoints/shapes the old server exposed, translated onto the new
engine. The app's configurable API URL points here from the P4 rollout
until P5.

### Complete-instance body (optional)

`POST /api/tasks/:id/complete-instance` accepts `{date?: "YYYY-MM-DD", completed?: boolean}`:
no body = legacy toggle of server-local today (upstream plugin parity); `date` targets the
device-captured instance; `completed` gives idempotent SET semantics (required for safe
offline-queue replay). Non-recurring tasks are a 400 (upstream parity).

### Idempotent mutations

Mutating `/api/` requests may carry an `X-Mutation-Id` header (the app's offline queue
sends its command id). Replays of an already-executed mutation return the stored response
with `X-Idempotent-Replay: true` instead of executing twice. Records persist at
`<vault>/.tasknotes-server/idempotency.json` (7-day TTL, 500-record cap, atomic writes)
so dedup survives restarts.

## Environment Variables

| Variable     | Required | Default | Description                           |
| ------------ | -------- | ------- | ------------------------------------- |
| `VAULT_PATH` | Yes      | —       | Path to synced vault directory        |
| `TASKS_DIR`  | No       | `""`    | Subfolder within vault for task files |
| `AUTH_TOKEN` | Yes      | —       | Bearer token for API auth             |
| `PORT`       | No       | `3000`  | Server port                           |

## Shared Types

Types and schemas come from `packages/tasknotes-types/` (shared with mobile app). The `details` field (not `description`) holds the task body content. `TaskStats` uses upstream shape: `{ total, completed, active, overdue, archived, withTimeTracking }`.
