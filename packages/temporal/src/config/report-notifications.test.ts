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
import { dailyReportNotificationsConfig } from "./report-notifications.ts";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
  source.mockImplementation(() => ({ name: "flag", get: flag }));
});

test("preserves cadence mail on absence and targets the activity namespace", async () => {
  expect(await dailyReportNotificationsConfig("prod")).toMatchObject({
    value: false,
    source: "default",
  });
  expect(source).toHaveBeenCalledWith({
    targetingKey: "temporal-reports-prod",
    attributes: { stage: "prod" },
    kinds: { enabled: "boolean" },
    requireFreshSnapshot: true,
  });
});

test.each([false, true])(
  "resolves explicit %s on every call",
  async (value) => {
    flag.mockResolvedValue({ value });
    expect(await dailyReportNotificationsConfig("beta")).toMatchObject({
      value,
      source: "flag",
    });
  },
);

test.each([0, 1, "true", "false", null])(
  "rejects invalid present flag %s",
  async (value) => {
    flag.mockResolvedValue({ value });
    await expect(dailyReportNotificationsConfig("prod")).rejects.toThrow();
  },
);

test("preserves cadence mail on source failure and observes its provenance", async () => {
  flag.mockRejectedValue(new Error("provider unavailable"));
  expect(await dailyReportNotificationsConfig("prod")).toMatchObject({
    value: false,
    source: "default",
  });
});
