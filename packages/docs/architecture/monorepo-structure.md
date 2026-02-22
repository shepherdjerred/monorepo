# Monorepo Structure

Bun workspaces monorepo. All commands use `bun` (never npm/yarn/pnpm).

## Workspace Members

Configured in root `package.json`:

```
packages/*
packages/better-skill-capped/*
packages/clauderon/web/*
packages/clauderon/docs
packages/discord-plays-pokemon/packages/*
packages/homelab/src/*
packages/scout-for-lol/packages/*
```

### Not Workspace Members

- `.dagger/` - Has its own `package.json`, runs independently
- `packages/clauderon/mobile` - React Native, deferred from shared tooling
- `archive/` - Legacy projects, do not modify

## Key Packages

| Package | Description |
|---------|-------------|
| `eslint-config` | Shared ESLint flat config (`recommended()` function) |
| `homelab` | K8s infrastructure (cdk8s, OpenTofu) |
| `clauderon` | Rust session manager with web frontend |
| `birmel` | Discord bot (VoltAgent + Claude AI) |
| `scout-for-lol` | League of Legends match analysis |
| `tools` | CLI developer tools |
| `docs` | This documentation (AI-maintained) |

## Verification Commands

```bash
bun run typecheck    # Type errors across all packages
bun run test         # Tests across all packages
bun run lint         # ESLint across all packages
```

Per-package:

```bash
bun run --filter='./packages/<name>' <script>
cd packages/<name> && bunx eslint . --fix
```
