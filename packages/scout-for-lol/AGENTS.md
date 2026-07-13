# Scout for LoL - Project Guide

## Environment Notes

**Remote environments**: When `CLAUDE_CODE_REMOTE=true`, use `bun run` commands for local development tasks.

## Project Structure

Monorepo using **Bun workspaces**:

```text
packages/
├── backend/   # Discord bot backend service (Discord.js, Prisma, twisted)
├── data/      # Shared data models, schemas, and utilities
├── report/    # Report generation components (React + satori)
├── frontend/  # Web frontend (Astro + React + Tailwind)
├── desktop/   # Desktop app (Tauri + React + Vite)
└── ui/        # Shared UI components (React)
```

## Workspace Dependencies

Scout's sub-packages are part of the root Bun workspace and use `workspace:*`
for internal dependencies (for example `@scout-for-lol/data` and
`@scout-for-lol/backend`). Run `bun install` once at the repository root after
dependency changes.

- The isolated linker is configured at the repository root. Do not add package
  local `bunfig.toml` linker overrides.
- Internal Scout package edits are visible through workspace symlinks; no
  package-local reinstall is needed to refresh copied `file:` dependencies.
- The app imports the backend `AppRouter` as `import type` only, so tRPC
  input/output changes still need dependent typechecks before the app sees the
  new procedure shape.

---

## Core Technologies

| Category      | Technology                       |
| ------------- | -------------------------------- |
| Runtime       | Bun                              |
| Language      | TypeScript (strict mode)         |
| Linting       | ESLint + Prettier                |
| Database      | Prisma ORM                       |
| Validation    | Zod                              |
| Task Runner   | mise                             |
| Bot Framework | Discord.js                       |
| Frontend      | Astro                            |
| Desktop       | Tauri + Vite                     |
| Reports       | React + satori + @resvg/resvg-js |

## Development Commands

### Root Level

```bash
bun install              # Install all dependencies
bun run typecheck        # Type checking across all packages
bun run lint             # Linting across all packages
bun run format           # Formatting check across all packages
bun run test             # Testing across all packages
bun run generate         # Generate Prisma client and other generated code
bun run clean            # Clean all node_modules
bun run knip             # Find unused code/dependencies
bun run duplication-check # Check for code duplication
```

### Using mise (Task Runner)

```bash
mise run dev             # Setup development environment
mise run check           # Run all checks (typecheck, lint, format, test, knip, duplication-check)
mise run generate        # Generate Prisma client
```

### Backend Package

```bash
cd packages/backend
bun run dev              # Start with hot reload
bun run build            # Build for production
bun run db:generate      # Generate Prisma client
bun run db:push          # Push schema to database
bun run db:migrate       # Run migrations
bun run db:studio        # Open Prisma Studio
```

### Web UI (Local end-to-end)

```bash
bun run --filter='./packages/scout-for-lol' dev:web
```

This boots the backend on `:3000` (logging in as the BETA Discord bot) and the
Vite dev server on `:5180` (proxying `/trpc` + `/api` to the backend). It
applies Prisma migrations against a local `local-web-dev.db` first.

Secrets are pulled at runtime via `op run --env-file=dev-web.env.tpl` — no
plaintext credentials are written to disk. You must be `op signin`'d.

**Caveats:**

- While running, the deployed beta bot is disconnected from Discord (one
  gateway connection per token). Stop with Ctrl+C and beta reconnects within
  seconds.
- The BETA Discord app (`1311755320745394317`) must list
  `http://localhost:5180/api/auth/discord/callback` in its OAuth redirect
  URIs, otherwise the token exchange returns 400.
- The bot only sees guilds it has been invited to. To populate the guild
  picker, make sure your test guild has the BETA bot in it.

### Desktop Package

```bash
cd packages/desktop
bun run dev              # Start Tauri dev mode
bun run build            # Build desktop app
bun run build:macos      # Build for macOS (universal)
bun run build:linux      # Build for Linux
bun run build:windows    # Build for Windows
```

Each package supports: `dev`, `build`, `test`, `lint`, `format`, `typecheck`

## CI/CD

