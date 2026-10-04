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
import { woodpeckerRetentionConfig } from "./woodpecker-retention.ts";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
  createSource.mockImplementation(() => ({ name: "flag", get: flag }));
});

describe("Woodpecker log retention configuration", () => {
  test("absent flags default destructive cleanup off and retain thirty days", async () => {
    expect(await woodpeckerRetentionConfig()).toEqual({
      enabled: false,
      days: 30,
      provenance: { enabled: "default", days: "default" },
    });
    expect(createSource).toHaveBeenCalledExactlyOnceWith({
      targetingKey: "woodpecker-log-retention-prod",
      attributes: { environment: "prod" },
      kinds: { enabled: "boolean", days: "number" },
      onUnavailable: expect.any(Function),
    });
    expect(flag.mock.calls.map(([names]) => names.flag).toSorted()).toEqual([
      "woodpecker-log-retention-days",
      "woodpecker-log-retention-enabled",
    ]);
  });

  test("explicit false is authoritative rather than falling through to default", async () => {
    flag.mockImplementation((names) =>
      Promise.resolve(names.key === "enabled" ? { value: false } : undefined),
    );
    expect(await woodpeckerRetentionConfig()).toEqual({
      enabled: false,
      days: 30,
      provenance: { enabled: "flag", days: "default" },
    });
  });

  test.each([30, 90, 3650])(
    "authoritative true enables cleanup with a validated %i day horizon",
    async (days) => {
      flag.mockImplementation((names) =>
        Promise.resolve({ value: names.key === "enabled" || days }),
      );
      expect(await woodpeckerRetentionConfig()).toEqual({
        enabled: true,
        days,
        provenance: { enabled: "flag", days: "flag" },
      });
    },
  );

  test.each([0, 29, 30.5, 3651, "30", null, true, Number.NaN, Infinity])(
    "rejects a present invalid retention horizon %s without defaulting",
    async (days) => {
      flag.mockImplementation((names) =>
        Promise.resolve({ value: names.key === "enabled" || days }),
      );
      await expect(woodpeckerRetentionConfig()).rejects.toThrow();
    },
  );

  test.each([0, 1, "false", "true", null])(
    "rejects a present invalid enabled value %s without defaulting",
    async (enabled) => {
      flag.mockImplementation((names) =>
        Promise.resolve({ value: names.key === "enabled" ? enabled : 30 }),
      );
      await expect(woodpeckerRetentionConfig()).rejects.toThrow();
    },
  );

  test("a days-source exception disables cleanup even when enabled resolves true", async () => {
    flag.mockImplementation((names) =>
      names.key === "enabled"
        ? Promise.resolve({ value: true })
        : Promise.reject(new Error("source unavailable")),
    );
    expect(await woodpeckerRetentionConfig()).toEqual({
      enabled: false,
      days: 30,
      provenance: { enabled: "flag", days: "default" },
    });
  });

  test("provider unavailability disables cleanup despite another authoritative true flag", async () => {
    flag.mockImplementation((names) => {
      if (names.key === "enabled") return Promise.resolve({ value: true });
      const options = createSource.mock.calls[0]?.[0];
      if (options?.onUnavailable === undefined)
        throw new Error("Retention must observe unavailable flag evaluations");
      options.onUnavailable(names.flag);
      return Promise.resolve(undefined);
    });
    expect(await woodpeckerRetentionConfig()).toEqual({
      enabled: false,
      days: 30,
      provenance: { enabled: "flag", days: "default" },
    });
  });

  test("a recovered source can enable a later call without carrying outage state", async () => {
    flag.mockRejectedValue(new Error("source unavailable"));
    expect(await woodpeckerRetentionConfig()).toEqual({
      enabled: false,
      days: 30,
      provenance: { enabled: "default", days: "default" },
    });
    flag.mockImplementation((names) =>
      Promise.resolve({ value: names.key === "enabled" || 90 }),
    );
    expect(await woodpeckerRetentionConfig()).toEqual({
      enabled: true,
      days: 90,
      provenance: { enabled: "flag", days: "flag" },
    });
  });

  test("fatal provider-contract failures remain errors", async () => {
    const error = new Error("managed flag contract invalid");
    error.name = "ConfigSourceFatalError";
    flag.mockRejectedValue(error);
    await expect(woodpeckerRetentionConfig()).rejects.toThrow(error);
  });
});
