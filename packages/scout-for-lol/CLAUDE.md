# Scout for LoL - Project Guide

## Environment Notes

**Dagger/Docker Availability**: Dagger and Docker commands are NOT available when `CLAUDE_CODE_REMOTE=true`. Use `bun run` commands for local development tasks instead.

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

## Core Technologies

| Category      | Technology                       |
| ------------- | -------------------------------- |
| Runtime       | Bun                              |
| Language      | TypeScript (strict mode)         |
| Linting       | ESLint + Prettier                |
| Database      | Prisma ORM                       |
| Validation    | Zod                              |
| CI/CD         | Dagger (requires Docker)         |
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
mise run ci              # Run full CI pipeline with Dagger
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

## Dagger CI/CD Pipeline

> Only available when Docker is running (not available when `CLAUDE_CODE_REMOTE=true`)

### Discovery

```bash
dagger functions              # List all available Dagger functions
dagger functions --help       # View specific function details
```

### Main Targets

```bash
dagger call check                                       # Run lint, typecheck, test
dagger call build --version="1.0.0" --git-sha="abc123" # Build all packages
dagger call ci --version="1.0.0" --git-sha="abc123"    # Full CI pipeline
dagger call deploy --version="1.0.0" --stage="beta"    # Deploy to stage
```

### Package-Specific

```bash
dagger call check-backend
dagger call check-report
dagger call check-data
dagger call generate-prisma
dagger call build-backend-image --version="1.0.0" --git-sha="abc123"
dagger call build-report-for-npm --version="1.0.0"
```

### Docker Export & Run

```bash
# Build and export backend image
dagger call build-backend-image --version="test" --git-sha="test123" export --path="./backend-image.tar.gz"

# Load and run
docker load < ./backend-image.tar.gz
docker run --rm <image_sha>
```

### Common Dagger Issues

- **Module not found "src/database/migrate.ts"**: Fix entrypoint in `dagger/src/backend.ts` to use correct working directory
- **failed to find arg "DataSource"**: Remove unused parameters from `dagger/src/index.ts` function signatures

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

- `SlashCommandBuilder` - Command definition
- `execute` function - Command handler

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
- Use Dagger secrets for sensitive data in CI/CD
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

---

## Performance Considerations

- **Lazy loading** - Load heavy dependencies only when needed (image generation, API clients)
- **Connection pooling** - For database connections
- **Caching** - Cache expensive operations appropriately (API responses)
- **Memory management** - Clean up resources and connections
- **Bundle optimization** - Use proper bundling strategies

---

## Git Hooks (Husky + lint-staged)

Pre-commit hooks run automatically:

- Prettier formatting on all files
- Markdownlint on `.md` files
- Actionlint on GitHub workflow files
- Per-package: typecheck, ESLint, and relevant tests
- Rust formatting and Clippy for desktop/src-tauri
