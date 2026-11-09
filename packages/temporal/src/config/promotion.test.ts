import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFlagConfigSource,
  type FlagConfigSource,
} from "@shepherdjerred/feature-flags/config-source.ts";

vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: vi.fn(),
}));
import { promotionConfig } from "./promotion.ts";

const source = {
  get: vi.fn<FlagConfigSource["get"]>(),
  create: vi.mocked(createFlagConfigSource),
};

beforeEach(() => {
  vi.resetAllMocks();
  source.get.mockResolvedValue(undefined);
  source.create.mockImplementation(() => ({ name: "flag", get: source.get }));
});

describe("promotion configuration", () => {
  it("defaults publishing off with an empty target allowlist", async () => {
    expect(await promotionConfig()).toMatchObject({
      enabled: false,
      enabledTargets: [],
      monthlySolverUsd: 10,
      maxSteps: 80,
      dailySpendUsd: 5,
    });
  });
  it("preserves false and a zero solver allowance", async () => {
    source.get.mockImplementation((names) =>
      Promise.resolve({
        value:
          names.flag === "the-storm-promotion-enabled"
            ? false
            : JSON.stringify({
                model: "gpt-5.6-luna",
                maxSteps: 10,
                timeoutMinutes: 5,
                monthlySolverUsd: 0,
                dailySpendUsd: 0,
                enabledTargets: ["pmc"],
              }),
      }),
    );
    expect(await promotionConfig()).toMatchObject({
      enabled: false,
      monthlySolverUsd: 0,
      dailySpendUsd: 0,
      enabledTargets: ["pmc"],
    });
  });
  it.each(["invalid-json", '{"monthlySolverUsd":100}'])(
    "rejects invalid present settings: %s",
    async (value) => {
      source.get.mockImplementation((names) =>
        Promise.resolve(
          names.flag === "the-storm-promotion-enabled" ? undefined : { value },
        ),
      );
      await expect(promotionConfig()).rejects.toThrow();
    },
  );
  it("disables publishing on provider errors", async () => {
    source.get.mockRejectedValue(new Error("provider unavailable"));
    expect(await promotionConfig()).toMatchObject({
      enabled: false,
      available: false,
    });
  });
  it("requires a fresh flag snapshot even when a stale true answer is returned", async () => {
    source.get.mockImplementation((names) => {
      source.create.mock.calls[0]?.[0].onUnavailable?.(names.flag);
      return Promise.resolve(
        names.flag === "the-storm-promotion-enabled"
          ? { value: true }
          : undefined,
      );
    });
    expect(await promotionConfig()).toMatchObject({ enabled: false });
  });
});
