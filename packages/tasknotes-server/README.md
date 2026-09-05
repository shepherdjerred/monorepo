# tasknotes-server

Hono HTTP server (Bun runtime) that reads and writes TaskNotes task markdown
files and exposes the upstream TaskNotes plugin API (`/api/*`). Designed to run
alongside obsidian-headless as a Kubernetes sidecar sharing a vault volume.

The vault layer is `@tasknotes/model` — the upstream plugin's own engine
library — so writes are plan-based read-modify-write and concurrent Obsidian
edits survive byte-for-byte.

## API

One surface, envelope responses (`{ success, data, error? }`):

- Task CRUD and query (upstream FilterQuery trees), stats, filter options
- NLP parsing/creation (`/api/nlp/parse`, `/api/nlp/create`)
- Time tracking (`/api/tasks/:id/time/*`, `/api/time/*`)
- Calendar events with recurring expansion (`/api/calendars/events`)
- Pomodoro (ephemeral, vault-independent) (`/api/pomodoro/*`)
- Health and engine status (`/api/health`, `/api/engine-status`)

## Commands

```bash
bun run dev           # Dev mode with reload
bun run start         # Run directly
bun run build         # Compile to a single binary (dist/tasknotes-server)
bun run test              # Tests
bun run typecheck     # tsc --noEmit
bun run lint          # ESLint (zero warnings)
bun run docker:build  # Build the Docker image (pushed to GHCR by CI)
bun run smoke         # Smoke-test the built image
```

## Engine and mutation contracts

Task IDs are URL-encoded vault-relative paths. Every write starts from current
disk bytes and applies the model's mutation plan so concurrent Obsidian edits
and unknown frontmatter keys survive. Malformed task-like files are counted,
logged, and exposed through `/api/engine-status`; root filesystem failures are
fatal.

Mutating requests may include `X-Mutation-Id`. The server persists the response
in the vault and returns it with `X-Idempotent-Replay: true` on replay instead
of executing the mutation twice.

| Variable     | Required | Default | Purpose                            |
| ------------ | -------- | ------- | ---------------------------------- |
| `VAULT_PATH` | yes      | —       | shared vault directory             |
| `TASKS_DIR`  | no       | empty   | task subdirectory within the vault |
| `AUTH_TOKEN` | yes      | —       | bearer authentication token        |
| `PORT`       | no       | `3000`  | HTTP port                          |

Migration and audit utilities live in `scripts/`; read the script's help and
run the vault audit before applying a migration. [AGENTS.md](AGENTS.md) contains
only the invariants that must remain in agent context.
