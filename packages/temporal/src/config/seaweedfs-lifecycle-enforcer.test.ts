import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  FlagConfigSource,
  FlagSourceOptions,
} from "@shepherdjerred/feature-flags/config-source.ts";

const flag = vi.hoisted(() => vi.fn<FlagConfigSource["get"]>());
const createSource = vi.hoisted(() =>
  vi.fn<(options: FlagSourceOptions) => FlagConfigSource>(),
);
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: createSource,
}));
import {
  parseBucketAllowlist,
  seaweedfsLifecycleEnforcerConfig,
} from "./seaweedfs-lifecycle-enforcer.ts";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
  createSource.mockImplementation(() => ({ name: "flag", get: flag }));
});

async function modeOf() {
  const policy = await seaweedfsLifecycleEnforcerConfig();
  return policy.mode;
}

function flags(values: Record<string, unknown>) {
  flag.mockImplementation((names) =>
    Promise.resolve(
      names.key in values ? { value: values[names.key] } : undefined,
    ),
  );
}

describe("SeaweedFS lifecycle enforcer configuration", () => {
  test("absent flags report only, cap at 20000 deletes, and cover every bucket", async () => {
    expect(await seaweedfsLifecycleEnforcerConfig()).toEqual({
      mode: "report",
      maxDeletes: 20_000,
      buckets: "*",
      provenance: {
        mode: "default",
        maxDeletes: "default",
        buckets: "default",
      },
    });
    expect(createSource).toHaveBeenCalledExactlyOnceWith({
      targetingKey: "seaweedfs-lifecycle-enforcer-prod",
      attributes: { environment: "prod" },
      kinds: { mode: "string", maxDeletes: "number", buckets: "string" },
      requireFreshSnapshot: true,
      onUnavailable: expect.any(Function),
    });
    expect(flag.mock.calls.map(([names]) => names.flag).toSorted()).toEqual([
      "seaweedfs-lifecycle-enforcer-buckets",
      "seaweedfs-lifecycle-enforcer-max-deletes",
      "seaweedfs-lifecycle-enforcer-mode",
    ]);
  });

  test("an explicit delete mode, cap, and allowlist are authoritative", async () => {
    flags({
      mode: "delete",
      maxDeletes: 500,
      buckets: "ci-handoff, sjer-red",
    });
    expect(await seaweedfsLifecycleEnforcerConfig()).toEqual({
      mode: "delete",
      maxDeletes: 500,
      buckets: ["ci-handoff", "sjer-red"],
      provenance: { mode: "flag", maxDeletes: "flag", buckets: "flag" },
    });
  });

  test("an explicit report mode is authoritative", async () => {
    flags({ mode: "report" });
    const policy = await seaweedfsLifecycleEnforcerConfig();
    expect(policy.mode).toBe("report");
  });

  test.each(["purge", "", "DELETE", null, 1, true])(
    "rejects a present invalid mode %j without defaulting",
    async (mode) => {
      flags({ mode });
      await expect(seaweedfsLifecycleEnforcerConfig()).rejects.toThrow();
    },
  );

  test.each([0, -1, 1.5, 1_000_001, "20000x", null, Number.NaN])(
    "rejects a present invalid delete cap %j without defaulting",
    async (maxDeletes) => {
      flags({ mode: "delete", maxDeletes });
      await expect(seaweedfsLifecycleEnforcerConfig()).rejects.toThrow();
    },
  );

  test.each(["", "ci-handoff,", "CI_Handoff", 3])(
    "rejects a present invalid allowlist %j without defaulting",
    async (buckets) => {
      flags({ mode: "delete", buckets });
      await expect(seaweedfsLifecycleEnforcerConfig()).rejects.toThrow();
    },
  );

  test("a source exception downgrades delete to report", async () => {
    flag.mockImplementation((names) =>
      names.key === "mode"
        ? Promise.resolve({ value: "delete" })
        : Promise.reject(new Error("source unavailable")),
    );
    expect(await seaweedfsLifecycleEnforcerConfig()).toMatchObject({
      mode: "report",
      maxDeletes: 20_000,
    });
  });

  test("provider unavailability downgrades delete to report", async () => {
    flag.mockImplementation((names) => {
      if (names.key === "mode") return Promise.resolve({ value: "delete" });
      const options = createSource.mock.calls[0]?.[0];
      if (options?.onUnavailable === undefined)
        throw new Error("The sweep must observe unavailable flag evaluations");
      options.onUnavailable(names.flag);
      return Promise.resolve(undefined);
    });
    expect(await modeOf()).toBe("report");
  });

  test("a recovered source can enable a later call without carrying outage state", async () => {
    flag.mockRejectedValue(new Error("source unavailable"));
    expect(await modeOf()).toBe("report");
    flags({ mode: "delete" });
    expect(await modeOf()).toBe("delete");
  });

  test("fatal provider-contract failures remain errors", async () => {
    const error = new Error("managed flag contract invalid");
    error.name = "ConfigSourceFatalError";
    flag.mockRejectedValue(error);
    await expect(seaweedfsLifecycleEnforcerConfig()).rejects.toThrow(error);
  });
});

describe("parseBucketAllowlist", () => {
  test("treats * as every bucket and splits a list", () => {
    expect(parseBucketAllowlist("*")).toBe("*");
    expect(parseBucketAllowlist("a-bucket, b-bucket,c-bucket")).toEqual([
      "a-bucket",
      "b-bucket",
      "c-bucket",
    ]);
  });
});
