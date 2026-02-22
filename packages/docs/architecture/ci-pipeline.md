# CI Pipeline

Dagger-based CI defined in `.dagger/src/index.ts` using `@object()` and `@func()` decorators.

## Running CI

```bash
dagger call ci
```

## Key Features

- **Quality ratchet**: Tracks suppression counts in `.quality-baseline.json`
- **Compliance check**: Verifies eslint config + lint/typecheck scripts per package
- **Pre-built eslint-config**: `lib-eslint-config.ts` shared by 9+ package checks
- **Cargo tool caching**: Binaries cached at `/root/.cargo-tools/bin` via `--root /root/.cargo-tools`
- **Source filtering**: `.daggerignore` reduces sync from ~600MB to ~400MB

## Gotchas

- `_EXPERIMENTAL_DAGGER_RUNNER_HOST` controls remote vs local Dagger engine
- Remote engine (K8s pod) is unreliable for complex DAGs — graphql errors are transient
- Never run concurrent `dagger call` on same engine — causes resource exhaustion
- `withExec()` does NOT use container entrypoints — always specify full commands
- Dagger GraphQL errors wrap real errors — dig into logs for actual cause
- Cannot mount cache at `/usr/local/cargo/bin` — rustup proxy shims live there
