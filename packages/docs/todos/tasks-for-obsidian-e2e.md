---
id: tasks-for-obsidian-e2e
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Get the Tasks-for-Obsidian iOS/RN app working end-to-end + agent-testable

## What

The React Native app (`packages/tasks-for-obsidian`, RN 0.85.3 bare workflow,
iOS + Android) is buggy and hard for agents to verify end-to-end. Stabilize it
and give it an automated e2e harness.

Why e2e is hard today:

- **No simulator automation** (no Detox / Maestro / Appium / XCUITest layer) —
  agents can't script user flows.
- **Native Swift features can't be exercised from the bun unit runner**: widgets
  (`ios/TasksWidget/`), Live Activities (`ios/.../LiveActivityBridge.swift`),
  Siri intents (`ios/.../Intents/`), SF Symbols bridge.
- **Build complexity**: Metro ↔ Xcode build phases, node path in
  `ios/.xcode.env.local`, CocoaPods, DerivedData state.
- Unit tests exist (~12 files: domain, sync, dates/nlp) but there are **no UI,
  integration, or e2e tests**.

Depends on `packages/tasknotes-server` (Hono API over the vault) and
`packages/tasknotes-types`.

## Remaining

- [ ] An agent can build + launch the app and exercise core flows automatically
      (likely Maestro or Detox).
- [ ] The main bugs (build flakiness, sync edge cases) are fixed.
- [ ] E2e covers task CRUD + sync against a running `tasknotes-server`.

## References

- `packages/tasks-for-obsidian/AGENTS.md` (architecture, native features,
  troubleshooting)
- `packages/tasknotes-server/AGENTS.md`
