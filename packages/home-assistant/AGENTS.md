# Home Assistant client constraints

This is a runtime-agnostic TypeScript client for Home Assistant REST and
WebSocket APIs. `README.md` owns the public API and codegen reference.

- Support Bun and Node using standard `fetch` and `WebSocket` boundaries.
- Parse all Home Assistant responses and events with Zod. Generated schemas may
  narrow the default client but must not change runtime validation.
- `ha-codegen` reads a live instance and emits instance-specific entity,
  service, and event types. Generated output contains private identifiers and
  must never be committed.
- CI has no Home Assistant credentials. Treat local codegen, package tests, and
  live-instance acceptance as separate checks.

```bash
bun run build
bun run typecheck
bun run test
bun run lint
```
