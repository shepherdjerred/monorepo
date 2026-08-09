---
id: sync-command-id-collision-after-relaunch
type: todo
status: planned
board: true
verification: human
disposition: active
source_marker: false
---

# A relaunch inside one millisecond can mint a duplicate mutation id

## Summary

In `packages/tasks-for-obsidian`, the sync command id doubles as the server's
`X-Mutation-Id` idempotency key. The id counter **resets to 0 on every launch**,
and only a `Math.random()` suffix separates ids minted in the same millisecond.
An app killed and reopened within a single clock millisecond can therefore mint
an id that its own restored queue already holds.

The failure is silent and data-losing: the server recognises the duplicate id and
answers the **second** command from the **first** command's stored response. The
second mutation is never applied, and the client believes it succeeded.

The same hazard applies to temp ids (`tmp-<millis>-<counter>`), where a collision
merges two optimistic tasks — and acking either one then remaps both.

Found by `proptest-state-machine` during the Phase 4 Rust port, in the generated
transition sequence `Create → Relaunch → Create`. **This is a pre-existing bug in
the shipping iOS app**, not something the port introduced.

## Why the existing tests miss it

The deterministic simulation harness uses a manual clock that only advances when a
test tells it to — which is exactly the condition that makes the collision
possible, but no hand-written scenario relaunches twice inside one tick. The bug
lives in the interaction of three transitions, and hand-written tests enumerate
scenarios someone thought of. This is the class of bug property testing exists
for.

## Fix already shipped in Rust

`TaskStore::next_command_id` / `next_temp_id` mint, check against the durable set
(`CommandQueue::contains_command_id` / `targets`, covering **both** the queue and
the dead-letter list), and retry on collision. Termination holds: the id is
injective in the counter at a fixed instant, and the durable set is finite.

The TypeScript implementation has **not** been changed.

## Remaining

- [ ] Decide whether to fix the TypeScript app now or let it ride until iOS moves
      onto the Rust core. It is a real data-loss path, but requires a relaunch
      inside one millisecond — rare in practice, and not observed in the wild.
- [ ] If fixing: mirror the Rust approach — check the minted id against the
      restored queue _and_ dead-letter list, retry on collision. Do **not** rely
      on a wider random suffix; that reduces the probability without removing the
      failure.
- [ ] Consider persisting the id counter alongside the queue so it doesn't reset
      on launch. That removes the collision class outright rather than detecting
      it, and is probably the better fix for both implementations.
- [ ] Add a regression scenario to `packages/tasknotes-fixtures/scenarios/` once
      fixed, so both implementations are pinned. The vocabulary already supports
      it: `dispatch` → `snapshot` → `relaunch` → `dispatch` with no `clock_set`
      between them.

## Comment Log

- 2026-08-08: Filed. Found by property testing during the Phase 4 port; fixed in
  Rust, unfixed in TypeScript. Not fixed inline because it touches shipping iOS
  sync behaviour and deserves its own change and verification.