There is no CI — the Dagger + Buildkite pipeline was removed 2026-07. Run checks locally (`mise run check`) and build/push container images manually.

---

## TypeScript Standards

### Strict Type Safety Rules

- **NEVER use `any`** - Always define proper types
- **Avoid type assertions (`as`)** - Enforced by `custom-rules/no-type-assertions`
- **Use `unknown` for uncertain types** - Validate with Zod before processing
- **Prefer advanced types** - Mapped types, conditional types, template literals
- **Exhaustive pattern matching** - Use `ts-pattern` for complex branching
- **Strict null checks** - Handle undefined/null explicitly
- **No type guards** - Enforced by `custom-rules/no-type-guards`, use Zod validation instead

### Validation Patterns

```typescript
// Always validate unknown input with Zod
const result = SomeSchema.safeParse(unknownData);
if (!result.success) {
  throw new Error(fromZodError(result.error).toString());
}

// Advanced types for complex scenarios
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};
```

### Error Handling

- Use `zod-validation-error` for user-friendly error messages
- Handle errors at appropriate levels
- Use Result patterns where appropriate
- Proper async/await error handling (enforced by `custom-rules/prefer-async-await`)

---

## Custom ESLint Rules

The project uses custom ESLint rules in `eslint-rules/`:

| Rule                        | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `no-type-assertions`        | Disallow `as` type assertions                   |
| `no-type-guards`            | Disallow custom type guard functions            |
| `prefer-zod-validation`     | Enforce Zod for runtime validation              |
| `prefer-bun-apis`           | Prefer Bun APIs over Node.js equivalents        |
| `prefer-async-await`        | Disallow .then()/.catch() promise chains        |
| `prefer-structured-logging` | Require tslog instead of console.log (backend)  |
| `zod-schema-naming`         | Enforce \*Schema suffix for Zod schemas         |
| `no-dto-naming`             | Disallow _Dto suffix (use Raw_ prefix)          |
| `require-ts-extensions`     | Require .ts extensions in imports               |
| `satori-best-practices`     | Enforce satori rendering requirements (report)  |
| `prisma-client-disconnect`  | Ensure Prisma clients are disconnected in tests |
| `no-re-exports`             | Disallow barrel file re-exports                 |
| `no-function-overloads`     | Disallow TypeScript function overloads          |
| `no-parent-imports`         | Disallow `../` imports                          |
| `no-shadcn-theme-tokens`    | Prevent shadcn tokens in marketing components   |

---

## Color Usage Convention (Frontend)

**Marketing components** (`components/*.astro`, `pages/*.astro`, non-UI TSX):

- Use explicit Tailwind colors: `text-gray-900 dark:text-white`
- Use `colors.ts` utilities: `iconColors`, `badgeColors`, `gradientColors`
- **NEVER** use shadcn theme tokens (`text-foreground`, `bg-primary`, etc.)
- Enforced by ESLint rule `custom-rules/no-shadcn-theme-tokens`

**UI components** (`components/ui/*.tsx`):

- shadcn theme tokens are allowed and expected
- These components are designed for the theming system

### Standard Color Replacements

| shadcn token              | Explicit Tailwind                      |
| ------------------------- | -------------------------------------- |
| `text-foreground`         | `text-gray-900 dark:text-white`        |
| `text-muted-foreground`   | `text-gray-600 dark:text-gray-300`     |
| `text-primary-foreground` | `text-white` (on colored bg)           |
| `text-primary`            | `text-indigo-600 dark:text-indigo-400` |
| `bg-background`           | `bg-white dark:bg-gray-900`            |
| `bg-primary`              | `bg-indigo-600` or specific color      |
| `bg-muted`                | `bg-gray-100 dark:bg-gray-800`         |
| `bg-card`                 | `bg-white dark:bg-gray-800`            |
| `border-border`           | `border-gray-200 dark:border-gray-700` |

---

## Web App vs Marketing Site — Distinct Design

Two separate web surfaces with **intentionally distinct visual design**:

