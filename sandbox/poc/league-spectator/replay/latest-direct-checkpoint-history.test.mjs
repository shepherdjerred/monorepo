import { expect, test } from "bun:test";
import { createDirectCheckpointHistory } from "./latest-direct-checkpoint-history.mjs";

test("persistent checkpoint roots retain every insertion-ordered row and independent old versions across tree growth/backward restore", () => {
  const history = createDirectCheckpointHistory(),
    reference = new Map(),
    snapshots = [];
  for (let index = 0; index < 40000; index++) {
    const key = `row:${index}`,
      value = { index, vector: [-0, index] };
    history.set(key, value);
    reference.set(key, structuredClone(value));
    value.vector[1] = -999;
    if ([31, 32, 1023, 1024, 32767, 32768, 39999].includes(index))
      snapshots.push([history.snapshot(), structuredClone([...reference])]);
  }
  history.set("row:3", { index: 3, vector: [-0, 88] });
  for (const [snapshot, rows] of snapshots)
    expect(history.cloneEntries(snapshot)).toEqual(rows);
  const [earlier, expected] = snapshots[2];
  history.restore(earlier);
  history.set("row:3", { changed: true });
  history.set("new-after-restore", { value: 5 });
  const restored = history.cloneEntries(history.snapshot());
  expect(restored).toHaveLength(expected.length + 1);
  expect(restored[3]).toEqual(["row:3", { changed: true }]);
  expect(restored.at(-1)).toEqual(["new-after-restore", { value: 5 }]);
  restored[0][1].vector[0] = 8;
  expect(Object.is(history.cloneEntries(earlier)[0][1].vector[0], -0)).toBe(
    true,
  );
  expect(history.cloneEntries(snapshots.at(-1)[0])).toHaveLength(40000);
});

test("foreign or cloned snapshot handles cannot read or replace private history", () => {
  const history = createDirectCheckpointHistory(),
    other = createDirectCheckpointHistory();
  const handle = history.snapshot();
  expect(() => other.cloneEntries(handle)).toThrow("Owned");
  expect(() => history.restore(structuredClone(handle))).toThrow("Owned");
  history.clear();
  expect(history.cloneEntries(history.snapshot())).toEqual([]);
});

test("batched row snapshots preserve active-state aliases without exposing or mutating earlier history", () => {
  const history = createDirectCheckpointHistory(),
    reasons = ["original"],
    payload = { active: { reasons } },
    first = history.snapshotWithEntries([["row", { reasons }]], payload);
  reasons.push("later");
  const second = history.snapshotWithEntries([["row", { reasons }]], payload);
  for (const [handle, expected] of [
    [first, ["original"]],
    [second, ["original", "later"]],
  ]) {
    const copy = history.cloneState(handle);
    expect(copy.payload.active.reasons).toBe(copy.entries[0][1].reasons);
    expect(copy.payload.active.reasons).toEqual(expected);
    copy.payload.active.reasons.push("caller mutation");
    expect(history.cloneState(handle).payload.active.reasons).toEqual(expected);
  }
});

test("batch writes cross tree levels, retain duplicate-key order and restore old roots without changing payload aliases", () => {
  const history = createDirectCheckpointHistory(),
    snapshots = [];
  let reference = new Map();
  for (const size of [31, 2, 991, 2, 31742, 2, 7230]) {
    const changes = [],
      reason = [reference.size];
    for (let slot = 0; slot < size; slot++) {
      const key = `row:${reference.size}`;
      const value = { slot, reason };
      changes.push([key, value]);
      reference.set(key, value);
    }
    changes.push(
      ["row:0", { latest: reference.size, reason }],
      ["row:0", { final: reference.size, reason }],
    );
    reference.set("row:0", changes.at(-1)[1]);
    const expected = structuredClone({
      entries: [...reference],
      payload: { reason },
    });
    const handle = history.snapshotWithEntries(changes, { reason });
    snapshots.push([handle, expected]);
    reference = new Map(structuredClone(expected.entries));
    reason.push("later");
    expect(history.cloneState(handle)).toEqual(expected);
    expect(history.cloneState(handle).entries[0][1].reason).toEqual(
      expected.payload.reason,
    );
  }
  for (const [handle, expected] of snapshots)
    expect(history.cloneState(handle)).toEqual(expected);
  const [earlier, expected] = snapshots[2];
  history.restore(earlier);
  const reason = ["restored"],
    branch = history.snapshotWithEntries(
      [
        ["row:5", { reason }],
        ["new-after-restore", { reason }],
        ["row:5", { last: true, reason }],
      ],
      { reason },
    );
  const state = history.cloneState(branch);
  expect(state.entries).toHaveLength(expected.entries.length + 1);
  expect(state.entries[5]).toEqual([
    "row:5",
    { last: true, reason: ["restored"] },
  ]);
  expect(state.entries.at(-1)).toEqual([
    "new-after-restore",
    { reason: ["restored"] },
  ]);
  expect(state.payload.reason).toBe(state.entries[5][1].reason);
  expect(state.payload.reason).toBe(state.entries.at(-1)[1].reason);
  state.payload.reason.push("public mutation");
  expect(history.cloneState(branch).payload.reason).toEqual(["restored"]);
  expect(history.cloneState(snapshots.at(-1)[0])).toEqual(snapshots.at(-1)[1]);
});
