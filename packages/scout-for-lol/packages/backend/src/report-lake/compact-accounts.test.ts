import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { prisma as realPrisma } from "#src/database/index.ts";
import { writeAccountsParquet } from "#src/report-lake/compact-accounts.ts";

let buildDir: string | undefined;

afterEach(async () => {
  if (buildDir !== undefined) {
    await rm(buildDir, { recursive: true, force: true });
    buildDir = undefined;
  }
});

describe("writeAccountsParquet", () => {
  test("closes the writer and removes its temp file when canceled", async () => {
    buildDir = await mkdtemp(path.join(tmpdir(), "compact-accounts-"));
    const controller = new AbortController();
    const accounts = Array.from({ length: 500 }, (_, id) => ({
      id,
      alias: "a".repeat(4096),
      puuid: `puuid-${String(id)}`,
      region: "NA1",
      serverId: "server",
      playerId: id,
      player: {
        id,
        alias: "player",
        discordId: null,
      },
    }));
    const prisma = new Proxy(realPrisma, {
      get: (target, property, receiver) =>
        property === "account"
          ? { findMany: async () => accounts }
          : Reflect.get(target, property, receiver),
    });
    const cancel = setTimeout(
      () => controller.abort(new Error("attempt canceled")),
      0,
    );

    try {
      await expect(
        writeAccountsParquet(prisma, buildDir, controller.signal),
      ).rejects.toThrow("attempt canceled");
      expect(await readdir(buildDir)).toEqual([]);
    } finally {
      clearTimeout(cancel);
    }
  });
});
