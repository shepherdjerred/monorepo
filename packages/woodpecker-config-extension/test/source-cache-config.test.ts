import { beforeEach, expect, test, vi } from "vitest";
import type { FlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
const { flag, factory } = vi.hoisted(() => {
  const getter = vi.fn<FlagConfigSource["get"]>();
  return {
    flag: getter,
    factory: vi.fn(() => ({ name: "flag", get: getter })),
  };
});
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: factory,
}));
import { sourceCacheConfig } from "#src/checkout/config.ts";
import { maintenanceConfig } from "#src/maintenance-config.ts";
beforeEach(() => {
  vi.clearAllMocks();
  flag.mockReset();
});

test.each(["main", "feature/example", "ci-canary/cache"])(
  "cache targeting uses the signed branch %s and a fresh snapshot",
  async (branch) => {
    flag.mockResolvedValue(undefined);
    await sourceCacheConfig(branch);
    expect(factory).toHaveBeenCalledWith({
      targetingKey: branch,
      attributes: { stage: branch.startsWith("ci-canary/") ? "beta" : "prod" },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
    });
    expect(flag.mock.calls[0]?.[0]).toMatchObject({
      flag: "woodpecker-source-cache-enabled",
    });
  },
);

test.each([false, true])(
  "maintenance canaries are separate from main activation (manual=%s)",
  async (manual) => {
    flag.mockResolvedValue(undefined);
    expect(await maintenanceConfig(manual)).toMatchObject({
      value: false,
      source: "default",
    });
    expect(factory).toHaveBeenCalledWith({
      targetingKey: manual
        ? "woodpecker-maintenance-manual"
        : "woodpecker-maintenance-prod",
      attributes: { stage: manual ? "beta" : "prod" },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
    });
    expect(flag.mock.calls[0]?.[0]).toMatchObject({
      flag: "woodpecker-maintenance-lanes-enabled",
    });
    flag.mockResolvedValue({ value: false });
    expect(await maintenanceConfig(manual)).toMatchObject({
      value: false,
      source: "flag",
    });
    flag.mockResolvedValue({ value: true });
    expect(await maintenanceConfig(manual)).toMatchObject({
      value: true,
      source: "flag",
    });
    flag.mockResolvedValue({ value: "true" });
    await expect(maintenanceConfig(manual)).rejects.toThrow();
    flag.mockRejectedValue(new Error("Flag service unavailable"));
    expect(await maintenanceConfig(manual)).toMatchObject({
      value: false,
      source: "default",
    });
  },
);

test("cache defaults off and records authoritative false provenance", async () => {
  flag.mockResolvedValue(undefined);
  expect(await sourceCacheConfig("main")).toMatchObject({
    value: false,
    source: "default",
  });
  flag.mockResolvedValue({ value: false });
  expect(await sourceCacheConfig("main")).toMatchObject({
    value: false,
    source: "flag",
  });
  flag.mockResolvedValue({ value: true });
  expect(await sourceCacheConfig("main")).toMatchObject({
    value: true,
    source: "flag",
  });
});

test("invalid present values fail and unavailable flags leave ordinary checkout enabled", async () => {
  flag.mockResolvedValue({ value: "true" });
  await expect(sourceCacheConfig("main")).rejects.toThrow();
  flag.mockRejectedValue(new Error("unavailable"));
  expect(await sourceCacheConfig("main")).toMatchObject({
    value: false,
    source: "default",
  });
});
