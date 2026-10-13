import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createFlagConfigSource,
  type FlagConfigSource,
} from "@shepherdjerred/feature-flags/config-source.ts";

vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: vi.fn(),
}));
import { ciWorkspaceSeedRefreshEnabled } from "./ci-maintenance.ts";

const source = {
  create: vi.mocked(createFlagConfigSource),
  get: vi.fn<FlagConfigSource["get"]>(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  source.get.mockResolvedValue(undefined);
  source.create.mockImplementation(() => ({ name: "flag", get: source.get }));
});
afterEach(() => vi.unstubAllEnvs());

test.each([false, true])(
  "the deployed production worker honors seed refresh %s",
  async (enabled) => {
    source.get.mockResolvedValue({ value: enabled });
    expect(await ciWorkspaceSeedRefreshEnabled()).toBe(enabled);
    expect(source.create).toHaveBeenCalledExactlyOnceWith({
      targetingKey: "ci-maintenance-prod",
      attributes: { environment: "prod", stage: "prod" },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
    });
    expect(source.get.mock.calls[0]?.[0].flag).toBe(
      "ci-workspace-seed-refresh-enabled",
    );
  },
);

test("absent and unavailable seed flags keep production dispatch disabled", async () => {
  expect(await ciWorkspaceSeedRefreshEnabled()).toBe(false);
  source.get.mockRejectedValue(new Error("source unavailable"));
  expect(await ciWorkspaceSeedRefreshEnabled()).toBe(false);
});

test("a beta namespace cannot activate the production seed producer", async () => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "beta");
  source.get.mockImplementation(() =>
    Promise.resolve({
      value: source.create.mock.calls[0]?.[0].attributes?.["stage"] === "beta",
    }),
  );
  expect(await ciWorkspaceSeedRefreshEnabled()).toBe(false);
});

test.each([0, "true", null])(
  "invalid seed flag %s fails visibly",
  async (value) => {
    source.get.mockResolvedValue({ value });
    await expect(ciWorkspaceSeedRefreshEnabled()).rejects.toThrow();
  },
);
