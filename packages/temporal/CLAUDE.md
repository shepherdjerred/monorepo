# packages/temporal

Temporal workflow worker for the monorepo. Consolidates ad-hoc scheduling (K8s CronJobs, in-process cron, custom job queues) under Temporal for durability, observability, and unified scheduling.

## Runtime

Runs under **Bun**. The Temporal TypeScript SDK supports Bun for workers, workflows, activities, and client.

## Structure

```
src/
  worker.ts              # Worker entrypoint — connects to Temporal server, registers task queues
  client.ts              # Shared Temporal client factory (reusable by other packages)
  shared/
    task-queues.ts       # Task queue name constants
    schemas.ts           # Zod schemas for workflow inputs
  workflows/             # Temporal workflow definitions (deterministic, no I/O)
  activities/            # Temporal activity implementations (actual work: API calls, DB, etc.)
  schedules/
    register-schedules.ts  # Creates/updates all Temporal schedules on worker startup
```

## Key Concepts

- **Workflows** are deterministic functions. No direct I/O — call activities instead.
- **Activities** do the real work (HTTP calls, DB queries, file I/O). They run outside the sandbox.
- **Schedules** replace K8s CronJobs — managed by Temporal, visible in the UI.

## Commands

```bash
bun run start        # Start worker (connects to Temporal server)
bun run typecheck    # Type check (runs ensure-ha-schema first)
bun run lint         # ESLint
bun test             # Run tests
bun run generate     # Regenerate src/generated/ha-schema.ts from live HA (needs HA_URL + HA_TOKEN)
```

## HA schema (type-safe workflows)

Workflows that touch Home Assistant go through `src/workflows/ha/util.ts`, which wraps each activity in a schema-parameterized signature — entity IDs, domains, services, and service data are type-checked against `src/generated/ha-schema.ts`.

That file is **gitignored** (`packages/temporal/.gitignore`). It is produced by `@shepherdjerred/home-assistant`'s `ha-codegen` CLI and contains entity IDs / service definitions from the live HA instance, which is treated as sensitive (see the `HA types are sensitive, generate in CI` auto-memory).

Two committed artifacts make this work without always needing HA credentials:

- `src/generated/ha-schema.stub.ts` — a permissive `DefaultHaSchema` fallback. No sensitive content.
- `scripts/ensure-ha-schema.ts` — pre-script that copies the stub into `ha-schema.ts` when the generated file is missing. Invoked automatically by `bun run typecheck`, `bun test`, and `bun run build`.

Workflow:

- **Local dev with HA access**: `bun run generate` populates `ha-schema.ts` with real data. Workflows get strict type safety. Don't commit the result.
- **Local dev without HA access**: stub flows in automatically via `ensure-ha-schema.ts`. Workflows typecheck against `DefaultHaSchema` (loose strings). Same compile behavior as before this feature landed.
- **CI (Dagger)**: today runs against the stub. To get strict typing in CI, add a `generateAndTypecheck` variant in `.dagger/src/typescript.ts` that injects `HA_URL` + `HA_TOKEN` via `withSecretVariable`, and register temporal in the codegen-required packages set (`scripts/ci/src/catalog.ts`'s `PRISMA_PACKAGES` is the analogous place). Not wired yet — the stub keeps CI green.

## Environment Variables

- `TEMPORAL_ADDRESS` — Temporal server gRPC address (default: `temporal-server.temporal.svc.cluster.local:7233`)
- `HA_URL` — Home Assistant URL
- `HA_TOKEN` — Home Assistant long-lived access token
- `GOLINK_URL` — Golink service URL
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` — S3/SeaweedFS credentials
- `GH_TOKEN` — GitHub API token
- `OPENAI_API_KEY` — OpenAI API key
- `POSTAL_HOST`, `POSTAL_API_KEY` — Postal email service
- `RECIPIENT_EMAIL`, `SENDER_EMAIL` — Email addresses for dependency summary
