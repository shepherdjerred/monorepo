import { describe, expect, test } from "vitest";
import {
  emptyAccumulator,
  LIFECYCLE_MAX_DELETE_ERRORS,
  type EnforceableRule,
  type SweepRuleInput,
  type SweepRuleResult,
} from "#shared/seaweedfs-lifecycle/types.ts";
import {
  classifyLifecycleRules,
  isExpired,
  sweepRuleChunk,
  type LifecycleRuleDocument,
} from "./core.ts";
import { daysAgo, FakeLifecycleS3, NOW_MS } from "./test-fixtures.ts";

const enabled = (rule: LifecycleRuleDocument): LifecycleRuleDocument => ({
  Status: "Enabled",
  ...rule,
});

describe("classifyLifecycleRules", () => {
  test("enforces Filter.Prefix rules, an empty prefix meaning the whole bucket", () => {
    const result = classifyLifecycleRules("assets", [
      enabled({
        ID: "hashed",
        Filter: { Prefix: "_astro/" },
        Expiration: { Days: 90 },
      }),
      enabled({
        ID: "everything",
        Filter: { Prefix: "" },
        Expiration: { Days: 7 },
      }),
    ]);
    expect(result).toEqual({
      bucket: "assets",
      rules: [
        { id: "hashed", prefix: "_astro/", days: 90 },
        { id: "everything", prefix: "", days: 7 },
      ],
      unsupported: [],
      disabledRules: 0,
    });
  });

  test("accepts the legacy top-level Prefix when there is no Filter", () => {
    expect(
      classifyLifecycleRules("b", [
        enabled({ ID: "old", Prefix: "logs/", Expiration: { Days: 3 } }),
        enabled({ ID: "old-all", Prefix: "", Expiration: { Days: 3 } }),
      ]).rules,
    ).toEqual([
      { id: "old", prefix: "logs/", days: 3 },
      { id: "old-all", prefix: "", days: 3 },
    ]);
  });

  test("counts disabled rules and never enforces them", () => {
    const result = classifyLifecycleRules("b", [
      { Status: "Disabled", Filter: { Prefix: "x/" }, Expiration: { Days: 1 } },
    ]);
    expect(result.rules).toEqual([]);
    expect(result.unsupported).toEqual([]);
    expect(result.disabledRules).toBe(1);
  });

  test("names an unidentified rule by its position", () => {
    expect(
      classifyLifecycleRules("b", [
        enabled({ Filter: { Prefix: "a/" }, Expiration: { Days: 1 } }),
        enabled({ Filter: { Prefix: "b/" }, Expiration: { Days: 2 } }),
      ]).rules.map((rule) => rule.id),
    ).toEqual(["rule-0", "rule-1"]);
  });

  test.each<[string, LifecycleRuleDocument, string]>([
    [
      "a tag filter",
      { Filter: { Tag: { Key: "k", Value: "v" } }, Expiration: { Days: 1 } },
      "filter uses tags or And",
    ],
    [
      "an And filter",
      {
        Filter: { And: { Prefix: "a/", Tags: [] } },
        Expiration: { Days: 1 },
      },
      "filter uses tags or And",
    ],
    [
      "an object size filter",
      {
        Filter: { Prefix: "a/", ObjectSizeGreaterThan: 10 },
        Expiration: { Days: 1 },
      },
      "filter uses object size",
    ],
    [
      "an empty filter",
      { Filter: {}, Expiration: { Days: 1 } },
      "empty filter",
    ],
    [
      "neither filter nor prefix",
      { Expiration: { Days: 1 } },
      "no filter or prefix",
    ],
    [
      "an Expiration.Date",
      { Filter: { Prefix: "a/" }, Expiration: { Date: new Date() } },
      "Expiration.Date",
    ],
    [
      "an ExpiredObjectDeleteMarker",
      {
        Filter: { Prefix: "a/" },
        Expiration: { ExpiredObjectDeleteMarker: true },
      },
      "ExpiredObjectDeleteMarker",
    ],
    ["no Expiration at all", { Filter: { Prefix: "a/" } }, "no Expiration"],
    [
      "a zero-day Expiration",
      { Filter: { Prefix: "a/" }, Expiration: { Days: 0 } },
      "no Expiration.Days",
    ],
    [
      "transitions",
      {
        Filter: { Prefix: "a/" },
        Expiration: { Days: 9 },
        Transitions: [{ Days: 1, StorageClass: "GLACIER" }],
      },
      "transitions",
    ],
    [
      "noncurrent version transitions",
      {
        Filter: { Prefix: "a/" },
        Expiration: { Days: 9 },
        NoncurrentVersionTransitions: [{ NoncurrentDays: 1 }],
      },
      "noncurrent version transitions",
    ],
    [
      "noncurrent version expiration",
      {
        Filter: { Prefix: "a/" },
        Expiration: { Days: 9 },
        NoncurrentVersionExpiration: { NoncurrentDays: 1 },
      },
      "noncurrent version expiration",
    ],
  ])("reports %s as unsupported and skips it", (_name, rule, reason) => {
    const result = classifyLifecycleRules("b", [
      enabled({ ID: "odd", ...rule }),
    ]);
    expect(result.rules).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]?.id).toBe("odd");
    expect(result.unsupported[0]?.reason).toContain(reason);
  });
});

