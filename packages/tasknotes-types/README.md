# tasknotes-types

Shared TypeScript/Zod schema library for TaskNotes concepts (tasks, recurrence,
API request/response shapes for the supported plugin `/api/*` task contract).
Pins `@tasknotes/model` exactly and exports curated adapters through
`src/index.ts` / `src/v2.ts`. Time tracking, Pomodoro and estimates have no
public routes or task fields. Existing vault metadata is preserved without
being interpreted or updated by ordinary task operations.

Consumed via `workspace:*` by `tasknotes-server` and other TaskNotes packages.
Commands: `bun run test`, `bun run typecheck`, `bun run lint`.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes.