- `packages/app/` — Vite + React SPA, served at `scout-for-lol.com/app/`. Authenticated subscription management (tables, forms, modals). Should look like a clean admin product.
- `packages/frontend/` — Astro marketing site. Content-heavy, Riot/LoL-branded (Beaufort for LoL + Spiegel fonts, indigo palette), conversion-focused.

Rules:

- Never `@import` `frontend/src/styles/global.css` or its tokens into `app/`.
- Never reuse the marketing site's fonts (Beaufort for LoL, Spiegel), color scale, radius, or shadow choices in `app/`. The app has its own `src/styles/tokens.css` and its own Tailwind v4 `@theme` block.
- Shared **dependencies** are fine (Tailwind v4, Radix, lucide-react, clsx, tailwind-merge). Shared **visual tokens/components** are not — if both surfaces ever need a shadcn-style Button/Card/Dialog, each gets its own copy with its own tokens (do not put them in a shared package).

---

## Code Quality Limits

Enforced by ESLint:

- **max-lines**: 500 lines per file (1500 for tests)
- **max-lines-per-function**: 400 lines (200 for tests)
- **complexity**: 20 max cyclomatic complexity
- **max-depth**: 4 levels of nesting
- **max-params**: 4 parameters per function
- **File naming**: kebab-case enforced by `unicorn/filename-case`

---

## Key Libraries

| Library                | Purpose                                 |
| ---------------------- | --------------------------------------- |
| `remeda`               | Functional data transformations         |
| `ts-pattern`           | Complex control flow / pattern matching |
| `env-var`              | Type-safe environment configuration     |
| `date-fns`             | Date operations                         |
| `zod`                  | Runtime validation and schemas          |
| `zod-validation-error` | User-friendly validation errors         |
| `twisted`              | Riot Games API client                   |
| `satori`               | JSX to SVG rendering                    |
| `@resvg/resvg-js`      | SVG to PNG conversion                   |
| `tslog`                | Structured logging (backend)            |

---

## Discord Bot Patterns

### Command Structure

Commands live in `packages/backend/src/discord/commands/`. Each command exports:

- `SlashCommandBuilder` - Command definition (collected in `discord/rest.ts` for registration)
- `execute` function - Command handler (dispatched by name/subcommand in `discord/commands/index.ts`)

Builders and executors are wired **separately** by name in those two files — there
is no per-command registry object, so adding a command means exporting the builder,
adding it to `rest.ts`, and adding an `execute*` case to `commands/index.ts`.

### Adding a Slash Command — `define-command.ts`

Shared helpers in `discord/commands/define-command.ts` remove the boilerplate every
command handler used to repeat. Prefer them for new commands:

- **`parseCommandArgs(interaction, schema, rawArgs)`** — validate the options object
  against a Zod schema. On failure it replies with a friendly ephemeral validation
  message (system-boundary rule: user input gets a reply, not a throw) and returns
  `{ success: false }` so you `return` early. On success returns `{ success: true, data }`.
- **`replyError(interaction, context, error)`** — the single error-reply path. Picks
  `editReply` vs `reply` based on the deferred/replied state, formats as
  `❌ **Error <context>**`, and never throws even if the interaction token expired.
- **`defineCommand({ builder, args, execute })`** — optional convenience to co-locate a
  command's builder, args schema, and handler in one object.

```typescript
const ArgsSchema = z.object({
  alias: z.string().min(1),
  guildId: DiscordGuildIdSchema,
});

export async function executeExample(interaction: ChatInputCommandInteraction) {
  const parsed = await parseCommandArgs(interaction, ArgsSchema, {
    alias: interaction.options.getString("alias"),
    guildId: interaction.guildId,
  });
  if (!parsed.success) return;

  await interaction.deferReply({ ephemeral: true });
  try {
    // …command logic using parsed.data…
  } catch (error) {
    await replyError(interaction, "doing the thing", error);
  }
}
```

The legacy group helpers delegate to these: `subscription/reply-helpers.ts`'s
`editReplyOnError` and `admin/utils/validation.ts`'s `validateCommandArgs` are thin
wrappers over `replyError` / `parseCommandArgs`. The `competition/` reply helpers
(`replyWithError` / `replyWithSuccess` / `replyWithErrorFromException`) stay separate —
they carry distinct semantics (message truncation, success replies, Sentry capture,
a different error-text format) that `replyError` intentionally does not absorb.