describe("isExpired", () => {
  test("keeps an object written exactly the rule's days ago", () => {
    expect(isExpired(daysAgo(30), 30, NOW_MS)).toBe(false);
  });

  test("expires an object a millisecond past the boundary", () => {
    expect(isExpired(daysAgo(30, 1), 30, NOW_MS)).toBe(true);
  });

  test("keeps newer objects and objects without a LastModified", () => {
    expect(isExpired(daysAgo(29), 30, NOW_MS)).toBe(false);
    expect(isExpired(undefined, 30, NOW_MS)).toBe(false);
  });
});

const RULE: EnforceableRule = { id: "expire-old", prefix: "_astro/", days: 90 };

function input(overrides: Partial<SweepRuleInput> = {}): SweepRuleInput {
  return {
    bucket: "site",
    rule: RULE,
    nowMs: NOW_MS,
    mode: "report",
    deleteBudget: 1_000_000,
    token: undefined,
    accumulator: emptyAccumulator(),
    ...overrides,
  };
}

function populate(s3: FakeLifecycleS3): void {
  s3.put("site", "_astro/old-a.js", daysAgo(200), 10);
  s3.put("site", "_astro/old-b.js", daysAgo(100), 20);
  s3.put("site", "_astro/boundary.js", daysAgo(90), 30);
  s3.put("site", "_astro/fresh.js", daysAgo(10), 40);
  s3.put("site", "index.html", daysAgo(500), 50);
  s3.put("site", "other/old.js", daysAgo(500), 60);
}

describe("sweepRuleChunk in report mode", () => {
  test("reports candidates under the prefix without deleting anything", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    const result = await sweepRuleChunk(input(), { client: s3 });
    expect(result).toMatchObject({
      status: "complete",
      mode: "report",
      token: undefined,
      deletedThisChunk: 0,
    });
    expect(result.accumulator).toMatchObject({
      scanned: 4,
      candidates: 2,
      candidateBytes: 30,
      deleted: 0,
      oldestModifiedMs: daysAgo(200).getTime(),
      newestModifiedMs: daysAgo(100).getTime(),
      sampleKeys: ["_astro/old-a.js", "_astro/old-b.js"],
    });
    expect(s3.deleteCalls).toEqual([]);
    expect(s3.keys("site")).toHaveLength(6);
    expect(s3.listCalls[0]?.prefix).toBe("_astro/");
  });

  test("keeps at most ten sample keys", async () => {
    const s3 = new FakeLifecycleS3();
    for (let n = 0; n < 25; n += 1) {
      s3.put("site", `_astro/f-${String(n).padStart(2, "0")}.js`, daysAgo(99));
    }
    const { accumulator } = await sweepRuleChunk(input(), { client: s3 });
    expect(accumulator.candidates).toBe(25);
    expect(accumulator.sampleKeys).toHaveLength(10);
    expect(accumulator.sampleKeys[0]).toBe("_astro/f-00.js");
  });

  test("an empty prefix covers the whole bucket", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    const { accumulator } = await sweepRuleChunk(
      input({ rule: { id: "all", prefix: "", days: 90 } }),
      { client: s3 },
    );
    expect(accumulator.scanned).toBe(6);
    expect(accumulator.candidates).toBe(4);
  });

  test("an object exactly at the days boundary is not a candidate", async () => {
    const s3 = new FakeLifecycleS3();
    s3.put("site", "_astro/boundary.js", daysAgo(90));
    s3.put("site", "_astro/just-over.js", daysAgo(90, 1));
    const { accumulator } = await sweepRuleChunk(input(), { client: s3 });
    expect(accumulator.sampleKeys).toEqual(["_astro/just-over.js"]);
  });
});

