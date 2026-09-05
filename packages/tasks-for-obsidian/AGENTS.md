# Tasks for Obsidian constraints

This is a bare React Native iOS/Android client for TaskNotes. `README.md` and
`e2e/README.md` own setup, screens, deep links, and test reference.

- Domain code is React-free. API responses and native modules are parsed with
  Zod. Expected failures use the typed result/error model.
- Wire conversion is centralized; internal camelCase vocabulary must not leak
  into the upstream `/v2` contract.
- Sync and mutation queues preserve offline ordering, crash recovery,
  idempotency, and optimistic rollback. Do not hide durable failures.
- Native bridges validate availability. A deliberately unsupported platform may
  no-op, but malformed bridge data is not an availability condition.
- Production errors surface through UI or Sentry. Do not add ad-hoc console
  logging that can expose task content.
- Widgets and Live Activities share only the configured app-group data. Tokens
  stay in secure storage.

## Acceptance layers

```bash
bun run typecheck
bun run test
bun run lint
bun run test:contract
bun run e2e
```

Unit tests use the deterministic sync harness. Contract tests spawn the real
server. Maestro E2E drives a simulator through a chaos proxy and asserts vault
Markdown bytes; it is a local native gate.

Xcode Cloud owns Archive and TestFlight. Dependency/import changes must pass the
Release Metro bundle guard and keep `ci_post_clone.sh` installing every required
workspace dependency. A debug simulator build does not prove Archive.

Capture affected screens and flows on a simulator. Preserve accessibility and
native behavior rather than weakening E2E assertions.
