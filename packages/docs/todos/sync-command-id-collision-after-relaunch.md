---
id: sync-command-id-collision-after-relaunch
type: todo
status: awaiting-human
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

The TypeScript implementation now persists the counters instead, keeping the
mint-and-check loop only as a backstop — see `## Remaining`.

## Remaining

- [x] Fixed in TypeScript now rather than waiting for the Rust core.
- [x] Persisted both counters under a new `id_counters` AsyncStorage key, written
      before the enqueue so the id is durably spent before it can reach the wire.
      This is the primary fix: it removes the collision class instead of
      detecting it, and unlike a durable-set check it also covers an id the
      client has already dequeued while the server still remembers it.
- [x] Kept the Rust mint-and-check loop as the backstop for the two states a
      counter cannot describe: the first launch after upgrading from a build
      that never wrote the key, and an unparseable counter blob. No schema
      version bump — there is no data to transform, and a missing key is exactly
      the fresh-install path.
- [x] Moved the temp-id counter off the module scope onto the store and
      persisted it too. The module-level counter accidentally hid the temp-id
      half of this bug from the harness (one process, so it never reset) while
      leaving the shipping app exposed.
- [x] Added `relaunch-in-one-millisecond-mints-a-fresh-mutation-id` to
      `packages/tasknotes-fixtures/scenarios/`. Both runners now pin the store's
      randomness (`() => 0.5` / `HalfUnitRandomness`), so the duplicate id is
      deterministic rather than a one-in-sixteen-million accident.

## The Rust port (done)

`packages/tasknotes-core` now persists both counters too, so the two
implementations use the same mechanism with the same fallback reasoning.

- New `id_counters` slot on the `TaskCacheStorage` host trait, written **before**
  the enqueue, exactly as in TypeScript. The macOS host stores it as
  `id-counters.json` beside the other container files.
- It had to be its own slot. Folding it into the queue blob would make the
  TypeScript per-item salvage loop see a non-array and **silently discard the
  whole offline queue**; folding it into the alias blob survives Rust's
  `parse_aliases` but is pruned by the TypeScript `replaceBase` on the first
  successful pull. Both reasons are recorded as doc comments on the trait so the
  keys do not get "simplified" later.
- The mint-and-check loop is kept, demoted to the documented backstop for the
  upgrade and corrupt-blob paths.
- No `CURRENT_SCHEMA_VERSION` bump, for the same reason as TypeScript: a missing
  key is the fresh-install path, and there is no data to transform.

The shared scenario passes under either mechanism **in Rust**, and that is worth
recording: unlike TypeScript, this crate has had the durable-set check since it
was written, and in the scenario the colliding command is still queued at the
moment of the second mint — precisely the case the check does see. The case that
separates the two mechanisms is an id that was already **acked and dequeued**
while the server still remembers it, which is now pinned by
`an_acked_commands_id_is_never_re_minted_after_a_relaunch` rather than by a
fixture.

## Human Verification

1. Install the new build **over** an existing install that has a non-empty
   offline queue (queue some mutations with the server unreachable, then update
   the app rather than reinstalling it).
2. Reconnect and let the queue drain. **Expected:** every queued mutation lands
   in the vault exactly once, and nothing is silently dropped.

This is the one path automated tests cannot reach: a real device carrying
durable state written by a build that never persisted the id counters. Accept if
the carried-over queue drains completely.

## Comment Log

- 2026-08-08: Filed. Found by property testing during the Phase 4 port; fixed in
  Rust, unfixed in TypeScript. Not fixed inline because it touches shipping iOS
  sync behaviour and deserves its own change and verification.
- 2026-08-08: Fixed in TypeScript by persisting the counters, with the Rust
  check-and-retry kept as an upgrade/corruption backstop. Verified by disabling
  each mechanism in turn: without persistence the new shared scenario reports one
  server task instead of two, and without the dead-letter half of the check the
  new `TaskStore` unit test re-mints a parked command's id.
- 2026-08-08: Converged the Rust core on the same persisted counters, under a
  new `id_counters` host storage slot; the mint-and-check loop stays as the
  backstop. All 26 shared scenarios and all 338 recurrence cases still pass
  unchanged, and no fixture was edited. Negative controls: disabling the
  counter write fails the acked-id and write-ordering unit tests, and disabling
  either dead-letter half of the durable-set check fails the parked-command
  test. Noted that the shared relaunch scenario does **not** discriminate the
  two mechanisms in Rust — it passes with persistence disabled, because this
  crate always had the check and the colliding command is still queued there.
  The discriminating case is an acked-and-dequeued id, now covered by a unit
  test.
