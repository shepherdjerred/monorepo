import type {
  FlagConfigSource,
  FlagSourceOptions,
} from "@shepherdjerred/feature-flags/config-source.ts";
import { beforeEach, describe, expect, test, vi } from "vitest";

const flagMocks = vi.hoisted(() => {
  const getFlagValue = vi.fn<FlagConfigSource["get"]>();
  const buildFlagSource = vi.fn<
    (options: FlagSourceOptions) => FlagConfigSource
  >(() => ({ name: "flag", get: getFlagValue }));
  return { getFlagValue, buildFlagSource };
});

vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: flagMocks.buildFlagSource,
}));

import {
  isReportRemediationEnabled,
  reportRemediationConfig,
} from "./report-remediation.ts";

describe("reportRemediationConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagMocks.getFlagValue.mockResolvedValue(undefined);
  });

  test("defaults auto-remediation on when flag is absent and targets temporal-remediation-<stage>", async () => {
    expect(await reportRemediationConfig("prod")).toMatchObject({
      value: true,
      source: "default",
    });
    expect(flagMocks.buildFlagSource).toHaveBeenCalledWith({
      targetingKey: "temporal-remediation-prod",
      attributes: { stage: "prod" },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
    });
  });

  test.each([false, true])(
    "resolves explicit %s without falling through to default",
    async (value) => {
      flagMocks.getFlagValue.mockResolvedValue({ value });
      expect(await reportRemediationConfig("beta")).toMatchObject({
        value,
        source: "flag",
      });
      expect(await isReportRemediationEnabled("beta")).toBe(value);
    },
  );

  test.each([0, 1, "true", "false", null])(
    "rejects invalid present flag value %s",
    async (value) => {
      flagMocks.getFlagValue.mockResolvedValue({ value });
      await expect(reportRemediationConfig("prod")).rejects.toThrow();
    },
  );

  test("falls back to declared default when flag source throws", async () => {
    flagMocks.getFlagValue.mockRejectedValue(
      new Error("flags snapshot unavailable"),
    );
    expect(await reportRemediationConfig("prod")).toMatchObject({
      value: true,
      source: "default",
    });
  });
});