### Discord Error Handling

```typescript
// Always handle Discord API errors gracefully
try {
  await interaction.reply({ content: "Success!" });
} catch (error) {
  logger.error("Discord API error", { error });
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content: "An error occurred",
      ephemeral: true,
    });
  } else {
    await interaction.reply({ content: "An error occurred", ephemeral: true });
  }
}
```

### Best Practices

- Validate all user input with Zod schemas
- Use ephemeral responses for error messages
- Use embeds for rich content presentation
- Handle message length limits appropriately
- Provide clear, user-friendly error messages
- Use structured logging with tslog (not console.log)

---

## League of Legends API Integration

- Use the `twisted` library for Riot API calls
- Implement proper rate limiting and retry logic
- Cache API responses appropriately
- Handle API errors and rate limits gracefully

### External Data Type Naming Convention

Types representing external/unvalidated data (from Riot API, user input, etc.) must use the **`Raw*` prefix**:

```typescript
// Correct: Raw* prefix for external data types
type RawMatch = z.infer<typeof RawMatchSchema>;
type RawParticipant = z.infer<typeof RawParticipantSchema>;
type RawTimeline = z.infer<typeof RawTimelineSchema>;
type RawSummonerLeague = z.infer<typeof RawSummonerLeagueSchema>;

// Incorrect: *Dto suffix (legacy pattern - do not use)
type MatchDto = ...;        // Use RawMatch instead
type ParticipantDto = ...;  // Use RawParticipant instead
```

**File naming**: Schema files should use `raw-*.schema.ts` pattern:

- `raw-match.schema.ts`
- `raw-participant.schema.ts`
- `raw-timeline.schema.ts`

**Why this convention?**

- Clearly distinguishes between unvalidated external data (`Raw*`) and validated internal types
- Enforced by ESLint rule `custom-rules/no-dto-naming`
- Never import DTO types directly from `twisted` - use `@scout-for-lol/data` schemas instead

---

## Report Generation

- Use the `@scout-for-lol/report` package for match reports
- Generate reports as images using `satori` (JSX to SVG) and `@resvg/resvg-js` (SVG to PNG)
- Optimize image generation performance
- Handle report generation errors gracefully
- Lazy load heavy dependencies
- Follow satori best practices (enforced by `custom-rules/satori-best-practices`)

## ScoutQL Report Queries — DuckDB Report Lake

Scheduled/user-authored ScoutQL reports execute as **compiled SQL on embedded
DuckDB** (`@duckdb/node-api`, lazy-loaded) over a local Parquet "report lake"
(`REPORT_LAKE_DIR`, prod `/data/report-lake`) — not over SQLite fact tables.

- Lake layout & compaction: `backend/src/report-lake/` (two-tier: 15-min
  staging fold + nightly full rebuild from `StoredMatch`/`StoredPrematch`
  rawJson; atomic `CURRENT`-pointer publish; the lake is disposable derived
  data). Manual run: `bun run compact:report-lake` (`--fold` for fold-only).
- Engine: `backend/src/reports/duckdb/` — the ScoutQL `ReportQueryPlan`
  compiles to parameterized SQL (never interpolate plan values); ordering,
  minGames, limits, and metric derivation stay in JS (`query-aggregates.ts`).
- **Adding a metric** = `ReportMetricSchema` enum + `REPORT_METRICS` registry
  entry (packages/data) + `METRIC_DISPLAY` (backend output.ts) + an aggregate
  column in `metrics-sql.ts`/`row-schema.ts`/`execute.ts` + `METRIC_VALUES`
  derivation. No Prisma migration, no backfill — the nightly rebuild picks up
  new lake columns from `report-lake/schema.ts`/`flatten.ts`.
- Ingest staging: `store.ts` appends flattened rows to
  `<lake>/matches-recent/` so games are queryable seconds after ingest.

---

## Database (Prisma)

