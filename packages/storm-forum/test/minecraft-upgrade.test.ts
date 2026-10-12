import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import legacy from "./fixtures/minecraft-status-v2.json";
import current from "./fixtures/minecraft-status.json";
import { parseMinecraftStatusCache } from "#src/minecraft-cache.ts";
import { readMinecraftStatus, refreshMinecraftStatus } from "#src/minecraft.ts";
import { QueryResultSchema } from "#src/minecraft-query.ts";

const failed = async () => {
  throw new Error("timeout");
};

describe("Minecraft cache upgrades", () => {
  it("reads the production v2 failure cache and recovers on the next refresh", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "storm-status-"));
    const cachePath = path.join(directory, "status.json");
    try {
      await Bun.write(cachePath, JSON.stringify(legacy));
      const previous = await readMinecraftStatus(cachePath);
      expect(previous).toEqual({ ...legacy, schemaVersion: 3 });
      const status = await refreshMinecraftStatus(
        {
          replicas: async () => ({ desired: 1, ready: 1 }),
          java: async () =>
            QueryResultSchema.parse({
              ...current.players,
              version: "26.2",
              games: current.games,
            }),
          bedrock: async () => ({ version: "26.51" }),
        },
        previous,
      );
      await Bun.write(cachePath, JSON.stringify(status));
      expect(await readMinecraftStatus(cachePath)).toEqual(status);
      expect(status.java.state).toBe("online");
      expect(status.players).toEqual(current.players);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("preserves verified versions when the first probe after upgrade fails", async () => {
    const previous = parseMinecraftStatusCache(legacy);
    const status = await refreshMinecraftStatus(
      {
        replicas: async () => ({ desired: 1, ready: 1 }),
        java: failed,
        bedrock: failed,
        report: vi.fn(),
      },
      previous,
    );
    expect(status.java).toEqual({ ...legacy.java, state: "unavailable" });
    expect(status.bedrock).toEqual({ ...legacy.bedrock, state: "unavailable" });
    expect(status.players).toBeUndefined();
  });

  it.each([{ names: [] }, { names: ["Jerred", ".Bedrock Player"] }])(
    "discards old names until identities are verified: %j",
    ({ names }) => {
      const status = parseMinecraftStatusCache({
        ...legacy,
        java: { ...legacy.java, state: "online" },
        players: { maximum: 20, names },
      });
      expect(status?.java).toEqual({ ...legacy.java, state: "unavailable" });
      expect(status?.players).toBeUndefined();
      expect(status?.games).toBeUndefined();
    },
  );

  it.each([
    { ...legacy, schemaVersion: 4 },
    { ...legacy, unexpected: true },
    { ...legacy, players: null },
    { ...legacy, java: { state: "online" } },
    { ...legacy, java: { ...legacy.java, state: "online" } },
    { ...legacy, java: { ...legacy.java, verifiedAt: undefined } },
    { ...legacy, players: { maximum: 20, names: [] } },
    ...[
      { maximum: 20, names: ["Jerred", "Jerred"] },
      { maximum: 0, names: ["Jerred"] },
      { maximum: 20, names: ["<unsafe>"] },
      { maximum: 20, names: {} },
      { maximum: 20, names: [], unexpected: true },
    ].map((players) => ({
      ...legacy,
      java: { ...legacy.java, state: "online" },
      players,
    })),
  ])(
    "rejects corrupt old caches instead of treating them as absent (case %#)",
    (value) => {
      expect(() => parseMinecraftStatusCache(value)).toThrow();
    },
  );

  it("retains the explicit migration of the original count-only cache", () => {
    expect(
      parseMinecraftStatusCache({
        state: "online",
        checkedAt: 1000,
        online: 2,
        maximum: 20,
      }),
    ).toBeUndefined();
    expect(() =>
      parseMinecraftStatusCache({
        state: "online",
        checkedAt: 1000,
        online: -1,
      }),
    ).toThrow();
    expect(parseMinecraftStatusCache(current)).toEqual(current);
  });
});
