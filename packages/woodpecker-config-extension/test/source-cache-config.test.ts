import { beforeEach, expect, test, vi } from "vitest";
import type { FlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
const flag = vi.hoisted(() => vi.fn<FlagConfigSource["get"]>());
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: () => ({ name: "flag", get: flag }),
}));
import { sourceCacheConfig } from "#src/checkout/config.ts";
beforeEach(() => vi.resetAllMocks());

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
