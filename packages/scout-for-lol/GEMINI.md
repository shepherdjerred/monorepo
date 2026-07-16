# Scout for LoL - Project Guide

## Environment Notes

**Docker Availability**: Docker commands are NOT available when `CLAUDE_CODE_REMOTE=true`. Use `bun run` commands for local development tasks instead.

## Project Structure

Monorepo using **Bun workspaces**:

```text
packages/
├── backend/   # Discord bot backend service
├── data/      # Shared data models and utilities
├── report/    # Report generation components (React + satori)
└── frontend/  # Web frontend (Astro)
```

## Core Technologies

| Category      | Technology                       |
| ------------- | -------------------------------- |
| Runtime       | Bun                              |
| Language      | TypeScript (strict mode)         |
| Linting       | ESLint + Prettier                |
| Database      | Prisma ORM                       |
| Validation    | Zod                              |
| Bot Framework | Discord.js                       |
| Frontend      | Astro                            |
| Reports       | React + satori + @resvg/resvg-js |

## Development Commands

### Root Level

```bash
bun install              # Install all dependencies
bun run install:all      # Install dependencies across all packages
bun run typecheck:all    # Type checking across all packages
bun run lint:all         # Linting across all packages
bun run format:all       # Formatting across all packages
bun run test:all         # Testing across all packages
bun run generate         # Generate Prisma client and other generated code
bun run clean            # Clean all node_modules
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

Each package supports: `dev`, `build`, `test`, `lint`, `format`, `typecheck`

## CI/CD

There is no CI — the Dagger pipeline was removed 2026-07. Run checks locally with `bun run` commands and build/push container images manually (plain `docker build`/`docker push`).

---

## TypeScript Standards

### Strict Type Safety Rules

- **NEVER use `any`** - Always define proper types
- **Avoid type assertions (`as`)** - Use type guards instead
- **Use `unknown` for uncertain types** - Validate with Zod before processing
- **Prefer advanced types** - Mapped types, conditional types, template literals
- **Exhaustive pattern matching** - Use `ts-pattern` for complex branching
- **Strict null checks** - Handle undefined/null explicitly

### Validation Patterns

```typescript
// Always validate unknown input with Zod
const result = SomeSchema.safeParse(unknownData);
if (!result.success) {
  throw new Error(fromZodError(result.error).toString());
}

// Use type guards instead of casting
function isString(value: unknown): value is string {
  return typeof value === "string";
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
- Proper async/await error handling

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
  console.error("Discord API error:", error);
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
type MatchDto = ...;        // ❌ Use RawMatch instead
type ParticipantDto = ...;  // ❌ Use RawParticipant instead
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
- Generate reports as images using `satori` (JSX → SVG) and `@resvg/resvg-js` (SVG → PNG)
- Optimize image generation performance
- Handle report generation errors gracefully
- Lazy load heavy dependencies

---

## Database (Prisma)

- **Schema-first approach** - Define models in `schema.prisma`
- **Migration strategy** - Use `prisma migrate` for production, `db:push` for development
- **Type safety** - Generated client provides full type safety
- **Connection management** - Proper connection pooling and cleanup
- Validate database inputs with Zod schemas
- Use transactions for multi-step operations
- Handle connection errors and timeouts

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

---

## Testing Strategy

- **Unit tests** - Test individual functions and components
- **Integration tests** - Test package interactions
- **Snapshot testing** - For report generation output
- **Type testing** - Ensure type safety in complex scenarios

---

## Performance Considerations

- **Lazy loading** - Load heavy dependencies only when needed (image generation, API clients)
- **Connection pooling** - For database connections
- **Caching** - Cache expensive operations appropriately (API responses)
- **Memory management** - Clean up resources and connections
- **Bundle optimization** - Use proper bundling strategies
