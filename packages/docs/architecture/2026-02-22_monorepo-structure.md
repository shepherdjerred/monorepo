---
id: architecture-2026-02-22-monorepo-structure
type: architecture
status: complete
board: false
---

# Monorepo Structure

Bun-first monorepo. All JavaScript/TypeScript commands use `bun` (never npm/yarn/pnpm).

## Package Discovery

The root `package.json` owns only repo-level scripts and dev dependencies. Package discovery is handled by local tooling:

- `scripts/run-package-script.ts` walks `packages/**/package.json` recursively and runs matching scripts.
- `scripts/ci/src/catalog.ts` is the CI source of truth for build, deploy, Helm, image, site, npm, and OpenTofu targets.
- Nested package families live under paths such as `packages/scout-for-lol/packages/*`, `packages/discord-plays-pokemon/packages/*`, and `packages/homelab/src/*`.

### Not Workspace Members

- `.dagger/` - Has its own `package.json`, runs independently
- `sandbox/` - Personal scratch (not shipped): `archive/` (legacy, do not modify), `poc/` (experiments), `practice/` (coding practice)

## Key Packages

| Package         | Description                                          |
| --------------- | ---------------------------------------------------- |
| `eslint-config` | Shared ESLint flat config (`recommended()` function) |
| `homelab`       | K8s infrastructure (cdk8s, OpenTofu)                 |
| `birmel`        | Discord bot (VoltAgent + Claude AI)                  |
| `scout-for-lol` | League of Legends match analysis                     |
| `toolkit`       | CLI developer tools (pr, pd, bugsink, grafana)       |
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
