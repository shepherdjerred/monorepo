# tasknotes-types

Shared TypeScript/Zod schema library for TaskNotes concepts (tasks, recurrence,
API request/response shapes for the upstream plugin `/api/*` contract). Pins
`@tasknotes/model` exactly and re-exports through `src/index.ts` / `src/v2.ts`.

Consumed via `workspace:*` by `tasknotes-server` and other TaskNotes packages.
Commands: `bun run test`, `bun run typecheck`, `bun run lint`.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
