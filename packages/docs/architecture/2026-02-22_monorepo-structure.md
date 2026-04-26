# Monorepo Structure

Bun-first monorepo. All JavaScript/TypeScript commands use `bun` (never npm/yarn/pnpm).

## Package Discovery

The root `package.json` owns only repo-level scripts and dev dependencies. Package discovery is handled by local tooling:

- `scripts/run-package-script.ts` walks `packages/**/package.json` recursively and runs matching scripts.
- `scripts/ci/src/catalog.ts` is the CI source of truth for build, deploy, Helm, image, site, npm, and OpenTofu targets.
- Nested package families live under paths such as `packages/scout-for-lol/packages/*`, `packages/discord-plays-pokemon/packages/*`, `packages/clauderon/web/*`, and `packages/homelab/src/*`.

### Not Workspace Members

- `.dagger/` - Has its own `package.json`, runs independently
- `packages/clauderon/mobile` - React Native, deferred from shared tooling
- `archive/` - Legacy projects, do not modify

## Key Packages

| Package         | Description                                          |
| --------------- | ---------------------------------------------------- |
| `eslint-config` | Shared ESLint flat config (`recommended()` function) |
| `homelab`       | K8s infrastructure (cdk8s, OpenTofu)                 |
| `clauderon`     | Rust session manager with web frontend               |
| `birmel`        | Discord bot (VoltAgent + Claude AI)                  |
| `scout-for-lol` | League of Legends match analysis                     |
| `tools`         | CLI developer tools                                  |
| `docs`          | This documentation (AI-maintained)                   |

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