describe("sweepRuleChunk in delete mode", () => {
  test("deletes only expired objects under the rule's prefix", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    const result = await sweepRuleChunk(input({ mode: "delete" }), {
      client: s3,
    });
    expect(result).toMatchObject({
      status: "complete",
      mode: "delete",
      deletedThisChunk: 2,
    });
    expect(result.accumulator).toMatchObject({
      candidates: 2,
      deleted: 2,
      deletedBytes: 30,
      deleteErrors: 0,
    });
    expect(s3.keys("site")).toEqual([
      "_astro/boundary.js",
      "_astro/fresh.js",
      "index.html",
      "other/old.js",
    ]);
  });

  test("never deletes outside the prefix even if the server ignores it", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    s3.ignorePrefix = true;
    await sweepRuleChunk(input({ mode: "delete" }), { client: s3 });
    expect(s3.keys("site")).toContain("index.html");
    expect(s3.keys("site")).toContain("other/old.js");
    expect(s3.deleteCalls.flatMap((call) => call.keys)).toEqual([
      "_astro/old-a.js",
      "_astro/old-b.js",
    ]);
  });

  test("an empty prefix deletes every expired object in the bucket", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    await sweepRuleChunk(
      input({ mode: "delete", rule: { id: "all", prefix: "", days: 90 } }),
      { client: s3 },
    );
    expect(s3.keys("site")).toEqual(["_astro/boundary.js", "_astro/fresh.js"]);
  });

  test("splits deletes into batches of at most 1000 keys", async () => {
    const s3 = new FakeLifecycleS3();
    for (let n = 0; n < 2500; n += 1) {
      s3.put("site", `_astro/f-${String(n).padStart(4, "0")}.js`, daysAgo(99));
    }
    s3.pageSize = 2500;
    const result = await sweepRuleChunk(input({ mode: "delete" }), {
      client: s3,
    });
    expect(s3.deleteCalls.map((call) => call.keys.length)).toEqual([
      1000, 1000, 500,
    ]);
    expect(result.deletedThisChunk).toBe(2500);
    expect(s3.keys("site")).toEqual([]);
  });

  test("honours the per-run delete cap and reports it", async () => {
    const s3 = new FakeLifecycleS3();
    for (let n = 0; n < 12; n += 1) {
      s3.put("site", `_astro/f-${String(n).padStart(2, "0")}.js`, daysAgo(99));
    }
    const result = await sweepRuleChunk(
      input({ mode: "delete", deleteBudget: 5 }),
      { client: s3 },
    );
    expect(result).toMatchObject({
      status: "cap-reached",
      token: undefined,
      deletedThisChunk: 5,
    });
    expect(result.accumulator.deleted).toBe(5);
    expect(s3.keys("site")).toHaveLength(7);
  });

  test("a zero budget deletes nothing", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    const result = await sweepRuleChunk(
      input({ mode: "delete", deleteBudget: 0 }),
      { client: s3 },
    );
    expect(result.status).toBe("cap-reached");
    expect(s3.deleteCalls).toEqual([]);
  });

  test("counts per-key delete failures without counting them as deleted", async () => {
    const s3 = new FakeLifecycleS3();
    populate(s3);
    s3.failDeleteKeys.add("_astro/old-b.js");
    const result = await sweepRuleChunk(input({ mode: "delete" }), {
      client: s3,
    });
    expect(result.status).toBe("complete");
    expect(result.accumulator).toMatchObject({
      candidates: 2,
      deleted: 1,
      deletedBytes: 10,
      deleteErrors: 1,
      errorSamples: ["_astro/old-b.js: AccessDenied denied"],
    });
    expect(s3.keys("site")).toContain("_astro/old-b.js");
  });

  test("aborts the rule after too many delete failures", async () => {
    const s3 = new FakeLifecycleS3();
    for (let n = 0; n < 300; n += 1) {
      const key = `_astro/f-${String(n).padStart(3, "0")}.js`;
      s3.put("site", key, daysAgo(99));
      s3.failDeleteKeys.add(key);
    }
    s3.pageSize = 150;
    const result = await sweepRuleChunk(input({ mode: "delete" }), {
      client: s3,
    });
    expect(result.status).toBe("aborted");
    expect(result.accumulator.deleteErrors).toBeGreaterThanOrEqual(
      LIFECYCLE_MAX_DELETE_ERRORS,
    );
    expect(result.accumulator.errorSamples.length).toBeLessThanOrEqual(5);
    expect(s3.deleteCalls).toHaveLength(1);
  });

  test("stops deleting and keeps reporting when the policy halts deletes", async () => {
    const s3 = new FakeLifecycleS3();
    for (let n = 0; n < 6; n += 1) {
      s3.put("site", `_astro/f-${String(n)}.js`, daysAgo(99));
    }
    s3.pageSize = 2;
    let calls = 0;
    const result = await sweepRuleChunk(input({ mode: "delete" }), {
      client: s3,
      deleteHalted: () => {
        calls += 1;
        return Promise.resolve(
          calls > 1 ? "the mode flag left delete" : undefined,
        );
      },
    });
    expect(result).toMatchObject({
      status: "complete",
      mode: "report",
      downgradeReason: "the mode flag left delete",
      deletedThisChunk: 2,
    });
    expect(result.accumulator.candidates).toBe(6);
    expect(s3.keys("site")).toHaveLength(4);
  });
});

