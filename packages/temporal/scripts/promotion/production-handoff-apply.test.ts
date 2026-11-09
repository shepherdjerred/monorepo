import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
const storage = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("#activities/reports/report-object-store.ts", () => ({
  reportReceiptStore: () => ({
    client: { send: storage.send },
    bucket: "fixture",
  }),
}));
vi.mock("#config/promotion.ts", () => ({ promotionConfig: vi.fn() }));
vi.mock("#activities/promotion/store.ts", async (original) => ({
  ...(await original<object>()),
  promotionStore: vi.fn(),
}));
import { promotionConfig } from "#config/promotion.ts";
import { promotionStore } from "#activities/promotion/store.ts";
import {
  applyProductionHandoff,
  runProductionHandoff,
} from "./production-handoff.ts";
import { z } from "zod/v4";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { localPromotionStore } from "./local-store.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
vi.mock("@shepherdjerred/feature-flags", () => ({
  initFeatureFlags: vi.fn(),
  shutdownFeatureFlags: vi.fn(),
}));
beforeEach(() => {
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  storage.send.mockReset();
  vi.mocked(initFeatureFlags).mockReset();
  vi.mocked(shutdownFeatureFlags).mockReset();
  vi.mocked(promotionConfig).mockResolvedValue({
    available: true,
    enabled: false,
    model: "gpt-5.6-luna",
    enabledTargets: [],
    maxSteps: 80,
    timeoutMinutes: 15,
    monthlySolverUsd: 10,
    dailySpendUsd: 5,
  });
});
afterEach(() => vi.unstubAllEnvs());
const plan = () => ({
  objects: new Map<string, unknown>([
    ["targets/fixture.json", { paused: true }],
  ]),
  artifacts: new Map<string, Uint8Array>([
    ["fixture.png", new Uint8Array([1])],
  ]),
});
it("resumes identical imports and refuses conflicting production state before evidence writes", async () => {
  const store = memoryPromotionStore();
  vi.mocked(promotionStore).mockReturnValue(store);
  const receipt = await applyProductionHandoff(plan());
  expect(await applyProductionHandoff(plan())).toEqual(receipt);
  expect(storage.send).toHaveBeenCalledTimes(1);
  const other = plan();
  other.objects.set("targets/fixture.json", { paused: false });
  await expect(applyProductionHandoff(other)).rejects.toThrow(
    "different production handoff",
  );
  const collision = memoryPromotionStore();
  vi.mocked(promotionStore).mockReturnValue(collision);
  await collision.put("targets/fixture.json", { paused: false }, undefined);
  await expect(applyProductionHandoff(plan())).rejects.toThrow(
    "Production conflict",
  );
  const unchanged = await collision.read("targets/fixture.json", z.unknown());
  expect(unchanged?.value).toEqual({ paused: false });
  expect(storage.send).toHaveBeenCalledTimes(1);
});
it("refuses import while publishing is enabled", async () => {
  const configuration = await promotionConfig();
  vi.mocked(promotionConfig).mockResolvedValue({
    ...configuration,
    enabled: true,
  });
  await expect(applyProductionHandoff(plan())).rejects.toThrow(
    "Disable publishing",
  );
  expect(storage.send).not.toHaveBeenCalled();
});
it("refuses import when publishing configuration could not be read freshly", async () => {
  const configuration = await promotionConfig();
  vi.mocked(promotionConfig).mockResolvedValue({
    ...configuration,
    available: false,
  });
  await expect(applyProductionHandoff(plan())).rejects.toThrow(
    "fresh publishing configuration",
  );
  expect(storage.send).not.toHaveBeenCalled();
});
it("initializes flags only when applying and closes them after a failed safety check", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "promotion-flag-lifecycle-"),
  );
  const database = await localPromotionStore(directory);
  database.close();
  try {
    await runProductionHandoff(directory, false);
    expect(initFeatureFlags).not.toHaveBeenCalled();
    const configuration = await promotionConfig();
    vi.mocked(promotionConfig).mockResolvedValue({
      ...configuration,
      available: false,
    });
    await expect(runProductionHandoff(directory, true)).rejects.toThrow(
      "fresh publishing configuration",
    );
    expect(initFeatureFlags).toHaveBeenCalledOnce();
    expect(shutdownFeatureFlags).toHaveBeenCalledOnce();
    expect(storage.send).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true });
  }
});
