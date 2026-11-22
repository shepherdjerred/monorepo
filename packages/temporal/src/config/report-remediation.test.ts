import { beforeEach, expect, test, vi } from "vitest";
import type {
  FlagConfigSource,
  FlagSourceOptions,
} from "@shepherdjerred/feature-flags/config-source.ts";

const flag = vi.hoisted(() => vi.fn<FlagConfigSource["get"]>());
const source = vi.hoisted(() =>
  vi.fn<(options: FlagSourceOptions) => FlagConfigSource>(),
);
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: source,
}));
import {
  isReportRemediationEnabled,
  reportRemediationConfig,
} from "./report-remediation.ts";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
  source.mockImplementation(() => ({ name: "flag", get: flag }));
});

test("defaults auto-remediation on when flag is absent and targets temporal-remediation-<stage>", async () => {
  expect(await reportRemediationConfig("prod")).toMatchObject({
    value: true,
    source: "default",
  });
  expect(source).toHaveBeenCalledWith({
    targetingKey: "temporal-remediation-prod",
    attributes: { stage: "prod" },
    kinds: { enabled: "boolean" },
    requireFreshSnapshot: true,
  });
});

test.each([false, true])(
  "resolves explicit %s without falling through to default",
  async (value) => {
    flag.mockResolvedValue({ value });
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
    flag.mockResolvedValue({ value });
    await expect(reportRemediationConfig("prod")).rejects.toThrow();
  },
);

test("falls back to declared default when flag source throws", async () => {
  flag.mockRejectedValue(new Error("flipt snapshot unavailable"));
  expect(await reportRemediationConfig("prod")).toMatchObject({
    value: true,
    source: "default",
  });
});