function many(s3: FakeLifecycleS3, count: number): void {
  for (let n = 0; n < count; n += 1) {
    s3.put("site", `_astro/f-${String(n).padStart(3, "0")}.js`, daysAgo(99));
  }
}

describe("sweepRuleChunk chunking and retries", () => {
  test("returns a continuation token when the chunk's page budget ends", async () => {
    const s3 = new FakeLifecycleS3();
    many(s3, 10);
    s3.pageSize = 3;
    const first = await sweepRuleChunk(input({ mode: "delete" }), {
      client: s3,
      maxPages: 2,
    });
    expect(first.status).toBe("running");
    expect(first.token).toBe("_astro/f-005.js");
    expect(first.accumulator.candidates).toBe(6);
    const second = await sweepRuleChunk(
      input({
        mode: "delete",
        token: first.token,
        accumulator: first.accumulator,
      }),
      { client: s3, maxPages: 2 },
    );
    expect(second.status).toBe("complete");
    expect(second.accumulator).toMatchObject({ candidates: 10, deleted: 10 });
    expect(s3.keys("site")).toEqual([]);
  });

  test("returns a continuation token when the chunk's time budget ends", async () => {
    const s3 = new FakeLifecycleS3();
    many(s3, 10);
    s3.pageSize = 3;
    let now = 0;
    const result = await sweepRuleChunk(input(), {
      client: s3,
      chunkMillis: 100,
      clock: () => {
        now += 120;
        return now;
      },
    });
    expect(result.status).toBe("running");
    expect(result.token).toBeDefined();
    expect(s3.listCalls).toHaveLength(1);
  });

  test("re-running a chunk after a mid-chunk failure re-lists and finishes", async () => {
    const s3 = new FakeLifecycleS3();
    many(s3, 9);
    s3.pageSize = 3;
    s3.failListOnCall = 3;
    await expect(
      sweepRuleChunk(input({ mode: "delete" }), { client: s3 }),
    ).rejects.toThrow("list failed");
    // Two pages were deleted before the failure; a retry from the original
    // token re-lists and sees only what is left, deleting it exactly once.
    expect(s3.keys("site")).toHaveLength(3);
    const retry = await sweepRuleChunk(input({ mode: "delete" }), {
      client: s3,
    });
    expect(retry.status).toBe("complete");
    expect(retry.accumulator).toMatchObject({ deleted: 3, deleteErrors: 0 });
    expect(s3.keys("site")).toEqual([]);
    const deletedKeys = s3.deleteCalls.flatMap((call) => call.keys);
    expect(new Set(deletedKeys).size).toBe(deletedKeys.length);
  });

  test("resuming from the last checkpoint matches an uninterrupted run", async () => {
    const clean = new FakeLifecycleS3();
    many(clean, 9);
    clean.pageSize = 3;
    const expected = await sweepRuleChunk(input({ mode: "delete" }), {
      client: clean,
    });

    const s3 = new FakeLifecycleS3();
    many(s3, 9);
    s3.pageSize = 3;
    s3.failListOnCall = 3;
    let checkpoint: SweepRuleResult | undefined;
    await expect(
      sweepRuleChunk(input({ mode: "delete" }), {
        client: s3,
        onCheckpoint: (value) => {
          checkpoint = value;
        },
      }),
    ).rejects.toThrow("list failed");
    expect(checkpoint?.token).toBe("_astro/f-005.js");
    if (checkpoint === undefined) throw new Error("no checkpoint");
    const resumed = await sweepRuleChunk(
      input({
        mode: "delete",
        token: checkpoint.token,
        accumulator: checkpoint.accumulator,
        deleteBudget: 1_000_000 - checkpoint.deletedThisChunk,
      }),
      { client: s3 },
    );
    expect(resumed.accumulator).toEqual(expected.accumulator);
    expect(resumed.deletedThisChunk + checkpoint.deletedThisChunk).toBe(9);
  });

  test("stops on cancellation before touching S3", async () => {
    const s3 = new FakeLifecycleS3();
    many(s3, 3);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      sweepRuleChunk(input({ mode: "delete" }), {
        client: s3,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(s3.listCalls).toEqual([]);
    expect(s3.deleteCalls).toEqual([]);
  });
});
