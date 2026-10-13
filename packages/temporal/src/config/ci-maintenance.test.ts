import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
import { ciWorkspaceSeedRefreshEnabled } from "./ci-maintenance.ts";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  flag.mockResolvedValue(undefined);
  createSource.mockImplementation(() => ({ name: "flag", get: flag }));
});
afterEach(() => vi.unstubAllEnvs());

test.each(["prod", "beta", "dev"])(
  "seed refresh supplies the %s namespace as its rollout stage",
  async (stage) => {
    vi.stubEnv("TEMPORAL_NAMESPACE", stage);
    flag.mockImplementation(() =>
      Promise.resolve({
        value: createSource.mock.calls[0]?.[0].attributes?.["stage"] === "beta",
      }),
    );
    expect(await ciWorkspaceSeedRefreshEnabled()).toBe(stage === "beta");
    expect(createSource).toHaveBeenCalledExactlyOnceWith({
      targetingKey: `ci-maintenance-${stage}`,
      attributes: { environment: stage, stage },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
    });
    expect(flag.mock.calls[0]?.[0].flag).toBe(
      "ci-workspace-seed-refresh-enabled",
    );
  },
);

test("absent and unavailable seed flags keep production dispatch disabled", async () => {
  expect(await ciWorkspaceSeedRefreshEnabled()).toBe(false);
  flag.mockRejectedValue(new Error("source unavailable"));
  expect(await ciWorkspaceSeedRefreshEnabled()).toBe(false);
});

test("an explicit false remains disabled", async () => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "beta");
  flag.mockResolvedValue({ value: false });
  expect(await ciWorkspaceSeedRefreshEnabled()).toBe(false);
});

test.each([0, "true", null])(
  "invalid seed flag %s fails visibly",
  async (value) => {
    flag.mockResolvedValue({ value });
    await expect(ciWorkspaceSeedRefreshEnabled()).rejects.toThrow();
  },
);

test("an invalid namespace fails before evaluating flags", async () => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "unknown");
  await expect(ciWorkspaceSeedRefreshEnabled()).rejects.toThrow();
  expect(createSource).not.toHaveBeenCalled();
});
