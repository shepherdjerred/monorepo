import { expect, test } from "vitest";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import type { FlagsActor } from "./audit.ts";
import { FlagStore } from "./store.ts";

const seed: FlagsActor = { kind: "system", id: "seed" };
const operator: FlagsActor = { kind: "human", id: "operator@example.com" };
const inventoryCheck: FlagsActor = {
  kind: "machine",
  id: "check-flag-inventory",
};

const added: FlagValue = {
  type: "boolean",
  key: "delivery-writes-enabled",
  default: true,
  rollouts: [],
};

/** A store whose clock advances one second per reading. */
function clockedStore() {
  let tick = Date.parse("2026-11-26T00:00:00.000Z");
  const store = FlagStore.open(":memory:", {
    now: () => {
      tick += 1000;
      return new Date(tick);
    },
  });
  return store;
}

function boolean(store: FlagStore, key: string) {
  const found = store.flag("scout/prod", key);
  if (found?.flag.type !== "boolean") throw new Error(`${key} missing`);
  return { revision: found.revision, flag: found.flag };
}

function allHistory(store: FlagStore, key: string) {
  return store.audit.history("scout/prod", key, { limit: 100 }).entries;
}

test("seeding a new deployment records one system create per key", () => {
  const store = clockedStore();
  try {
    store.seedFromInventory(seed);
    const document = store.document("scout/prod");
    if (document === undefined) throw new Error("scout/prod missing");
    for (const flag of document.flags) {
      const [entry] = allHistory(store, flag.key);
      expect(entry).toMatchObject({
        action: "create",
        actor: seed,
        revisionAfter: 1,
        before: null,
        after: flag,
      });
    }
    // A restart with nothing new writes no rows.
    const lastChange = store.audit.lastChange("scout/prod", "dares_enabled");
    store.seedFromInventory(seed);
    expect(store.audit.lastChange("scout/prod", "dares_enabled")).toEqual(
      lastChange,
    );
  } finally {
    store.close();
  }
});

test("apply records create and update rows and skips an identical flag", () => {
  const store = clockedStore();
  try {
    store.seedFromInventory(seed);
    const dares = boolean(store, "dares_enabled");
    const changed: FlagValue = { ...dares.flag, default: !dares.flag.default };
    const untouchedKey = "scout-explore-model";
    const untouched = store.flag("scout/prod", untouchedKey);
    if (untouched === undefined) throw new Error(`${untouchedKey} missing`);
    const before = store.audit.lastChange("scout/prod", untouchedKey);

    const applied = store.apply(
      "scout/prod",
      dares.revision,
      [changed, untouched.flag, added],
      operator,
    );
    expect(applied).toEqual({ ok: true, revision: dares.revision + 1 });

    expect(allHistory(store, "dares_enabled")[0]).toMatchObject({
      action: "update",
      actor: operator,
      revisionAfter: dares.revision + 1,
      before: dares.flag,
      after: changed,
    });
    expect(allHistory(store, added.key)).toMatchObject([
      { action: "create", actor: operator, before: null, after: added },
    ]);
    expect(store.audit.lastChange("scout/prod", untouchedKey)).toEqual(before);

    // An all-identical batch still advances the revision and records nothing.
    const noop = store.apply(
      "scout/prod",
      dares.revision + 1,
      [changed],
      operator,
    );
    expect(noop).toEqual({ ok: true, revision: dares.revision + 2 });
    expect(allHistory(store, "dares_enabled")).toHaveLength(2);
  } finally {
    store.close();
  }
});

test("refused and conflicting writes record nothing", () => {
  const store = clockedStore();
  try {
    store.seedFromInventory(seed);
    const dares = boolean(store, "dares_enabled");
    const stale = store.apply(
      "scout/prod",
      dares.revision - 1,
      [{ ...dares.flag, default: !dares.flag.default }],
      operator,
    );
    expect(stale.ok).toBe(false);
    const missing = store.retire(
      "scout/prod",
      dares.revision,
      ["dares_enabled", "not-a-flag"],
      operator,
    );
    expect(missing.ok).toBe(false);
    expect(allHistory(store, "dares_enabled")).toHaveLength(1);
  } finally {
    store.close();
  }
});

test("create-missing records only keys it created", () => {
  const store = clockedStore();
  try {
    store.seedFromInventory(seed);
    const dares = boolean(store, "dares_enabled");
    const created = store.createMissing(
      "scout/prod",
      [{ ...dares.flag, default: !dares.flag.default }, added],
      inventoryCheck,
    );
    expect(created).toEqual({
      ok: true,
      revision: dares.revision + 1,
      created: [added.key],
    });
    expect(allHistory(store, added.key)).toMatchObject([
      {
        action: "create",
        actor: inventoryCheck,
        revisionAfter: dares.revision + 1,
      },
    ]);
    expect(allHistory(store, "dares_enabled")).toHaveLength(1);

    const steady = store.createMissing("scout/prod", [added], inventoryCheck);
    expect(steady).toEqual({
      ok: true,
      revision: dares.revision + 1,
      created: [],
    });
    expect(allHistory(store, added.key)).toHaveLength(1);
  } finally {
    store.close();
  }
});

test("retire keeps the final body, and a re-created key gets a new added time", () => {
  const store = clockedStore();
  try {
    store.seedFromInventory(seed);
    const first = store.createMissing("scout/prod", [added], operator);
    if (!first.ok) throw new Error("create failed");
    const firstCreatedAt = store.audit.createdAt("scout/prod", added.key);

    const retired = store.retire(
      "scout/prod",
      first.revision,
      [added.key],
      inventoryCheck,
    );
    expect(retired).toEqual({ ok: true, revision: first.revision + 1 });
    expect(store.flag("scout/prod", added.key)).toBeUndefined();
    expect(allHistory(store, added.key)[0]).toMatchObject({
      action: "retire",
      actor: inventoryCheck,
      revisionAfter: first.revision + 1,
      before: added,
      after: null,
    });
    expect(store.audit.archive()).toMatchObject([
      { deploymentId: "scout/prod", key: added.key, before: added },
    ]);

    const recreated = store.createMissing("scout/prod", [added], seed);
    expect(recreated.ok).toBe(true);
    const secondCreatedAt = store.audit.createdAt("scout/prod", added.key);
    expect(secondCreatedAt?.getTime()).toBeGreaterThan(
      firstCreatedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    expect(store.audit.archive()).toEqual([]);
  } finally {
    store.close();
  }
});

test("history pages newest first by id", () => {
  const store = clockedStore();
  try {
    store.seedFromInventory(seed);
    let current = boolean(store, "dares_enabled");
    for (let index = 0; index < 4; index += 1) {
      const result = store.apply(
        "scout/prod",
        current.revision,
        [{ ...current.flag, default: !current.flag.default }],
        operator,
      );
      if (!result.ok) throw new Error("apply failed");
      current = boolean(store, "dares_enabled");
    }
    const ids: number[] = [];
    let before: number | undefined;
    for (;;) {
      const page = store.audit.history("scout/prod", "dares_enabled", {
        before,
        limit: 2,
      });
      ids.push(...page.entries.map((entry) => entry.id));
      expect(page.entries.length).toBeLessThanOrEqual(2);
      if (page.nextBefore === null) break;
      before = page.nextBefore;
    }
    expect(ids).toHaveLength(5);
    expect(ids).toEqual(ids.toSorted((left, right) => right - left));
    expect(() =>
      store.audit.history("scout/prod", "dares_enabled", { limit: 101 }),
    ).toThrow(/out of range/u);
  } finally {
    store.close();
  }
});
