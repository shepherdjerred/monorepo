import { describe, expect, test } from "bun:test";
import { createLatestVisibleActorOwnership } from "./latest-visible-actor-ownership.mjs";

describe("native-visible actor resource ownership", () => {
  test("retains every full-match record while allocating only the oracle's living/corpse set across backwards seeks", () => {
    const entries = Array.from({ length: 2379 }, (_, index) => ({
      entityId: 0x40000000 + index,
      // These are opaque test oracle intervals, not renderer lifetime rules.
      oracle: [
        [index * 2, index * 2 + 15],
        [6000 + index, 6000 + index + 2],
      ],
      events: [{ sequence: index * 3, value: `source-${index}` }],
    }));
    const snapshot = structuredClone(entries),
      alive = new Set();
    let created = 0,
      released = 0,
      serial = 0,
      maximum = 0;
    const owner = createLatestVisibleActorOwnership({
      entries,
      visible: (entry, time) =>
        entry.oracle.some(([start, end]) => time >= start && time < end),
      create(entry) {
        const instance = {
          entityId: entry.entityId,
          serial: serial++,
          pose: "bind",
        };
        alive.add(instance);
        created++;
        maximum = Math.max(maximum, alive.size);
        return instance;
      },
      release(instance, entry) {
        expect(instance.entityId).toBe(entry.entityId);
        expect(alive.delete(instance)).toBe(true);
        released++;
      },
    });
    expect(created).toBe(0);
    for (const time of [0, 500, 1000, 4500, 8000, 1000, 6001, 0]) {
      const expected = entries.filter((entry) =>
        entry.oracle.some(([start, end]) => time >= start && time < end),
      );
      const active = owner.reconcile(time);
      expect(active).toEqual(expected);
      expect(owner.size).toBe(expected.length);
      for (const entry of entries)
        expect(owner.get(entry)?.entityId ?? null).toBe(
          expected.includes(entry) ? entry.entityId : null,
        );
    }
    const first = owner.get(entries[0]);
    first.pose = "later corpse pose";
    owner.reconcile(4500);
    expect(owner.get(entries[0])).toBeNull();
    owner.reconcile(0);
    expect(owner.get(entries[0])).not.toBe(first);
    expect(owner.get(entries[0]).pose).toBe("bind");
    expect(maximum).toBeLessThan(10);
    expect(entries).toEqual(snapshot);
    owner.dispose();
    owner.dispose();
    expect(alive.size).toBe(0);
    expect(released).toBe(created);
    expect(() => owner.reconcile(0)).toThrow("disposed");
  });

  test("retains the same actor throughout a visible corpse and rejects guessed truthy visibility", () => {
    const entry = { id: "native-identity" };
    let creates = 0,
      releases = 0;
    const owner = createLatestVisibleActorOwnership({
      entries: [entry],
      visible: (_, time) => time >= 10 && time < 20,
      create: () => ({ serial: ++creates }),
      release: () => {
        releases++;
      },
    });
    owner.reconcile(10);
    const original = owner.get(entry);
    owner.reconcile(19.999);
    expect(owner.get(entry)).toBe(original);
    owner.reconcile(20);
    expect(owner.size).toBe(0);
    expect(releases).toBe(1);
    const invalid = createLatestVisibleActorOwnership({
      entries: [entry],
      visible: () => 1,
      create: () => ({}),
      release() {},
    });
    expect(() => invalid.reconcile(1)).toThrow("explicit");
  });
});
