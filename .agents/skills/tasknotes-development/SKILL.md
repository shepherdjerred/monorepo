---
name: tasknotes-development
description: Develop or verify TaskNotes across the Rust core, fixtures, generated bindings, sync server, macOS, Windows, and React Native clients. Use for any packages/tasknotes-* or packages/tasks-for-obsidian work.
---

# TaskNotes development

TaskNotes is a cross-language system. Read the nearest package `AGENTS.md` and
README, then identify which contract layer owns the change.

- `tasknotes-core` is pure Rust domain logic with host-provided I/O traits.
- `tasknotes-core-ffi` contains UniFFI scaffolding only.
- `@tasknotes/fixtures` is the shared oracle used by Rust and TypeScript. A
  disagreement is a finding; do not edit the fixture to bless one implementation.
- Generated bindings are committed. UniFFI record field order is ABI-significant
  even when checksums and headers do not change. Regenerate through `cargo xtask`
  and commit every diff.
- Apps and presentation layers do not import generated FFI directly; use their
  host/engine boundary.
- The server preserves Markdown and wire contracts, validates request/response
  schemas, and keeps idempotent mutation behavior.

Use focused cross-language tests. Native checks are platform-specific:

- Build the XCFramework before macOS E2E when bindings or core behavior changed.
- Run the macOS accessibility/UI flow for affected native behavior.
- Use portable Windows verification on non-Windows hosts and
  `bun run windows:verify` on Windows for full packaging/runtime claims.
- For the React Native app, distinguish unit, real-server contract, simulator
  E2E, and Xcode Cloud Archive/TestFlight acceptance.

Never soften an accessibility assertion, skip a native gate, edit generated
code, or claim parity without the package's runtime assertion evidence.
