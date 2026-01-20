# CLAUDE.md - eslint-config

Shared ESLint v9 flat config with custom rules.

## Commands

```bash
bun run build      # Compile to dist/
bun run typecheck
```

## Custom Rules

- `prefer-bun-apis` - Bun over Node.js APIs
- `no-type-assertions` - Avoid TS type assertions
- `zod-schema-naming` - Zod naming conventions
- `prefer-date-fns` - date-fns over native Date
