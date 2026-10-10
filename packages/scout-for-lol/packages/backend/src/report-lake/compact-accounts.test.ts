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
  test("checks cancellation between bounded account pages and removes its temp file", async () => {
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
    const queries: unknown[] = [];
    const prisma = new Proxy(realPrisma, {
      get: (target, property, receiver) =>
        property === "account"
          ? {
              findMany: async (query: unknown) => {
                queries.push(query);
                if (queries.length === 1) return accounts;
                controller.abort(new Error("attempt canceled"));
                return [];
              },
            }
          : Reflect.get(target, property, receiver),
    });

    await expect(
      writeAccountsParquet(prisma, buildDir, controller.signal),
    ).rejects.toThrow("attempt canceled");
    expect(queries).toEqual([
      { include: { player: true }, orderBy: { id: "asc" }, take: 500 },
      {
        include: { player: true },
        orderBy: { id: "asc" },
        take: 500,
        cursor: { id: 499 },
        skip: 1,
      },
    ]);
    expect(await readdir(buildDir)).toEqual([]);
  });

  test("does not query accounts after cancellation", async () => {
    buildDir = await mkdtemp(path.join(tmpdir(), "compact-accounts-"));
    const controller = new AbortController();
    controller.abort(new Error("attempt canceled"));
    let queries = 0;
    const prisma = new Proxy(realPrisma, {
      get: (target, property, receiver) =>
        property === "account"
          ? { findMany: async () => (queries += 1) }
          : Reflect.get(target, property, receiver),
    });

    await expect(
      writeAccountsParquet(prisma, buildDir, controller.signal),
    ).rejects.toThrow("attempt canceled");
    expect(queries).toBe(0);
    expect(await readdir(buildDir)).toEqual([]);
  });
});
