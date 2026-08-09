import { describe, expect, test } from "bun:test";

import { makeHarness, makeTask } from "./harness";

/**
 * The one scenario that is deliberately NOT a fixture.
 *
 * `expect(b).toBe(a)` asserts JavaScript reference identity: the second
 * caller must receive the very same settled `Result` object, which is only
 * observable because `syncNow` hands both callers the same promise. There is
 * no cross-language way to state "these are the same allocation" — Rust's
 * single-flight is a shared future behind an async mutex, not an aliased
 * object — so encoding it in the shared corpus would either weaken the
 * assertion or invent a verb no second implementation could honour.
 *
 * Its portable half (an overlapping sync must not double-drain) is already
 * covered by `reconnect-delivers-each-mutation-once`, which pins
 * `applyCount` at exactly one across a three-way trigger pile-up.
 */

describe("reconnect delivers each mutation exactly once", () => {
  test("concurrent syncNow calls coalesce into the same run", async () => {
    const harness = makeHarness();
    await harness.store.restore();
    harness.server.seed(makeTask());

    const [a, b] = await Promise.all([
      harness.engine.syncNow(),
      harness.engine.syncNow(),
    ]);
    expect(a.ok).toBe(true);
    // The joined caller receives the very same settled result object.
    expect(b).toBe(a);
  });
});
