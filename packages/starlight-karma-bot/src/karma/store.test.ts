import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  disconnectPrisma as disconnectPrismaFunction,
  prisma as prismaClient,
} from "#src/db/index.ts";
import type {
  recordKarma as recordKarmaFunction,
  revokeMessageReactionKarma as revokeMessageReactionKarmaFunction,
} from "./store.ts";

let temporaryDirectory: string;
let previousDatabaseUrl: string | undefined;
let prisma: typeof prismaClient;
let disconnectPrisma: typeof disconnectPrismaFunction;
let recordKarma: typeof recordKarmaFunction;
let revokeMessageReactionKarma: typeof revokeMessageReactionKarmaFunction;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "karma-store-test-"));
  previousDatabaseUrl = Bun.env["DATABASE_URL"];
  const databaseUrl = `file:${temporaryDirectory}/karma.db`;
  Bun.env["DATABASE_URL"] = databaseUrl;

  const migration = Bun.spawn(["bun", "run", "scripts/migrate.ts"], {
    cwd: process.cwd(),
    env: { ...Bun.env, DATABASE_URL: databaseUrl },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await migration.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(migration.stderr).text();
    throw new Error(`Test database migration failed: ${stderr}`);
  }

  const database = await import("#src/db/index.ts");
  const store = await import("./store.ts");
  prisma = database.prisma;
  disconnectPrisma = database.disconnectPrisma;
  recordKarma = store.recordKarma;
  revokeMessageReactionKarma = store.revokeMessageReactionKarma;
});

afterAll(async () => {
  await disconnectPrisma();
  await rm(temporaryDirectory, { recursive: true, force: true });
  if (previousDatabaseUrl === undefined) {
    delete Bun.env["DATABASE_URL"];
  } else {
    Bun.env["DATABASE_URL"] = previousDatabaseUrl;
  }
});

describe("milestone persistence", () => {
  test("does not re-announce after dropping below a milestone", async () => {
    const firstCrossing = await recordKarma({
      giverId: "giver",
      receiverId: "receiver",
      amount: 25,
      guildId: "milestone-guild",
    });
    expect(firstCrossing).toEqual({
      receiverTotalBefore: 0,
      receiverTotalAfter: 25,
      milestone: 25,
    });

    const downwardCrossing = await recordKarma({
      giverId: "receiver",
      receiverId: "receiver",
      amount: -1,
      guildId: "milestone-guild",
    });
    expect(downwardCrossing).toEqual({
      receiverTotalBefore: 25,
      receiverTotalAfter: 24,
      milestone: null,
    });

    const repeatedCrossing = await recordKarma({
      giverId: "giver",
      receiverId: "receiver",
      amount: 1,
      guildId: "milestone-guild",
    });
    expect(repeatedCrossing).toEqual({
      receiverTotalBefore: 24,
      receiverTotalAfter: 25,
      milestone: null,
    });

    const milestoneState = await prisma.milestoneState.findUnique({
      where: {
        guildId_receiverId: {
          guildId: "milestone-guild",
          receiverId: "receiver",
        },
      },
    });
    expect(milestoneState).toMatchObject({ highestAnnounced: 25 });
  });
});

describe("bulk reaction revocation", () => {
  test("removes every reaction award on a message and preserves ordinary gives", async () => {
    await recordKarma({
      giverId: "reaction-giver-one",
      receiverId: "reaction-receiver",
      amount: 1,
      guildId: "reaction-guild",
      sourceMessageId: "message",
    });
    await recordKarma({
      giverId: "reaction-giver-two",
      receiverId: "reaction-receiver",
      amount: 1,
      guildId: "reaction-guild",
      sourceMessageId: "message",
    });
    await recordKarma({
      giverId: "ordinary-giver",
      receiverId: "reaction-receiver",
      amount: 1,
      guildId: "reaction-guild",
    });

    expect(await revokeMessageReactionKarma("message")).toBe(2);
    const remaining = await prisma.karma.findMany({
      where: { guildId: "reaction-guild" },
      select: { giverId: true, sourceMessageId: true },
    });
    expect(remaining).toEqual([
      { giverId: "ordinary-giver", sourceMessageId: null },
    ]);
  });
});
