import { beforeEach, expect, test, vi } from "vitest";
import type { ReplayPatchObservation } from "@scout-for-lol/domain/artifacts/replay-support.ts";

const database = vi.hoisted(() => ({ platforms: vi.fn(), execute: vi.fn() }));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientReplayArtifact: { findMany: database.platforms },
    $executeRaw: database.execute,
  },
}));
const { persistReplayPatchObservation, refreshReplayPatchObservations } =
  await import("./observation.ts");

function observation(platformId = "NA1"): ReplayPatchObservation {
  return {
    platformId,
    patch: "16.22",
    gameBuild: "16.22.834.8910",
    sourceUrl: `https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/${platformId}/versions?platform=windows`,
    sourceSha256: "a".repeat(64),
    observedAt: "2026-11-13T20:00:00Z",
  };
}
const platforms = vi.fn();
const observe = vi.fn();
const persist = vi.fn();
const deps = { platforms, observe, persist };

beforeEach(() => {
  vi.clearAllMocks();
  platforms.mockResolvedValue(["NA1"]);
  observe.mockImplementation(async (platformId: string) => {
    await Promise.resolve();
    return observation(platformId);
  });
  persist.mockResolvedValue(true);
  database.execute.mockResolvedValue(1);
});

test("observation persistence is an atomic monotonic timestamp CAS", async () => {
  expect(await persistReplayPatchObservation(observation())).toBe(true);
  const [sql, ...values] = database.execute.mock.calls[0] ?? [];
  expect(sql.join("?")).toContain(
    'WHERE "ReplayPatchObservation"."observedAt" < EXCLUDED."observedAt"',
  );
  expect(values).toContain("NA1");
  expect(values).toContainEqual(new Date("2026-11-13T20:00:00Z"));
  database.execute.mockResolvedValue(0);
  expect(await persistReplayPatchObservation(observation())).toBe(false);
});

test("corrupt source, patch or native build cannot be persisted", async () => {
  for (const invalid of [
    { ...observation(), patch: "16.21" },
    { ...observation(), gameBuild: "16.22.834.08910" },
    { ...observation(), sourceUrl: observation("EUW1").sourceUrl },
  ])
    await expect(persistReplayPatchObservation(invalid)).rejects.toThrow();
  expect(database.execute).not.toHaveBeenCalled();
});

test("refresh deduplicates completed platforms, bounds concurrency and reports heartbeats", async () => {
  platforms.mockResolvedValue(["NA1", "EUW1", "KR", "NA1"]);
  let active = 0;
  let peak = 0;
  observe.mockImplementation(async (platformId: string) => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return observation(platformId);
  });
  const onProgress = vi.fn();
  expect(
    await refreshReplayPatchObservations({ dependencies: deps, onProgress }),
  ).toEqual({ platforms: 3, updated: 3, unchanged: 0 });
  expect(peak).toBe(2);
  expect(observe).toHaveBeenCalledTimes(3);
  expect(onProgress).toHaveBeenCalledWith({
    phase: "observing",
    platformId: "NA1",
  });
  expect(onProgress).toHaveBeenCalledWith({
    phase: "persisted",
    platformId: "KR",
  });
});

test("one region failure does not prevent other regions from refreshing", async () => {
  platforms.mockResolvedValue(["NA1", "EUW1", "KR"]);
  observe.mockImplementation(async (platformId: string) => {
    await Promise.resolve();
    if (platformId === "EUW1") throw new Error("upstream unavailable");
    return observation(platformId);
  });
  await expect(
    refreshReplayPatchObservations({ dependencies: deps }),
  ).rejects.toThrow("successful platforms were retained");
  expect(persist).toHaveBeenCalledTimes(2);
});

test("cancelled activity cannot persist an observation completed after cancellation", async () => {
  const controller = new AbortController();
  observe.mockImplementation(async () => {
    await Promise.resolve();
    controller.abort(new Error("activity cancelled"));
    return observation();
  });
  await expect(
    refreshReplayPatchObservations({
      dependencies: deps,
      signal: controller.signal,
    }),
  ).rejects.toThrow("activity cancelled");
  expect(observe).toHaveBeenCalledWith("NA1", { signal: controller.signal });
  expect(persist).not.toHaveBeenCalled();
});

test("unknown legacy platforms are not queried by the default source", async () => {
  database.platforms.mockResolvedValue([{ platformId: null }]);
  expect(await refreshReplayPatchObservations()).toEqual({
    platforms: 0,
    updated: 0,
    unchanged: 0,
  });
  expect(database.platforms).toHaveBeenCalledWith({
    where: { uploadState: "COMPLETED", platformId: { not: null } },
    distinct: ["platformId"],
    select: { platformId: true },
    orderBy: { platformId: "asc" },
  });
  expect(database.execute).not.toHaveBeenCalled();
});
