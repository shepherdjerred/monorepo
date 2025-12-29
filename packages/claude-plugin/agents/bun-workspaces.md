---
description: Bun monorepo workspaces - configuration, filtering, dependencies, and multi-package management
when_to_use: When user works with Bun monorepos, workspaces, multi-package projects, or mentions bun --filter
---

# Bun Workspaces Agent

## What's New in Bun Workspaces (2024-2025)

- **Text-based lockfile**: `bun.lock` replaces binary `bun.lockb` (v1.2+)
- **Catalogs**: Define shared dependency versions once in root package.json
- **Dependency-aware filtering**: Scripts run in dependency order
- **Glob patterns**: Full glob syntax with negative patterns
- **Automatic lockfile migration**: From npm, yarn, pnpm

## Performance

Bun workspaces are significantly faster than alternatives:
- **28x faster** than npm install
- **12x faster** than yarn install (v1)
- **8x faster** than pnpm install

## Monorepo Structure

```
my-monorepo/
├── package.json          # Root config with workspaces field
├── bun.lock              # Single lockfile for all packages
├── bunfig.toml           # Optional Bun configuration
├── tsconfig.json         # Shared TypeScript config
└── packages/
    ├── shared/
    │   ├── package.json
    │   ├── index.ts
    │   └── tsconfig.json
    ├── backend/
    │   ├── package.json
    │   ├── src/
    │   └── tsconfig.json
    └── frontend/
        ├── package.json
        ├── src/
        └── tsconfig.json
```

## Root package.json

```json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun --filter '*' dev",
    "build": "bun --filter '*' build",
    "test": "bun --filter '*' test",
    "typecheck": "bun --filter '*' typecheck"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### Glob Patterns

```json
{
  "workspaces": [
    "packages/*",
    "apps/*",
    "packages/**",
    "!packages/**/test/**",
    "!packages/deprecated"
  ]
}
```

## Workspace Protocol

Reference workspace packages in dependencies:

```json
{
  "name": "@myorg/backend",
  "dependencies": {
    "@myorg/shared": "workspace:*"
  }
}
```

### Protocol Variants

| Syntax | Meaning | Published As |
|--------|---------|--------------|
| `workspace:*` | Any version | `"1.0.0"` (actual version) |
| `workspace:^` | Caret range | `"^1.0.0"` |
| `workspace:~` | Tilde range | `"~1.0.0"` |
| `workspace:1.0.2` | Exact version | `"1.0.2"` |

When publishing, `workspace:` references are replaced with actual versions.

## Catalogs

Define shared dependency versions once:

```json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "catalog": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.0.0",
    "zod": "^3.22.0"
  }
}
```

### Using Catalog in Workspace

```json
{
  "name": "@myorg/frontend",
  "dependencies": {
    "react": "catalog:",
    "react-dom": "catalog:",
    "zod": "catalog:"
  }
}
```

### Named Catalogs

```json
{
  "catalogs": {
    "default": {
      "typescript": "^5.0.0"
    },
    "testing": {
      "vitest": "^1.0.0",
      "playwright": "^1.40.0"
    }
  }
}
```

```json
{
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:testing"
  }
}
```

## Commands

### Installing Dependencies

```bash
# Install all workspaces
bun install

# Install with frozen lockfile (CI)
bun install --frozen-lockfile

# Generate lockfile only
bun install --lockfile-only

# Filter to specific packages
bun install --filter "pkg-*"
bun install --filter "!pkg-c"
```

### Adding Dependencies

```bash
# Add to current workspace
cd packages/backend
bun add express

# Add as dev dependency
bun add -d typescript

# Add with exact version
bun add -E zod@3.22.0

# Add to specific workspace from root
bun add lodash --filter "@myorg/shared"
```

### Running Scripts

```bash
# Run in all workspaces
bun --filter '*' dev

# Run in specific package
bun --filter '@myorg/backend' dev

# Run with glob pattern
bun --filter 'pkg-*' build

# Run excluding packages
bun --filter '*' --filter '!@myorg/frontend' test