- **Schema-first approach** - Define models in `schema.prisma`
- **Migration strategy** - Use `prisma migrate` for production, `db:push` for development
- **Type safety** - Generated client provides full type safety
- **Connection management** - Proper connection pooling and cleanup
- Validate database inputs with Zod schemas
- Use transactions for multi-step operations
- Handle connection errors and timeouts
- **Integration tests** - Must disconnect Prisma clients (enforced by `custom-rules/prisma-client-disconnect`)

---

## Environment & Configuration

- Use `env-var` for type-safe environment variables
- Validate all configuration with Zod schemas
- Keep sensitive data in secret stores (1Password / k8s secrets), never in the repo
- Separate development and production configurations

---

## Code Organization

- **Functional approach** - Use `remeda` for data transformations
- **Modular design** - Each package has clear responsibilities
- **Proper dependency injection** - Avoid global state
- **Consistent naming** - Use TypeScript naming conventions
- **No barrel re-exports** - Enforced by `custom-rules/no-re-exports`
- **No parent imports** - Enforced by `custom-rules/no-parent-imports`
- **Prefer Bun APIs** - Use Bun.file(), Bun.write(), Bun.spawn() instead of Node.js fs/child_process

---

## Testing Strategy

- **Unit tests** - Test individual functions and components
- **Integration tests** - Test package interactions
- **Snapshot testing** - For report generation output
- **Type testing** - Ensure type safety in complex scenarios
- **Run tests**: `bun test` in any package or root

### Local testing without Discord login or a real Discord backing

There is **no runtime auth bypass** (no `SKIP_AUTH`/`DEV_AUTH` flag), and the web
mutations are gated by a signed session cookie + CSRF + `assertGuildAdmin` (which
calls Discord). To exercise the web/tRPC surface offline, use one of these — both
run fully in-process against an isolated SQLite copy of `template.db`, no OAuth,
no Discord API:

- **Domain layer (simplest)** — call the exported functions directly (e.g.
  `setSubscriptionFilters` / `setChannelFilters` from
  `src/lib/subscription/filters.ts`) with a test client from
  `createTestDatabase(...)`. No auth surface at all. See
  `src/database/subscriptions.integration.test.ts`.

- **Full tRPC router** — `createOfflineTrpcHarness(...)` from
  `src/testing/test-trpc-caller.ts`. It stubs the Discord guild guard and points
  the router's Prisma singleton at an isolated migrated DB, then hands you an
  authenticated (and an anonymous) `appRouter.createCaller(...)`. This exercises
  the real procedures — input validation, audit-row writes, domain wiring — the
  exact surface OAuth gates. Example: `src/trpc/router/subscription-filters.router.test.ts`.

  ```ts
  const trpc = await createOfflineTrpcHarness("my-feature-test");
  const res = await trpc
    .authedCaller()
    .subscription.setFilters({ guildId, channelId, alias, filters });
  // assert against trpc.prisma …; trpc.anonCaller() for unauthenticated-rejection tests
  // remember: await trpc.prisma.$disconnect() in afterAll
  ```

  Constraints (documented in the harness): call it at the TOP of the test file
  before anything imports `appRouter`, and take `appRouter` from the returned
  object. `assertGuildAdmin` / `assertChannelInGuild` are stubbed, so real Discord
  admin/membership is out of scope for these tests.

For the running app end-to-end, `bun run dev:web` still needs `op signin` and real
Discord OAuth in the browser (see **Web UI (Local end-to-end)** above).

---

## Performance Considerations

- **Lazy loading** - Load heavy dependencies only when needed (image generation, API clients)
- **Connection pooling** - For database connections
- **Caching** - Cache expensive operations appropriately (API responses)
- **Memory management** - Clean up resources and connections
- **Bundle optimization** - Use proper bundling strategies

---

## Pre-commit Checklist (manual — git hooks were removed 2026-07)

Nothing runs automatically on commit. Before committing, run yourself:

- Prettier formatting on touched files
- Markdownlint on `.md` files
- Per-package: typecheck, ESLint, and relevant tests
- Rust formatting and Clippy for desktop/src-tauri
