import { describe, expect, test } from "vitest";
import fixture from "./providers/fixtures/flipt-snapshot.default.json" with { type: "json" };
import { managedFlagInventory } from "./managed-flag-inventory.ts";
import {
  compareManagedFlagInventory,
  fetchFliptSnapshot,
  FliptSnapshotSchema,
  formatManagedFlagDrift,
  type FliptSnapshot,
} from "./managed-flag-drift.ts";

const fixtureSnapshot = FliptSnapshotSchema.parse({ flags: fixture.flags });

const snapshot = FliptSnapshotSchema.parse({
  flags: managedFlagInventory.flags.map((flag) => ({
    key: flag.key,
    enabled: flag.type === "boolean" ? flag.default : false,
    type: flag.type === "boolean" ? "BOOLEAN_FLAG_TYPE" : "VARIANT_FLAG_TYPE",
    rules: flag.rules,
    rollouts: [
      ...flag.rollouts.map((rollout, index) => ({
        type: "SEGMENT_ROLLOUT_TYPE" as const,
        rank: index,
        segment: {
          value: rollout.result,
          segmentOperator: rollout.segmentOperator,
          segments: [
            {
              key: rollout.segmentKey,
              matchType: rollout.matchType,
              constraints: rollout.constraints,
            },
          ],
        },
      })),
      ...flag.thresholdRollouts.map((rollout) => ({
        type: "THRESHOLD_ROLLOUT_TYPE" as const,
        rank: rollout.rank,
        threshold: {
          percentage: rollout.percentage,
          value: rollout.result,
        },
      })),
    ],
    ...(flag.type === "variant"
      ? { defaultVariant: { key: flag.default } }
      : {}),
  })),
});

function flagAt(index: number): FliptSnapshot["flags"][number] {
  const flag = snapshot.flags[index];
  if (flag === undefined) {
    throw new Error(`fixture flag ${index.toString()} is missing`);
  }
  return flag;
}

function withFlags(flags: FliptSnapshot["flags"]): FliptSnapshot {
  return FliptSnapshotSchema.parse({ flags });
}

describe("managed Flipt flag drift", () => {
  test("recognizes an aligned snapshot", () => {
    expect(compareManagedFlagInventory(snapshot)).toEqual({
      missingInFlipt: [],
      undeclaredInInventory: [],
      contractMismatches: [],
    });
  });

  test("reports inventory keys missing from Flipt", () => {
    const missing = snapshot.flags[0]?.key;
    if (missing === undefined) throw new Error("aligned snapshot is empty");
    const result = compareManagedFlagInventory(
      withFlags(snapshot.flags.filter((flag) => flag.key !== missing)),
    );

    expect(result.missingInFlipt).toEqual([missing]);
    expect(result.undeclaredInInventory).toEqual([]);
  });

  test("reports Flipt keys absent from the inventory", () => {
    const unexpected = { ...flagAt(0), key: "unexpected-test-flag" };
    const result = compareManagedFlagInventory(
      withFlags([...snapshot.flags, unexpected]),
    );

    expect(result.missingInFlipt).toEqual([]);
    expect(result.undeclaredInInventory).toEqual(["unexpected-test-flag"]);
  });

  test("reports both mismatch directions in deterministic order", () => {
    const missing = snapshot.flags[0]?.key;
    if (missing === undefined) throw new Error("aligned snapshot is empty");
    const unexpectedKeys = ["zeta-test-flag", "alpha-test-flag"];
    const result = compareManagedFlagInventory(
      withFlags([
        ...snapshot.flags.filter((flag) => flag.key !== missing),
        ...unexpectedKeys.map((key) => ({ ...flagAt(0), key })),
      ]),
    );

    expect(result.missingInFlipt).toEqual([missing]);
    expect(result.undeclaredInInventory).toEqual(unexpectedKeys.toSorted());
    expect(formatManagedFlagDrift(result)).toEqual([
      `declared keys missing from Flipt: ${missing}`,
      "Flipt keys absent from the inventory: alpha-test-flag,zeta-test-flag",
    ]);
  });

  test("keeps contract mismatches separate from key membership drift", () => {
    const changed = { ...flagAt(0), enabled: !flagAt(0).enabled };
    const result = compareManagedFlagInventory(
      withFlags([changed, ...snapshot.flags.slice(1)]),
    );

    expect(result.missingInFlipt).toEqual([]);
    expect(result.undeclaredInInventory).toEqual([]);
    expect(result.contractMismatches).toHaveLength(1);
  });
});

describe("fetchFliptSnapshot", () => {
  test("requests the configured namespace and environment", async () => {
    let request:
      | { input: string | Request | URL; init: RequestInit | undefined }
      | undefined;
    const result = await fetchFliptSnapshot({
      url: "http://flipt.test/",
      namespace: "custom namespace",
      environment: "staging",
      fetcher: async (input, init) => {
        request = { input, init };
        return Response.json(fixtureSnapshot, { status: 200 });
      },
    });

    expect(result).toEqual(fixtureSnapshot);
    expect(request?.input).toBe(
      "http://flipt.test/internal/v1/evaluation/snapshot/namespace/custom%20namespace",
    );
    expect(request?.init?.headers).toEqual({
      Accept: "application/json",
      "x-flipt-accept-server-version": "1.47.0",
      "x-flipt-environment": "staging",
    });
  });

  test("fails on an unsuccessful response", async () => {
    await expect(
      fetchFliptSnapshot({
        url: "http://flipt.test",
        fetcher: async () =>
          new Response("unavailable", {
            status: 503,
            statusText: "Service Unavailable",
          }),
      }),
    ).rejects.toThrow("Flipt snapshot request failed: 503 Service Unavailable");
  });

  test("propagates connectivity failures", async () => {
    await expect(
      fetchFliptSnapshot({
        url: "http://flipt.test",
        fetcher: async () => {
          throw new Error("connection refused");
        },
      }),
    ).rejects.toThrow("connection refused");
  });

  test("fails on a malformed snapshot", async () => {
    await expect(
      fetchFliptSnapshot({
        url: "http://flipt.test",
        fetcher: async () =>
          Response.json({ flags: [{ key: "broken" }] }, { status: 200 }),
      }),
    ).rejects.toThrow();
  });
});