# Run by path
bun --filter './packages/backend' dev
```

### Script Dependency Order

When packages depend on each other, scripts run in dependency order:

```
# If @myorg/backend depends on @myorg/shared:
bun --filter '*' build
# Runs: shared build → backend build
```

### Other Commands

```bash
# Check outdated dependencies
bun outdated
bun outdated --filter 'pkg-*'

# Update dependencies
bun update

# Remove dependency
bun remove lodash

# List installed packages
bun pm ls
bun pm ls --all
```

## Shared Configuration

### TypeScript (tsconfig.json)

**Root tsconfig.json:**
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true,
    "paths": {
      "@myorg/*": ["./packages/*/src"]
    }
  }
}
```

**Workspace tsconfig.json:**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }
  ]
}
```

### ESLint (eslint.config.js)

```javascript
// Root eslint.config.js
import baseConfig from "@myorg/eslint-config";

export default [
  ...baseConfig,
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
];
```

## bunfig.toml Configuration

```toml
[install]
# Auto-install missing dependencies
auto = true

# Lifecycle scripts control
lifecycle = ["postinstall"]

[install.lockfile]
# Save text-based lockfile
save = true
# Also generate yarn.lock
print = "yarn"

[install.scopes]
# Registry for scoped packages
"@myorg" = { token = "$NPM_TOKEN", url = "https://npm.pkg.github.com" }
```

## Common Patterns

### Shared Library Package

```json
{
  "name": "@myorg/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./utils": {
      "import": "./dist/utils.js",
      "types": "./dist/utils.d.ts"
    }
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### Internal Dependencies

```typescript
// packages/backend/src/index.ts
import { validateUser, UserSchema } from "@myorg/shared";
import type { User } from "@myorg/shared/types";

const user = validateUser(data);
```

### Running Type Checks

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "typecheck:all": "bun --filter '*' typecheck"
  }
}
```

## Lockfile Management

### Text-based Lockfile (v1.2+)

```bash
# Migrate from binary lockfile
bun install --save-text-lockfile --frozen-lockfile --lockfile-only
rm bun.lockb
```

### Automatic Migration

Bun automatically migrates from:
- `package-lock.json` (npm)
- `yarn.lock` (Yarn v1)
- `pnpm-lock.yaml` (pnpm)

```bash
# Install and migrate lockfile
bun install
```

## Dependency Overrides

Force specific versions for transitive dependencies:

```json
{
  "overrides": {
    "lodash": "4.17.21",
    "axios": "^1.6.0"
  }
}
```

Or Yarn-style:

```json
{
  "resolutions": {
    "lodash": "4.17.21"
  }
}
```

## CI/CD Integration

### GitHub Actions

```yaml
- uses: oven-sh/setup-bun@v1
  with:
    bun-version: latest

- run: bun install --frozen-lockfile

- run: bun --filter '*' typecheck

- run: bun --filter '*' build

- run: bun --filter '*' test
```

### Docker

```dockerfile
FROM oven/bun:1

WORKDIR /app

# Copy lockfile first for caching
COPY bun.lock package.json ./
COPY packages/*/package.json ./packages/

RUN bun install --frozen-lockfile

COPY . .

RUN bun --filter '*' build
```

## Best Practices Summary

1. **Use `private: true`** on root package.json
2. **Keep root dependencies minimal** - only shared dev tools
3. **Use workspace protocol** (`workspace:*`) for internal deps
4. **Use catalogs** for consistent versions across packages
5. **Run `--frozen-lockfile`** in CI
6. **Commit `bun.lock`** to version control
7. **Use glob negation** to exclude test/template directories
8. **Run scripts in parallel** with `bun --filter '*'`
9. **Configure TypeScript paths** for seamless imports
10. **Build dependencies first** - Bun handles order automatically

## When to Ask for Help

- Complex publishing workflows to npm
- Custom registry authentication
- Peer dependency conflicts
- Selective version updates in catalogs
- Integration with Turborepo or Nx
- Workspace-specific bunfig.toml overrides
